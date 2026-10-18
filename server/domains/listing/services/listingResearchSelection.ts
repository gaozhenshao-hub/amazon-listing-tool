import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { assertActiveCompetitorResearchScope } from "../../../services/competitorActiveResearch";
import { z } from "zod";
import {
  listingResearchBindingSchema, listingResearchIdsSchema, type ListingResearchBinding,
} from "../../../../shared/listingResearchSelection";
import type { CompetitorAnalysis, CompetitorComparisonReport } from "../../../../drizzle/schema/project";
import { cloneActiveResearch, readActiveCompetitorResearch } from "./competitorActiveResearch";
import {
  getCompetitorAnalysesByProject, getLatestCompetitorComparisonReport, getProjectByIdAdmin,
} from "../repository";

const scopeSchema = listingResearchBindingSchema.pick({ projectId: true, workspaceId: true });
const prepareSchema = scopeSchema.extend({ analysisIds: listingResearchIdsSchema.optional() }).strict();
type ResearchScope = z.infer<typeof scopeSchema>;
type PrepareInput = z.infer<typeof prepareSchema>;

export type ListingResearchSelection = {
  binding: ListingResearchBinding;
  competitors: CompetitorAnalysis[];
  confirmedComparison: CompetitorComparisonReport | null;
  // The project-wide aggregation has no exact analysis-ID/version provenance.
  // Individual selected analyses retain their own reviewAnalysis instead.
  reviewAggregation: null;
};

function unavailable(message: string): never {
  throw new TRPCError({ code: "PRECONDITION_FAILED", message });
}

/** Canonicalize the entire returned source rows, not just summaryVersion.
 * Text columns remain exact text (including JSON text); valid DB Dates use ISO.
 * Reject lossy values rather than silently dropping fields or coercing to null. */
function sourceText(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return unavailable("竞品研究来源含无效时间，无法绑定版本");
    return JSON.stringify(value.toISOString());
  }
  if (!value || typeof value !== "object" || ancestors.has(value)) return unavailable("竞品研究来源含无法忠实绑定的字段");
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return unavailable("竞品研究来源对象格式异常");
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== "string")) return unavailable("竞品研究来源含未知字段");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys as string[]) {
    if (Array.isArray(value) && key === "length") continue;
    if (!("value" in descriptors[key]) || !descriptors[key].enumerable) return unavailable("竞品研究来源含非数据字段");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (keys.length !== value.length + 1 || Array.from({ length: value.length }, (_, index) => String(index))
        .some(key => !Object.hasOwn(value, key))) return unavailable("竞品研究来源数组不完整");
      return `[${value.map(item => sourceText(item, ancestors)).join(",")}]`;
    }
    return `{${(keys as string[]).sort().map(key => `${JSON.stringify(key)}:${sourceText(descriptors[key].value, ancestors)}`).join(",")}}`;
  } finally { ancestors.delete(value); }
}

