import fs from "node:fs";
import path from "node:path";

export function collectContext(repoPath: string, _changedFiles: string[]): string {
  const packageJson = readIfExists(path.join(repoPath, "package.json"));
  const tsconfig = readIfExists(path.join(repoPath, "tsconfig.json"));

  return [
    packageJson ? `## package.json\n\`\`\`json\n${packageJson}\n\`\`\`` : "",
    tsconfig ? `## tsconfig.json\n\`\`\`json\n${tsconfig}\n\`\`\`` : ""
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
