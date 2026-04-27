import type { FixInput, FixResult, ReviewInput, ReviewResult } from "../review/schema.js";

export interface LlmAdapter {
  review(input: ReviewInput): Promise<ReviewResult>;
  fix?(input: FixInput): Promise<FixResult>;
}
