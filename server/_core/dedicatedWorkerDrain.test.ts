import { describe, expect, it } from "vitest";
import { observeDedicatedWorkerDrains } from "./dedicatedWorkerDrain";

describe("dedicated shutdown observations before the status write", () => {
  it("observes an early timeout but preserves its failure for the eventual shutdown await", async () => {
    let reject!: (error: Error) => void;
    const cleanup = new Promise<void>((_resolve, fail) => { reject = fail; });
    const result = observeDedicatedWorkerDrains([undefined, cleanup]);
    const error = new Error("SYNTHETIC_LISTING_STOP_TIMEOUT");
    reject(error);
    // Model a slow draining-status write. Without an immediate observer this
    // is an unhandled rejection before central shutdown can attach its await.
    await new Promise<void>(resolve => setImmediate(resolve));
    await expect(result).rejects.toBe(error);
  });
  it("waits for every dedicated cleanup and retains ordinary legacy void drains", async () => {
    let release!: () => void, finished = false;
    const cleanup = new Promise<void>(resolve => { release = resolve; });
    const result = observeDedicatedWorkerDrains([undefined, cleanup, Promise.resolve("settled")]);
    void result.then(() => { finished = true; });
    await Promise.resolve(); expect(finished).toBe(false);
    release(); await expect(result).resolves.toEqual([undefined, undefined, "settled"]);
    expect(finished).toBe(true);
  });
});
