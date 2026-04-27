import { ReviewResultSchema, type ReviewInput, type ReviewResult } from "../review/schema.js";
import { buildReviewPrompt, readSystemPrompt } from "../review/prompt.js";
import type { LlmAdapter } from "./adapter.js";

export class OpenAiApiAdapter implements LlmAdapter {
  async review(input: ReviewInput): Promise<ReviewResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for openai-api provider");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        input: [
          { role: "system", content: readSystemPrompt() },
          { role: "user", content: buildReviewPrompt(input) }
        ],
        text: { format: { type: "json_object" } }
      })
    });

    if (!response.ok) throw new Error(`OpenAI API failed: ${response.status} ${await response.text()}`);
    const data = await response.json() as { output_text?: string };
    return ReviewResultSchema.parse(JSON.parse(data.output_text ?? "{}"));
  }
}
