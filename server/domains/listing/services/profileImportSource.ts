import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { devProductProfiles, devProjects, projectAssignments } from "../../../../drizzle/schema";
import type { TrpcContext } from "../../../_core/context";
import { getDb } from "../../../repositories/dbClient";
import { actorFromContext, workspaceIdFromContext } from "../../../services/securityGovernance";

type Project = typeof devProjects.$inferSelect;
type Profile = typeof devProductProfiles.$inferSelect;
const elevatedRoles = new Set(["super_admin", "admin", "ops_manager"]);

function denied(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "产品开发来源不存在或无权访问" });
}

export function profileImportWorkspace(ctx: TrpcContext, expectedWorkspaceId?: number | null) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  const workspaceId = workspaceIdFromContext(ctx);
  if (workspaceId !== null && (!Number.isSafeInteger(workspaceId) || workspaceId <= 0)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "来源工作区无效" });
  }
  if (expectedWorkspaceId !== undefined && expectedWorkspaceId !== workspaceId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "工作区已变化，请重新选择产品画像" });
  }
  return workspaceId;
}

function parentScope(workspaceId: number | null, actorId: number) {
  // Match the existing dev-project repository's owner-only NULL-parent rule.
  const legacyOwner = and(isNull(devProjects.workspaceId), eq(devProjects.userId, actorId));
  return workspaceId === null ? legacyOwner : or(eq(devProjects.workspaceId, workspaceId), legacyOwner);
}

function childScope(column: typeof projectAssignments.workspaceId | typeof devProductProfiles.workspaceId, workspaceId: number | null) {
  return workspaceId === null ? isNull(column) : or(eq(column, workspaceId), isNull(column));
}

function parentInScope(project: Project, workspaceId: number | null, actorId: number) {
  return project.workspaceId === null ? project.userId === actorId : project.workspaceId === workspaceId;
}

export async function listProfileImportSources(ctx: TrpcContext, expectedWorkspaceId?: number | null) {
  const workspaceId = profileImportWorkspace(ctx, expectedWorkspaceId);
  const actor = actorFromContext(ctx);
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  let projectIds: number[] | undefined;
  if (!elevatedRoles.has(actor.role)) {
    const assignments = await database.select().from(projectAssignments).where(and(
      eq(projectAssignments.assignedUserId, actor.id), eq(projectAssignments.projectType, "dev_project"),
      childScope(projectAssignments.workspaceId, workspaceId),
    ));
    projectIds = assignments.filter(row => row.assignedUserId === actor.id && row.projectType === "dev_project"
      && (row.workspaceId === workspaceId || row.workspaceId === null)).map(row => row.projectId);
    if (!projectIds.length) return [];
  }
  const rows = await database.select().from(devProjects).where(and(parentScope(workspaceId, actor.id),
    projectIds ? inArray(devProjects.id, projectIds) : undefined)).orderBy(desc(devProjects.updatedAt));
  const result = [];
  for (const project of rows) {
    if (!parentInScope(project, workspaceId, actor.id) || (projectIds && !projectIds.includes(project.id))) continue;
    result.push({ id: project.id, name: project.name, targetMarket: project.targetMarket, status: project.status });
  }
  return result;
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function profileImportSourceHash(workspaceId: number | null, project: Project, profile: Profile) {
  // Bind the complete stored source, including identities, confirmation flags and timestamps.
  return createHash("sha256").update(JSON.stringify(canonical({ kind: "dev_product_profile", workspaceId, project, profile }))).digest("hex");
}

export async function loadProfileImportSource(ctx: TrpcContext, input: {
  devProjectId: number; expectedWorkspaceId?: number | null; expectedSourceHash?: string;
}) {
  const workspaceId = profileImportWorkspace(ctx, input.expectedWorkspaceId);
  const actor = actorFromContext(ctx);
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  const [project] = await database.select().from(devProjects).where(and(
    eq(devProjects.id, input.devProjectId), parentScope(workspaceId, actor.id),
  )).limit(1);
  if (!project || project.id !== input.devProjectId || !parentInScope(project, workspaceId, actor.id)) denied();
  if (!elevatedRoles.has(actor.role)) {
    const assignments = await database.select().from(projectAssignments).where(and(
      eq(projectAssignments.projectId, project.id), eq(projectAssignments.projectType, "dev_project"),
      eq(projectAssignments.assignedUserId, actor.id), childScope(projectAssignments.workspaceId, workspaceId),
    )).limit(1);
    if (!assignments.some(row => row.projectId === project.id && row.projectType === "dev_project"
      && row.assignedUserId === actor.id && (row.workspaceId === null || row.workspaceId === workspaceId))) denied();
  }
  // Preserve the existing cross-module admin/assignment grant. A development-module
  // role gate would incorrectly deny assigned operations users who lack that module.
  const profiles = await database.select().from(devProductProfiles).where(and(
    eq(devProductProfiles.projectId, project.id), childScope(devProductProfiles.workspaceId, workspaceId),
  )).limit(2);
  if (profiles.length > 1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "产品画像来源不唯一，请先核对来源" });
  const profile = profiles[0] ?? null;
  // Legacy children inherit only their verified parent's scope, never a global fallback.
  if (profile && (profile.projectId !== project.id
    || (profile.workspaceId !== null && profile.workspaceId !== workspaceId)
    || (profile.workspaceId === null && profile.userId !== project.userId))) denied();
  const sourceHash = profile ? profileImportSourceHash(workspaceId, project, profile) : null;
  if (input.expectedSourceHash !== undefined && input.expectedSourceHash !== sourceHash) {
    throw new TRPCError({ code: "CONFLICT", message: "产品画像已变化，请重新预览并选择" });
  }
  return { project, profile, sourceHash };
}

const profileSections = [
  ["appearanceColors", "外观设计"], ["mainFunctions", "功能特点"], ["costBreakdown", "产品成本"],
  ["packageDimensions", "包装尺寸"], ["packageDesign", "包装设计"], ["userPersona", "用户画像"],
  ["usageScenarios", "使用场景"], ["productMap", "产品地图"],
] as const;

export function flattenProfileSource(data: unknown, indent = 0): string {
  if (data === null || data === undefined || data === "") return "";
  const prefix = "  ".repeat(indent);
  if (typeof data !== "object") return `${prefix}${String(data)}`;
  if (Array.isArray(data)) return data.map(value => flattenProfileSource(value)).filter(text => text.trim())
    .map(text => `${prefix}- ${text}`).join("\n");
  return Object.entries(data).flatMap(([key, value]) => {
    const text = flattenProfileSource(value, typeof value === "object" ? indent + 1 : 0);
    if (!text.trim()) return [];
    return [typeof value === "object" ? `${prefix}${key}:\n${text}` : `${prefix}${key}: ${text}`];
  }).join("\n");
}

export function convertProfileSourceToText(profile: Pick<Profile, typeof profileSections[number][0]>, projectName: string) {
  const sections = [`产品名称: ${projectName}`, ""];
  let provided = false;
  for (const [field, label] of profileSections) {
    const raw = profile[field];
    if (raw === null || raw === undefined || raw === "") continue;
    let value: unknown = raw;
    if (typeof raw === "string") { try { value = JSON.parse(raw); } catch { /* Preserve user-entered text. */ } }
    const text = flattenProfileSource(value);
    if (!text.trim()) continue;
    provided = true;
    sections.push(`【${label}】`, text, "");
  }
  // AI suggestions are not user-provided facts. Do not silently promote their fallback values.
  if (!provided) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "产品画像尚无人工填写内容，AI建议不能代替本品事实；请先完善画像" });
  return sections.join("\n");
}
