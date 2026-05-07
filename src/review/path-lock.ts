const tails = new Map<string, Promise<void>>();

export async function withPathLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let resolveCurrent: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve;
  });
  const chained = previous.then(() => current);
  tails.set(key, chained);
  try {
    await previous;
    return await fn();
  } finally {
    resolveCurrent();
    if (tails.get(key) === chained) {
      tails.delete(key);
    }
  }
}
