/** Tracks accepted scheduler work through its complete promise, including
 * bookkeeping. Stopping admission never cancels/retries accepted work. */
export function createTrackedSchedulerWork() {
  let accepting = true;
  const pending = new Set<Promise<unknown>>();
  return {
    get accepting() { return accepting; },
    get pendingCount() { return pending.size; },
    run(work: () => Promise<unknown>): Promise<void> {
      if (!accepting) return Promise.resolve();
      const result = Promise.resolve().then(work);
      pending.add(result);
      void result.then(() => pending.delete(result), () => pending.delete(result));
      return result.then(() => undefined);
    },
    stop() { accepting = false; },
    async drain() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
  };
}
