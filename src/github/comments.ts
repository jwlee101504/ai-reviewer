import type { GitHubClient } from "./client.js";

export async function upsertSummaryComment(args: {
  client: GitHubClient;
  owner: string;
  repo: string;
  issueNumber: number;
  previousCommentId: number | null;
  body: string;
}): Promise<number> {
  if (args.previousCommentId) {
    try {
      await args.client.rest.issues.updateComment({
        owner: args.owner,
        repo: args.repo,
        comment_id: args.previousCommentId,
        body: args.body
      });
      return args.previousCommentId;
    } catch {
      // If the old comment was deleted, create a new one below.
    }
  }

  const { data } = await args.client.rest.issues.createComment({
    owner: args.owner,
    repo: args.repo,
    issue_number: args.issueNumber,
    body: args.body
  });
  return data.id;
}
