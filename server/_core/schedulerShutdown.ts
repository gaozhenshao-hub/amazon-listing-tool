type Stop = () => void | Promise<void>;
/** A deadline reports incomplete drain; it does not authorize releasing a
 * still-owned lock, closing the shared DB, or terminating accepted writes. */
export function createSchedulerShutdown(input: {
  stops: Stop[];
  graceMs: number;
  releaseLock: () => Promise<void>;
  closeDatabase: () => Promise<void>;
  onDeadline: (leaderLost: boolean) => void;
  onDrained: (leaderLost: boolean) => void;
}) {
  let leaderLost = false;
  let shutdown: Promise<void> | null = null;
  return (reason: string): Promise<void> => {
    if (reason === "leader_lock_lost") leaderLost = true;
    if (shutdown) return shutdown;
    // Invoke every stop synchronously before awaiting any drain.
    const drains = input.stops.map(stop => { try { return Promise.resolve(stop()); } catch (error) { return Promise.reject(error); } });
    shutdown = (async () => {
      const deadline = setTimeout(() => input.onDeadline(leaderLost), input.graceMs);
      try {
        const results = await Promise.allSettled(drains);
        const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failed) throw new Error("SCHEDULER_DRAIN_UNVERIFIED", { cause: failed.reason });
        // A lost leader connection no longer grants exclusive ownership.
        if (!leaderLost) await input.releaseLock();
        await input.closeDatabase();
        input.onDrained(leaderLost);
      } finally { clearTimeout(deadline); }
    })();
    return shutdown;
  };
}
