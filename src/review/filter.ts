import type { Finding } from "./schema.js";

export function filterFindings(args: {
  findings: Finding[];
  changedLines: Map<string, Set<number>>;
  minConfidence: number;
}): Finding[] {
  return args.findings.filter((finding) => {
    if (finding.confidence < args.minConfidence) return false;
    const lines = args.changedLines.get(finding.filePath);
    return Boolean(lines?.has(finding.line));
  });
}
