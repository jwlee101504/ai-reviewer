import fs from "node:fs";
import path from "node:path";

export function collectContext(repoPath: string, changedFiles: string[]): string {
  const packageJson = readIfExists(path.join(repoPath, "package.json"));
  const tsconfig = readIfExists(path.join(repoPath, "tsconfig.json"));
  const snippets = changedFiles.slice(0, 20).map((file) => {
    const absolute = path.join(repoPath, file);
    const content = readIfExists(absolute);
    if (!content) return "";
    return `\n## ${file}\n\`\`\`\n${content.slice(0, 12_000)}\n\`\`\`\n`;
  });

  return [
    packageJson ? `## package.json\n\`\`\`json\n${packageJson}\n\`\`\`` : "",
    tsconfig ? `## tsconfig.json\n\`\`\`json\n${tsconfig}\n\`\`\`` : "",
    ...snippets
  ].filter(Boolean).join("\n");
}

function readIfExists(file: string): string | undefined {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return undefined;
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}
