import * as shared from "../routerContext";
import { ensureListingAgentRun } from "../listingAgentBridge";
import {
  cancelListingGenerationJob,
  getLatestListingNodeJob,
  listingGenerationJobInput,
  listListingGenerationJobs,
  startListingGenerationJob,
  syncListingPreparationNodes,
} from "../services/generationJob";
import { resolveConfirmedListingCore } from "../services/listingConfirmedCore";
import { resolveCurrentConfirmedListingFacts } from "../services/listingFactSource";

const { db, ensureWriteAccess, protectedProcedure, resolveProjectAccess, TRPCError, z } = shared;

const nodeIdSchema = z.enum(["N0", "N1", "N2", "N3", "N4", "N5", "G1", "G2", "G3", "G4", "G5"]);

async function resolveListingRun(input: {
  projectId: number;
  userId: number;
  workspaceId?: number | null;
}) {
  let listing = await db.getActiveListingByProject(input.projectId);
  const agentRunId = listing?.agentRunId || await ensureListingAgentRun(input);
  if (!listing) {
    listing = await db.createListing({
      projectId: input.projectId,
      title: "",
      bulletPoints: "[]",
      description: "",
      searchTerms: "",
      agentRunId,
    });
  } else if (agentRunId && listing.agentRunId !== agentRunId) {
    const updated = await db.updateListing(listing.id, { agentRunId });
    if (!updated) throw new Error("Listing Agent Run 关联写入失败，未创建新的生成任务");
    listing = updated;
  }
  return { listing, agentRunId };
}

export async function startListingJobForContext(input: {
  projectId: number;
  userId: number;
  workspaceId?: number | null;
  operation: "sellingPoints" | "singleBullet" | "bullets" | "title" | "description" | "searchTerms" | "qa" | "batch";
  nodeId: "G1" | "G2" | "G3" | "G4" | "G5";
  scopeKey?: string;
  emphasis?: string;
  existingTitle?: string;
  sellingPoint?: Parameters<typeof startListingGenerationJob>[0]["sellingPoint"];
  coreRevisionId?: number;
  coreInputHash?: string;
  previousBullets?: Parameters<typeof startListingGenerationJob>[0]["previousBullets"];
}) {
  if (input.operation === "bullets" || input.operation === "batch") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "旧整套卖点任务缺少逐条已审事实与核心绑定，已在入队前停用；请逐条人工确认核心后生成并审阅候选" });
  }
  if (input.operation === "singleBullet") {
    if (!input.workspaceId || !input.coreRevisionId || !input.coreInputHash)
      throw new Error("必须先人工确认当前卖点核心及产品事实，再创建逐条生成任务");
    await resolveConfirmedListingCore({ projectId: input.projectId, workspaceId: input.workspaceId,
      coreRevisionId: input.coreRevisionId, coreInputHash: input.coreInputHash });
  }
  if (["sellingPoints", "title", "description", "searchTerms", "qa"].includes(input.operation)) {
    if (!input.workspaceId) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "0204事实账本需要当前工作空间，无法启动未绑定人审事实的AI任务" });
    }
    // Check before resolveListingRun: an insufficient or unavailable ledger must
    // not create a placeholder formal Listing merely because generation was clicked.
    await resolveCurrentConfirmedListingFacts({ projectId: input.projectId, workspaceId: input.workspaceId });
  }
  const { agentRunId } = await resolveListingRun({
    projectId: input.projectId,
    userId: input.userId,
    workspaceId: input.workspaceId,
  });
  await syncListingPreparationNodes({
    projectId: input.projectId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    agentRunId,
  });
  return startListingGenerationJob({
    ...input,
    scopeKey: input.scopeKey || "main",
    agentRunId: agentRunId || undefined,
  });
}

export const listingJobControlProcedures = {
  startGenerationJob: protectedProcedure
    .input(listingGenerationJobInput.omit({ agentRunId: true }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
      ensureWriteAccess(project, ctx.user);
      return startListingJobForContext({
        ...input,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
      });
    }),

  getGenerationRun: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      nodeId: nodeIdSchema,
      scopeKey: z.string().trim().min(1).max(80).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
      return getLatestListingNodeJob(ctx.user.id, input.projectId, input.nodeId, input.scopeKey);
    }),

  listGenerationRuns: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      nodeId: nodeIdSchema.optional(),
    }))
    .query(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
      const jobs = await listListingGenerationJobs(ctx.user.id, input.projectId);
      if (!input.nodeId) return jobs;
      return jobs.filter((job) => {
        const parsed = listingGenerationJobInput.safeParse(job.input);
        return parsed.success && (parsed.data.operation === "batch" || parsed.data.nodeId === input.nodeId);
      });
    }),

  cancelGenerationJob: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      nodeId: nodeIdSchema,
      scopeKey: z.string().trim().min(1).max(80).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
      ensureWriteAccess(project, ctx.user);
      const listing = await db.getActiveListingByProject(input.projectId);
      return cancelListingGenerationJob({
        userId: ctx.user.id,
        projectId: input.projectId,
        nodeId: input.nodeId,
        scopeKey: input.scopeKey,
        agentRunId: listing?.agentRunId,
      });
    }),
};
