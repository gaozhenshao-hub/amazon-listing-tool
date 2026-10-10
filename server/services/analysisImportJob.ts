import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { aiJobs } from "../../drizzle/schema";
import { getProjectById, getCompetitorAnalysesByProject } from "../repositories";
import { requireDb } from "../repositories/dbClient";
import {
  getAiJobRun, registerAiJobHandler, createAiJobRun, scheduleAiJobRun,
  type AiJobSnapshot,
} from "./aiJobRunner";
import {
  ensureListingAgentRun, syncListingNodeJobQueued, syncListingNodeJobRunning,
  syncListingNodeJobWaitingHuman, syncListingNodeJobFailed,
} from "../domains/listing/listingAgentBridge";
import {
  executeReviewImport, executeSellerSpriteImport, retainSavedImportResults, type ImportItemResult,
} from "./analysisImportExecution";

export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMPORT_FILE_BYTES / 3) * 4;
const IMPORT_KINDS = ["analysis.import.reviews", "analysis.import.sellersprite"];
export const analysisImportJobInputSchema = z.object({
  projectId: z.number().int().positive(),
  kind: z.enum(["reviews", "sellersprite"]),
  fileBase64: z.string().min(4).max(MAX_BASE64_CHARS),
  filename: z.string().trim().min(1).max(255).regex(/\.(xlsx|xls|csv)$/i, "仅支持 Excel 或 CSV 文件"),
  selectedAsins: z.array(z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/)).max(5000).optional(),
});
type ImportInput = z.infer<typeof analysisImportJobInputSchema>;
type ImportScope = { userId: number; workspaceId?: number | null };
type StoredImportInput = ImportInput & { agentRunId: string; agentNodeId: "N1" | "N5"; completedResults?: ImportItemResult[] };
export type ImportJobResult = { results: ImportItemResult[]; total: number; succeeded: number; failed: number; [key: string]: unknown };

export function decodeImportFile(fileBase64: string) {
  if (!fileBase64 || fileBase64.length > MAX_BASE64_CHARS || !/^[A-Za-z0-9+/]*={0,2}$/.test(fileBase64)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "文件编码无效或文件超过 20 MB" });
  }
  const buffer = Buffer.from(fileBase64, "base64");
  if (!buffer.length || buffer.length > MAX_IMPORT_FILE_BYTES || buffer.toString("base64") !== fileBase64) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "文件编码无效或文件超过 20 MB" });
  }
  return buffer;
}

export function importJobIdentity(input: ImportInput, scope: ImportScope) {
  const hash = createHash("sha256").update(JSON.stringify({
    userId: scope.userId,
    workspaceId: scope.workspaceId ?? null,
    projectId: input.projectId,
    kind: input.kind,
    extension: input.filename.split(".").pop()?.toLowerCase(),
    selectedAsins: [...new Set(input.selectedAsins || [])].sort(),
  })).update(decodeImportFile(input.fileBase64)).digest("hex");
  return `analysis_import_${hash.slice(0, 48)}`;
}

export function summarizeImportResult(results: ImportItemResult[], total = results.length): ImportJobResult {
  return {
    results,
    total,
    succeeded: results.filter(row => row.status !== "failed").length,
    failed: results.filter(row => row.status === "failed").length,
  };
}

