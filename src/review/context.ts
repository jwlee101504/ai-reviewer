import fs from "node:fs";
import path from "node:path";

const EXCLUDED_DIRS = new Set([
  ".git",
  ".idea",
  ".next",
  ".turbo",
  "coverage",
  "data",
  "dist",
  "node_modules",
  "repos"
]);
const MAX_TEST_FILES = 200;
const MAX_TEST_SEARCH_FILES = 5_000;
const MAX_TEST_SEARCH_DEPTH = 8;
const MAX_TREE_ENTRIES = 120;

export function collectContext(repoPath: string, changedFiles: string[]): string {
  const packageJson = summarizePackageJson(readIfExists(path.join(repoPath, "package.json")));
  const readme = readFirstExisting(repoPath, ["README.md", "readme.md"]);
  const tsconfig = readIfExists(path.join(repoPath, "tsconfig.json"));
  const tree = summarizeDirectoryTree(repoPath);
  const testFiles = findTestFiles(repoPath);
  const relatedTests = findRelatedTests(changedFiles, testFiles);
  const snippets = changedFiles.slice(0, 20).map((file) => {
    const absolute = path.join(repoPath, file);
    const content = readIfExists(absolute);
    if (!content) return "";
    return `\n## ${file}\n\`\`\`\n${content.slice(0, 12_000)}\n\`\`\`\n`;
  });
  const relatedTestSnippets = relatedTests.slice(0, 5).map((file) => {
    const content = readIfExists(path.join(repoPath, file));
    if (!content) return "";
    return `\n## ${file}\n\`\`\`\n${content.slice(0, 8_000)}\n\`\`\`\n`;
  });

  return [
    readme ? `# Project README excerpt\n\`\`\`md\n${readme.slice(0, 8_000)}\n\`\`\`` : "",
    packageJson ? `# package.json summary\n\`\`\`json\n${packageJson}\n\`\`\`` : "",
    tsconfig ? `# tsconfig.json excerpt\n\`\`\`json\n${tsconfig.slice(0, 8_000)}\n\`\`\`` : "",
    tree ? `# Repository structure\n\`\`\`\n${tree}\n\`\`\`` : "",
    testFiles.length ? `# Test files\n\`\`\`\n${testFiles.slice(0, 80).join("\n")}\n\`\`\`` : "",
    relatedTestSnippets.length ? `# Related test snippets\n${relatedTestSnippets.join("\n")}` : "",
    snippets.length ? "# Changed file snippets" : "",
    ...snippets
  ].filter(Boolean).join("\n");
}

function summarizePackageJson(content: string | undefined): string | undefined {
  if (!content) return undefined;
  try {
    const parsed = JSON.parse(content) as {
      name?: unknown;
      type?: unknown;
      scripts?: unknown;
      dependencies?: unknown;
      devDependencies?: unknown;
    };
    return JSON.stringify({
      name: parsed.name,
      type: parsed.type,
      scripts: parsed.scripts,
      dependencies: parsed.dependencies,
      devDependencies: parsed.devDependencies
    }, null, 2);
  } catch {
    return content.slice(0, 8_000);
  }
}

function readFirstExisting(repoPath: string, files: string[]): string | undefined {
  for (const file of files) {
    const content = readIfExists(path.join(repoPath, file));
    if (content) return content;
  }
  return undefined;
}

function summarizeDirectoryTree(repoPath: string): string {
  const lines: string[] = [];
  walkDirectory(repoPath, "", 0, lines);
  return lines.join("\n");
}

function walkDirectory(root: string, relativeDir: string, depth: number, lines: string[]): void {
  if (lines.length >= MAX_TREE_ENTRIES) return;
  if (depth > 2) return;
  const absoluteDir = path.join(root, relativeDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
    if (lines.length >= MAX_TREE_ENTRIES) return;
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    const relativePath = toRepoPath(path.join(relativeDir, entry.name));
    lines.push(`${"  ".repeat(depth)}${entry.isDirectory() ? relativePath + "/" : relativePath}`);
    if (entry.isDirectory()) {
      walkDirectory(root, relativePath, depth + 1, lines);
    }
  }
}

function findTestFiles(repoPath: string): string[] {
  const result: string[] = [];
  const budget = { visitedFiles: 0 };
  walkFiles(repoPath, "", result, budget, (file) => (
    /(^|\/)(__tests__|test|tests)\//.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
  ));
  return result;
}

function walkFiles(
  root: string,
  relativeDir: string,
  result: string[],
  budget: { visitedFiles: number },
  include: (file: string) => boolean
): void {
  if (result.length >= MAX_TEST_FILES || budget.visitedFiles >= MAX_TEST_SEARCH_FILES) return;
  const depth = relativeDir ? relativeDir.split("/").length : 0;
  if (depth > MAX_TEST_SEARCH_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (result.length >= MAX_TEST_FILES || budget.visitedFiles >= MAX_TEST_SEARCH_FILES) return;
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    const relativePath = toRepoPath(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) {
      walkFiles(root, relativePath, result, budget, include);
    } else {
      budget.visitedFiles += 1;
      if (include(relativePath)) {
        result.push(relativePath);
      }
    }
  }
}

function findRelatedTests(changedFiles: string[], testFiles: string[]): string[] {
  const related = new Set<string>();
  for (const changedFile of changedFiles) {
    const changedDir = path.posix.dirname(toRepoPath(changedFile));
    const changedBase = stripKnownExtensions(path.posix.basename(changedFile));
    for (const testFile of testFiles) {
      const testDir = path.posix.dirname(testFile);
      const testBase = stripKnownExtensions(path.posix.basename(testFile).replace(/\.(test|spec)$/, ""));
      if (testDir === changedDir || testBase === changedBase || testFile.includes(`/${changedBase}.`)) {
        related.add(testFile);
      }
    }
  }
  return [...related];
}

function stripKnownExtensions(file: string): string {
  return file.replace(/\.[cm]?[jt]sx?$/, "");
}

function toRepoPath(file: string): string {
  return file.split(path.sep).join("/");
}

function readIfExists(file: string): string | undefined {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return undefined;
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}
