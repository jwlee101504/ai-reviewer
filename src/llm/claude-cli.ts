import { execa } from "execa";
import type { ReviewInput } from "../review/schema.js";
import type { LlmReviewResponse } from "./adapter.js";
import type { LlmAdapter } from "./adapter.js";
import { CLI_MAX_BUFFER_BYTES, buildFullPrompt, measureTextUsage, parseReviewOutput } from "./shared.js";

export class ClaudeCliAdapter implements LlmAdapter {
  async review(input: ReviewInput): Promise<LlmReviewResponse> {
    const startedAt = Date.now();
    const prompt = buildFullPrompt(input);
    const { stdout } = await execa("claude", ["--print", prompt], {
      maxBuffer: CLI_MAX_BUFFER_BYTES
    });
    return {
      result: parseReviewOutput(stdout),
      provider: "claude-cli",
      durationMs: Date.now() - startedAt,
      textUsage: measureTextUsage(prompt, stdout)
    };
  }
}
