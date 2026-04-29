import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ReviewInput } from "../review/schema.js";
import type { LlmAdapter } from "./adapter.js";
import type { LlmReviewResponse } from "./adapter.js";
import { CLI_MAX_BUFFER_BYTES, buildFullPrompt, measureTextUsage, parseReviewOutput } from "./shared.js";

export class CodexCliAdapter implements LlmAdapter {
  async review(input: ReviewInput): Promise<LlmReviewResponse> {
    const startedAt = Date.now();
    const prompt = buildFullPrompt(input);
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
        maxBuffer: CLI_MAX_BUFFER_BYTES
      });
      const output = await readOutputFile(outputFile, stdout);
      return {
        result: parseReviewOutput(output),
        provider: "codex-cli",
        durationMs: Date.now() - startedAt,
        textUsage: measureTextUsage(prompt, output)
      };
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
