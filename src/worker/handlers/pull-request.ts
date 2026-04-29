import type { Db } from "../../db/connection.js";
import { setLastSummaryCommentId, upsertPullRequest, upsertRepository } from "../../db/review-state.js";
import { getInstallationToken } from "../../github/auth.js";
import { githubClient } from "../../github/client.js";
import { upsertSummaryComment } from "../../github/comments.js";
import { httpsCloneUrl, publicRemoteUrl } from "../../github/refs.js";
import { createLogger } from "../../logger.js";
import { collectContext } from "../../review/context.js";
import { buildDiff, ensureRepoCache } from "../../review/diff.js";
import { isReviewSkipError } from "../../review/errors.js";
import { filterFindings } from "../../review/filter.js";
import { publishReviewResult } from "../../review/publisher.js";
import type { AppConfig } from "../../config/schema.js";
import type { LlmAdapter } from "../../llm/adapter.js";

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

  const owner = payload.repository.owner.login;
  const repoName = payload.repository.name;
  const pullNumber = payload.pull_request.number;
  const repo = upsertRepository(db, owner, repoName, payload.installation.id);
  const pr = upsertPullRequest(db, repo.id, pullNumber, payload.pull_request.base.sha, payload.pull_request.head.sha);
  if (pr.paused) {
    log.info({ owner, repo: repoName, pullNumber }, "review skipped because pull request is paused");
    return;
  }

  const fromSha = payload.action === "synchronize" && pr.last_reviewed_sha
    ? pr.last_reviewed_sha
    : payload.pull_request.base.sha;
  const headSha = payload.pull_request.head.sha;
  const reviewStartedAt = Date.now();

  log.info({ owner, repo: repoName, pullNumber, action: payload.action, fromSha, headSha }, "review started");

  const token = await getInstallationToken(payload.installation.id);
  const cacheStartedAt = Date.now();
  await ensureRepoCache({
    cloneUrl: httpsCloneUrl(owner, repoName, token),
    publicUrl: publicRemoteUrl(owner, repoName),
    clonePath: repo.clone_path,
    headSha
  });
  log.info({
    owner,
    repo: repoName,
    pullNumber,
    clonePath: repo.clone_path,
    durationMs: Date.now() - cacheStartedAt
  }, "repository cache ready");

  let diff;
  try {
    const diffStartedAt = Date.now();
    diff = await buildDiff({
      repoPath: repo.clone_path,
      fromSha,
      toSha: headSha,
      config
    });
    log.info({
      owner,
      repo: repoName,
      pullNumber,
      changedFiles: diff.changedFiles.length,
      changedLines: diff.changedLines.size,
      diffChars: diff.diff.length,
      durationMs: Date.now() - diffStartedAt
    }, "diff built");
  } catch (error) {
    if (isReviewSkipError(error)) {
      log.warn({ owner, repo: repoName, pullNumber, reason: error.message }, "review skipped");
      const client = await githubClient(payload.installation.id);
      const commentId = await upsertSummaryComment({
        client,
        owner,
        repo: repoName,
        issueNumber: pullNumber,
        previousCommentId: pr.last_summary_comment_id,
        body: formatSkipSummary(error.message)
      });
      setLastSummaryCommentId(db, repo.id, pullNumber, commentId);
      return;
    }
    throw error;
  }
  if (!diff.diff.trim()) {
    log.info({ owner, repo: repoName, pullNumber }, "review skipped because diff is empty");
    return;
  }

  const contextStartedAt = Date.now();
  const context = collectContext(repo.clone_path, diff.changedFiles);
  log.info({
    owner,
    repo: repoName,
    pullNumber,
    contextChars: context.length,
    changedFiles: diff.changedFiles.length,
    durationMs: Date.now() - contextStartedAt
  }, "review context collected");

  const llmResponse = await args.llm.review({
    owner,
    repo: repoName,
    pullNumber,
    baseSha: fromSha,
    headSha,
    diff: diff.diff,
    context,
    analysisLanguage: config.review.analysis_language,
    responseLanguage: config.review.response_language
  });
  log.info({
    owner,
    repo: repoName,
    pullNumber,
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
    owner,
    repo: repoName,
    pullNumber,
    rawFindings: rawResult.findings.length,
    filteredFindings: result.findings.length,
    minConfidence: config.review.min_confidence
  }, "review findings filtered");

  const client = await githubClient(payload.installation.id);

  const publishStartedAt = Date.now();
  await publishReviewResult({
    db,
    client,
    owner,
    repo: repoName,
    repoId: repo.id,
    pullNumber,
    headSha,
    previousSummaryCommentId: pr.last_summary_comment_id,
    result
  });
  log.info({
    owner,
    repo: repoName,
    pullNumber,
    findings: result.findings.length,
    durationMs: Date.now() - publishStartedAt,
    totalDurationMs: Date.now() - reviewStartedAt
  }, "review published");
}

function formatSkipSummary(reason: string): string {
  return `<!-- ai-review-bot-summary -->
## AI Review Skipped

${reason}

Adjust \`review.max_changed_files\` / \`review.max_changed_lines\` or split the PR to enable review.`;
}
