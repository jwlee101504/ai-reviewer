Review this pull request diff and relevant context.

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
