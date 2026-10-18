import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb, type DbExecutor } from "../dbClient";
import { competitorRevision, competitorDataHash, mergeCompetitorUpdate, stripIncomingManualSales } from "./competitorWritePolicy";
import { CompetitorManualSalesSchema, type CompetitorManualSales } from "../../../shared/competitorSales";
import { z } from "zod";
import {
  InsertAnalysisVersion,
  InsertCompetitorAnalysis,
  InsertCompetitorComparisonReport,
  InsertProjectFile,
  InsertReviewImport,
  analysisVersions,
  competitorAnalyses,
  competitorComparisonReports,
  projectFiles,
  reviewImports,
  projects,
  type CompetitorAnalysis,
  type CompetitorComparisonReport,
} from "../../../drizzle/schema/project";

// --- Competitor Analysis Helpers --------------------------------

async function competitorTransaction<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db || typeof db.transaction !== "function") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "竞品写入需要真实数据库事务" });
  return db.transaction(callback);
}

async function lockCompetitorParent(tx: DbExecutor, projectId: number) {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "项目标识无效" });
  const rows = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1).for("update");
  if (rows.length !== 1 || rows[0].id !== projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  return rows[0];
}

async function readLockedCompetitor(tx: DbExecutor, id: number, projectId: number): Promise<CompetitorAnalysis> {
  const rows = await tx.select().from(competitorAnalyses).where(and(eq(competitorAnalyses.id, id), eq(competitorAnalyses.projectId, projectId))).limit(1).for("update");
  if (rows.length !== 1 || rows[0].id !== id || rows[0].projectId !== projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Competitor analysis not found" });
  return rows[0];
}

type CompetitorWriteGuard = { projectId: number; expectedRevision: string; userId?: number; workspaceId?: number | null };
async function withLockedCompetitor<T>(id: number, guard: CompetitorWriteGuard | undefined, callback: (tx: DbExecutor, row: CompetitorAnalysis) => Promise<T>): Promise<T> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "竞品标识无效" });
  if (guard && (!/^[a-f0-9]{64}$/u.test(guard.expectedRevision)
    || (Object.hasOwn(guard, "workspaceId") && guard.userId === undefined)
    || (guard.userId !== undefined && (!Number.isSafeInteger(guard.userId) || guard.userId <= 0
      || !Object.hasOwn(guard, "workspaceId") || (guard.workspaceId !== null
        && (!Number.isSafeInteger(guard.workspaceId) || (guard.workspaceId as number) <= 0)))))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "竞品写入校验范围无效" });
  }
  return competitorTransaction(async tx => {
    // Legacy callers do not supply a parent. This discovery read takes no row lock;
    // the authoritative read is repeated only after the parent is locked.
    const projectId = guard?.projectId ?? (await tx.select({ projectId: competitorAnalyses.projectId }).from(competitorAnalyses).where(eq(competitorAnalyses.id, id)).limit(1))[0]?.projectId;
    if (projectId === undefined) throw new TRPCError({ code: "NOT_FOUND", message: "Competitor analysis not found" });
    const parent = await lockCompetitorParent(tx, projectId);
    if (guard?.userId !== undefined && (parent.userId !== guard.userId
      || (parent.workspaceId !== null && parent.workspaceId !== guard.workspaceId))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    }
    const row = await readLockedCompetitor(tx, id, projectId);
    if (guard && competitorRevision(row) !== guard.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "竞品资料已变化，请刷新后重试" });
    return callback(tx, row);
  });
}

type LegacyAcquisitionGuard = { userId: number; workspaceId: number; rejectCapturedSource: true };
function assertNotCaptured(row: CompetitorAnalysis) {
  if (!row.rawData) return;
  let raw: unknown;
  try { raw = JSON.parse(row.rawData); } catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "COMPETITOR_LEGACY_SOURCE_INVALID" }); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "COMPETITOR_LEGACY_SOURCE_INVALID" });
  if (Object.hasOwn(raw, "acquisitionCapture")) throw new TRPCError({ code: "CONFLICT", message: "COMPETITOR_LEGACY_CAPTURE_PROTECTED" });
}
/** A queued legacy job checks this before spending on a model; commit repeats
 * the same fence so capture during the call cannot be overwritten. */
