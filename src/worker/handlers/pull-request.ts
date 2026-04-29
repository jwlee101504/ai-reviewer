import type { Db } from "../../db/connection.js";
import {
  setLastSummaryCommentId,
  upsertPullRequest,
  upsertRepository,
  type PullRequestRecord,
  type RepoRecord
} from "../../db/review-state.js";
import { getInstallationToken } from "../../github/auth.js";
import { githubClient } from "../../github/client.js";
import { upsertSummaryComment } from "../../github/comments.js";
import { publicRemoteUrl } from "../../github/refs.js";
import { createLogger } from "../../logger.js";
import { collectContext } from "../../review/context.js";
import { buildDiff, ensureRepoCache, type DiffInfo } from "../../review/diff.js";
import { isReviewSkipError } from "../../review/errors.js";
import { filterFindings } from "../../review/filter.js";
import { publishReviewResult } from "../../review/publisher.js";
import type { AppConfig } from "../../config/schema.js";
import type { LlmAdapter } from "../../llm/adapter.js";
import type { ReviewResult } from "../../review/schema.js";

const log = createLogger("pull-request-handler");

type PullRequestPayload = {
  action: string;
  installation?: { id: number };
  repository: {
    name: string;
    owner: { login: string };
  };
  pull_request: {
    number: number;
    base: { sha: string };
    head: { sha: string };
  };
};

type ReviewTarget = {
  installationId: number;
  owner: string;
  repoName: string;
  pullNumber: number;
  repo: RepoRecord;
  pr: PullRequestRecord;
  fromSha: string;
  headSha: string;
};

export async function handlePullRequestJob(args: {
  db: Db;
  config: AppConfig;
  llm: LlmAdapter;
  payload: unknown;
}): Promise<void> {
  const { db, config } = args;
  const payload = args.payload as PullRequestPayload;
  if (!["opened", "reopened", "synchronize"].includes(payload.action)) return;
  if (payload.action !== "synchronize" && !config.review.auto_review) return;
  if (payload.action === "synchronize" && !config.review.auto_incremental_review) return;
  if (!payload.installation?.id) throw new Error("Missing installation id");

  const target = prepareReviewTarget(db, payload);
  if (target.pr.paused) {
    log.info(reviewLogFields(target), "review skipped because pull request is paused");
    return;
  }

  const reviewStartedAt = Date.now();
  log.info({
    ...reviewLogFields(target),
    action: payload.action,
    fromSha: target.fromSha,
    headSha: target.headSha
  }, "review started");

  await ensureReviewCache(target);

  let diff;
  try {
    diff = await buildReviewDiff(target, config);
  } catch (error) {
    if (isReviewSkipError(error)) {
      await publishSkipSummary(db, target, error.message);
      return;
    }
    throw error;
  }
  if (!diff.diff.trim()) {
    log.info(reviewLogFields(target), "review skipped because diff is empty");
    return;
  }

  const context = collectReviewContext(target, diff);
  const result = await runReview(args.llm, target, diff, context, config);
  const client = await githubClient(target.installationId);

  const publishStartedAt = Date.now();
  await publishReviewResult({
    db,
    client,
    owner: target.owner,
    repo: target.repoName,
    repoId: target.repo.id,
    pullNumber: target.pullNumber,
    headSha: target.headSha,
    previousSummaryCommentId: target.pr.last_summary_comment_id,
    result
  });
  log.info({
    ...reviewLogFields(target),
    findings: result.findings.length,
    durationMs: Date.now() - publishStartedAt,
    totalDurationMs: Date.now() - reviewStartedAt
  }, "review published");
}

function prepareReviewTarget(db: Db, payload: PullRequestPayload): ReviewTarget {
  const installationId = payload.installation?.id;
  if (!installationId) throw new Error("Missing installation id");

  const owner = payload.repository.owner.login;
  const repoName = payload.repository.name;
  const pullNumber = payload.pull_request.number;
  const repo = upsertRepository(db, owner, repoName, installationId);
  const pr = upsertPullRequest(db, repo.id, pullNumber, payload.pull_request.base.sha, payload.pull_request.head.sha);
  const fromSha = payload.action === "synchronize" && pr.last_reviewed_sha
    ? pr.last_reviewed_sha
    : payload.pull_request.base.sha;

  return {
    installationId,
    owner,
    repoName,
    pullNumber,
    repo,
    pr,
    fromSha,
    headSha: payload.pull_request.head.sha
  };
}

