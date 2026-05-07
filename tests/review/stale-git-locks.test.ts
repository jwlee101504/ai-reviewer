import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearStaleGitLocks } from "../../src/review/diff.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

async function writeAged(file: string, ageMs: number): Promise<void> {
  await fs.writeFile(file, "");
  const aged = new Date(Date.now() - ageMs);
  await fs.utimes(file, aged, aged);
}

describe("clearStaleGitLocks", () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "ai-reviewer-locks-"));
  });

  afterEach(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it("returns an empty list when there is no .git directory", async () => {
    expect(await clearStaleGitLocks(repoPath)).toEqual([]);
  });

  it("removes top-level lock files older than the threshold", async () => {
    const gitDir = path.join(repoPath, ".git");
    await fs.mkdir(gitDir, { recursive: true });
    const indexLock = path.join(gitDir, "index.lock");
    const headLock = path.join(gitDir, "HEAD.lock");
    await writeAged(indexLock, ONE_HOUR_MS);
    await writeAged(headLock, ONE_HOUR_MS);

    const removed = await clearStaleGitLocks(repoPath);

    expect(removed.sort()).toEqual([headLock, indexLock].sort());
    await expect(fs.access(indexLock)).rejects.toBeDefined();
    await expect(fs.access(headLock)).rejects.toBeDefined();
  });

  it("leaves fresh lock files alone (active git operation)", async () => {
    const gitDir = path.join(repoPath, ".git");
    await fs.mkdir(gitDir, { recursive: true });
    const indexLock = path.join(gitDir, "index.lock");
    await fs.writeFile(indexLock, "");

    const removed = await clearStaleGitLocks(repoPath);

    expect(removed).toEqual([]);
    await expect(fs.access(indexLock)).resolves.toBeUndefined();
  });

  it("removes nested ref locks older than the threshold but leaves real refs alone", async () => {
    const refsDir = path.join(repoPath, ".git", "refs", "heads");
    await fs.mkdir(refsDir, { recursive: true });
    const realRef = path.join(refsDir, "main");
    const stagedLock = path.join(refsDir, "main.lock");
    await fs.writeFile(realRef, "deadbeef\n");
    await writeAged(stagedLock, ONE_HOUR_MS);

    const removed = await clearStaleGitLocks(repoPath);

    expect(removed).toEqual([stagedLock]);
    await expect(fs.readFile(realRef, "utf8")).resolves.toBe("deadbeef\n");
  });

  it("scans logs/refs as well", async () => {
    const logsDir = path.join(repoPath, ".git", "logs", "refs", "heads");
    await fs.mkdir(logsDir, { recursive: true });
    const lock = path.join(logsDir, "feature.lock");
    await writeAged(lock, ONE_HOUR_MS);

    const removed = await clearStaleGitLocks(repoPath);

    expect(removed).toEqual([lock]);
  });

  it("respects a custom maxAgeMs threshold", async () => {
    const gitDir = path.join(repoPath, ".git");
    await fs.mkdir(gitDir, { recursive: true });
    const indexLock = path.join(gitDir, "index.lock");
    await writeAged(indexLock, 30 * 1000);

    expect(await clearStaleGitLocks(repoPath, { maxAgeMs: 60 * 1000 })).toEqual([]);
    expect(await clearStaleGitLocks(repoPath, { maxAgeMs: 10 * 1000 })).toEqual([indexLock]);
  });
});
