import { describe, expect, it } from "vitest";
import { buildReviewPrompt } from "../../src/review/prompt.js";

describe("buildReviewPrompt", () => {
  it("includes language instructions for analysis and response output", () => {
    const prompt = buildReviewPrompt({
      owner: "owner",
      repo: "repo",
      pullNumber: 1,
      baseSha: "base",
      headSha: "head",
      repoPath: "/repo",
      diff: "+const value = 1;",
      context: "context",
      analysisLanguage: "English",
      responseLanguage: "Korean"
    });

    expect(prompt).toContain("Analyze code, reasoning, and tradeoffs in English.");
    expect(prompt).toContain("Write all human-facing JSON string values in Korean");
  });
});
