import { recordProductDevelopmentAudit, resolveDevProjectAccess } from "../security/productDevelopmentAccess";
import type { ProductDevelopmentContext } from "../types";
import { listProjectSources, upsertProjectProgress } from "./projectListRepository";
import type { ProjectProgressPatch } from "./projectListTypes";
import { buildProjectListRows } from "./projectListViewModel";

export async function listProjectProgress(
  ctx: ProductDevelopmentContext,
  includeWorkspaceProjects: boolean,
) {
  const source = await listProjectSources(ctx.workspaceId ?? null, ctx.user.id, includeWorkspaceProjects);
  return buildProjectListRows(source);
}

export async function updateProjectProgress(
  ctx: ProductDevelopmentContext,
  projectId: number,
  patch: ProjectProgressPatch,
) {
  const project = await resolveDevProjectAccess(projectId, ctx, "update");
  const normalizedPatch: ProjectProgressPatch = { ...patch };
  if ("primaryCompetitorAsin" in patch) {
    normalizedPatch.primaryCompetitorAsin = patch.primaryCompetitorAsin?.trim().toUpperCase() || null;
  }
  if ("selectorName" in patch) normalizedPatch.selectorName = patch.selectorName?.trim() || null;
  if ("assistantName" in patch) normalizedPatch.assistantName = patch.assistantName?.trim() || null;
  const result = await upsertProjectProgress({
    projectId,
    workspaceId: project.workspaceId,
    updatedBy: ctx.user.id,
    patch: normalizedPatch,
  });
  await recordProductDevelopmentAudit({
    ctx,
    action: "product_development.project.progress.update",
    projectId,
    resourceType: "dev_project_progress",
    resourceId: projectId,
    resourceName: project.name,
    afterSnapshot: normalizedPatch,
  });
  return result;
}
