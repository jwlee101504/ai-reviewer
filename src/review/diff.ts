import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import simpleGit from "simple-git";
import { minimatch } from "minimatch";
import type { AppConfig } from "../config/schema.js";
import { ReviewSkipError } from "./errors.js";
import { withPathLock } from "./path-lock.js";

const GIT_DIFF_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const GIT_TOP_LEVEL_LOCK_FILES = [
  "index.lock",
  "HEAD.lock",
  "ORIG_HEAD.lock",
  "FETCH_HEAD.lock",
  "MERGE_HEAD.lock",
  "shallow.lock",
  "packed-refs.lock",
  "config.lock"
];
const GIT_LOCK_SCAN_DIRS = ["refs", "logs/refs"];
const STALE_GIT_LOCK_AGE_MS = 10 * 60 * 1000;

export type DiffInfo = {
  diff: string;
  changedLines: Map<string, Set<number>>;
  changedFiles: string[];
};

export async function ensureRepoCache(args: {
  remoteUrl: string;
  token: string;
  publicUrl: string;
  clonePath: string;
  headSha: string;
}): Promise<{ clearedLocks: string[] }> {
  return withPathLock(args.clonePath, async () => {
    fs.mkdirSync(path.dirname(args.clonePath), { recursive: true });
    if (!fs.existsSync(path.join(args.clonePath, ".git"))) {
      await simpleGitWithToken(args.token).clone(args.remoteUrl, args.clonePath, ["--no-checkout"]);
    }
    const clearedLocks = await clearStaleGitLocks(args.clonePath);
    const git = simpleGit(args.clonePath);
    try {
      await git.remote(["set-url", "origin", args.remoteUrl]);
      await simpleGitWithToken(args.token, args.clonePath).fetch(["--all", "--prune"]);
      await git.checkout(args.headSha);
    } finally {
      await git.remote(["set-url", "origin", args.publicUrl]);
    }
    return { clearedLocks };
  });
}

export async function clearStaleGitLocks(
  repoPath: string,
  options: { maxAgeMs?: number; now?: number } = {}
): Promise<string[]> {
  const gitDir = path.join(repoPath, ".git");
  try {
    const stat = await fsp.stat(gitDir);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  const maxAgeMs = options.maxAgeMs ?? STALE_GIT_LOCK_AGE_MS;
  const now = options.now ?? Date.now();
  const removed: string[] = [];
  for (const name of GIT_TOP_LEVEL_LOCK_FILES) {
    const file = path.join(gitDir, name);
    if (await tryUnlinkIfStale(file, now, maxAgeMs)) removed.push(file);
  }
  for (const relative of GIT_LOCK_SCAN_DIRS) {
    await collectLocks(path.join(gitDir, relative), now, maxAgeMs, removed);
  }
  return removed;
}

async function collectLocks(dir: string, now: number, maxAgeMs: number, removed: string[]): Promise<void> {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectLocks(full, now, maxAgeMs, removed);
    } else if (entry.isFile() && entry.name.endsWith(".lock")) {
      if (await tryUnlinkIfStale(full, now, maxAgeMs)) removed.push(full);
    }
  }
}

async function tryUnlinkIfStale(file: string, now: number, maxAgeMs: number): Promise<boolean> {
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return false;
  }
  if (now - stat.mtimeMs < maxAgeMs) return false;
  try {
    await fsp.unlink(file);
    return true;
  } catch {
    return false;
  }
}

export async function isShaReachable(repoPath: string, sha: string): Promise<boolean> {
  try {
    await execa("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}

export async function buildDiff(args: {
  repoPath: string;
  fromSha: string;
  toSha: string;
  config: AppConfig;
}): Promise<DiffInfo> {
  const { stdout } = await execa("git", ["diff", "--unified=20", "--function-context", `${args.fromSha}...${args.toSha}`], {
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

function simpleGitWithToken(token: string, baseDir?: string) {
  const auth = Buffer.from(`x-access-token:${token}`).toString("base64");
  return simpleGit({
    baseDir,
    unsafe: {
      allowUnsafeConfigEnvCount: true
    }
  }).env({
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${auth}`
  });
}
