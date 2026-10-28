import { and, eq, inArray, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { aiJobs } from "../../../drizzle/schema/ai_os";
import { workspaces } from "../../../drizzle/schema/auth";
import { acquisitionJobs } from "../../../drizzle/schema/acquisition";
import { kbImageSets } from "../../../drizzle/schema/image";
import { KnowledgeCollectionInputSchema, collectionDisplayAsin, knowledgeCollectionRef, knowledgeCollectionVersion, knowledgeSourceAsin, knowledgeStoredVersion,
  type KnowledgeCollectionInput, type KnowledgeCollectionReceipt } from "../../../shared/knowledgeCollection";
import { requireDb, withDbTransaction } from "../../repositories/dbClient";
import { registerAiJobHandler, updateAiJobProgress, type AiJobSnapshot } from "../../services/aiJobRunner";
import { getBasicImagesProfile } from "./basicProviderProfile";
import { KB_IMAGE_IMPORT_CAPABILITIES } from "./kbImagesAcquisition";
import { createAcquisitionJob, getAcquisitionJob, updateAcquisitionJob } from "./repository";
import { executeAmazonAcquisitionJob } from "./acquisitionJobs";

const BATCH_KIND = "amazon.acquisition.knowledge_batch";
const ACTIVE = new Set(["queued", "running", "review_required"]);

/** Reserve all ASINs and the durable queue entry in one transaction. The workspace
 * row lock also serializes simultaneous submissions from different operators. */
export async function startKnowledgeCollectionBatch(raw: KnowledgeCollectionInput & { workspaceId: number; requestedBy: number }, options: { recollectJobId?: number } = {}): Promise<KnowledgeCollectionReceipt> {
  const input = KnowledgeCollectionInputSchema.parse(raw);
  const asins = [...new Set(input.asins)];
  const request = { asins, mode: input.mode, ...(options.recollectJobId ? { recollectJobId: options.recollectJobId } : {}) };
  const runId = `kb-collect:${raw.workspaceId}:${input.requestId}`;
  return withDbTransaction("Queue knowledge image collection", async tx => {
    const [workspace] = await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, raw.workspaceId)).for("update");
    if (!workspace) throw new TRPCError({ code: "NOT_FOUND", message: "当前工作空间不可用" });
    const [prior] = await tx.select().from(aiJobs).where(eq(aiJobs.runId, runId)).limit(1);
    if (prior) {
      if (prior.userId !== raw.requestedBy || JSON.stringify(prior.input?.request) !== JSON.stringify(request)) {
        throw new TRPCError({ code: "CONFLICT", message: "提交内容已变化，请重新提交" });
      }
      return prior.input.receipt as KnowledgeCollectionReceipt;
    }
    const retryJob = options.recollectJobId ? await getAcquisitionJob(tx, raw.workspaceId, options.recollectJobId) : null;
    if (options.recollectJobId && (!retryJob || retryJob.deletedAt || retryJob.requestedBy !== raw.requestedBy ||
      retryJob.consumerType !== "kb_images" || asins.length !== 1 || knowledgeSourceAsin(retryJob.asin) !== asins[0] ||
      ["queued", "running"].includes(retryJob.status))) {
      throw new TRPCError({ code: "CONFLICT", message: "原采集记录已变化，请刷新后重试" });
    }
    const sets: Array<{ asin: string; sourceAsin: string | null; version: number }> = await tx.select({ asin: kbImageSets.asin, sourceAsin: kbImageSets.sourceAsin, version: kbImageSets.collectionVersion })
      .from(kbImageSets).where(and(eq(kbImageSets.workspaceId, raw.workspaceId), or(
        inArray(sql`UPPER(TRIM(${kbImageSets.sourceAsin}))`, asins),
        inArray(sql`RIGHT(UPPER(TRIM(${kbImageSets.asin})), 10)`, asins))));
    // Deleted history still reserves version numbers, but does not block a normal retry.
    const previousJobs = await tx.select().from(acquisitionJobs).where(and(eq(acquisitionJobs.workspaceId, raw.workspaceId),
      eq(acquisitionJobs.consumerType, "kb_images"), inArray(acquisitionJobs.asin, asins)));
    const receipt: KnowledgeCollectionReceipt = { items: [], skippedItems: [] };
    const accepted: Array<{ asin: string; version: number }> = [];
    for (const asin of asins) {
      const matchingSets = sets.filter(set => (knowledgeSourceAsin(set.sourceAsin) || knowledgeSourceAsin(set.asin)) === asin);
      const matchingJobs = previousJobs.filter((job: any) => job.asin === asin);
      const active = matchingJobs.some((job: any) => !job.deletedAt && ACTIVE.has(job.status) && (!retryJob || job.id !== retryJob.id));
      if (active || (!retryJob && ((input.mode === "normal" && matchingSets.length) || (input.mode === "new_version" && !matchingSets.length)))) {
        receipt.skippedItems.push({ asin, reason: active ? "active" : matchingSets.length ? "exists" : "not_collected" });
        continue;
      }
      const version = !matchingSets.length ? 1 : Math.max(1, ...matchingSets.map(set => knowledgeStoredVersion(set.asin, set.version)),
        ...matchingJobs.map((job: any) => knowledgeCollectionVersion(job.consumerRef))) + 1;
      accepted.push({ asin, version });
    }
    if (!accepted.length) return receipt; // No acquisition task for duplicates.
    const profile = await getBasicImagesProfile(tx, raw.workspaceId);
    if (!profile || !KB_IMAGE_IMPORT_CAPABILITIES.every(capability => Array.isArray(profile.capabilities) && profile.capabilities.includes(capability))) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "系统图片采集尚未配置完整，请联系管理员" });
    }
    for (const { asin, version } of accepted) {
      const jobId = await createAcquisitionJob(tx, { workspaceId: raw.workspaceId, requestedBy: raw.requestedBy, providerProfileId: profile.id,
        consumerType: "kb_images", consumerRef: knowledgeCollectionRef(asin, version), marketplace: "US", asin,
        requestedCapabilities: [...KB_IMAGE_IMPORT_CAPABILITIES], idempotencyKey: `${runId}:${asin}`, status: "queued", cachePolicy: "refresh", maxChargeUsd: "0.0000" });
      receipt.items.push({ asin, version, displayAsin: collectionDisplayAsin(asin, version), jobId, status: "queued", cacheHitSnapshotId: null });
    }
    if (retryJob?.status === "review_required") {
      await updateAcquisitionJob(tx, raw.workspaceId, retryJob.id, { status: "canceled", completedAt: new Date() });
    }
    // The ordinary worker claims this committed row; never schedule before commit.
    // This is native collection, without a model invocation or an Agent binding.
    await tx.insert(aiJobs).values({ workspaceId: raw.workspaceId, runId, kind: BATCH_KIND, module: "amazonAcquisition",
      procedure: "acquisition.collectKnowledge", userId: raw.requestedBy, status: "queued", queueName: "amazon_acquisition",
      maxAttempts: 3, timeoutSeconds: 7200, input: { request, receipt, agentRunId: null, agentNodeId: null } });
    return receipt;
  }, { required: true });
}

