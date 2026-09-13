import * as shared from "../routerContext";
import { ExpressionSelectionFilterSchema, Step0SynthesisSchema, ExpressionGroupAnalysisSchema } from "../expressionLinkageContracts";
import {
  confirmExpressionAnalysisVersion,
  confirmExpressionSelectionVersion,
  confirmStep0SynthesisVersion,
  getStep0SynthesisState,
  listExpressionAssetCandidates,
  saveExpressionAnalysisEdit,
  saveExpressionSelection,
  saveStep0SynthesisEdit,
} from "../expressionLinkageService";
import {
  getLatestExpressionAnalysisJob,
  getLatestStep0SynthesisJob,
  startExpressionAnalysisJob,
  startStep0SynthesisJob,
} from "../services/expressionLinkageJob";

const { protectedProcedure, resolveProjectAccess, resolveSessionAccess, ensureWriteAccess, z } = shared;

function projectWorkspaceId(project: any, contextWorkspaceId?: number | null) {
  const workspaceId = Number(project?.workspaceId || contextWorkspaceId || 0);
  if (workspaceId <= 0) throw new Error("当前工作空间不可用");
  return workspaceId;
}

async function access(input: { projectId: number }, ctx: any, write = false) {
  const project = await resolveProjectAccess(input.projectId, ctx.user);
  if (write) ensureWriteAccess(project, ctx.user);
  const session = await resolveSessionAccess(input.projectId, ctx.user);
  if (!session) throw new Error("图片工作流会话不存在");
  return { project, session, workspaceId: projectWorkspaceId(project, ctx.workspaceId) };
}

export const imageExpressionLinkageProcedures = {
  listExpressionAssetCandidates: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      groupId: z.number().int().positive(),
      filters: ExpressionSelectionFilterSchema.optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { workspaceId } = await access(input, ctx);
      return listExpressionAssetCandidates({ workspaceId, ...input });
    }),

  saveExpressionSelection: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      groupId: z.number().int().positive(),
      filters: ExpressionSelectionFilterSchema.optional(),
      selectedAssetIds: z.array(z.number().int().positive()).min(1),
      aiRecommendedAssetIds: z.array(z.number().int().positive()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId, session } = await access(input, ctx, true);
      return saveExpressionSelection({ workspaceId, sessionId: session.id, userId: ctx.user.id, ...input });
    }),

  confirmExpressionSelection: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), groupId: z.number().int().positive(), selectionVersionId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId } = await access(input, ctx, true);
      return confirmExpressionSelectionVersion({ workspaceId, userId: ctx.user.id, ...input });
    }),

  startExpressionAssetAnalysis: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), groupId: z.number().int().positive(), selectionVersionId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId, session } = await access(input, ctx, true);
      return startExpressionAnalysisJob({ workspaceId, sessionId: session.id, userId: ctx.user.id, ...input });
    }),

  latestExpressionAssetAnalysisJob: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), groupId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await access(input, ctx);
      return getLatestExpressionAnalysisJob(ctx.user.id, input.projectId, input.groupId);
    }),

  saveExpressionAssetAnalysis: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), groupId: z.number().int().positive(), analysisId: z.number().int().positive(), analysis: ExpressionGroupAnalysisSchema }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId } = await access(input, ctx, true);
      return saveExpressionAnalysisEdit({ workspaceId, ...input });
    }),

  confirmExpressionAssetAnalysis: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), groupId: z.number().int().positive(), analysisId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId } = await access(input, ctx, true);
      return confirmExpressionAnalysisVersion({ workspaceId, userId: ctx.user.id, ...input });
    }),

  getStep0SynthesisState: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const { workspaceId, session } = await access(input, ctx);
      return getStep0SynthesisState({ workspaceId, projectId: input.projectId, sessionId: session.id });
    }),

  startStep0Synthesis: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId, session } = await access(input, ctx, true);
      return startStep0SynthesisJob({ workspaceId, projectId: input.projectId, sessionId: session.id, userId: ctx.user.id });
    }),

  latestStep0SynthesisJob: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await access(input, ctx);
      return getLatestStep0SynthesisJob(ctx.user.id, input.projectId);
    }),

  saveStep0Synthesis: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), synthesisId: z.number().int().positive(), analysis: Step0SynthesisSchema, selectedDecisionIds: z.array(z.string().min(1)) }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId, session } = await access(input, ctx, true);
      return saveStep0SynthesisEdit({ workspaceId, sessionId: session.id, ...input });
    }),

  confirmStep0Synthesis: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), synthesisId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId, session } = await access(input, ctx, true);
      return confirmStep0SynthesisVersion({ workspaceId, sessionId: session.id, userId: ctx.user.id, ...input });
    }),
};
