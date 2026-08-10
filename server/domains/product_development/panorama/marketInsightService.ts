import { z } from "zod";
import * as devDb from "../../../devDb";
import {
  cancelAiJob,
  generateAiJobRunId,
  getAiJobRun,
  registerAiJobHandler,
  startRegisteredAiJob,
  updateAiJobProgress,
  type AiJobSnapshot,
} from "../../ai_os/services/jobRunner";
import { runEmperorSkill, safeParseSkillJSON } from "../../ai_os/services/skillRunner";
import { registerPanoramaMarketInsightArtifact } from "../../ai_os/services/businessArtifactRegistry";
import { mapToProductData } from "../analysis/dataHelpers";
import { buildAdaptivePriceBands, normalizeParentMarketMetrics, sanitizePriceBands } from "./marketMetrics";
import { panoramaMarketInsightResultSchema, type PanoramaMarketInsightResult } from "./marketInsightSchema";
import {
  claimMarketInsightRun,
  getMarketInsight,
  updateMarketInsight,
  updateMarketInsightForRun,
} from "./marketInsightRepository";

const marketInsightJobInput = z.object({ projectId: z.number().int().positive() });
const ACTIVE_STATUSES = new Set(["queued", "running"]);

function parseStoredResult(value: unknown): PanoramaMarketInsightResult | null {
  const parsed = panoramaMarketInsightResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function getPanoramaMarketInsight(projectId: number) {
  const insight = await getMarketInsight(projectId);
  if (!insight) return null;
  const result = parseStoredResult(insight.editedResult) || parseStoredResult(insight.rawResult);
  const job = insight.runId ? await getAiJobRun(insight.runId).catch(() => null) : null;
  return {
    ...insight,
    result,
    job: job ? { status: job.status, progress: job.progress, attempt: job.attempt, maxAttempts: job.maxAttempts, error: job.error } : null,
  };
}

export async function queuePanoramaMarketInsight(input: {
  projectId: number;
  userId: number;
  workspaceId?: number | null;
}) {
  const current = await getMarketInsight(input.projectId);
  if (current?.runId && ACTIVE_STATUSES.has(current.status)) {
    const job = await getAiJobRun(current.runId).catch(() => null);
    if (job && ["queued", "running"].includes(job.status)) {
      return { runId: current.runId, status: current.status, progress: job.progress, alreadyRunning: true };
    }
  }

  const runId = generateAiJobRunId("dev_panorama_market");
  await claimMarketInsightRun({ ...input, runId });
  try {
    await startRegisteredAiJob({
      runId,
      kind: "dev.panorama.marketInsight",
      module: "productDevelopment",
      procedure: "devPanorama.generateMarketInsight",
      workspaceId: input.workspaceId ?? null,
      userId: input.userId,
      projectId: input.projectId,
      skillSlug: "dev.panorama.market_insights",
      input: { projectId: input.projectId },
      progress: 5,
      priority: 20,
      queueName: "analysis",
      maxAttempts: 2,
      timeoutSeconds: 240,
    });
  } catch (error) {
    await updateMarketInsightForRun(input.projectId, runId, {
      status: "failed",
      runError: error instanceof Error ? error.message : String(error),
      runCompletedAt: new Date(),
    });
    throw error;
  }
  return { runId, status: "queued" as const, progress: 5, alreadyRunning: false };
}

async function runPanoramaMarketInsight(job: AiJobSnapshot, signal: AbortSignal) {
  const { projectId } = marketInsightJobInput.parse(job.input);
  const progress = async (value: number, error: string | null = null) => {
    const current = await updateMarketInsightForRun(projectId, job.runId, {
      status: "running",
      runProgress: value,
      runError: error,
    });
    if (current) {
      await updateAiJobProgress(job.runId, value, {
        expectedWorkerId: job.lockedBy || undefined,
        expectedAttempt: job.attempt,
      });
    }
    return current;
  };

  try {
    if (!await progress(15)) return { skipped: true, reason: "任务已被新的运行替代" };
    const [products, tags, reviews] = await Promise.all([
      devDb.getDevProductsByProject(projectId),
      devDb.getDevProductTags(projectId),
      devDb.getDevReviewsByProject(projectId),
    ]);
    if (products.length < 2) throw new Error("至少需要 2 个竞品 ASIN 才能生成主要竞争对手分析");

    const normalized = normalizeParentMarketMetrics(products.map(mapToProductData));
    const representatives = normalized
      .filter((product) => product.parentSalesRepresentative)
      .sort((left, right) => (right.monthlySales || 0) - (left.monthlySales || 0));
    const deterministicBands = buildAdaptivePriceBands(normalized);
    const tagMap = new Map<string, Record<string, string>>();
    for (const tag of tags) {
      const current = tagMap.get(tag.asin) || {};
      current[tag.dimensionName] = tag.dimensionValue;
      tagMap.set(tag.asin, current);
    }
    const reviewSamples = reviews.slice(0, 160).map((review) => ({
      asin: review.asin,
      rating: review.rating,
      title: review.title,
      content: String(review.content || "").slice(0, 600),
    }));
    const context = {
      schemaVersion: "1.0",
      metricPolicy: {
        salesSource: "parent_asin_only",
        representativeRule: "highest_reported_parent_sales_row_per_parent_asin",
        childSalesExcluded: true,
      },
      fallbackPriceBands: deterministicBands,
      competitors: representatives.slice(0, 16).map((product) => ({
        asin: product.asin,
        parentAsin: product.parentAsin,
        title: product.title,
        brand: product.brand,
        price: product.price,
        parentMonthlySales: product.monthlySales,
        parentMonthlyRevenue: product.monthlyRevenue,
        rating: product.rating,
        reviewCount: product.reviewCount,
        category: product.category,
        tags: tagMap.get(product.asin) || {},
      })),
      reviewSamples,
    };
    if (!await progress(40)) return { skipped: true, reason: "任务已被新的运行替代" };

    const skillResult = await runEmperorSkill<PanoramaMarketInsightResult>({
      skillSlug: "dev.panorama.market_insights",
      userId: job.userId,
      workspaceId: job.workspaceId,
      context: JSON.stringify(context),
      variables: { schemaVersion: "1.0", maxCompetitors: 3, priceBandCount: "4-5" },
      migrationSource: "drizzle/0131_dev_panorama_market_insights.sql",
      maxModelAttempts: 1,
      signal,
      validate: (content) => {
        const parsed = safeParseSkillJSON<PanoramaMarketInsightResult>(content);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || "raw" in parsed) {
          throw new Error("皇帝 Skill dev.panorama.market_insights 未返回有效 JSON");
        }
        const withSafeBands = {
          ...parsed,
          priceBands: sanitizePriceBands((parsed as any).priceBands, deterministicBands),
        };
        return panoramaMarketInsightResultSchema.parse(withSafeBands);
      },
    });
    if (!await progress(85)) return { skipped: true, reason: "任务已被新的运行替代" };

    const completed = await updateMarketInsightForRun(projectId, job.runId, {
      status: "ready",
      rawResult: skillResult.parsed,
      editedResult: null,
      runProgress: 100,
      runError: null,
      runCompletedAt: new Date(),
      version: (await getMarketInsight(projectId))?.version || 1,
    });
    if (completed) {
      const insight = await getMarketInsight(projectId);
      if (insight) await registerPanoramaMarketInsightArtifact(insight.id, "ai_output").catch(() => null);
      return skillResult.parsed;
    }
    return { skipped: true, reason: "任务已被新的运行替代" };
  } catch (error) {
    const finalAttempt = job.attempt >= job.maxAttempts || signal.aborted;
    await updateMarketInsightForRun(projectId, job.runId, {
      status: finalAttempt ? (signal.aborted ? "canceled" : "failed") : "running",
      runError: finalAttempt
        ? (error instanceof Error ? error.message : String(error))
        : `本次调用失败，后台将自动重试（${job.attempt}/${job.maxAttempts}）`,
      runCompletedAt: finalAttempt ? new Date() : null,
    });
    throw error;
  }
}

