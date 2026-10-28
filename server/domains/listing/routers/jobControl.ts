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

const { TRPCError, db, ensureWriteAccess, protectedProcedure, resolveProjectAccess, z } = shared;

function assertWorkspace(actual: number | null | undefined, expected: number | null | undefined) {
  if (expected !== undefined && (actual ?? null) !== expected) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "当前登录范围已变化，请刷新页面" });
}

const nodeIdSchema = z.enum(["N0", "N1", "N2", "N3", "N4", "N5", "G1", "G2", "G3", "G4", "G5"]);

async function resolveListingRun(input: {
  projectId: number;
  userId: number;
  workspaceId?: number | null;
}) {
  let listing: Awaited<ReturnType<typeof db.getActiveListingByProject>> | null = await db.getActiveListingByProject(input.projectId);
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
    listing = await db.updateListing(listing.id, { agentRunId });
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
  previousBullets?: Parameters<typeof startListingGenerationJob>[0]["previousBullets"];
}) {
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
    .input(listingGenerationJobInput.omit({ agentRunId: true }).extend({ expectedWorkspaceId: z.number().int().positive().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      assertWorkspace(ctx.workspaceId, input.expectedWorkspaceId);
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      ensureWriteAccess(project, ctx.user);
      return startListingJobForContext({
        ...input,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
      });
    }),

  getGenerationRun: protectedProcedure
    .input(z.object({
      expectedWorkspaceId: z.number().int().positive().nullable().optional(),
      projectId: z.number().int().positive(),
      nodeId: nodeIdSchema,
      scopeKey: z.string().trim().min(1).max(80).optional(),
    }))
    .query(async ({ ctx, input }) => {
      assertWorkspace(ctx.workspaceId, input.expectedWorkspaceId);
      await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      const job = await getLatestListingNodeJob(ctx.user.id, input.projectId, input.nodeId, input.scopeKey);
      return job && job.workspaceId === (ctx.workspaceId ?? null) ? job : null;
    }),

  listGenerationRuns: protectedProcedure
    .input(z.object({
      expectedWorkspaceId: z.number().int().positive().nullable().optional(),
      projectId: z.number().int().positive(),
      nodeId: nodeIdSchema.optional(),
    }))
    .query(async ({ ctx, input }) => {
      assertWorkspace(ctx.workspaceId, input.expectedWorkspaceId);
      await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      const jobs = (await listListingGenerationJobs(ctx.user.id, input.projectId)).filter(job => job.workspaceId === (ctx.workspaceId ?? null));
      if (!input.nodeId) return jobs;
      return jobs.filter((job) => {
        const parsed = listingGenerationJobInput.safeParse(job.input);
        return parsed.success && (parsed.data.operation === "batch" || parsed.data.nodeId === input.nodeId);
      });
    }),

  cancelGenerationJob: protectedProcedure
    .input(z.object({
      expectedWorkspaceId: z.number().int().positive().nullable().optional(),
      projectId: z.number().int().positive(),
      nodeId: nodeIdSchema,
      scopeKey: z.string().trim().min(1).max(80).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertWorkspace(ctx.workspaceId, input.expectedWorkspaceId);
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
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
