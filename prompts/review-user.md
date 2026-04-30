Review this pull request diff and relevant context.

Before producing the JSON, reason through these review passes internally:
1. Identify the user-visible behavior changed by the diff.
2. Trace the changed path through direct callers and persistence or external API boundaries.
3. Check edge cases around incremental PR updates, repeated runs, empty results, duplicate findings, deleted or stale comments, and skipped reviews when relevant.
4. Compare the changed code with existing tests and call out a finding only when a concrete regression path remains.
5. Write a summary that shows what was actually reviewed, even if there are no findings.

Return JSON:
{
  "summary": "short markdown summary",
  "findings": [
    {
      "filePath": "path/from/repo/root",
      "line": 123,
      "severity": "low|medium|high|critical",
      "title": "short title",
      "body": "review comment body",
      "confidence": 0.0,
      "suggestion": "optional replacement code"
    }
  ]
}