export async function savePanoramaMarketInsight(projectId: number, userId: number, value: unknown) {
  const parsed = panoramaMarketInsightResultSchema.parse(value);
  const current = await getMarketInsight(projectId);
  if (!current) throw new Error("请先生成主要竞争对手分析");
  const updated = await updateMarketInsight(projectId, {
    userId,
    status: "editing",
    editedResult: parsed,
    confirmedAt: null,
    confirmedBy: null,
    version: current.version + 1,
  });
  if (updated) await registerPanoramaMarketInsightArtifact(updated.id, "user_edit").catch(() => null);
  return updated;
}

export async function confirmPanoramaMarketInsight(projectId: number, userId: number, value: unknown) {
  const parsed = panoramaMarketInsightResultSchema.parse(value);
  const current = await getMarketInsight(projectId);
  if (!current) throw new Error("请先生成主要竞争对手分析");
  const updated = await updateMarketInsight(projectId, {
    userId,
    status: "confirmed",
    editedResult: parsed,
    confirmedAt: new Date(),
    confirmedBy: userId,
    version: current.version + 1,
  });
  if (updated) await registerPanoramaMarketInsightArtifact(updated.id, "user_edit").catch(() => null);
  return updated;
}

export async function unlockPanoramaMarketInsight(projectId: number, userId: number) {
  const current = await getMarketInsight(projectId);
  if (!current) throw new Error("主要竞争对手分析不存在");
  return updateMarketInsight(projectId, { userId, status: "editing", confirmedAt: null, confirmedBy: null });
}

export async function cancelPanoramaMarketInsight(projectId: number) {
  const current = await getMarketInsight(projectId);
  if (!current?.runId || !ACTIVE_STATUSES.has(current.status)) return current;
  await cancelAiJob(current.runId, "用户取消主要竞争对手分析");
  return updateMarketInsightForRun(projectId, current.runId, {
    status: "canceled",
    runError: "任务已取消",
    runCompletedAt: new Date(),
  });
}

registerAiJobHandler({
  id: "productDevelopment.panoramaMarketInsight",
  match: (job) => job.kind === "dev.panorama.marketInsight",
  handler: (job, context) => runPanoramaMarketInsight(job, context.signal),
});
