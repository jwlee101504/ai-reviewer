import { z } from "zod";

export const ConfigSchema = z.object({
  bot: z.object({
    name: z.string().default("my-ai-reviewer")
  }),
  review: z.object({
    auto_review: z.boolean().default(true),
    auto_incremental_review: z.boolean().default(true),
    max_changed_files: z.number().int().positive().default(80),
    max_changed_lines: z.number().int().positive().default(3000),
    min_confidence: z.number().min(0).max(1).default(0.65),
    ignore: z.array(z.string()).default([])
  }),
  llm: z.object({
    provider: z.enum(["claude-cli", "codex-cli", "openai-api", "anthropic-api"]).default("claude-cli"),
    fallback_provider: z.enum(["claude-cli", "codex-cli", "openai-api", "anthropic-api"]).optional()
  }),
  tools: z.object({
    run_lint: z.boolean().default(false),
    run_tests: z.boolean().default(false)
  }),
  fix: z.object({
    enabled: z.boolean().default(false),
    push_mode: z.enum(["new_branch", "same_pr"]).default("new_branch")
  })
});

export type AppConfig = z.infer<typeof ConfigSchema>;