export function compactImportJob(job: AiJobSnapshot) {
  const input = job.input as Partial<StoredImportInput> | null;
  return {
    runId: job.runId,
    kind: input?.kind || (job.kind.endsWith("reviews") ? "reviews" : "sellersprite") as ImportInput["kind"],
    filename: input?.filename || "",
    status: job.status,
    progress: job.progress,
    result: (job.output || null) as ImportJobResult | null,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

async function requireImportProject(projectId: number, scope: ImportScope) {
  const project = await getProjectById(projectId, scope.userId, scope.workspaceId ?? null);
  if (!project || (project.workspaceId != null && project.workspaceId !== (scope.workspaceId ?? null))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在或无权访问" });
  }
  return project;
}

function importJobConditions(projectId: number, scope: ImportScope) {
  return [
    eq(aiJobs.userId, scope.userId), eq(aiJobs.projectId, projectId),
    scope.workspaceId == null ? isNull(aiJobs.workspaceId) : eq(aiJobs.workspaceId, scope.workspaceId),
    eq(aiJobs.module, "listing"), inArray(aiJobs.kind, IMPORT_KINDS),
  ];
}

function isDuplicateJob(error: unknown): boolean {
  let current = error as any;
  for (let depth = 0; current && depth < 5; depth++, current = current.cause) {
    if (current.code === "ER_DUP_ENTRY" || current.errno === 1062) return true;
  }
  return false;
}

// Select only metadata and results: polling must never fetch/return the uploaded Base64 payload.
async function selectImportJobs(projectId: number, scope: ImportScope, limit: number, runId?: string) {
  const database = await requireDb("Analysis imports");
  const rows = await database.select({
    runId: aiJobs.runId, kind: aiJobs.kind,
    filename: sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${aiJobs.input}, '$.filename'))`,
    status: aiJobs.status, progress: aiJobs.progress,
    result: aiJobs.output, error: aiJobs.errorMessage,
    createdAt: aiJobs.createdAt, updatedAt: aiJobs.updatedAt,
  }).from(aiJobs).where(and(...importJobConditions(projectId, scope), runId ? eq(aiJobs.runId, runId) : undefined))
    .orderBy(desc(aiJobs.createdAt), desc(aiJobs.id)).limit(limit);
  return rows.map(row => ({
    ...row,
    kind: (row.kind.endsWith("reviews") ? "reviews" : "sellersprite") as ImportInput["kind"],
    result: row.result as ImportJobResult | null,
  }));
}

export async function getAnalysisImportJob(input: { projectId: number; runId: string }, scope: ImportScope) {
  const project = await requireImportProject(input.projectId, scope);
  scope = { ...scope, workspaceId: project.workspaceId ?? null };
  const job = (await selectImportJobs(input.projectId, scope, 1, input.runId))[0];
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "导入任务不存在或无权访问" });
  return job;
}

export async function listAnalysisImportJobs(input: { projectId: number; limit?: number }, scope: ImportScope) {
  const project = await requireImportProject(input.projectId, scope);
  scope = { ...scope, workspaceId: project.workspaceId ?? null };
  return selectImportJobs(input.projectId, scope, Math.min(Math.max(input.limit || 20, 1), 50));
}

export async function startAnalysisImportJob(rawInput: ImportInput, scope: ImportScope) {
  const input = analysisImportJobInputSchema.parse(rawInput);
  const project = await requireImportProject(input.projectId, scope);
  scope = { ...scope, workspaceId: project.workspaceId ?? null };
  const baseRunId = importJobIdentity(input, scope);
  const sourceHash = createHash("sha256").update(decodeImportFile(input.fileBase64)).digest("hex");
  let completedResults: ImportItemResult[] = [];
  let previousRunId: string | null = null;
  // Unique runId arbitrates concurrent submissions across processes. A new explicit
  // submission after failure gets a deterministic next slot and retains successes.
  for (let revision = 0; revision < 100; revision++) {
    const runId = revision === 0 ? baseRunId : `${baseRunId}_${revision}`;
    const existing = await getAiJobRun(runId);
    if (existing) {
      if (existing.userId !== scope.userId || existing.projectId !== input.projectId || existing.workspaceId !== (scope.workspaceId ?? null)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权访问导入任务" });
      }
      if (["queued", "running"].includes(existing.status)) return compactImportJob(existing);
      const priorResults = ((existing.output as ImportJobResult | null)?.results || completedResults).filter(row => row.status !== "failed");
      const analyses = await getCompetitorAnalysesByProject(input.projectId);
      completedResults = retainSavedImportResults(priorResults, analyses, sourceHash, input.kind);
      // A user may have deleted/replaced a prior result since this file succeeded.
      // Rebuild missing rows instead of returning an empty historical success forever.
      if (existing.status === "succeeded" && completedResults.length > 0 && completedResults.length === priorResults.length) {
        return compactImportJob(existing);
      }
      previousRunId = existing.runId;
      continue;
    }

    // JSON has no TEXT's 64 KB ceiling, but MySQL packets still bound each upload.
    const database = await requireDb("Analysis imports");
    const packetResult = await database.execute(sql`SELECT @@max_allowed_packet AS maxPacket`);
    const maxPacket = Number((packetResult as any)[0]?.[0]?.maxPacket || 0);
    if (maxPacket && input.fileBase64.length + 1024 * 1024 >= maxPacket) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "文件超过当前数据库上传容量，请拆分文件后导入" });
    }
    const agentRunId = await ensureListingAgentRun({ projectId: input.projectId, userId: scope.userId, workspaceId: project.workspaceId });
    if (!agentRunId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "导入任务初始化失败，请稍后重试" });
    const agentNodeId = input.kind === "reviews" ? "N5" : "N1";
    let job: AiJobSnapshot;
    try {
      job = await createAiJobRun({
        runId, kind: `analysis.import.${input.kind}`, module: "listing",
        procedure: "analysis.startImportJob", userId: scope.userId,
        workspaceId: project.workspaceId ?? null, projectId: input.projectId,
        skillSlug: input.kind === "reviews" ? "analysis.review.extract" : "listing.competitor.analyze",
        input: { ...input, agentRunId, agentNodeId, completedResults },
        queueName: "analysis", priority: 10, progress: 0,
        maxAttempts: 1, timeoutSeconds: 7200,
        recoveryOfRunId: previousRunId,
        recoveryReason: previousRunId ? "用户重新提交失败导入，仅继续未成功项目" : null,
      });
    } catch (error) {
      if (!isDuplicateJob(error)) throw error;
      // INSERT may lose the unique-key race. Do not disguise scheduling/DB errors
      // as a duplicate: only MySQL's unique-constraint error is recoverable here.
      const raced = await getAiJobRun(runId);
      if (raced && raced.userId === scope.userId && raced.projectId === input.projectId && raced.workspaceId === (scope.workspaceId ?? null)) {
        return compactImportJob(raced);
      }
      throw error;
    }
    await syncListingNodeJobQueued({
      agentRunId, nodeId: agentNodeId, projectId: input.projectId,
      userId: scope.userId, workspaceId: project.workspaceId, aiJobRunId: job.runId,
      aiJobAttempt: 0, aiJobMaxAttempts: 1, progress: 0,
    });
    // A queue wait must not consume the Agent node's fixed 30-minute budget.
    await database.execute(sql`UPDATE emperor_agent_checkpoints SET timeoutAt=NULL
      WHERE runId=${agentRunId} AND nodeId=${agentNodeId} AND aiJobRunId=${job.runId}
      AND status='running' AND COALESCE(aiJobAttempt, 0)=0`);
    await scheduleAiJobRun(job.runId);
    return compactImportJob(job);
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: "该文件失败次数过多，请检查错误后再提交" });
}

export async function runAnalysisImportJob(job: AiJobSnapshot, context: { signal: AbortSignal }) {
  const parsed = analysisImportJobInputSchema.parse(job.input);
  const stored = job.input as StoredImportInput;
  await requireImportProject(parsed.projectId, { userId: job.userId, workspaceId: job.workspaceId });
  decodeImportFile(parsed.fileBase64);
  const syncInput = {
    agentRunId: stored.agentRunId, nodeId: stored.agentNodeId,
    projectId: parsed.projectId, userId: job.userId, workspaceId: job.workspaceId,
    aiJobRunId: job.runId, aiJobAttempt: job.attempt, aiJobMaxAttempts: 1,
  };
  let latest = summarizeImportResult(stored.completedResults || []);
  const assertActive = async () => {
    context.signal.throwIfAborted();
    const database = await requireDb("Analysis import ownership");
    const rows = await database.select({ status: aiJobs.status, attempt: aiJobs.attempt, lockedBy: aiJobs.lockedBy })
      .from(aiJobs).where(eq(aiJobs.runId, job.runId)).limit(1);
    const current = rows[0];
    if (!current || current.status !== "running" || current.attempt !== job.attempt || current.lockedBy !== job.lockedBy) {
      throw new Error("导入任务已停止或执行权已变更，请查看任务状态");
    }
  };
  const synchronizeDeadline = async () => {
    const database = await requireDb("Analysis import Agent deadline");
    const started = new Date(job.claimedAt || job.startedAt || new Date()).getTime();
    const deadline = new Date(started + job.timeoutSeconds * 1000 + 60_000);
    await database.execute(sql`UPDATE emperor_agent_checkpoints SET timeoutAt=${deadline}
      WHERE runId=${stored.agentRunId} AND nodeId=${stored.agentNodeId} AND aiJobRunId=${job.runId}
      AND status='running' AND aiJobAttempt=${job.attempt}`);
  };
  const checkpoint = async (result: ImportJobResult) => {
    await assertActive();
    const database = await requireDb("Analysis import checkpoint");
    const progress = Math.min(99, Math.round(result.results.length / Math.max(result.total, 1) * 95));
    await database.update(aiJobs).set({ output: result, progress, lastHeartbeatAt: new Date() }).where(and(
      eq(aiJobs.runId, job.runId), eq(aiJobs.status, "running"),
      eq(aiJobs.attempt, job.attempt), job.lockedBy ? eq(aiJobs.lockedBy, job.lockedBy) : undefined,
    ));
    latest = result;
    await synchronizeDeadline();
  };
  try {
    context.signal.throwIfAborted();
    await assertActive();
    await syncListingNodeJobRunning({ ...syncInput, progress: 5 });
    await synchronizeDeadline();
    const execute = parsed.kind === "reviews" ? executeReviewImport : executeSellerSpriteImport;
    const result = await execute(parsed, job.userId, {
      signal: context.signal,
      assertActive,
      completedResults: stored.completedResults,
      onProgress: (rows, total) => checkpoint(summarizeImportResult(rows, total)),
    });
    const summary = { ...result, ...summarizeImportResult(result.results) };
    await checkpoint(summary);
    if (summary.failed) throw new Error(`导入已处理：${summary.succeeded} 个成功，${summary.failed} 个失败。重新提交同一文件只会重试未成功项目。`);
    await syncListingNodeJobWaitingHuman({ ...syncInput, progress: 100, output: summary });
    return summary;
  } catch (error) {
    await syncListingNodeJobFailed({
      ...syncInput, output: latest, finalAttempt: true,
      failureKind: context.signal.aborted ? "cancel" : "error",
      errorMessage: error instanceof Error ? error.message : "导入失败",
    });
    throw error;
  }
}

registerAiJobHandler({
  id: "analysis.import", match: job => job.module === "listing" && IMPORT_KINDS.includes(job.kind),
  handler: runAnalysisImportJob,
});
