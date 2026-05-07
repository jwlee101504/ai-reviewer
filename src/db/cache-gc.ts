import fs from "node:fs/promises";
import { withPathLock } from "../review/path-lock.js";
import type { Db } from "./connection.js";

export type EvictedRepo = {
  id: number;
  owner: string;
  name: string;
  clonePath: string;
};

export async function evictStaleRepoCaches(args: {
  db: Db;
  maxAgeDays: number;
}): Promise<{ evicted: EvictedRepo[] }> {
  const claimed = args.db.prepare(`
    UPDATE repositories
    SET last_used_at = NULL
    WHERE last_used_at IS NOT NULL
      AND datetime(last_used_at) <= datetime('now', ?)
    RETURNING id, owner, name, clone_path AS clonePath
  `).all(`-${args.maxAgeDays} days`) as EvictedRepo[];

  const recheck = args.db.prepare(
    "SELECT last_used_at FROM repositories WHERE id = ?"
  );
  const evicted: EvictedRepo[] = [];
  for (const repo of claimed) {
    await withPathLock(repo.clonePath, async () => {
      const row = recheck.get(repo.id) as { last_used_at: string | null } | undefined;
      if (!row || row.last_used_at !== null) return;
      try {
        await fs.rm(repo.clonePath, { recursive: true, force: true });
        evicted.push(repo);
      } catch {
        // best-effort: leave NULL marker so next tick retries unless a webhook re-arms first
      }
    });
  }
  return { evicted };
}