export async function assertLegacyCompetitorAcquisitionWritable(projectId: number, asin: string, guard: LegacyAcquisitionGuard) {
  return competitorTransaction(async tx => {
    const parent = await lockCompetitorParent(tx, projectId);
    if (parent.userId !== guard.userId || parent.workspaceId !== guard.workspaceId) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    const matches: CompetitorAnalysis[] = await tx.select().from(competitorAnalyses).where(and(eq(competitorAnalyses.projectId, projectId), eq(competitorAnalyses.asin, asin))).limit(2).for("update");
    if (matches.length > 1) throw new TRPCError({ code: "CONFLICT", message: "同项目竞品记录不唯一" });
    if (matches[0]) assertNotCaptured(matches[0]);
  });
}
async function saveCompetitor(data: InsertCompetitorAnalysis, createOnly: boolean, legacyGuard?: LegacyAcquisitionGuard) {
  data = stripIncomingManualSales(data);
  return competitorTransaction(async tx => {
    const parent = await lockCompetitorParent(tx, data.projectId);
    if (legacyGuard && (parent.userId !== legacyGuard.userId || parent.workspaceId !== legacyGuard.workspaceId)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    }
    const matches: CompetitorAnalysis[] = await tx.select().from(competitorAnalyses).where(and(
      eq(competitorAnalyses.projectId, data.projectId), eq(competitorAnalyses.asin, data.asin),
    )).limit(2).for("update");
    if (matches.length > 1 || (createOnly && matches.length)) throw new TRPCError({ code: "CONFLICT", message: "同项目竞品记录已存在或不唯一" });
    if (matches[0]) {
      // A previously queued automatic analysis must never overwrite the new
      // selected-generation lane, even when its model completed after capture.
      if (legacyGuard) assertNotCaptured(matches[0]);
      const update = mergeCompetitorUpdate(matches[0], data, { kind: "upsert" });
      if (Object.keys(update).length) await tx.update(competitorAnalyses).set(update).where(and(eq(competitorAnalyses.id, matches[0].id), eq(competitorAnalyses.projectId, data.projectId)));
      return readLockedCompetitor(tx, matches[0].id, data.projectId);
    }
    const result = await tx.insert(competitorAnalyses).values(data);
    const insertId = result[0]?.insertId;
    if (!Number.isSafeInteger(insertId) || insertId <= 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "竞品写入未返回有效标识" });
    return readLockedCompetitor(tx, insertId, data.projectId);
  });
}

export async function createCompetitorAnalysis(data: InsertCompetitorAnalysis) {
  return saveCompetitor(data, true);
}

/**
 * Upsert competitor analysis: if same projectId+asin exists, update it; otherwise insert new.
 * This prevents duplicate entries when re-uploading the same SellerSprite file.
 */
export async function upsertCompetitorAnalysis(data: InsertCompetitorAnalysis, legacyGuard?: LegacyAcquisitionGuard) {
  return saveCompetitor(data, false, legacyGuard);
}

export async function getCompetitorAnalysesByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(competitorAnalyses).where(eq(competitorAnalyses.projectId, projectId)).orderBy(desc(competitorAnalyses.createdAt));
}

export async function getCompetitorAnalysisById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(competitorAnalyses).where(eq(competitorAnalyses.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateCompetitorAnalysisSummary(
  id: number,
  data: {
    aiSummary?: string | null;
    summary?: string | null;
    summaryStatus?: "draft" | "confirmed";
    summaryConfirmedBy?: number | null;
    summaryConfirmedAt?: Date | null;
    incrementVersion?: boolean;
  },
  guard?: CompetitorWriteGuard,
) {
  return withLockedCompetitor(id, guard, async (tx, row) => {
    const explicitUnlock = data.summaryStatus === "draft" && data.summaryConfirmedBy === null && data.summaryConfirmedAt === null
      && data.summary === undefined && data.aiSummary === undefined;
    const repeatedConfirmation = row.summaryStatus === "confirmed" && data.summaryStatus === "confirmed"
      && data.summary === row.summary && (data.aiSummary === undefined || data.aiSummary === row.aiSummary);
    if (repeatedConfirmation) return row;
    if (row.summaryStatus === "confirmed" && !explicitUnlock) {
      throw new TRPCError({ code: "CONFLICT", message: "已确认的竞品分析需要先解锁才能编辑" });
    }
    if (data.summaryStatus === "draft" && !explicitUnlock) throw new TRPCError({ code: "BAD_REQUEST", message: "解锁必须明确清除确认人和确认时间" });
    const { incrementVersion, ...values } = data;
    const versionChanged = incrementVersion || data.summaryStatus === "confirmed" || explicitUnlock;
    if (versionChanged && (!Number.isSafeInteger(row.summaryVersion) || row.summaryVersion < 1 || row.summaryVersion >= 2147483647)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "竞品摘要版本无效或已达上限" });
    }
    await tx.update(competitorAnalyses).set({ ...values, ...(versionChanged ? { summaryVersion: row.summaryVersion + 1 } : {}) })
      .where(and(eq(competitorAnalyses.id, id), eq(competitorAnalyses.projectId, row.projectId)));
    return readLockedCompetitor(tx, id, row.projectId);
  });
}

