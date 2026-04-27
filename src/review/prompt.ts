import fs from "node:fs";
import type { ReviewInput } from "./schema.js";

export function buildReviewPrompt(input: ReviewInput): string {
  const template = fs.readFileSync("prompts/review-user.md", "utf8");
  return `${template}

PR: ${input.owner}/${input.repo}#${input.pullNumber}
Base: ${input.baseSha}
Head: ${input.headSha}

# Diff
\`\`\`diff
${input.diff}
\`\`\`

# Context
${input.context}
`;
}

export function readSystemPrompt(): string {
  return fs.readFileSync("prompts/review-system.md", "utf8");
}
