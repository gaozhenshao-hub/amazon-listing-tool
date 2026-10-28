/** Keep the memory-heavy fallback serial within each worker. */
export function createBrowserSlot(waitMs = 180_000) {
  let occupied = false;
  const waiters: Array<() => void> = [];
  return async () => {
    if (occupied) await new Promise<void>((resolve, reject) => {
      const ready = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(ready);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error('Amazon browser capacity timeout'));
      }, waitMs);
      waiters.push(ready);
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
