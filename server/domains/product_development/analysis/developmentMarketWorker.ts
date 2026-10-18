import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { RuntimeRole } from "../../../_core/runtime";
import { requireDb } from "../../../repositories/dbClient";
import { createDevelopmentMarketExecution } from "./developmentMarketExecution";
import { developmentMarketEnabled, developmentMarketRepository } from "./developmentMarketService";
const id = z.number().int().min(1).max(2147483647), hintSchema = z.object({ id, userId: id, workspaceId: id, devProjectId: id,
  operationId: z.string().uuid().refine(value => value === value.toLowerCase()) }).strict();
export type DevelopmentMarketQueueHint = z.infer<typeof hintSchema>;
export const shouldProcessDevelopmentMarket = (role: RuntimeRole, env = process.env) => role === "worker" && env.ENABLE_DEVELOPMENT_MARKET_WRITES === "true" && env.ENABLE_DEVELOPMENT_MARKET_WORKER === "true";
/** Metadata discovery is not authority; claim does fresh physical admission,
 * workspace/project policy, complete source and original-UUID lease checks. */
export async function discoverDevelopmentMarket(afterId: number, limit: number): Promise<DevelopmentMarketQueueHint[]> {
  if (!Number.isSafeInteger(afterId) || afterId < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new Error("DEVELOPMENT_MARKET_QUEUE_INVALID");
  if (!developmentMarketEnabled()) return [];
  const db = await requireDb("Development market discovery"), result = await db.execute(sql`SELECT id,userId,workspaceId,
    CAST(JSON_UNQUOTE(JSON_EXTRACT(input,'$.devProjectId')) AS UNSIGNED) AS devProjectId,JSON_UNQUOTE(JSON_EXTRACT(input,'$.operationId')) AS operationId
    FROM ai_jobs WHERE kind='product.development.market_overview.v1' AND id>${afterId} AND status IN ('queued','running')
    AND (leaseUntil IS NULL OR leaseUntil<=NOW(3)) ORDER BY id ASC LIMIT ${limit}`);
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > limit) throw new Error("DEVELOPMENT_MARKET_QUEUE_INVALID");
  const hints = z.array(hintSchema).parse(result[0]); if (hints.some((hint, index) => hint.id <= (index ? hints[index - 1].id : afterId))) throw new Error("DEVELOPMENT_MARKET_QUEUE_INVALID");
  return developmentMarketEnabled() ? hints : [];
}
export function createDevelopmentMarketWorker(dependencies: Partial<{ enabled: () => boolean; discover: typeof discoverDevelopmentMarket;
  process: ReturnType<typeof createDevelopmentMarketExecution>; workerId: string; report: (state: "discovery_failed" | "processing_failed" | "drain_timeout") => void }> = {}) {
  const enabled = dependencies.enabled ?? developmentMarketEnabled, discover = dependencies.discover ?? discoverDevelopmentMarket,
    process = dependencies.process ?? createDevelopmentMarketExecution({ repository: developmentMarketRepository, enabled }),
    report = dependencies.report ?? (state => console.warn("[DevelopmentMarketWorker]", { state })), workerId = dependencies.workerId ?? `devmarket-${randomUUID()}`,
    controller = new AbortController();
  let stopped = false, cursor = 0, running: Promise<void> | null = null;
  return {
    tick(): Promise<void> {
      if (stopped || !enabled()) return Promise.resolve(); if (running) return running;
      running = (async () => { try {
        const hints = await discover(cursor, 10); if (!hints.length) { cursor = 0; return; }
        for (const hint of hints) { if (stopped || !enabled()) return; cursor = hint.id;
          try { await process({ identity: { workspaceId: hint.workspaceId, userId: hint.userId }, operation: { expectedWorkspaceId: hint.workspaceId,
            devProjectId: hint.devProjectId, operationId: hint.operationId }, workerId, signal: controller.signal }); } catch { report("processing_failed"); }
        }
      } catch { report("discovery_failed"); } finally { running = null; } })(); return running;
    },
    async stop(timeoutMs = 30_000) {
      stopped = true; controller.abort(); if (!running) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const drained = await Promise.race([running.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), Math.max(1, Math.min(timeoutMs, 60_000))); })]);
      if (timer) clearTimeout(timer); if (!drained) report("drain_timeout");
    },
  };
}
export function startDevelopmentMarketWorker(role: RuntimeRole) {
  if (!shouldProcessDevelopmentMarket(role)) return async () => {};
  const worker = createDevelopmentMarketWorker(), timer = setInterval(() => { void worker.tick(); }, 5000); timer.unref(); void worker.tick();
  return async () => { clearInterval(timer); await worker.stop(); };
}
