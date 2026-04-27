import path from "node:path";
import type { Db } from "./connection.js";

export type RepoRecord = {
  id: number;
  owner: string;
  name: string;
  installation_id: number;
  clone_path: string;
};

export type PullRequestRecord = {
  id: number;
  repo_id: number;
  pr_number: number;
  base_sha: string;
  head_sha: string;
  last_reviewed_sha: string | null;
  paused: 0 | 1;
  last_summary_comment_id: number | null;
};

export function upsertRepository(db: Db, owner: string, name: string, installationId: number): RepoRecord {
  const clonePath = path.join("repos", "cache", `${owner}__${name}`);
  db.prepare(`
    INSERT INTO repositories (owner, name, installation_id, clone_path)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(owner, name) DO UPDATE SET
      installation_id = excluded.installation_id,
      clone_path = excluded.clone_path
  `).run(owner, name, installationId, clonePath);

  return db.prepare("SELECT * FROM repositories WHERE owner = ? AND name = ?").get(owner, name) as RepoRecord;
}

export function upsertPullRequest(
  db: Db,
  repoId: number,
  prNumber: number,
  baseSha: string,
  headSha: string
): PullRequestRecord {
  db.prepare(`
    INSERT INTO pull_requests (repo_id, pr_number, base_sha, head_sha)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(repo_id, pr_number) DO UPDATE SET
      base_sha = excluded.base_sha,
      head_sha = excluded.head_sha
  `).run(repoId, prNumber, baseSha, headSha);

  return db.prepare(`
    SELECT * FROM pull_requests WHERE repo_id = ? AND pr_number = ?
  `).get(repoId, prNumber) as PullRequestRecord;
}

export function getPullRequestRecord(
  db: Db,
  repoId: number,
  prNumber: number
): PullRequestRecord | undefined {
  return db.prepare(`
    SELECT * FROM pull_requests WHERE repo_id = ? AND pr_number = ?
  `).get(repoId, prNumber) as PullRequestRecord | undefined;
}

export function markReviewed(db: Db, repoId: number, prNumber: number, headSha: string, summaryCommentId?: number): void {
  db.prepare(`
    UPDATE pull_requests
    SET last_reviewed_sha = ?,
        last_summary_comment_id = COALESCE(?, last_summary_comment_id)
    WHERE repo_id = ? AND pr_number = ?
  `).run(headSha, summaryCommentId ?? null, repoId, prNumber);
}

export function setPaused(db: Db, repoId: number, prNumber: number, paused: boolean): void {
  db.prepare("UPDATE pull_requests SET paused = ? WHERE repo_id = ? AND pr_number = ?")
    .run(paused ? 1 : 0, repoId, prNumber);
}
