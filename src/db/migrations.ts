import type { Db } from "./connection.js";

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      installation_id INTEGER NOT NULL,
      clone_path TEXT NOT NULL,
      UNIQUE(owner, name)
    );

    CREATE TABLE IF NOT EXISTS pull_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      pr_number INTEGER NOT NULL,
      base_sha TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      last_reviewed_sha TEXT,
      paused INTEGER NOT NULL DEFAULT 0,
      last_summary_comment_id INTEGER,
      UNIQUE(repo_id, pr_number)
    );

    CREATE TABLE IF NOT EXISTS review_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      pr_number INTEGER NOT NULL,
      run_type TEXT NOT NULL,
      base_sha TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      pr_number INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      github_comment_id INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(repo_id, pr_number, fingerprint)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_run_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_ready ON jobs(status, next_run_at, locked_at);
  `);
}
