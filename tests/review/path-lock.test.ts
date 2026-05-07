import { describe, expect, it } from "vitest";
import { withPathLock } from "../../src/review/path-lock.js";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("withPathLock", () => {
  it("serializes work for the same key", async () => {
    const order: string[] = [];
    const first = deferred<void>();
    const second = deferred<void>();

    const a = withPathLock("repo", async () => {
      order.push("a:start");
      await first.promise;
      order.push("a:end");
    });
    const b = withPathLock("repo", async () => {
      order.push("b:start");
      await second.promise;
      order.push("b:end");
    });

    await Promise.resolve();
    expect(order).toEqual(["a:start"]);
    second.resolve();
    await Promise.resolve();
    expect(order).toEqual(["a:start"]);
    first.resolve();
    await a;
    await b;
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("does not block work for different keys", async () => {
    const order: string[] = [];
    const gate = deferred<void>();

    const slow = withPathLock("a", async () => {
      order.push("slow:start");
      await gate.promise;
      order.push("slow:end");
    });
    const fast = withPathLock("b", async () => {
      order.push("fast");
    });

    await fast;
    expect(order).toEqual(["slow:start", "fast"]);
    gate.resolve();
    await slow;
    expect(order).toEqual(["slow:start", "fast", "slow:end"]);
  });

  it("releases the lock when the worker throws", async () => {
    await expect(
      withPathLock("repo", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    let ran = false;
    await withPathLock("repo", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
