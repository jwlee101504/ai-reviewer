import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import simpleGit from "simple-git";
import { minimatch } from "minimatch";
import type { AppConfig } from "../config/schema.js";
import { ReviewSkipError } from "./errors.js";

const GIT_DIFF_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

export type DiffInfo = {
  diff: string;
  changedLines: Map<string, Set<number>>;
  changedFiles: string[];
};

export async function ensureRepoCache(args: {
  cloneUrl: string;
  publicUrl: string;
  clonePath: string;
  headSha: string;
}): Promise<void> {
  fs.mkdirSync(path.dirname(args.clonePath), { recursive: true });
  if (!fs.existsSync(path.join(args.clonePath, ".git"))) {
    await simpleGit().clone(args.cloneUrl, args.clonePath, ["--no-checkout"]);
  }
  const git = simpleGit(args.clonePath);
  try {
    await git.remote(["set-url", "origin", args.cloneUrl]);
    await git.fetch(["--all", "--prune"]);
    await git.checkout(args.headSha);
  } finally {
    await git.remote(["set-url", "origin", args.publicUrl]);
  }
}

export async function buildDiff(args: {
  repoPath: string;
  fromSha: string;
  toSha: string;
  config: AppConfig;
}): Promise<DiffInfo> {
  const { stdout } = await execa("git", ["diff", "--unified=80", `${args.fromSha}...${args.toSha}`], {
    cwd: args.repoPath,
    maxBuffer: GIT_DIFF_MAX_BUFFER_BYTES
  });
  const parsed = parseUnifiedDiff(stdout);
  const changedFiles = parsed.changedFiles.filter((file) => !isIgnored(file, args.config.review.ignore));
  const changedLines = new Map([...parsed.changedLines.entries()].filter(([file]) => changedFiles.includes(file)));
  const diff = filterDiffFiles(stdout, changedFiles);

  const lineCount = [...changedLines.values()].reduce((sum, lines) => sum + lines.size, 0);
  if (changedFiles.length > args.config.review.max_changed_files) {
    throw new ReviewSkipError(
      `PR has ${changedFiles.length} changed files, over max_changed_files (${args.config.review.max_changed_files}).`
    );
  }
  if (lineCount > args.config.review.max_changed_lines) {
    throw new ReviewSkipError(
      `PR has ${lineCount} changed lines, over max_changed_lines (${args.config.review.max_changed_lines}).`
    );
  }

  return { diff, changedFiles, changedLines };
}

export function parseUnifiedDiff(diff: string): Pick<DiffInfo, "changedFiles" | "changedLines"> {
  const changedFiles: string[] = [];
  const changedLines = new Map<string, Set<number>>();
  let currentFile: string | undefined;
  let newLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length);
      changedFiles.push(currentFile);
      changedLines.set(currentFile, new Set());
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!currentFile || line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      changedLines.get(currentFile)?.add(newLine);
      newLine += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      continue;
    } else {
      newLine += 1;
    }
  }

  return { changedFiles, changedLines };
}

function isIgnored(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(file, pattern, { dot: true, matchBase: true }));
}

function filterDiffFiles(diff: string, allowedFiles: string[]): string {
  const allowed = new Set(allowedFiles);
  const chunks = diff.split(/^diff --git /m);
  return chunks
    .filter(Boolean)
    .map((chunk) => `diff --git ${chunk}`)
    .filter((chunk) => {
      const match = /\+\+\+ b\/(.+)/.exec(chunk);
      return match ? allowed.has(match[1].trim()) : false;
    })
    .join("");
}
