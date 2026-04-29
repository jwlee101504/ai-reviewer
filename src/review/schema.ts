import { z } from "zod";

export const FindingSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().positive(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  title: z.string().min(1),
  body: z.string().min(1),
  confidence: z.number().min(0).max(1),
  suggestion: z.string().optional(),
  fingerprint: z.string().optional()
});

export const ReviewResultSchema = z.object({
  summary: z.string().default("No summary provided."),
  findings: z.array(FindingSchema).default([])
});

export type Finding = z.infer<typeof FindingSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export type ReviewInput = {
  owner: string;
  repo: string;
  pullNumber: number;
  baseSha: string;
  headSha: string;
  repoPath: string;
  diff: string;
  context: string;
  analysisLanguage?: string;
  responseLanguage?: string;
};

export type FixInput = {
  finding: Finding;
  context: string;
};

export type FixResult = {
  branchName: string;
  commitMessage: string;
};
