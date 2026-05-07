import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evictStaleRepoCaches } from "../../src/db/cache-gc.js";
import { migrate } from "../../src/db/migrations.js";
import { upsertRepository } from "../../src/db/review-state.js";
import { withPathLock } from "../../src/review/path-lock.js";
import type { Db } from "../../src/db/connection.js";

async function makeRepoCache(workspace: string, owner: string, name: string): Promise<string> {
  const repoPath = path.join(workspace, `${owner}__${name}`);
  await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });
  await fs.writeFile(path.join(repoPath, ".git", "HEAD"), "ref: refs/heads/main\n");
  return repoPath;
}

function setLastUsedAt(db: Db, id: number, daysAgo: number): void {
  db.prepare(
    "UPDATE repositories SET last_used_at = datetime('now', ?) WHERE id = ?"
  ).run(`-${daysAgo} days`, id);
}

describe("evictStaleRepoCaches", () => {
  let workspace: string;
  let prevCacheDir: string | undefined;
  let db: Db;
  let dbFile: string;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "ai-reviewer-gc-"));
    prevCacheDir = process.env.REPO_CACHE_DIR;
    process.env.REPO_CACHE_DIR = workspace;
    dbFile = path.join(workspace, "test.sqlite");
    db = new Database(dbFile);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  afterEach(async () => {
    db.close();
    if (prevCacheDir === undefined) delete process.env.REPO_CACHE_DIR;
    else process.env.REPO_CACHE_DIR = prevCacheDir;
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("evicts only repos older than the threshold and keeps fresh ones", async () => {
    const stale = upsertRepository(db, "alice", "old", 1);
    const fresh = upsertRepository(db, "alice", "new", 2);
    const stalePath = await makeRepoCache(workspace, "alice", "old");
    const freshPath = await makeRepoCache(workspace, "alice", "new");
    expect(stale.clone_path).toBe(stalePath);
    expect(fresh.clone_path).toBe(freshPath);

    setLastUsedAt(db, stale.id, 60);
    setLastUsedAt(db, fresh.id, 5);

    const result = await evictStaleRepoCaches({ db, maxAgeDays: 30 });

    expect(result.evicted.map((repo) => repo.id)).toEqual([stale.id]);
    await expect(fs.access(stalePath)).rejects.toBeDefined();
    await expect(fs.access(freshPath)).resolves.toBeUndefined();
  });

  it("marks evicted rows so they are not re-evicted on next run", async () => {
    const repo = upsertRepository(db, "alice", "old", 1);
    await makeRepoCache(workspace, "alice", "old");
    setLastUsedAt(db, repo.id, 60);

    const first = await evictStaleRepoCaches({ db, maxAgeDays: 30 });
    const second = await evictStaleRepoCaches({ db, maxAgeDays: 30 });

    expect(first.evicted).toHaveLength(1);
    expect(second.evicted).toHaveLength(0);

    const row = db.prepare("SELECT last_used_at FROM repositories WHERE id = ?").get(repo.id) as { last_used_at: string | null };
    expect(row.last_used_at).toBeNull();
  });

  it("re-arms eviction after the next upsertRepository call", async () => {
    const repo = upsertRepository(db, "alice", "old", 1);
    await makeRepoCache(workspace, "alice", "old");
    setLastUsedAt(db, repo.id, 60);

    await evictStaleRepoCaches({ db, maxAgeDays: 30 });
    upsertRepository(db, "alice", "old", 1);

    const row = db.prepare("SELECT last_used_at FROM repositories WHERE id = ?").get(repo.id) as { last_used_at: string | null };
    expect(row.last_used_at).not.toBeNull();
  });

  it("skips eviction when last_used_at is re-armed before the path lock is acquired", async () => {
    const repo = upsertRepository(db, "alice", "old", 1);
    const repoPath = await makeRepoCache(workspace, "alice", "old");
    setLastUsedAt(db, repo.id, 60);

    let releaseBlocker: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blocker = withPathLock(repo.clone_path, async () => {
      await blocked;
    });

    const gcPromise = evictStaleRepoCaches({ db, maxAgeDays: 30 });
    upsertRepository(db, "alice", "old", 1);
    releaseBlocker();
    await blocker;
    const result = await gcPromise;

    expect(result.evicted).toEqual([]);
    await expect(fs.access(repoPath)).resolves.toBeUndefined();
    const row = db.prepare("SELECT last_used_at FROM repositories WHERE id = ?").get(repo.id) as { last_used_at: string | null };
    expect(row.last_used_at).not.toBeNull();
  });

  it("leaves the row armed when fs.rm fails so the next tick retries", async () => {
    const repo = upsertRepository(db, "alice", "old", 1);
    const repoPath = await makeRepoCache(workspace, "alice", "old");
    setLastUsedAt(db, repo.id, 60);
    const before = db.prepare("SELECT last_used_at AS lastUsedAt FROM repositories WHERE id = ?").get(repo.id) as { lastUsedAt: string };

    const rmSpy = vi.spyOn(fs, "rm").mockRejectedValueOnce(new Error("simulated rm failure"));
    try {
      const first = await evictStaleRepoCaches({ db, maxAgeDays: 30 });
      expect(first.evicted).toEqual([]);
    } finally {
      rmSpy.mockRestore();
    }

    const after = db.prepare("SELECT last_used_at AS lastUsedAt FROM repositories WHERE id = ?").get(repo.id) as { lastUsedAt: string };
    expect(after.lastUsedAt).toBe(before.lastUsedAt);
    await expect(fs.access(repoPath)).resolves.toBeUndefined();

    const second = await evictStaleRepoCaches({ db, maxAgeDays: 30 });
    expect(second.evicted.map((r) => r.id)).toEqual([repo.id]);
    await expect(fs.access(repoPath)).rejects.toBeDefined();
  });

  it("preserves dependent pull_requests rows (clone files only are deleted)", async () => {
    const repo = upsertRepository(db, "alice", "old", 1);
    await makeRepoCache(workspace, "alice", "old");
    db.prepare(
      "INSERT INTO pull_requests (repo_id, pr_number, base_sha, head_sha) VALUES (?, ?, ?, ?)"
    ).run(repo.id, 7, "base", "head");
    setLastUsedAt(db, repo.id, 60);

    await evictStaleRepoCaches({ db, maxAgeDays: 30 });

    const pr = db.prepare("SELECT pr_number FROM pull_requests WHERE repo_id = ?").get(repo.id);
    expect(pr).toEqual({ pr_number: 7 });
  });
});
