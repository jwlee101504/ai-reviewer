import fs from "node:fs";
import type { ReviewInput } from "./schema.js";

export function buildReviewPrompt(input: ReviewInput): string {
  const template = fs.readFileSync("prompts/review-user.md", "utf8");
  const analysisLanguage = input.analysisLanguage ?? "English";
  const responseLanguage = input.responseLanguage ?? "Korean";
  return `${template}

PR: ${input.owner}/${input.repo}#${input.pullNumber}
Base: ${input.baseSha}
Head: ${input.headSha}

# Language
- Analyze code, reasoning, and tradeoffs in ${analysisLanguage}.
- Write all human-facing JSON string values in ${responseLanguage}, including summary, finding titles, and finding bodies.
- Keep JSON property names, code, file paths, identifiers, logs, and quoted source text unchanged.
- If a suggestion contains replacement code, keep the code in the original programming language.

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
