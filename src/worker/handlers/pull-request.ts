import type { Db } from "../../db/connection.js";
import { upsertPullRequest, upsertRepository } from "../../db/review-state.js";
import { getInstallationToken } from "../../github/auth.js";
import { githubClient } from "../../github/client.js";
import { httpsCloneUrl, publicRemoteUrl } from "../../github/refs.js";
import { collectContext } from "../../review/context.js";
import { buildDiff, ensureRepoCache } from "../../review/diff.js";
import { filterFindings } from "../../review/filter.js";
import { publishReviewResult } from "../../review/publisher.js";
import type { AppConfig } from "../../config/schema.js";
import type { LlmAdapter } from "../../llm/adapter.js";

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
  if (pr.paused) return;

  const fromSha = payload.action === "synchronize" && pr.last_reviewed_sha
    ? pr.last_reviewed_sha
    : payload.pull_request.base.sha;
  const headSha = payload.pull_request.head.sha;

  const token = await getInstallationToken(payload.installation.id);
  await ensureRepoCache({
    cloneUrl: httpsCloneUrl(owner, repoName, token),
    publicUrl: publicRemoteUrl(owner, repoName),
    clonePath: repo.clone_path,
    headSha
  });

  const diff = await buildDiff({
    repoPath: repo.clone_path,
    fromSha,
    toSha: headSha,
    config
  });
  if (!diff.diff.trim()) {
    return;
  }

  const context = collectContext(repo.clone_path, diff.changedFiles);
  const rawResult = await args.llm.review({
    owner,
    repo: repoName,
    pullNumber,
    baseSha: fromSha,
    headSha,
    diff: diff.diff,
    context
  });
  const result = {
    ...rawResult,
    findings: filterFindings({
      findings: rawResult.findings,
      changedLines: diff.changedLines,
      minConfidence: config.review.min_confidence
    })
  };

  const client = await githubClient(payload.installation.id);
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
}
