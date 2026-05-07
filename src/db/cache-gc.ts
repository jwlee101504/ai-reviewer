import fs from "node:fs/promises";
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
  const stale = args.db.prepare(`
    SELECT id, owner, name, clone_path AS clonePath
    FROM repositories
    WHERE last_used_at IS NOT NULL
      AND datetime(last_used_at) <= datetime('now', ?)
  `).all(`-${args.maxAgeDays} days`) as EvictedRepo[];

  const markEvicted = args.db.prepare(
    "UPDATE repositories SET last_used_at = NULL WHERE id = ?"
  );
  const evicted: EvictedRepo[] = [];
  for (const repo of stale) {
    try {
      await fs.rm(repo.clonePath, { recursive: true, force: true });
      markEvicted.run(repo.id);
      evicted.push(repo);
    } catch {
      // best-effort: skip; next tick can retry
    }
  }
  return { evicted };
}
