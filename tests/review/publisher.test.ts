import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/migrations.js";
import { upsertPullRequest, upsertRepository } from "../../src/db/review-state.js";
import { formatSummary } from "../../src/review/publisher.js";
import { publishReviewResult } from "../../src/review/publisher.js";

describe("formatSummary", () => {
  it("includes the reviewed commit range and distinguishes total from newly posted findings", () => {
    const summary = formatSummary({
      summary: "No risky changes found.",
      fromSha: "1111111222222233333334444444555555566666",
      headSha: "aaaaaaabbbbbbbcccccccdddddddeeeeeeeffffff",
      totalFindingCount: 1,
      newFindingCount: 0
    });

    expect(summary).toContain("Reviewed range: `1111111...aaaaaaa`");
    expect(summary).toContain("Findings from this run: 1");
    expect(summary).toContain("New findings posted: 0");
    expect(summary).toContain("This comment is updated after each completed review.");
  });

  it("does not persist findings before GitHub review publication succeeds", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const repo = upsertRepository(db, "alice", "demo", 1);
    upsertPullRequest(db, repo.id, 7, "base", "head");
    const createReview = vi.fn().mockRejectedValue(new Error("github unavailable"));
    const client = {
      rest: {
        pulls: { createReview },
        issues: {
          createComment: vi.fn(),
          updateComment: vi.fn()
        }
      }
    };

    try {
      await expect(publishReviewResult({
        db,
        client: client as never,
        owner: "alice",
        repo: "demo",
        repoId: repo.id,
        pullNumber: 7,
        fromSha: "base",
        headSha: "head",
        previousSummaryCommentId: null,
        result: {
          summary: "summary",
          findings: [
            {
              filePath: "src/a.ts",
              line: 1,
              severity: "high",
              title: "Bug",
              body: "Body",
              confidence: 0.9
            }
          ]
        }
      })).rejects.toThrow("github unavailable");

      const row = db.prepare("SELECT COUNT(*) AS count FROM findings").get() as { count: number };
      expect(row.count).toBe(0);
    } finally {
      db.close();
    }
  });
});
