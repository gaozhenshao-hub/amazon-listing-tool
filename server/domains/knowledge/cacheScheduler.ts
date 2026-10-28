import { createTrackedSchedulerWork } from "../../_core/trackedSchedulerWork";
import { requireDb } from "../../repositories/dbClient";
import { sweepKnowledgeCache } from "../acquisition/cacheExpiry";
import { knowledgeCacheCleanupEnabled } from "../acquisition/cacheRetention";
import { cleanupKnowledgeObjects } from "./assetLifecycle";

/** The process-wide scheduler leader admits one bounded sweep at a time. */
export function startKnowledgeCacheScheduler() {
  if (!knowledgeCacheCleanupEnabled()) return async () => {};
  const work = createTrackedSchedulerWork();
  const signal = new AbortController().signal;
  const tick = () => {
    if (work.pendingCount || !work.accepting) return;
    void work
      .run(async () => {
        const expiry = await sweepKnowledgeCache(signal);
        const files = await cleanupKnowledgeObjects(await requireDb(), signal);
        if (expiry.checked || files.checked)
          console.info("[KnowledgeCache]", {
            ...expiry,
            filesChecked: files.checked,
          });
      })
      .catch(() =>
        console.error(
          "[KnowledgeCache] sweep failed; will retry on the next interval"
        )
      );
  };
  const initial = setTimeout(tick, 60_000);
  const interval = setInterval(tick, 15 * 60_000);
  return async () => {
    clearTimeout(initial);
    clearInterval(interval);
    work.stop();
    await work.drain();
  };
}
