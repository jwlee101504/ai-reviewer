import type { AppConfig } from "../config/schema.js";
import type { LlmAdapter } from "./adapter.js";
import { ClaudeCliAdapter } from "./claude-cli.js";
import { CodexCliAdapter } from "./codex-cli.js";
import { OpenAiApiAdapter } from "./openai-api.js";

export function createLlmAdapter(config: AppConfig): LlmAdapter {
  switch (config.llm.provider) {
    case "claude-cli":
      return new ClaudeCliAdapter();
    case "codex-cli":
      return new CodexCliAdapter();
    case "openai-api":
      return new OpenAiApiAdapter();
    case "anthropic-api":
      throw new Error("anthropic-api adapter is not implemented yet");
  }
}
