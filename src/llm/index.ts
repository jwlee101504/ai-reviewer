import type { AppConfig } from "../config/schema.js";
import { createLogger } from "../logger.js";
import type { ReviewInput } from "../review/schema.js";
import type { LlmAdapter, LlmReviewResponse } from "./adapter.js";
import { ClaudeCliAdapter } from "./claude-cli.js";
import { CodexCliAdapter } from "./codex-cli.js";
import { OpenAiApiAdapter } from "./openai-api.js";

const log = createLogger("llm");

type Provider = NonNullable<AppConfig["llm"]["fallback_provider"]>;

export function createLlmAdapter(config: AppConfig): LlmAdapter {
  const primary = buildAdapter(config.llm.provider);
  if (!config.llm.fallback_provider || config.llm.fallback_provider === config.llm.provider) {
    return primary;
  }
  return new FallbackAdapter(primary, buildAdapter(config.llm.fallback_provider), config.llm.fallback_provider);
}

function buildAdapter(provider: Provider): LlmAdapter {
  switch (provider) {
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

class FallbackAdapter implements LlmAdapter {
  constructor(
    private readonly primary: LlmAdapter,
    private readonly fallback: LlmAdapter,
    private readonly fallbackName: Provider
  ) {}

  async review(input: ReviewInput): Promise<LlmReviewResponse> {
    try {
      return await this.primary.review(input);
    } catch (err) {
      log.warn({ err, fallback: this.fallbackName }, "primary llm failed, falling back");
      return this.fallback.review(input);
    }
  }
}
