/** A single large download keeps the worker's memory and shared server bandwidth bounded. */
export function createVideoDownloadSlot() {
  let occupied = false;
  const waiters: Array<() => void> = [];
  return async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (occupied)
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          const index = waiters.indexOf(ready);
          if (index >= 0) waiters.splice(index, 1);
          reject(signal?.reason || new Error("视频下载已取消"));
        };
        waiters.push(ready);
        signal?.addEventListener("abort", abort, { once: true });
      });
    else occupied = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = waiters.shift();
      if (next) next();
      else occupied = false;
    };
  };
}