export async function createCompetitorComparisonReport(data: InsertCompetitorComparisonReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(competitorComparisonReports).values(data);
  return getCompetitorComparisonReportById(result[0].insertId);
}

export async function getLatestCompetitorComparisonReport(projectId: number, selectionKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(competitorComparisonReports)
    .where(and(
      eq(competitorComparisonReports.projectId, projectId),
      eq(competitorComparisonReports.selectionKey, selectionKey),
    ))
    .orderBy(desc(competitorComparisonReports.createdAt), desc(competitorComparisonReports.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getLatestConfirmedCompetitorComparisonReport(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(competitorComparisonReports)
    .where(and(
      eq(competitorComparisonReports.projectId, projectId),
      eq(competitorComparisonReports.status, "confirmed"),
    ))
    .orderBy(desc(competitorComparisonReports.updatedAt), desc(competitorComparisonReports.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCompetitorComparisonReportById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(competitorComparisonReports)
    .where(eq(competitorComparisonReports.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateCompetitorComparisonReport(
  id: number,
  data: Partial<InsertCompetitorComparisonReport> & { incrementVersion?: boolean },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { incrementVersion, ...values } = data;
  await db.update(competitorComparisonReports)
    .set({
      ...values,
      ...(incrementVersion ? { version: sql`${competitorComparisonReports.version} + 1` } : {}),
    })
    .where(eq(competitorComparisonReports.id, id));
  return getCompetitorComparisonReportById(id);
}

// Human sales calibration and comparison review share the same project lock as
// acquisition. These methods never call a provider or manufacture provenance for
// an older report: sourceHash describes the currently selected persisted rows.
export type CompetitorOwnerScope = { projectId: number; userId: number; workspaceId: number | null };
const comparisonIdsSchema = z.array(z.number().int().positive().safe()).min(2).max(8)
  .refine(ids => new Set(ids).size === ids.length, "Duplicate analyses");
const comparisonFields = ["id", "workspaceId", "projectId", "userId", "selectionKey", "analysisIds", "analyzedAsins", "aiSummary", "summary", "sellingPointRows", "status", "version", "confirmedBy", "confirmedAt", "createdAt", "updatedAt"] as const;
function comparisonFailure(reason: string, code: "BAD_REQUEST" | "CONFLICT" | "PRECONDITION_FAILED" | "NOT_FOUND" = "PRECONDITION_FAILED"): never {
  throw new TRPCError({ code, message: `COMPETITOR_COMPARISON_${reason}` });
}
function textBudget(value: unknown) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 65535) comparisonFailure("TEXT_LIMIT");
}
function acknowledged(result: unknown) {
  const header = Array.isArray(result) ? result[0] : null;
  if (!header || header.affectedRows !== 1 || header.warningStatus !== 0) comparisonFailure("WRITE_UNVERIFIED", "CONFLICT");
}
function instant(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) comparisonFailure("CLOCK_INVALID");
  return new Date(Math.floor(now.getTime() / 1000) * 1000);
}
function reportIds(report: CompetitorComparisonReport): number[] {
  let ids: number[];
  try { ids = comparisonIdsSchema.parse(JSON.parse(report.analysisIds)); } catch { return comparisonFailure("SELECTION_INVALID"); }
  ids.sort((a, b) => a - b);
  if (report.selectionKey !== ids.join("-")) comparisonFailure("SELECTION_INVALID");
  return ids;
}
export function competitorComparisonRevision(row: CompetitorComparisonReport) {
  if (!row || Object.keys(row).length !== comparisonFields.length || comparisonFields.some(key => !Object.hasOwn(row, key))
    || !["draft", "confirmed"].includes(row.status) || !Number.isSafeInteger(row.version) || row.version < 1
    || ![row.id, row.projectId, row.userId].every(value => Number.isSafeInteger(value) && value > 0)
    || row.workspaceId !== null && (!Number.isSafeInteger(row.workspaceId) || row.workspaceId <= 0)
    || row.confirmedBy !== null && (!Number.isSafeInteger(row.confirmedBy) || row.confirmedBy <= 0)
    || ![row.createdAt, row.updatedAt].every(value => value instanceof Date && Number.isFinite(value.getTime()))
    || row.confirmedAt !== null && (!(row.confirmedAt instanceof Date) || !Number.isFinite(row.confirmedAt.getTime()))) comparisonFailure("RECORD_INVALID");
  for (const key of ["selectionKey", "analysisIds", "analyzedAsins", "aiSummary", "summary", "sellingPointRows"] as const) textBudget(row[key]);
  reportIds(row); return competitorDataHash(row);
}
async function ownerParent(tx: DbExecutor, scope: CompetitorOwnerScope) {
  if (!scope || ![scope.projectId, scope.userId].every(value => Number.isSafeInteger(value) && value > 0)
    || !Object.hasOwn(scope, "workspaceId") || scope.workspaceId !== null && (!Number.isSafeInteger(scope.workspaceId) || scope.workspaceId <= 0)) comparisonFailure("SCOPE_INVALID", "BAD_REQUEST");
  const parent = await lockCompetitorParent(tx, scope.projectId);
  if (parent.userId !== scope.userId || parent.workspaceId !== null && parent.workspaceId !== scope.workspaceId) comparisonFailure("PROJECT_UNAVAILABLE", "NOT_FOUND");
  return parent;
}
async function selectedSources(tx: DbExecutor, scope: CompetitorOwnerScope, rawIds: number[]) {
  const ids = comparisonIdsSchema.parse(rawIds).sort((a, b) => a - b), analyses: CompetitorAnalysis[] = [];
  for (const id of ids) analyses.push(await readLockedCompetitor(tx, id, scope.projectId));
  const sourceHash = competitorDataHash({ schema: "competitor-comparison-current-source/v1", ...scope,
    analyses: analyses.map(row => ({ id: row.id, revision: competitorRevision(row) })) });
  return { analyses, sourceHash, analysisIds: ids };
}
function assertComparisonSourcesCurrent(analyses: CompetitorAnalysis[]) {
  for (const row of analyses) {
    if (row.rawData === null || row.rawData.trim() === "") continue;
    let raw: Record<string, unknown>;
    try { const value: unknown = JSON.parse(row.rawData); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid"); raw = value as Record<string, unknown>; }
    catch { return comparisonFailure("SOURCE_STATE_INVALID"); }
    for (const key of ["analysisStale", "captureOnly"]) {
      if (Object.hasOwn(raw, key) && typeof raw[key] !== "boolean") comparisonFailure("SOURCE_STATE_INVALID");
      if (raw[key] === true) comparisonFailure("SOURCE_REANALYSIS_REQUIRED", "CONFLICT");
    }
  }
}
async function lockedReport(tx: DbExecutor, id: number, scope: CompetitorOwnerScope, _parentWorkspace: number | null) {
  const rows: CompetitorComparisonReport[] = await tx.select().from(competitorComparisonReports)
    .where(and(eq(competitorComparisonReports.id, id), eq(competitorComparisonReports.projectId, scope.projectId))).limit(1).for("update");
  const row = rows[0];
  // Reports retain their existing project-level sharing semantics, including a
  // previous creator after project transfer. A concrete report workspace must
  // still equal the current context; NULL legacy parent is not that equality.
  if (rows.length !== 1 || row.id !== id || row.projectId !== scope.projectId || row.workspaceId !== null && row.workspaceId !== scope.workspaceId) comparisonFailure("REPORT_UNAVAILABLE", "NOT_FOUND");
  competitorComparisonRevision(row); return row;
}
async function persistReport(tx: DbExecutor, before: CompetitorComparisonReport, values: Partial<CompetitorComparisonReport>, scope: CompetitorOwnerScope, parentWorkspace: number | null) {
  const expected = { ...before, ...values };
  competitorComparisonRevision(expected);
  acknowledged(await tx.update(competitorComparisonReports).set(values).where(and(eq(competitorComparisonReports.id, before.id), eq(competitorComparisonReports.projectId, scope.projectId), eq(competitorComparisonReports.version, before.version))));
  const saved = await lockedReport(tx, before.id, scope, parentWorkspace);
  if (competitorComparisonRevision(saved) !== competitorComparisonRevision(expected)) comparisonFailure("READBACK_FAILED", "CONFLICT");
  return saved;
}
function nextReportVersion(row: CompetitorComparisonReport) {
  if (row.version >= 2147483647) comparisonFailure("VERSION_LIMIT"); return row.version + 1;
}
export async function calibrateCompetitorSales(id: number, manual: CompetitorManualSales | null, guard: CompetitorWriteGuard & CompetitorOwnerScope) {
  if (manual !== null) {
    manual = CompetitorManualSalesSchema.parse(manual);
    if (manual.updatedBy !== guard.userId) comparisonFailure("ACTOR_INVALID", "BAD_REQUEST");
  }
  return withLockedCompetitor(id, guard, async (tx, row) => {
    let raw: Record<string, unknown>;
    try { const value: unknown = row.rawData === null ? {} : JSON.parse(row.rawData);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid"); raw = value as Record<string, unknown>;
    } catch { return comparisonFailure("SOURCE_INVALID"); }
    if (manual === null && !Object.hasOwn(raw, "manualSales")) return row;
    if (manual === null) delete raw.manualSales; else raw.manualSales = manual;
    raw.analysisStale = true;
    const rawData = JSON.stringify(raw); textBudget(rawData);
    const updatedAt = instant(), expected = { ...row, rawData, updatedAt };
    acknowledged(await tx.update(competitorAnalyses).set({ rawData, updatedAt }).where(and(eq(competitorAnalyses.id, id), eq(competitorAnalyses.projectId, guard.projectId))));
    const saved = await readLockedCompetitor(tx, id, guard.projectId);
    if (competitorRevision(saved) !== competitorRevision(expected)) comparisonFailure("READBACK_FAILED", "CONFLICT");
    // Bounded metadata only; malformed/oversized selections cannot silently
    // evade invalidation. Full report bodies are loaded one at a time.
    const refs: { id: number; analysisIds: string | null; selectionBytes: number }[] = await tx.select({ id: competitorComparisonReports.id,
      analysisIds: sql`CASE WHEN OCTET_LENGTH(${competitorComparisonReports.analysisIds}) <= 512 THEN ${competitorComparisonReports.analysisIds} ELSE NULL END`,
      selectionBytes: sql`OCTET_LENGTH(${competitorComparisonReports.analysisIds})` })
      .from(competitorComparisonReports).where(and(eq(competitorComparisonReports.projectId, guard.projectId), eq(competitorComparisonReports.status, "confirmed"))).limit(1001).for("update");
    if (refs.length > 1000) comparisonFailure("SCAN_LIMIT");
    for (const ref of refs) {
      if (!Number.isSafeInteger(ref.selectionBytes) || ref.selectionBytes < 1 || ref.selectionBytes > 512 || ref.analysisIds === null) comparisonFailure("SELECTION_INVALID");
      let ids: number[]; try { ids = comparisonIdsSchema.parse(JSON.parse(ref.analysisIds)); } catch { return comparisonFailure("SELECTION_INVALID"); }
      if (!ids.includes(id)) continue;
      const parent = await lockCompetitorParent(tx, guard.projectId);
      const report = await lockedReport(tx, ref.id, guard, parent.workspaceId);
      await persistReport(tx, report, { status: "draft", confirmedBy: null, confirmedAt: null, version: nextReportVersion(report), updatedAt }, guard, parent.workspaceId);
    }
    return saved;
  });
}
export async function captureCompetitorComparisonSources(scope: CompetitorOwnerScope, analysisIds: number[]) {
  return competitorTransaction(async tx => {
    const project = await ownerParent(tx, scope), selected = await selectedSources(tx, scope, analysisIds);
    assertComparisonSourcesCurrent(selected.analyses); return { project, ...selected };
  });
}
export async function readCompetitorComparisonReport(scope: CompetitorOwnerScope, analysisIds: number[]) {
  return competitorTransaction(async tx => {
    const parent = await ownerParent(tx, scope), source = await selectedSources(tx, scope, analysisIds);
    const rows: CompetitorComparisonReport[] = await tx.select().from(competitorComparisonReports)
      .where(and(eq(competitorComparisonReports.projectId, scope.projectId), eq(competitorComparisonReports.selectionKey, source.analysisIds.join("-"))))
      .orderBy(desc(competitorComparisonReports.createdAt), desc(competitorComparisonReports.id)).limit(1).for("update");
    if (!rows.length) return null;
    const report = await lockedReport(tx, rows[0].id, scope, parent.workspaceId);
    return { report, reportRevision: competitorComparisonRevision(report), sourceHash: source.sourceHash };
  });
}
export async function reviewCompetitorComparisonReport(scope: CompetitorOwnerScope, input: { reportId: number; expectedReportRevision: string; expectedSourceHash: string;
  action: "save" | "confirm" | "unlock"; summary?: string; sellingPointRows?: string }) {
  return competitorTransaction(async tx => {
    const parent = await ownerParent(tx, scope), report = await lockedReport(tx, input.reportId, scope, parent.workspaceId);
    const source = await selectedSources(tx, scope, reportIds(report));
    if (competitorComparisonRevision(report) !== input.expectedReportRevision || source.sourceHash !== input.expectedSourceHash) comparisonFailure("SOURCE_OR_REPORT_CHANGED", "CONFLICT");
    if (!["save", "confirm", "unlock"].includes(input.action)) comparisonFailure("ACTION_INVALID", "BAD_REQUEST");
    if (input.action === "confirm") assertComparisonSourcesCurrent(source.analyses);
    if (input.action !== "unlock") {
      textBudget(input.summary); textBudget(input.sellingPointRows);
      if (report.status === "confirmed" && (input.action === "save" || report.summary !== input.summary || report.sellingPointRows !== input.sellingPointRows)) comparisonFailure("UNLOCK_REQUIRED", "CONFLICT");
      if (report.status === "confirmed") return { report, reportRevision: competitorComparisonRevision(report), sourceHash: source.sourceHash };
    }
    const stamp = instant(), values = input.action === "unlock" ? { status: "draft" as const, confirmedBy: null, confirmedAt: null }
      : { summary: input.summary!, sellingPointRows: input.sellingPointRows!, ...(input.action === "confirm" ? { status: "confirmed" as const, confirmedBy: scope.userId, confirmedAt: stamp } : {}) };
    const saved = await persistReport(tx, report, { ...values, version: nextReportVersion(report), updatedAt: stamp }, scope, parent.workspaceId);
    return { report: saved, reportRevision: competitorComparisonRevision(saved), sourceHash: source.sourceHash };
  });
}
export async function createCompetitorComparisonReportFromSnapshot(scope: CompetitorOwnerScope, input: { analysisIds: number[]; expectedSourceHash: string; summary: string; sellingPointRows: string }) {
  return competitorTransaction(async tx => {
    const parent = await ownerParent(tx, scope), source = await selectedSources(tx, scope, input.analysisIds);
    if (source.sourceHash !== input.expectedSourceHash) comparisonFailure("SOURCE_CHANGED_DURING_GENERATION", "CONFLICT");
    assertComparisonSourcesCurrent(source.analyses);
    textBudget(input.summary); textBudget(input.sellingPointRows);
    const selectionKey = source.analysisIds.join("-"), stamp = instant();
    const previous: CompetitorComparisonReport[] = await tx.select().from(competitorComparisonReports)
      .where(and(eq(competitorComparisonReports.projectId, scope.projectId), eq(competitorComparisonReports.selectionKey, selectionKey)))
      .orderBy(desc(competitorComparisonReports.createdAt), desc(competitorComparisonReports.id)).limit(1).for("update");
    if (previous.length) competitorComparisonRevision(previous[0]);
    const data = { workspaceId: parent.workspaceId, projectId: scope.projectId, userId: scope.userId, selectionKey,
      analysisIds: JSON.stringify(source.analysisIds), analyzedAsins: JSON.stringify(source.analyses.map(row => row.asin)), aiSummary: input.summary, summary: input.summary,
      sellingPointRows: input.sellingPointRows, status: "draft" as const, version: previous.length ? nextReportVersion(previous[0]) : 1,
      confirmedBy: null, confirmedAt: null, createdAt: stamp, updatedAt: stamp };
    const result = await tx.insert(competitorComparisonReports).values(data); acknowledged(result);
    const insertId = result[0]?.insertId;
    if (!Number.isSafeInteger(insertId) || insertId <= 0) comparisonFailure("WRITE_UNVERIFIED");
    const saved = await lockedReport(tx, insertId, scope, parent.workspaceId);
    if (competitorComparisonRevision(saved) !== competitorComparisonRevision({ ...data, id: insertId })) comparisonFailure("READBACK_FAILED", "CONFLICT");
    return { report: saved, reportRevision: competitorComparisonRevision(saved), sourceHash: source.sourceHash };
  });
}

export async function updateCompetitorAnalysisReviews(id: number, data: { reviewCount?: string; reviewAnalysis?: string | null; rawData?: string }) {
  return withLockedCompetitor(id, undefined, async (tx, row) => {
    const update = mergeCompetitorUpdate(row, data, { kind: "reviews" });
    if (Object.keys(update).length) await tx.update(competitorAnalyses).set(update).where(and(eq(competitorAnalyses.id, id), eq(competitorAnalyses.projectId, row.projectId)));
    return readLockedCompetitor(tx, id, row.projectId);
  });
}

export async function deleteCompetitorAnalysis(id: number, guard?: CompetitorWriteGuard) {
  return withLockedCompetitor(id, guard, async (tx, row) => {
    await tx.delete(competitorAnalyses).where(and(eq(competitorAnalyses.id, id), eq(competitorAnalyses.projectId, row.projectId)));
    return { success: true };
  });
}

// --- Review Import Helpers -----------------------------------------

export async function createReviewImport(data: InsertReviewImport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(reviewImports).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(reviewImports).where(eq(reviewImports.id, insertId)).limit(1);
  return rows[0];
}

export async function getReviewImportsByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(reviewImports).where(eq(reviewImports.projectId, projectId)).orderBy(desc(reviewImports.createdAt));
}

export async function getReviewImportById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(reviewImports).where(eq(reviewImports.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateReviewImport(id: number, data: Partial<InsertReviewImport>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(reviewImports).set(data).where(eq(reviewImports.id, id));
  const rows = await db.select().from(reviewImports).where(eq(reviewImports.id, id)).limit(1);
  return rows[0];
}

export async function deleteReviewImport(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(reviewImports).where(eq(reviewImports.id, id));
  return { success: true };
}

// --- Project File Helpers -------------------------------------

export async function createProjectFile(data: InsertProjectFile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectFiles).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.id, insertId)).limit(1);
  return rows[0];
}

export async function getProjectFilesByProject(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId)).orderBy(desc(projectFiles.createdAt), desc(projectFiles.id));
}

export async function getProjectFilesByType(projectId: number, fileType: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.fileType, fileType as any)))
    .orderBy(desc(projectFiles.createdAt), desc(projectFiles.id));
}

