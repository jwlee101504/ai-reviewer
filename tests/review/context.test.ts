import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectContext } from "../../src/review/context.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("collectContext", () => {
  it("includes project summary and related test context", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-context-"));
    write("README.md", "# Demo\n\nProject overview.");
    write("package.json", JSON.stringify({
      name: "demo",
      scripts: { test: "vitest run" },
      dependencies: { fastify: "1.0.0" },
      private: true
    }));
    write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true } }));
    write("src/service.ts", "export function service() { return 1; }");
    write("src/service.test.ts", "import { service } from './service';");
    write("node_modules/ignored.test.ts", "ignored");

    const context = collectContext(tempDir, ["src/service.ts"]);

    expect(context).toContain("# Project README excerpt");
    expect(context).toContain("Project overview.");
    expect(context).toContain("# package.json summary");
    expect(context).toContain('"scripts"');
    expect(context).not.toContain('"private"');
    expect(context).toContain("# Repository structure");
    expect(context).toContain("src/service.ts");
    expect(context).not.toContain("node_modules/ignored.test.ts");
    expect(context).toContain("# Test files");
    expect(context).toContain("src/service.test.ts");
    expect(context).toContain("# Related test snippets");
    expect(context).toContain("import { service }");
    expect(context).toContain("# Changed file snippets");
  });

  it("stops test discovery after the result budget is reached", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-context-"));
    write("src/generated/file-240.ts", "export function lateFile() { return 1; }");
    for (let index = 0; index < 250; index += 1) {
      write(`src/generated/file-${index}.test.ts`, index === 240 ? "late related test body" : `export const value${index} = ${index};`);
    }

    const context = collectContext(tempDir, ["src/generated/file-240.ts"]);

    expect(context).toContain("src/generated/file-0.test.ts");
    expect(context).not.toContain("late related test body");
  });

  it("does not read changed-file symlinks that resolve outside the repo", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-context-"));
    const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-secret-"));
    const secretFile = path.join(secretDir, "secret.txt");
    fs.writeFileSync(secretFile, "SUPER_SECRET_TOKEN");
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });

    try {
      fs.symlinkSync(secretFile, path.join(tempDir, "src", "leak.txt"));
    } catch {
      fs.rmSync(secretDir, { recursive: true, force: true });
      return;
    }

    try {
      const context = collectContext(tempDir, ["src/leak.txt"]);
      expect(context).not.toContain("SUPER_SECRET_TOKEN");
    } finally {
      fs.rmSync(secretDir, { recursive: true, force: true });
    }
  });

  it("does not read changed paths outside the repo root", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-context-"));
    const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-secret-"));
    fs.writeFileSync(path.join(secretDir, "secret.txt"), "OUTSIDE_REPO_SECRET");

    try {
      const context = collectContext(tempDir, [`../${path.basename(secretDir)}/secret.txt`]);
      expect(context).not.toContain("OUTSIDE_REPO_SECRET");
    } finally {
      fs.rmSync(secretDir, { recursive: true, force: true });
    }
  });
});

function write(relativePath: string, content: string): void {
  if (!tempDir) throw new Error("tempDir is not initialized");
  const absolutePath = path.join(tempDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}
