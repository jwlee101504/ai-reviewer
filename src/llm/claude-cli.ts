import { execa } from "execa";
import { ReviewResultSchema, type ReviewInput, type ReviewResult } from "../review/schema.js";
import { buildReviewPrompt, readSystemPrompt } from "../review/prompt.js";
import type { LlmAdapter } from "./adapter.js";

export class ClaudeCliAdapter implements LlmAdapter {
  async review(input: ReviewInput): Promise<ReviewResult> {
    const prompt = `${readSystemPrompt()}\n\n${buildReviewPrompt(input)}`;
    const { stdout } = await execa("claude", ["--print", prompt], {
      maxBuffer: 20 * 1024 * 1024
    });
    return ReviewResultSchema.parse(JSON.parse(extractJson(stdout)));
  }
}

function extractJson(output: string): string {
  const fenced = /```json\s*([\s\S]*?)```/.exec(output);
  if (fenced) return fenced[1].trim();
  const first = output.indexOf("{");
  const last = output.lastIndexOf("}");
  if (first >= 0 && last > first) return output.slice(first, last + 1);
  return output;
}
