import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { RuntimeRole } from "../../_core/runtime";
import { requireDb } from "../../repositories/dbClient";
import { createImageTaggingExecution } from "./imageTaggingExecution";
import { imageTaggingImages } from "./imageTaggingImages";
import { imageTaggingRepository, imageTaggingWorkerEnabled, loadImageTaggingConfiguration } from "./imageTaggingService";

const id = z.number().int().min(1).max(2147483647);
const hintSchema = z.object({ id, userId: id, workspaceId: id, imageSetId: id,
  operationId: z.string().uuid().refine(value => value === value.toLowerCase()) }).strict();
export type ImageTaggingQueueHint = z.infer<typeof hintSchema>;
export function shouldProcessImageTagging(role: RuntimeRole, env: NodeJS.ProcessEnv = process.env) {
  return role === "worker" && env.ENABLE_IMAGE_TAGGING_WRITES === "true" && env.ENABLE_IMAGE_TAGGING_WORKER === "true";
}
/** Discovery reads only bounded metadata. A hint grants no resource authority;
 * the dedicated processor rechecks complete schema, owner, source and lease. */
export async function discoverImageTagging(afterId: number, limit: number): Promise<ImageTaggingQueueHint[]> {
  if (!Number.isSafeInteger(afterId) || afterId < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new Error("IMAGE_TAGGING_QUEUE_INVALID");
  if (!imageTaggingWorkerEnabled()) return [];
  const db = await requireDb("Image tagging discovery");
  const result = await db.execute(sql`SELECT id,userId,workspaceId,CAST(JSON_UNQUOTE(JSON_EXTRACT(input,'$.imageSetId')) AS UNSIGNED) AS imageSetId,
    JSON_UNQUOTE(JSON_EXTRACT(input,'$.operationId')) AS operationId FROM ai_jobs
    WHERE kind='knowledge.image_tagging.v1' AND id>${afterId} AND status IN ('queued','running')
      AND (leaseUntil IS NULL OR leaseUntil<=NOW(3)) ORDER BY id ASC LIMIT ${limit}`);
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > limit) throw new Error("IMAGE_TAGGING_QUEUE_INVALID");
  const hints = z.array(hintSchema).parse(result[0]);
  if (hints.some((hint, index) => hint.id <= (index ? hints[index - 1].id : afterId))) throw new Error("IMAGE_TAGGING_QUEUE_INVALID");
  return imageTaggingWorkerEnabled() ? hints : [];
}
export function createImageTaggingWorker(dependencies: Partial<{ enabled: () => boolean;
  discover: typeof discoverImageTagging; process: ReturnType<typeof createImageTaggingExecution>;
  report: (state: "discovery_failed" | "processing_failed" | "drain_timeout") => void; workerId: string }> = {}) {
  const enabled = dependencies.enabled ?? imageTaggingWorkerEnabled, discover = dependencies.discover ?? discoverImageTagging;
  const report = dependencies.report ?? (state => console.warn("[ImageTaggingWorker]", { state }));
  const process = dependencies.process ?? createImageTaggingExecution({ repository: imageTaggingRepository,
    readImage: imageTaggingImages.read, loadConfiguration: loadImageTaggingConfiguration, enabled });
  const controller = new AbortController(), workerId = dependencies.workerId ?? `tagger-${randomUUID()}`;
  let stopped = false, cursor = 0, running: Promise<void> | null = null;
  return {
    tick(): Promise<void> {
      if (stopped || !enabled()) return Promise.resolve();
      if (running) return running;
      running = (async () => {
        try {
          const hints = await discover(cursor, 10);
          if (!hints.length) { cursor = 0; return; }
          for (const hint of hints) {
            if (stopped || !enabled()) return;
            cursor = hint.id;
            try { await process({ identity: { userId: hint.userId, workspaceId: hint.workspaceId },
              operation: { expectedWorkspaceId: hint.workspaceId, imageSetId: hint.imageSetId, operationId: hint.operationId }, workerId, signal: controller.signal }); }
            catch { report("processing_failed"); }
          }
        } catch { report("discovery_failed"); }
        finally { running = null; }
      })();
      return running;
    },
    async stop(timeoutMs = 30_000): Promise<void> {
      stopped = true; controller.abort();
      if (!running) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const completed = await Promise.race([running.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), Math.max(1, Math.min(timeoutMs, 60_000))); })]);
      if (timer) clearTimeout(timer);
      if (!completed) report("drain_timeout");
    },
  };
}
export function startImageTaggingWorker(role: RuntimeRole) {
  if (!shouldProcessImageTagging(role)) return async () => {};
  const worker = createImageTaggingWorker(), timer = setInterval(() => { void worker.tick(); }, 5000);
  timer.unref(); void worker.tick();
  return async () => { clearInterval(timer); await worker.stop(); };
}
