import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { findNewFindings, insertNewFindings } from "../../src/db/findings.js";
import { migrate } from "../../src/db/migrations.js";
import type { Finding } from "../../src/review/schema.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    filePath: "src/a.ts",
    line: 1,
    severity: "medium",
    title: "Bug",
    body: "Body",
    confidence: 0.9,
    ...overrides
  };
}

describe("findNewFindings", () => {
  it("filters findings already stored in the database", () => {
    const db = new Database(":memory:");
    migrate(db);

    try {
      const existing = makeFinding();
      const fresh = makeFinding({ line: 2, title: "Fresh" });
      insertNewFindings(db, 1, 7, [existing]);

      expect(findNewFindings(db, 1, 7, [existing, fresh]).map((finding) => finding.title))
        .toEqual(["Fresh"]);
    } finally {
      db.close();
    }
  });

  it("filters duplicate findings from the same run before publication", () => {
    const db = new Database(":memory:");
    migrate(db);

    try {
      const duplicate = makeFinding();
      const fresh = makeFinding({ line: 2, title: "Fresh" });

      const findings = findNewFindings(db, 1, 7, [duplicate, duplicate, fresh]);

      expect(findings.map((finding) => finding.title)).toEqual(["Bug", "Fresh"]);
      expect(findings.map((finding) => finding.fingerprint)).toHaveLength(2);
      expect(new Set(findings.map((finding) => finding.fingerprint)).size).toBe(2);
    } finally {
      db.close();
    }
  });
});
