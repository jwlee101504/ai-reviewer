import type { GitHubClient } from "./client.js";
import type { Finding } from "../review/schema.js";

export async function publishReview(args: {
  client: GitHubClient;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  findings: Finding[];
  summary: string;
}): Promise<void> {
  if (args.findings.length === 0) return;

  await args.client.rest.pulls.createReview({
    owner: args.owner,
    repo: args.repo,
    pull_number: args.pullNumber,
    commit_id: args.headSha,
    event: "COMMENT",
    body: args.summary,
    comments: args.findings.map((finding) => ({
      path: finding.filePath,
      line: finding.line,
      side: "RIGHT" as const,
      body: formatFindingBody(finding)
    }))
  });
}

function formatFindingBody(finding: Finding): string {
  const header = `**${finding.severity.toUpperCase()}: ${finding.title}**`;
  const body = finding.suggestion
    ? `${finding.body}\n\n\`\`\`suggestion\n${finding.suggestion}\n\`\`\``
    : finding.body;
  return `${header}\n\n${body}`;
}
