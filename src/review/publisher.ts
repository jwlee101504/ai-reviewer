import type { Db } from "../db/connection.js";
import { insertNewFindings } from "../db/findings.js";
import { markReviewed } from "../db/review-state.js";
import { upsertSummaryComment } from "../github/comments.js";
import { publishReview } from "../github/reviews.js";
import type { GitHubClient } from "../github/client.js";
import type { ReviewResult } from "./schema.js";

export async function publishReviewResult(args: {
  db: Db;
  client: GitHubClient;
  owner: string;
  repo: string;
  repoId: number;
  pullNumber: number;
  headSha: string;
  previousSummaryCommentId: number | null;
  result: ReviewResult;
}): Promise<void> {
  const newFindings = insertNewFindings(args.db, args.repoId, args.pullNumber, args.result.findings);
  await publishReview({
    client: args.client,
    owner: args.owner,
    repo: args.repo,
    pullNumber: args.pullNumber,
    headSha: args.headSha,
    findings: newFindings,
    summary: args.result.summary
  });

  const summaryCommentId = await upsertSummaryComment({
    client: args.client,
    owner: args.owner,
    repo: args.repo,
    issueNumber: args.pullNumber,
    previousCommentId: args.previousSummaryCommentId,
    body: formatSummary(args.result.summary, newFindings.length)
  });

  markReviewed(args.db, args.repoId, args.pullNumber, args.headSha, summaryCommentId);
}

function formatSummary(summary: string, newFindingCount: number): string {
  return `<!-- ai-review-bot-summary -->
## AI Review Summary

${summary}

New findings posted: ${newFindingCount}`;
}
