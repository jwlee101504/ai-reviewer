import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectContext } from "./context.js";

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
});

function write(relativePath: string, content: string): void {
  if (!tempDir) throw new Error("tempDir is not initialized");
  const absolutePath = path.join(tempDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}
