import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { actorFromContext, assertResourceAction, hasResourceAction, recordSecurityAuditLog, workspaceIdFromContext } from "../services/securityGovernance";
import {
  createProject,
  deleteProject,
  getAllProjects,
  getProjectById,
  getProjectByIdAdmin,
  getProjectsByUser,
  updateProject,
} from "../repositories/project";

export const projectRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const workspaceId = workspaceIdFromContext(ctx);
    const actor = actorFromContext(ctx);
    const canReadProject = await hasResourceAction({ actor, resource: "project", action: "read", workspaceId });
    const canReadImageWorkflow = !canReadProject && await hasResourceAction({ actor, resource: "image_workflow", action: "read", workspaceId });
    if (!canReadProject && !canReadImageWorkflow) {
      await assertResourceAction({ actor, resource: "project", action: "read", workspaceId });
    }
    // super_admin, admin, and designer can see all projects with owner info
    // designer needs read-only access to all projects for image suggestions
    if (ctx.user.role === 'super_admin' || ctx.user.role === 'admin' || ctx.user.role === 'designer') {
      return getAllProjects(workspaceId);
    }
    return getProjectsByUser(ctx.user.id, workspaceId);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const workspaceId = workspaceIdFromContext(ctx);
      const actor = actorFromContext(ctx);
      const canReadProject = await hasResourceAction({ actor, resource: "project", action: "read", workspaceId, projectId: input.id, resourceId: input.id });
      const canReadImageWorkflow = !canReadProject && await hasResourceAction({ actor, resource: "image_workflow", action: "read", workspaceId, projectId: input.id, resourceId: input.id });
      if (!canReadProject && !canReadImageWorkflow) {
        await assertResourceAction({ actor, resource: "project", action: "read", workspaceId, projectId: input.id, resourceId: input.id });
      }
      // super_admin, admin, and designer can access any project (designer: read-only for image suggestions)
      if (ctx.user.role === 'super_admin' || ctx.user.role === 'admin' || ctx.user.role === 'designer') {
        const project = await getProjectByIdAdmin(input.id, workspaceId);
        if (!project) throw new Error("Project not found");
        return project;
      }
      const project = await getProjectById(input.id, ctx.user.id, workspaceId);
      if (!project) throw new Error("Project not found");
      await assertResourceAction({ actor: actorFromContext(ctx), resource: "project", action: "read", workspaceId, projectId: input.id, resourceId: input.id, ownerUserId: project.userId });
      return project;
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      brand: z.string().max(255).optional(),
      productName: z.string().max(500).optional(),
      category: z.string().max(255).optional(),
      targetMarket: z.string().max(100).optional(),
      productFeatures: z.string().optional(),
      productSpecs: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const workspaceId = workspaceIdFromContext(ctx);
      await assertResourceAction({ actor: actorFromContext(ctx), resource: "project", action: "create", workspaceId });
      const project = await createProject({
        workspaceId,
        userId: ctx.user.id,
        name: input.name,
        brand: input.brand ?? null,
        productName: input.productName ?? null,
        category: input.category ?? null,
        targetMarket: input.targetMarket ?? "US",
        productFeatures: input.productFeatures ?? null,
        productSpecs: input.productSpecs ?? null,
      });
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "project.create",
        resourceType: "project",
        resourceId: project.id,
        resourceName: project.name,
        projectId: project.id,
        status: "success",
        riskLevel: "medium",
      });
      return project;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      brand: z.string().max(255).optional(),
      productName: z.string().max(500).optional(),
      category: z.string().max(255).optional(),
      targetMarket: z.string().max(100).optional(),
      productFeatures: z.string().optional(),
      productSpecs: z.string().optional(),
      status: z.enum(["draft", "analyzing", "generating", "completed"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const workspaceId = workspaceIdFromContext(ctx);
      // Admin can update any project
      if (ctx.user.role === 'super_admin' || ctx.user.role === 'admin') {
        const project = await getProjectByIdAdmin(id, workspaceId);
        if (!project) throw new Error("Project not found");
        await assertResourceAction({ actor: actorFromContext(ctx), resource: "project", action: "update", workspaceId, projectId: id, resourceId: id, ownerUserId: project.userId });
        const updated = await updateProject(id, project.userId, data);
        await recordSecurityAuditLog({ ctx, workspaceId, action: "project.update", resourceType: "project", resourceId: id, projectId: id, status: "success", riskLevel: "medium", metadata: Object.keys(data) });
        return updated;
      }
      const project = await getProjectById(id, ctx.user.id, workspaceId);
      if (!project) throw new Error("Project not found");
      await assertResourceAction({ actor: actorFromContext(ctx), resource: "project", action: "update", workspaceId, projectId: id, resourceId: id, ownerUserId: project.userId });
      const updated = await updateProject(id, ctx.user.id, data);
      await recordSecurityAuditLog({ ctx, workspaceId, action: "project.update", resourceType: "project", resourceId: id, projectId: id, status: "success", riskLevel: "medium", metadata: Object.keys(data) });
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const workspaceId = workspaceIdFromContext(ctx);
      // Admin can delete any project
      if (ctx.user.role === 'super_admin' || ctx.user.role === 'admin') {
        const project = await getProjectByIdAdmin(input.id, workspaceId);
        if (!project) throw new Error("Project not found");
        await assertResourceAction({ actor: actorFromContext(ctx), resource: "project", action: "delete", workspaceId, projectId: input.id, resourceId: input.id, ownerUserId: project.userId });
        const result = await deleteProject(input.id, project.userId);
        await recordSecurityAuditLog({ ctx, workspaceId, action: "project.delete", resourceType: "project", resourceId: input.id, projectId: input.id, status: result.success ? "success" : "failed", riskLevel: "high" });
        return result;
      }
      const project = await getProjectById(input.id, ctx.user.id, workspaceId);
      if (!project) throw new Error("Project not found");
      await assertResourceAction({ actor: actorFromContext(ctx), resource: "project", action: "delete", workspaceId, projectId: input.id, resourceId: input.id, ownerUserId: project.userId });
      const result = await deleteProject(input.id, ctx.user.id);
      await recordSecurityAuditLog({ ctx, workspaceId, action: "project.delete", resourceType: "project", resourceId: input.id, projectId: input.id, status: result.success ? "success" : "failed", riskLevel: "high" });
      return result;
    }),
});
