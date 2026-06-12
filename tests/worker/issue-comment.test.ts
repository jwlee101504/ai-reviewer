import { describe, expect, it } from "vitest";
import { isTrustedCommentAuthor } from "../../src/worker/handlers/issue-comment.js";

describe("isTrustedCommentAuthor", () => {
  it("allows repository collaborators to run bot commands", () => {
    expect(isTrustedCommentAuthor("OWNER")).toBe(true);
    expect(isTrustedCommentAuthor("MEMBER")).toBe(true);
    expect(isTrustedCommentAuthor("COLLABORATOR")).toBe(true);
  });

  it("rejects untrusted comment authors", () => {
    expect(isTrustedCommentAuthor("CONTRIBUTOR")).toBe(false);
    expect(isTrustedCommentAuthor("FIRST_TIMER")).toBe(false);
    expect(isTrustedCommentAuthor("NONE")).toBe(false);
    expect(isTrustedCommentAuthor(undefined)).toBe(false);
  });
});
