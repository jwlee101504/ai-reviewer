import { ReviewResultSchema, type ReviewInput, type ReviewResult } from "../review/schema.js";
import { buildReviewPrompt, readSystemPrompt } from "../review/prompt.js";
import type { LlmTextUsage } from "./adapter.js";

export const CLI_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

export function buildFullPrompt(input: ReviewInput): string {
  return `${readSystemPrompt()}\n\n${buildReviewPrompt(input)}`;
}

export function parseReviewOutput(raw: string): ReviewResult {
  return ReviewResultSchema.parse(JSON.parse(extractJson(raw)));
}

export function measureTextUsage(input: string, output: string): LlmTextUsage {
  return {
    inputChars: input.length,
    outputChars: output.length,
    totalChars: input.length + output.length
  };
}

function extractJson(output: string): string {
  const fenced = /```json\s*([\s\S]*?)```/.exec(output);
  if (fenced) return fenced[1].trim();
  const first = output.indexOf("{");
  const last = output.lastIndexOf("}");
  if (first >= 0 && last > first) return output.slice(first, last + 1);
  return output;
}
