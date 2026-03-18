import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const projectRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    // super_admin and admin can see all projects with owner info
    if (ctx.user.role === 'super_admin' || ctx.user.role === 'admin') {
      return db.getAllProjects();
    }
    return db.getProjectsByUser(ctx.user.id);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      // super_admin and admin can access any project
      if (ctx.user.role === 'super_admin' || ctx.user.role === 'admin') {
        const project = await db.getProjectByIdAdmin(input.id);
        if (!project) throw new Error("Project not found");
        return project;
      }
      const project = await db.getProjectById(input.id, ctx.user.id);
      if (!project) throw new Error("Project not found");
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
      return db.createProject({
        userId: ctx.user.id,
        name: input.name,
        brand: input.brand ?? null,
        productName: input.productName ?? null,
        category: input.category ?? null,
        targetMarket: input.targetMarket ?? "US",
        productFeatures: input.productFeatures ?? null,
        productSpecs: input.productSpecs ?? null,
      });
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
      // Admin can update any project
      if (ctx.user.role === 'super_admin' || ctx.user.role === 'admin') {
        const project = await db.getProjectByIdAdmin(id);
        if (!project) throw new Error("Project not found");
        return db.updateProject(id, project.userId, data);
      }
      return db.updateProject(id, ctx.user.id, data);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Admin can delete any project
      if (ctx.user.role === 'super_admin' || ctx.user.role === 'admin') {
        const project = await db.getProjectByIdAdmin(input.id);
        if (!project) throw new Error("Project not found");
        return db.deleteProject(input.id, project.userId);
      }
      return db.deleteProject(input.id, ctx.user.id);
    }),
});
