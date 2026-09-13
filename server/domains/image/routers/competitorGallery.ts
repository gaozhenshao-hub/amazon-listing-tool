import * as shared from "../routerContext";
import { CompetitorGalleryAnalysisSchema, CompetitorImageFactSchema } from "../competitorGalleryContracts";
import {
  addCompetitorResearchSubject,
  archiveCompetitorResearchSubject,
  confirmCompetitorGalleryAnalysis,
  listCompetitorGallerySubjects,
  listCompetitorSnapshotOptions,
  saveCompetitorAssetFact,
  saveCompetitorGalleryAnalysis,
  setPrimaryCompetitorSubject,
} from "../competitorGalleryService";
import {
  getLatestCompetitorGalleryJob,
  startCompetitorGalleryAnalysisJob,
} from "../services/competitorGalleryJob";

const { protectedProcedure, resolveProjectAccess, ensureWriteAccess, z } = shared;

function projectWorkspaceId(project: any, contextWorkspaceId?: number | null) {
  const workspaceId = Number(project?.workspaceId || contextWorkspaceId || 0);
  if (workspaceId <= 0) throw new Error("当前工作空间不可用");
  return workspaceId;
}

async function access(input: { projectId: number }, ctx: any, write = false) {
  const project = await resolveProjectAccess(input.projectId, ctx.user);
  if (write) ensureWriteAccess(project, ctx.user);
  return { project, workspaceId: projectWorkspaceId(project, ctx.workspaceId) };
}

export const imageCompetitorGalleryProcedures = {
  listCompetitorSnapshotOptions: protectedProcedure.query(async ({ ctx }) =>
    listCompetitorSnapshotOptions(ctx.workspaceId)),

  listCompetitorGallerySubjects: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const { workspaceId } = await access(input, ctx);
      return listCompetitorGallerySubjects({ workspaceId, projectId: input.projectId });
    }),

  addCompetitorResearchSubject: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      confirmedSnapshotId: z.number().int().positive(),
      role: z.enum(["primary", "benchmark", "supplemental"]),
      displayName: z.string().trim().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId } = await access(input, ctx, true);
      return addCompetitorResearchSubject({ ...input, workspaceId, userId: ctx.user.id });
    }),

  setPrimaryCompetitorSubject: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), subjectId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId } = await access(input, ctx, true);
      return setPrimaryCompetitorSubject({ ...input, workspaceId });
    }),

  archiveCompetitorResearchSubject: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), subjectId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId } = await access(input, ctx, true);
      return archiveCompetitorResearchSubject({ ...input, workspaceId });
    }),

  startCompetitorGalleryAnalysis: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), subjectId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId } = await access(input, ctx, true);
      return startCompetitorGalleryAnalysisJob({ ...input, workspaceId, userId: ctx.user.id });
    }),

  latestCompetitorGalleryJob: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), subjectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await access(input, ctx);
      return getLatestCompetitorGalleryJob(ctx.user.id, input.projectId, input.subjectId);
    }),

  saveCompetitorImageFact: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(), subjectId: z.number().int().positive(), factId: z.number().int().positive(), fact: CompetitorImageFactSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId } = await access(input, ctx, true);
      return saveCompetitorAssetFact({ ...input, workspaceId });
    }),

  saveCompetitorGalleryAnalysis: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(), subjectId: z.number().int().positive(), analysisId: z.number().int().positive(), analysis: CompetitorGalleryAnalysisSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId } = await access(input, ctx, true);
      return saveCompetitorGalleryAnalysis({ ...input, workspaceId });
    }),

  confirmCompetitorGalleryAnalysis: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), subjectId: z.number().int().positive(), analysisId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId } = await access(input, ctx, true);
      return confirmCompetitorGalleryAnalysis({ ...input, workspaceId, userId: ctx.user.id });
    }),
};
