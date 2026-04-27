import crypto from "node:crypto";
import type { Db } from "./connection.js";
import type { Finding } from "../review/schema.js";

export function fingerprintFinding(finding: Pick<Finding, "filePath" | "line" | "title" | "body">): string {
  return crypto.createHash("sha256")
    .update(`${finding.filePath}:${finding.line}:${finding.title}:${finding.body}`)
    .digest("hex");
}

export function insertNewFindings(db: Db, repoId: number, prNumber: number, findings: Finding[]): Finding[] {
  const inserted: Finding[] = [];
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO findings
      (repo_id, pr_number, fingerprint, file_path, line, severity, title, body, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
  `);

  for (const finding of findings) {
    const fingerprint = fingerprintFinding(finding);
    const result = stmt.run(repoId, prNumber, fingerprint, finding.filePath, finding.line, finding.severity, finding.title, finding.body);
    if (result.changes > 0) inserted.push({ ...finding, fingerprint });
  }
  return inserted;
}
