import type { Db } from "./connection.js";

export type Job = {
  id: number;
  event_type: string;
  payload_json: string;
  attempts: number;
};

export const JOB_LOCK_TIMEOUT_MINUTES = 15;

export function enqueueJob(db: Db, eventType: string, payload: unknown): number {
  const json = typeof payload === "string" ? payload : JSON.stringify(payload);
  const result = db.prepare(`
    INSERT INTO jobs (event_type, payload_json, status)
    VALUES (?, ?, 'pending')
  `).run(eventType, json);
  return Number(result.lastInsertRowid);
}

export function recoverStaleJobs(db: Db, timeoutMinutes = JOB_LOCK_TIMEOUT_MINUTES): number {
  const result = db.prepare(`
    UPDATE jobs
    SET status = 'pending', locked_at = NULL
    WHERE status = 'running'
      AND (locked_at IS NULL OR datetime(locked_at) <= datetime('now', ?))
  `).run(`-${timeoutMinutes} minutes`);
  return result.changes;
}

export function claimNextJob(db: Db, timeoutMinutes = JOB_LOCK_TIMEOUT_MINUTES): Job | undefined {
  const tx = db.transaction(() => {
    const job = db.prepare(`
      SELECT id, event_type, payload_json, attempts
      FROM jobs
      WHERE (
              (status = 'pending' AND locked_at IS NULL)
              OR (status = 'running' AND datetime(locked_at) <= datetime('now', ?))
            )
        AND datetime(next_run_at) <= datetime('now')
      ORDER BY id
      LIMIT 1
    `).get(`-${timeoutMinutes} minutes`) as Job | undefined;

    if (!job) return undefined;
    db.prepare(`
      UPDATE jobs
      SET locked_at = CURRENT_TIMESTAMP, status = 'running', attempts = attempts + 1
      WHERE id = ?
    `).run(job.id);
    return job;
  });
  return tx();
}

export function completeJob(db: Db, id: number): void {
  db.prepare("UPDATE jobs SET status = 'done', locked_at = NULL WHERE id = ?").run(id);
}

export function failJob(db: Db, id: number, attempts: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const terminal = attempts + 1 >= 5;
  db.prepare(`
    UPDATE jobs
    SET status = ?,
        locked_at = NULL,
        error = ?,
        next_run_at = datetime('now', ?)
    WHERE id = ?
  `).run(terminal ? "failed" : "pending", message, `+${Math.min(60, 2 ** attempts)} minutes`, id);
}
