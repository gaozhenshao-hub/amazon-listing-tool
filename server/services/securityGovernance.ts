import { randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import { sql as drizzleSql } from "drizzle-orm";
import {
  ROLE_MODULE_ACCESS,
  SECURITY_ACTION_OPERATION,
  SECURITY_PERMISSION_MATRIX,
  SECURITY_RESOURCE_MODULES,
  type ModulePermission,
  type SecurityAction,
  type SecurityResource,
} from "@shared/const";
import { getDb } from "../repositories/dbClient";
import type { TrpcContext } from "../_core/context";

export type { SecurityAction, SecurityResource } from "@shared/const";

export type SecurityAuditStatus = "success" | "denied" | "failed";
export type SecurityRiskLevel = "low" | "medium" | "high" | "critical";

export type SecurityActor = {
  id: number;
  role: string;
  defaultWorkspaceId?: number | null;
};

export type ResourceActionCheck = {
  actor: SecurityActor;
  resource: SecurityResource;
  action: SecurityAction;
  workspaceId?: number | null;
  projectId?: number | null;
  resourceId?: string | number | null;
  ownerUserId?: number | null;
};

export type SecurityAuditInput = {
  ctx?: TrpcContext;
  actorUserId?: number | null;
  actorRole?: string | null;
  workspaceId?: number | null;
  action: string;
  resourceType: string;
  resourceId?: string | number | null;
  resourceName?: string | null;
  projectId?: number | null;
  agentRunId?: string | null;
  toolSlug?: string | null;
  status?: SecurityAuditStatus;
  riskLevel?: SecurityRiskLevel;
  reason?: string | null;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  metadata?: unknown;
};

const SENSITIVE_AUDIT_KEY_PATTERN = /(authorization|cookie|token|secret|password|api[-_]?key|access[-_]?key|refresh[-_]?token|connection[-_]?string|dsn)/i;

function isAdminRole(role: string | null | undefined) {
  return role === "super_admin" || role === "admin";
}

function isMissingGovernanceSchema(error: unknown) {
  return /doesn't exist|unknown column|no such table|no such column/i.test(String((error as Error).message));
}

function normalizeWorkspaceId(actor: SecurityActor, workspaceId?: number | null) {
  return workspaceId ?? actor.defaultWorkspaceId ?? null;
}

function jsonOrNull(value: unknown) {
  return value === undefined ? null : JSON.stringify(sanitizeForSecurityAudit(value));
}

function sanitizeForSecurityAudit(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MaxDepth]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeForSecurityAudit(item, depth + 1));
  if (typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_AUDIT_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeForSecurityAudit(item, depth + 1),
    ]),
  );
}

async function rawSecurityQuery(sqlStr: string, params: unknown[] = []): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];
  let result: any;
  if (params.length > 0) {
    const parts = sqlStr.split("?");
    const chunks: any[] = [];
    for (let i = 0; i < parts.length; i++) {
      chunks.push(drizzleSql.raw(parts[i]));
      if (i < params.length) chunks.push(drizzleSql`${params[i]}`);
    }
    result = await db.execute(drizzleSql.join(chunks, drizzleSql.raw("")));
  } else {
    result = await db.execute(drizzleSql.raw(sqlStr));
  }
  const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
  return Array.isArray(rows) ? rows : [];
}

async function actorCanUseWorkspace(actor: SecurityActor, workspaceId: number | null): Promise<boolean> {
  if (!workspaceId) return true;
  if (actor.role === "super_admin") return true;
  if (actor.defaultWorkspaceId === workspaceId) return true;
  try {
    const rows = await rawSecurityQuery(
      `SELECT id
       FROM workspace_memberships
       WHERE workspaceId=? AND userId=? AND status='active'
       LIMIT 1`,
      [workspaceId, actor.id],
    );
    return Boolean(rows[0]);
  } catch (error) {
    if (!isMissingGovernanceSchema(error)) {
      console.warn("[Security] Failed to verify workspace membership:", error);
    }
    return actor.defaultWorkspaceId === workspaceId;
  }
}

function parseJsonArray<T>(value: unknown, fallback: T[] = []): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
}

function modulePermissionAllows(
  detailedPermissions: ModulePermission[] | null,
  resource: SecurityResource,
  action: SecurityAction,
) {
  if (!detailedPermissions?.length) return null;
  const mapping = SECURITY_RESOURCE_MODULES[resource];
  const operation = SECURITY_ACTION_OPERATION[action];
  const modulePermission = detailedPermissions.find((perm) => perm.moduleId === mapping.moduleId);
  if (!modulePermission) return false;
  if (mapping.subModuleId && modulePermission.subModules?.length) {
    const subPermission = modulePermission.subModules.find((sub) => sub.subModuleId === mapping.subModuleId);
    if (subPermission) return subPermission.operations.includes(operation);
  }
  return modulePermission.operations.includes(operation);
}

async function getRolePermissionOverride(role: string, workspaceId: number | null) {
  try {
    const rows = await rawSecurityQuery(
      `SELECT modules,detailedPermissions
       FROM role_permissions
       WHERE role=? AND (workspaceId=? OR workspaceId IS NULL)
       ORDER BY workspaceId IS NULL ASC
       LIMIT 1`,
      [role, workspaceId],
    );
    return rows[0] || null;
  } catch (error) {
    if (!isMissingGovernanceSchema(error)) {
      console.warn("[Security] Failed to load role permission override:", error);
    }
    return null;
  }
}

