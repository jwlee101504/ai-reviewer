import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ReviewResultSchema, type ReviewInput, type ReviewResult } from "../review/schema.js";
import { buildReviewPrompt, readSystemPrompt } from "../review/prompt.js";
import type { LlmAdapter } from "./adapter.js";

export class CodexCliAdapter implements LlmAdapter {
  async review(input: ReviewInput): Promise<ReviewResult> {
    const prompt = `${readSystemPrompt()}\n\n${buildReviewPrompt(input)}`;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-review-bot-"));
    const outputFile = path.join(tempDir, "codex-output.txt");
    try {
      const { stdout } = await execa("codex", [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--output-last-message",
        outputFile,
        "-"
      ], {
        input: prompt,
        maxBuffer: 20 * 1024 * 1024
      });
      const output = await readOutputFile(outputFile, stdout);
      return ReviewResultSchema.parse(JSON.parse(extractJson(output)));
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

async function readOutputFile(file: string, fallback: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return fallback;
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