export async function getProjectFileById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateProjectFile(id: number, data: Partial<InsertProjectFile>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectFiles).set(data).where(eq(projectFiles.id, id));
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.id, id)).limit(1);
  return rows[0];
}

export async function deleteProjectFile(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projectFiles).where(eq(projectFiles.id, id));
  return { success: true };
}

// --- Analysis Version Helpers ---------------------------------

export async function createAnalysisVersion(data: InsertAnalysisVersion) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(analysisVersions).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(analysisVersions).where(eq(analysisVersions.id, insertId)).limit(1);
  return rows[0];
}

export async function getAnalysisVersionsByFileId(projectFileId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(analysisVersions)
    .where(eq(analysisVersions.projectFileId, projectFileId))
    .orderBy(desc(analysisVersions.version));
}

export async function getAnalysisVersionById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(analysisVersions).where(eq(analysisVersions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getLatestVersionNumber(projectFileId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(analysisVersions)
    .where(eq(analysisVersions.projectFileId, projectFileId))
    .orderBy(desc(analysisVersions.version))
    .limit(1);
  return rows.length > 0 ? rows[0].version : 0;
}

export async function deleteAnalysisVersionsByFileId(projectFileId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(analysisVersions).where(eq(analysisVersions.projectFileId, projectFileId));
  return { success: true };
}