async function evaluateAccessPolicy(input: ResourceActionCheck): Promise<boolean | null> {
  try {
    const rows = await rawSecurityQuery(
      `SELECT effect
       FROM security_access_policies
       WHERE status='active'
         AND resourceType=?
         AND action=?
         AND (workspaceId=? OR workspaceId IS NULL)
         AND (resourceId=? OR resourceId IS NULL)
         AND (
           (principalType='user' AND principalId=?)
           OR (principalType='role' AND principalId=?)
           OR principalType='workspace_member'
         )
       ORDER BY effect='deny' DESC, resourceId IS NOT NULL DESC, workspaceId IS NOT NULL DESC
       LIMIT 1`,
      [
        input.resource,
        input.action,
        normalizeWorkspaceId(input.actor, input.workspaceId),
        input.resourceId === undefined || input.resourceId === null ? null : String(input.resourceId),
        String(input.actor.id),
        input.actor.role,
      ],
    );
    if (!rows[0]) return null;
    return rows[0].effect === "allow";
  } catch (error) {
    if (!isMissingGovernanceSchema(error)) {
      console.warn("[Security] Failed to evaluate access policy:", error);
    }
    return null;
  }
}

function baseMatrixAllows(role: string, resource: SecurityResource, action: SecurityAction) {
  return Boolean(SECURITY_PERMISSION_MATRIX[role]?.[resource]?.includes(action));
}

export async function hasResourceAction(input: ResourceActionCheck): Promise<boolean> {
  if (isAdminRole(input.actor.role) && input.actor.role === "super_admin") return true;

  const workspaceId = normalizeWorkspaceId(input.actor, input.workspaceId);
  if (!(await actorCanUseWorkspace(input.actor, workspaceId))) return false;
  if (input.ownerUserId && input.ownerUserId === input.actor.id && input.action !== "delete") return true;

  const policyDecision = await evaluateAccessPolicy(input);
  if (policyDecision !== null) return policyDecision;

  const override = await getRolePermissionOverride(input.actor.role, workspaceId);
  if (override) {
    const detailedPermissions = parseJsonArray<ModulePermission>(override.detailedPermissions, []);
    const detailedDecision = modulePermissionAllows(detailedPermissions, input.resource, input.action);
    if (detailedDecision !== null) return detailedDecision;

    const modules = parseJsonArray<string>(override.modules, []);
    const moduleId = SECURITY_RESOURCE_MODULES[input.resource].moduleId;
    return modules.includes(moduleId) && baseMatrixAllows(input.actor.role, input.resource, input.action);
  }

  return baseMatrixAllows(input.actor.role, input.resource, input.action);
}

export async function assertResourceAction(input: ResourceActionCheck): Promise<void> {
  const allowed = await hasResourceAction(input);
  if (allowed) return;
  const message = `没有权限执行 ${input.resource}.${input.action}`;
  await recordSecurityAuditLog({
    actorUserId: input.actor.id,
    actorRole: input.actor.role,
    workspaceId: normalizeWorkspaceId(input.actor, input.workspaceId),
    action: `${input.resource}.${input.action}`,
    resourceType: input.resource,
    resourceId: input.resourceId,
    projectId: input.projectId,
    status: "denied",
    riskLevel: input.action === "delete" || input.action.includes("secret") ? "high" : "medium",
    reason: message,
  });
  throw new TRPCError({ code: "FORBIDDEN", message });
}

export async function recordSecurityAuditLog(input: SecurityAuditInput): Promise<void> {
  const actor = input.ctx?.user;
  const req = input.ctx?.req;
  try {
    await rawSecurityQuery(
      `INSERT INTO security_audit_logs
       (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,resourceName,projectId,agentRunId,toolSlug,status,riskLevel,ipAddress,userAgent,requestId,reason,beforeSnapshot,afterSnapshot,metadata)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        `audit_${randomUUID()}`,
        input.workspaceId ?? (actor as any)?.defaultWorkspaceId ?? null,
        input.actorUserId ?? actor?.id ?? null,
        input.actorRole ?? (actor as any)?.role ?? null,
        input.action,
        input.resourceType,
        input.resourceId === undefined || input.resourceId === null ? null : String(input.resourceId),
        input.resourceName || null,
        input.projectId ?? null,
        input.agentRunId || null,
        input.toolSlug || null,
        input.status || "success",
        input.riskLevel || "medium",
        req?.ip || req?.socket?.remoteAddress || null,
        req?.headers?.["user-agent"] ? String(req.headers["user-agent"]).slice(0, 512) : null,
        input.ctx?.requestId
          || (req?.headers?.["x-request-id"] ? String(req.headers["x-request-id"]).slice(0, 128) : null),
        input.reason || null,
        jsonOrNull(input.beforeSnapshot),
        jsonOrNull(input.afterSnapshot),
        jsonOrNull(input.metadata),
      ],
    );
  } catch (error) {
    if (!isMissingGovernanceSchema(error)) {
      console.warn("[Security] Failed to record audit log:", error);
    }
  }
}

export function actorFromContext(ctx: TrpcContext): SecurityActor {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录 (10001)" });
  return {
    id: ctx.user.id,
    role: (ctx.user as any).role,
    defaultWorkspaceId: (ctx.user as any).defaultWorkspaceId ?? null,
  };
}

export function workspaceIdFromContext(ctx: TrpcContext, explicitWorkspaceId?: number | null): number | null {
  return explicitWorkspaceId ?? ctx.workspaceId ?? (ctx.user as any)?.defaultWorkspaceId ?? null;
}

export function buildWorkspaceScopeFilter(workspaceId?: number | null, column = "workspaceId") {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(column)) {
    throw new Error(`Unsafe workspace scope column: ${column}`);
  }
  const normalizedWorkspaceId = workspaceId ?? null;
  if (normalizedWorkspaceId === null) {
    return {
      clause: `${column} IS NULL`,
      params: [] as unknown[],
    };
  }
  return {
    clause: `(${column}=? OR ${column} IS NULL)`,
    params: [normalizedWorkspaceId] as unknown[],
  };
}