async function requireProject(scope: ResearchScope) {
  const project = await getProjectByIdAdmin(scope.projectId, scope.workspaceId);
  if (!project || project.id !== scope.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Listing项目不存在或不在当前工作区" });
  // Retain the existing repository's legacy NULL policy. This service is not an
  // actor permission grant; the route/worker must independently authorize it.
  if (project.workspaceId !== null && project.workspaceId !== scope.workspaceId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Listing项目不属于当前工作区" });
  }
}

function assertSelectedSourceUsable(row: CompetitorAnalysis, scope: ResearchScope) {
  const active = readActiveCompetitorResearch(row);
  if (active.status === "unavailable") return unavailable("所选深度研究未正式采纳或来源已变化，不能使用历史分析生成");
  if (active.status === "adopted_deep") {
    // A legacy NULL project is accessible under the caller's existing policy,
    // but its privately adopted research remains bound to its exact workspace.
    try { assertActiveCompetitorResearchScope(row, active, scope); } catch {
      throw new TRPCError({ code: "FORBIDDEN", message: "所选深度研究不属于当前工作区或来源身份不匹配" });
    }
    return;
  }
  // Preserve legacy records without a source envelope; do not require all
  // drafts to be confirmed. Known historical/capture-only data is different.
  if (row.rawData === null) return;
  if (typeof row.rawData !== "string") return unavailable("所选竞品来源状态无法核验，请重新读取资料");
  if (row.rawData.trim() === "") return;
  let raw: unknown;
  try { raw = JSON.parse(row.rawData); }
  catch { return unavailable("所选竞品来源状态无法核验，请重新读取资料"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unavailable("所选竞品来源状态无法核验，请重新读取资料");
  const source = raw as Record<string, unknown>;
  for (const key of ["analysisStale", "captureOnly"] as const) {
    if (Object.hasOwn(source, key) && typeof source[key] !== "boolean") return unavailable("所选竞品来源状态无法核验，请重新读取资料");
    if (source[key] === true) return unavailable("所选竞品资料已变化或尚未分析，不能将历史摘要用于当前生成");
  }
}

async function readSelection(scope: ResearchScope, requestedIds: number[] | undefined, mode: ListingResearchBinding["mode"]): Promise<ListingResearchSelection> {
  await requireProject(scope);
  // Explicit empty selections do not touch unrelated research or comparisons.
  const rows = requestedIds?.length === 0 ? [] : await getCompetitorAnalysesByProject(scope.projectId);
  const rowIds = rows.map(row => row.id);
  if (new Set(rowIds).size !== rowIds.length || rows.some(row => !Number.isSafeInteger(row.id) || row.id <= 0 || row.projectId !== scope.projectId)) {
    return unavailable("竞品分析来源身份不完整或不属于当前项目");
  }
  const parsedIds = listingResearchIdsSchema.safeParse(requestedIds ?? rowIds);
  if (!parsedIds.success) return unavailable("竞品分析选集不完整或超过1000条，请重新选择");
  const analysisIds = [...parsedIds.data].sort((left, right) => left - right);
  const byId = new Map(rows.map(row => [row.id, row]));
  const selected = analysisIds.map(id => {
    const row = byId.get(id);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "所选竞品分析已删除或不属于当前项目，请重新选择" });
    assertSelectedSourceUsable(row, scope);
    return row;
  });
  let confirmedComparison: CompetitorComparisonReport | null = null;
  if (analysisIds.length > 0) {
    const selectionKey = analysisIds.join("-");
    const comparison = await getLatestCompetitorComparisonReport(scope.projectId, selectionKey);
    if (comparison) {
      if (comparison.projectId !== scope.projectId || (comparison.workspaceId !== null && comparison.workspaceId !== scope.workspaceId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "竞品对比来源不属于当前项目或工作区" });
      }
      let storedIds: unknown;
      try { storedIds = JSON.parse(comparison.analysisIds); } catch { return unavailable("竞品对比选集记录损坏"); }
      const parsed = listingResearchIdsSchema.safeParse(storedIds);
      if (!parsed.success || comparison.selectionKey !== selectionKey
        || JSON.stringify([...parsed.data].sort((a, b) => a - b)) !== JSON.stringify(analysisIds)) {
        return unavailable("竞品对比记录与所选分析ID不一致");
      }
      if (comparison.status !== "draft" && comparison.status !== "confirmed") return unavailable("竞品对比审核状态无效");
      if (comparison.status === "confirmed") confirmedComparison = comparison;
    }
  }
  // Snapshot before returning: a caller must not be able to alter DB mock/cache
  // objects through this result. Dates and zero/false values are preserved.
  const hashInput = { version: 1, ...scope, mode, analysisIds, competitors: selected, confirmedComparison };
  const sourceHash = createHash("sha256").update(sourceText(hashInput)).digest("hex");
  const snapshots = structuredClone(selected);
  selected.forEach((row, index) => cloneActiveResearch(row, snapshots[index]));
  return {
    binding: { version: 1, ...scope, mode, analysisIds, sourceHash },
    competitors: snapshots, confirmedComparison: structuredClone(confirmedComparison), reviewAggregation: null,
  };
}

/** Call only after the route has authorized the project and before creating
 * Agent/Listing/job side effects. A missing argument freezes current IDs once. */
export async function prepareListingResearchSelection(input: PrepareInput): Promise<ListingResearchSelection> {
  const parsed = prepareSchema.safeParse(input);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "竞品研究选集或工作区参数无效" });
  const { projectId, workspaceId, analysisIds } = parsed.data;
  return readSelection({ projectId, workspaceId }, analysisIds, analysisIds === undefined ? "legacy_all" : "explicit");
}

/** Rechecks exactly the persisted IDs, including legacy_all snapshots. Never
 * interprets a historical binding as permission to include newly added rows. */
export async function assertListingResearchSelection(binding: ListingResearchBinding, scope: ResearchScope): Promise<ListingResearchSelection> {
  const parsedBinding = listingResearchBindingSchema.safeParse(binding), parsedScope = scopeSchema.safeParse(scope);
  if (!parsedBinding.success || !parsedScope.success) return unavailable("竞品研究任务缺少有效来源版本，请重新创建任务");
  if (parsedBinding.data.projectId !== parsedScope.data.projectId || parsedBinding.data.workspaceId !== parsedScope.data.workspaceId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "竞品研究任务与当前项目或工作区不一致" });
  }
  const current = await readSelection(parsedScope.data, parsedBinding.data.analysisIds, parsedBinding.data.mode);
  if (current.binding.sourceHash !== parsedBinding.data.sourceHash) {
    throw new TRPCError({ code: "CONFLICT", message: "所选竞品研究来源或已确认对比已变化，请重新选择并创建任务" });
  }
  return current;
}
