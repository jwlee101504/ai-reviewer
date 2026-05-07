import fs from "node:fs/promises";
import { withPathLock } from "../review/path-lock.js";
import type { Db } from "./connection.js";

export type EvictedRepo = {
  id: number;
  owner: string;
  name: string;
  clonePath: string;
};

type ClaimedRepo = EvictedRepo & { lastUsedAt: string };

export async function evictStaleRepoCaches(args: {
  db: Db;
  maxAgeDays: number;
}): Promise<{ evicted: EvictedRepo[] }> {
  const candidates = args.db.prepare(`
    SELECT id, owner, name, clone_path AS clonePath, last_used_at AS lastUsedAt
    FROM repositories
    WHERE last_used_at IS NOT NULL
      AND datetime(last_used_at) <= datetime('now', ?)
  `).all(`-${args.maxAgeDays} days`) as ClaimedRepo[];

  const recheck = args.db.prepare(
    "SELECT last_used_at AS lastUsedAt FROM repositories WHERE id = ?"
  );
  const markEvicted = args.db.prepare(
    "UPDATE repositories SET last_used_at = NULL WHERE id = ? AND last_used_at = ?"
  );

  const evicted: EvictedRepo[] = [];
  for (const repo of candidates) {
    await withPathLock(repo.clonePath, async () => {
      const row = recheck.get(repo.id) as { lastUsedAt: string | null } | undefined;
      if (!row || row.lastUsedAt !== repo.lastUsedAt) return;
      try {
        await fs.rm(repo.clonePath, { recursive: true, force: true });
      } catch {
        return;
      }
      markEvicted.run(repo.id, repo.lastUsedAt);
      evicted.push({ id: repo.id, owner: repo.owner, name: repo.name, clonePath: repo.clonePath });
    });
  }
  return { evicted };
}
