import { describe, expect, it } from "vitest";
import { formatSummary } from "../../src/review/publisher.js";

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
});
