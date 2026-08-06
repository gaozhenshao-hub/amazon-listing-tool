import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../../_core/context";
import * as devDb from "../../../devDb";
import {
  actorFromContext,
  assertResourceAction,
  recordSecurityAuditLog,
  type SecurityAction,
  workspaceIdFromContext,
} from "../../../services/securityGovernance";

export type ProductDevelopmentAccessAction = SecurityAction;

function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "产品开发项目不存在或无权访问" });
}

export async function resolveDevProjectAccess(
  projectId: number,
  ctx: TrpcContext,
  action: ProductDevelopmentAccessAction = "read",
) {
  const actor = actorFromContext(ctx);
  const workspaceId = workspaceIdFromContext(ctx);
  const project = await devDb.getDevProjectByWorkspace(projectId, workspaceId, actor.id);
  if (!project) {
    await recordSecurityAuditLog({
      ctx,
      workspaceId,
      action: `product_development.${action}`,
      resourceType: "dev_project",
      resourceId: projectId,
      projectId,
      status: "denied",
      riskLevel: "high",
      reason: "Project is outside the current workspace or is not owned by the actor",
    });
    notFound();
  }

  await assertResourceAction({
    actor,
    resource: "product_development",
    action,
    workspaceId: project.workspaceId,
    projectId,
    resourceId: projectId,
    ownerUserId: project.userId,
  });
  return project;
}

export function productDevelopmentWorkspaceId(ctx: TrpcContext) {
  return workspaceIdFromContext(ctx);
}

export async function recordProductDevelopmentAudit(input: {
  ctx: TrpcContext;
  action: string;
  projectId?: number | null;
  resourceType?: string;
  resourceId?: string | number | null;
  resourceName?: string | null;
  riskLevel?: "low" | "medium" | "high" | "critical";
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  metadata?: unknown;
}) {
  await recordSecurityAuditLog({
    ctx: input.ctx,
    workspaceId: workspaceIdFromContext(input.ctx),
    action: input.action,
    resourceType: input.resourceType || "dev_project",
    resourceId: input.resourceId ?? input.projectId ?? null,
    resourceName: input.resourceName,
    projectId: input.projectId,
    riskLevel: input.riskLevel || "medium",
    beforeSnapshot: input.beforeSnapshot,
    afterSnapshot: input.afterSnapshot,
    metadata: input.metadata,
  });
}
