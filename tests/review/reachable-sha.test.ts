import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isShaReachable } from "../../src/review/diff.js";

describe("isShaReachable", () => {
  let repoPath: string;
  let firstSha: string;
  let secondSha: string;

  beforeAll(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "ai-reviewer-sha-test-"));
    const run = (args: string[]) => execa("git", args, { cwd: repoPath });
    await run(["init", "-q", "-b", "main"]);
    await run(["config", "user.email", "test@example.com"]);
    await run(["config", "user.name", "Test"]);
    await run(["commit", "-q", "--allow-empty", "-m", "first"]);
    firstSha = (await run(["rev-parse", "HEAD"])).stdout.trim();
    await run(["commit", "-q", "--allow-empty", "-m", "second"]);
    secondSha = (await run(["rev-parse", "HEAD"])).stdout.trim();
  });

  afterAll(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it("returns true for a reachable commit", async () => {
    expect(await isShaReachable(repoPath, firstSha)).toBe(true);
    expect(await isShaReachable(repoPath, secondSha)).toBe(true);
  });

  it("returns false for an unknown sha", async () => {
    expect(await isShaReachable(repoPath, "0".repeat(40))).toBe(false);
  });

  it("returns false when the path is not a repo", async () => {
    const notRepo = await fs.mkdtemp(path.join(os.tmpdir(), "ai-reviewer-sha-test-norepo-"));
    try {
      expect(await isShaReachable(notRepo, firstSha)).toBe(false);
    } finally {
      await fs.rm(notRepo, { recursive: true, force: true });
    }
  });
});
