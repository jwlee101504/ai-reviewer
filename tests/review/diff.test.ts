import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../../src/review/diff.js";
import { filterFindings } from "../../src/review/filter.js";

describe("diff parsing and finding filtering", () => {
  it("keeps only findings on added lines", () => {
    const diff = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;
`;
    const parsed = parseUnifiedDiff(diff);
    expect(parsed.changedFiles).toEqual(["src/a.ts"]);
    expect([...parsed.changedLines.get("src/a.ts") ?? []]).toEqual([2]);

    const findings = filterFindings({
      changedLines: parsed.changedLines,
      minConfidence: 0.65,
      findings: [
        { filePath: "src/a.ts", line: 2, severity: "medium", title: "real", body: "body", confidence: 0.9 },
        { filePath: "src/a.ts", line: 3, severity: "medium", title: "old", body: "body", confidence: 0.9 },
        { filePath: "src/a.ts", line: 2, severity: "medium", title: "weak", body: "body", confidence: 0.3 }
      ]
    });

    expect(findings.map((finding) => finding.title)).toEqual(["real"]);
  });
});
