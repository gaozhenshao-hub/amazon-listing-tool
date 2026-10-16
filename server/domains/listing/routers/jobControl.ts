import * as shared from "../routerContext";
import { ensureListingAgentRun } from "../listingAgentBridge";
import {
  cancelListingGenerationJob,
  assertListingResearchJobCompatible,
  getLatestListingNodeJob,
  listingGenerationJobInput,
  listListingGenerationJobs,
  startListingGenerationJob,
  syncListingPreparationNodes,
} from "../services/generationJob";
import { resolveConfirmedListingCore } from "../services/listingConfirmedCore";
import { resolveCurrentConfirmedListingFacts } from "../services/listingFactSource";
import { prepareListingResearchSelection } from "../services/listingResearchSelection";
import { workspaceIdFromContext } from "../../../services/securityGovernance";

const { db, ensureWriteAccess, protectedProcedure, resolveProjectAccess, TRPCError, z } = shared;

const nodeIdSchema = z.enum(["N0", "N1", "N2", "N3", "N4", "N5", "G1", "G2", "G3", "G4", "G5"]);
const expectedWorkspaceSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional();

export function resolveExpectedListingWorkspace(ctx: Parameters<typeof workspaceIdFromContext>[0], expected?: number | null) {
  const actual = workspaceIdFromContext(ctx);
  if (expected !== undefined && expected !== actual) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "工作区已变化，请重新确认项目和竞品范围" });
  }
  return actual;
}

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
  analysisIds?: number[];
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
  // Reject missing/foreign IDs and conflicting active selections before creating
  // an Agent, placeholder Listing or preparation artifacts.
  const research = input.operation === "sellingPoints" ? await prepareListingResearchSelection({
    projectId: input.projectId, workspaceId: input.workspaceId ?? null, analysisIds: input.analysisIds,
  }) : null;
  if (research) {
    const active = await getLatestListingNodeJob(input.userId, input.projectId, input.nodeId, input.scopeKey || "main", input.workspaceId ?? null);
    if (active?.status === "queued" || active?.status === "running") {
      assertListingResearchJobCompatible(active, { ...input, researchBinding: research.binding });
      return active;
    }
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
    researchBinding: research?.binding,
  });
  return startListingGenerationJob({
    ...input,
    scopeKey: input.scopeKey || "main",
    agentRunId: agentRunId || undefined,
  }, research?.binding);
}

export const listingJobControlProcedures = {
  startGenerationJob: protectedProcedure
    .input(listingGenerationJobInput.omit({ agentRunId: true, researchBinding: true }).extend({ expectedWorkspaceId: expectedWorkspaceSchema }))
    .mutation(async ({ ctx, input }) => {
      const { expectedWorkspaceId, ...payload } = input;
      const workspaceId = resolveExpectedListingWorkspace(ctx, expectedWorkspaceId);
      const project = await resolveProjectAccess(input.projectId, ctx.user, workspaceId);
      ensureWriteAccess(project, ctx.user);
      return startListingJobForContext({
        ...payload,
        userId: ctx.user.id,
        workspaceId,
      });
    }),

  getGenerationRun: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      nodeId: nodeIdSchema,
      scopeKey: z.string().trim().min(1).max(80).optional(),
      expectedWorkspaceId: expectedWorkspaceSchema,
    }))
    .query(async ({ ctx, input }) => {
      const workspaceId = resolveExpectedListingWorkspace(ctx, input.expectedWorkspaceId);
      await resolveProjectAccess(input.projectId, ctx.user, workspaceId);
      return getLatestListingNodeJob(ctx.user.id, input.projectId, input.nodeId, input.scopeKey, workspaceId);
    }),

  listGenerationRuns: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      nodeId: nodeIdSchema.optional(),
      expectedWorkspaceId: expectedWorkspaceSchema,
    }))
    .query(async ({ ctx, input }) => {
      const workspaceId = resolveExpectedListingWorkspace(ctx, input.expectedWorkspaceId);
      await resolveProjectAccess(input.projectId, ctx.user, workspaceId);
      const jobs = await listListingGenerationJobs(ctx.user.id, input.projectId, workspaceId);
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
      expectedWorkspaceId: expectedWorkspaceSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const workspaceId = resolveExpectedListingWorkspace(ctx, input.expectedWorkspaceId);
      const project = await resolveProjectAccess(input.projectId, ctx.user, workspaceId);
      ensureWriteAccess(project, ctx.user);
      const listing = await db.getActiveListingByProject(input.projectId);
      return cancelListingGenerationJob({
        userId: ctx.user.id,
        projectId: input.projectId,
        workspaceId,
        nodeId: input.nodeId,
        scopeKey: input.scopeKey,
        agentRunId: listing?.agentRunId,
      });
    }),
};
