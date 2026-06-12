import type { Db } from "../db/connection.js";
import { findNewFindings, insertNewFindings } from "../db/findings.js";
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
  fromSha: string;
  headSha: string;
  previousSummaryCommentId: number | null;
  result: ReviewResult;
}): Promise<void> {
  const newFindings = findNewFindings(args.db, args.repoId, args.pullNumber, args.result.findings);
  await publishReview({
    client: args.client,
    owner: args.owner,
    repo: args.repo,
    pullNumber: args.pullNumber,
    headSha: args.headSha,
    findings: newFindings,
    summary: args.result.summary
  });
  insertNewFindings(args.db, args.repoId, args.pullNumber, newFindings);

  const summaryCommentId = await upsertSummaryComment({
    client: args.client,
    owner: args.owner,
    repo: args.repo,
    issueNumber: args.pullNumber,
    previousCommentId: args.previousSummaryCommentId,
    body: formatSummary({
      summary: args.result.summary,
      fromSha: args.fromSha,
      headSha: args.headSha,
      totalFindingCount: args.result.findings.length,
      newFindingCount: newFindings.length
    })
  });

  markReviewed(args.db, args.repoId, args.pullNumber, args.headSha, summaryCommentId);
}

export function formatSummary(args: {
  summary: string;
  fromSha: string;
  headSha: string;
  totalFindingCount: number;
  newFindingCount: number;
}): string {
  return `<!-- ai-review-bot-summary -->
## AI Review Summary

${args.summary}

Reviewed range: \`${shortSha(args.fromSha)}...${shortSha(args.headSha)}\`
Findings from this run: ${args.totalFindingCount}
New findings posted: ${args.newFindingCount}

This comment is updated after each completed review.`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
