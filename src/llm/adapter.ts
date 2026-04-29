import type { FixInput, FixResult, ReviewInput, ReviewResult } from "../review/schema.js";

export type LlmTextUsage = {
  inputChars: number;
  outputChars: number;
  totalChars: number;
};

export type LlmReviewResponse = {
  result: ReviewResult;
  provider: string;
  model?: string;
  durationMs: number;
  textUsage?: LlmTextUsage;
};

export interface LlmAdapter {
  review(input: ReviewInput): Promise<LlmReviewResponse>;
  fix?(input: FixInput): Promise<FixResult>;
}
