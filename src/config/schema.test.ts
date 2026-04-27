import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema.js";

describe("ConfigSchema", () => {
  it("applies defaults when optional sections are missing", () => {
    const config = ConfigSchema.parse({});

    expect(config.bot.name).toBe("my-ai-reviewer");
    expect(config.review.auto_review).toBe(true);
    expect(config.llm.provider).toBe("claude-cli");
    expect(config.tools.run_lint).toBe(false);
    expect(config.fix.enabled).toBe(false);
  });

  it("keeps provided nested values while defaulting the rest", () => {
    const config = ConfigSchema.parse({
      llm: { provider: "openai-api" },
      review: { response_language: "Korean" }
    });

    expect(config.llm.provider).toBe("openai-api");
    expect(config.review.response_language).toBe("Korean");
    expect(config.review.max_changed_files).toBe(80);
    expect(config.tools.run_tests).toBe(false);
  });
});
