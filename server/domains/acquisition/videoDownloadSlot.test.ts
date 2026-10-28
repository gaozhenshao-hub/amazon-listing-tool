import { expect, it } from "vitest";
import { createVideoDownloadSlot } from "./videoDownloadSlot";
it("serializes large downloads and releases capacity only once", async () => {
  const acquire = createVideoDownloadSlot(),
    release = await acquire();
  let started = false;
  const next = acquire().then(done => {
    started = true;
    return done;
  });
  await Promise.resolve();
  expect(started).toBe(false);
  release();
  release();
  (await next)();
  (await acquire())();
});
it("removes canceled waiting downloads without blocking the next one", async () => {
  const acquire = createVideoDownloadSlot(),
    release = await acquire(),
    controller = new AbortController();
  const canceled = acquire(controller.signal);
  controller.abort(new Error("canceled"));
  await expect(canceled).rejects.toThrow("canceled");
  const next = acquire();
  release();
  (await next)();
  await expect(acquire(controller.signal)).rejects.toThrow("canceled");
  (await acquire())();
});