async function ensureReviewCache(target: ReviewTarget): Promise<void> {
  const token = await getInstallationToken(target.installationId);
  const cacheStartedAt = Date.now();
  const remoteUrl = publicRemoteUrl(target.owner, target.repoName);
  await ensureRepoCache({
    remoteUrl,
    token,
    publicUrl: remoteUrl,
    clonePath: target.repo.clone_path,
    headSha: target.headSha
  });
  log.info({
    ...reviewLogFields(target),
    clonePath: target.repo.clone_path,
    durationMs: Date.now() - cacheStartedAt
  }, "repository cache ready");
}

async function buildReviewDiff(target: ReviewTarget, config: AppConfig): Promise<DiffInfo> {
  const diffStartedAt = Date.now();
  const diff = await buildDiff({
    repoPath: target.repo.clone_path,
    fromSha: target.fromSha,
    toSha: target.headSha,
    config
  });
  log.info({
    ...reviewLogFields(target),
    changedFiles: diff.changedFiles.length,
    changedLines: diff.changedLines.size,
    diffChars: diff.diff.length,
    durationMs: Date.now() - diffStartedAt
  }, "diff built");
  return diff;
}

function collectReviewContext(target: ReviewTarget, diff: DiffInfo): string {
  const contextStartedAt = Date.now();
  const context = collectContext(target.repo.clone_path, diff.changedFiles);
  log.info({
    ...reviewLogFields(target),
    contextChars: context.length,
    changedFiles: diff.changedFiles.length,
    durationMs: Date.now() - contextStartedAt
  }, "review context collected");
  return context;
}

async function runReview(
  llm: LlmAdapter,
  target: ReviewTarget,
  diff: DiffInfo,
  context: string,
  config: AppConfig
): Promise<ReviewResult> {
  const llmResponse = await llm.review({
    owner: target.owner,
    repo: target.repoName,
    pullNumber: target.pullNumber,
    baseSha: target.fromSha,
    headSha: target.headSha,
    repoPath: target.repo.clone_path,
    diff: diff.diff,
    context,
    analysisLanguage: config.review.analysis_language,
    responseLanguage: config.review.response_language
  });
  log.info({
    ...reviewLogFields(target),
    provider: llmResponse.provider,
    model: llmResponse.model,
    durationMs: llmResponse.durationMs,
    inputChars: llmResponse.textUsage?.inputChars,
    outputChars: llmResponse.textUsage?.outputChars,
    totalChars: llmResponse.textUsage?.totalChars
  }, "llm review completed");

  const rawResult = llmResponse.result;
  const result = {
    ...rawResult,
    findings: filterFindings({
      findings: rawResult.findings,
      changedLines: diff.changedLines,
      minConfidence: config.review.min_confidence
    })
  };
  log.info({
    ...reviewLogFields(target),
    rawFindings: rawResult.findings.length,
    filteredFindings: result.findings.length,
    minConfidence: config.review.min_confidence
  }, "review findings filtered");
  return result;
}

async function publishSkipSummary(db: Db, target: ReviewTarget, reason: string): Promise<void> {
  log.warn({ ...reviewLogFields(target), reason }, "review skipped");
  const client = await githubClient(target.installationId);
  const commentId = await upsertSummaryComment({
    client,
    owner: target.owner,
    repo: target.repoName,
    issueNumber: target.pullNumber,
    previousCommentId: target.pr.last_summary_comment_id,
    body: formatSkipSummary(reason)
  });
  setLastSummaryCommentId(db, target.repo.id, target.pullNumber, commentId);
}

function reviewLogFields(target: ReviewTarget): { owner: string; repo: string; pullNumber: number } {
  return {
    owner: target.owner,
    repo: target.repoName,
    pullNumber: target.pullNumber
  };
}

function formatSkipSummary(reason: string): string {
  return `<!-- ai-review-bot-summary -->
## AI Review Skipped

${reason}

Adjust \`review.max_changed_files\` / \`review.max_changed_lines\` or split the PR to enable review.`;
}