export async function runKnowledgeCollectionSequence<T extends { jobId: number }>(items: T[], run: (item: T, index: number) => Promise<void>, signal?: AbortSignal) {
  for (let index = 0; index < items.length; index++) {
    signal?.throwIfAborted();
    await run(items[index], index);
  }
}

async function executeBatch(aiJob: AiJobSnapshot, context?: { signal: AbortSignal }) {
  const receipt = (aiJob.input as { receipt: KnowledgeCollectionReceipt }).receipt;
  const db = await requireDb("Knowledge collection batch");
  const workspaceId = aiJob.workspaceId!;
  await runKnowledgeCollectionSequence(receipt.items, async (item, index) => {
    const child = await getAcquisitionJob(db, workspaceId, item.jobId);
    if (!child || child.requestedBy !== aiJob.userId || child.deletedAt || !["queued", "running"].includes(child.status)) return;
    try {
      await executeAmazonAcquisitionJob({ ...aiJob, input: { acquisitionJobId: item.jobId } }, context);
    } catch (error) {
      context?.signal.throwIfAborted(); // Let worker recovery resume this child after shutdown.
      console.warn("[Knowledge collection] Item failed", item.jobId, error instanceof Error ? error.name : "unknown");
      await updateAcquisitionJob(db, workspaceId, item.jobId, { status: "failed", completedAt: new Date() });
    }
    await updateAiJobProgress(aiJob.runId, Math.round(99 * (index + 1) / receipt.items.length));
  }, context?.signal);
  return { completed: receipt.items.length };
}

registerAiJobHandler({ id: "knowledge-collection-batch", match: job => job.kind === BATCH_KIND && job.module === "amazonAcquisition",
  recoverable: true, handler: executeBatch });
