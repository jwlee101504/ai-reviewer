import { execa } from "execa";
import type { ReviewInput, ReviewResult } from "../review/schema.js";
import type { LlmAdapter } from "./adapter.js";
import { CLI_MAX_BUFFER_BYTES, buildFullPrompt, parseReviewOutput } from "./shared.js";

export class ClaudeCliAdapter implements LlmAdapter {
  async review(input: ReviewInput): Promise<ReviewResult> {
    const { stdout } = await execa("claude", ["--print", buildFullPrompt(input)], {
      maxBuffer: CLI_MAX_BUFFER_BYTES
    });
    return parseReviewOutput(stdout);
  }
}
