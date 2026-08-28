import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { workspaceIdFromContext } from "../services/securityGovernance";
import { assertSkillDistillationGovernor } from "../domains/knowledge/skillDistillationAuthorization";
import { getDistillationCatalog } from "../domains/knowledge/skillDistillationCatalog";
import {
  addDistillationSource,
  createDistillationProject,
  createEvidenceCard,
  createSkillDraft,
  getDistillationProjectDetail,
  listEligibleDistillationSources,
  listDistillationProjects,
  publishApprovedSkillDraft,
  recordDistillationFeedback,
  reviewEvidenceCard,
  transitionSkillDraft,
} from "../domains/knowledge/skillDistillationService";
import {
  analyzeClaimLedgerChangeImpact,
  createClaimLedger,
  createClaimLedgerVersion,
  getClaimLedgerDetail,
  linkLedgerClaim,
  listClaimLedgers,
  listPublishedDistilledSkills,
  lockClaimLedger,
  reviewClaimLedgerCoherence,
  resolveWorkflowGuidance,
} from "../domains/knowledge/claimLedgerService";

const profileSchema = z.object({
  domain: z.union([z.string(), z.array(z.string())]).optional(),
  descriptionMode: z.union([z.string(), z.array(z.string())]).optional(),
  expressionDirection: z.union([z.string(), z.array(z.string())]).optional(),
  productCategory: z.union([z.string(), z.array(z.string())]).optional(),
  style: z.union([z.string(), z.array(z.string())]).optional(),
  market: z.union([z.string(), z.array(z.string())]).optional(),
  audience: z.union([z.string(), z.array(z.string())]).optional(),
  productConditions: z.union([z.string(), z.array(z.string())]).optional(),
});

const sourceDomainSchema = z.enum(["products", "listings", "images", "skills", "videos"]);
const claimSchema = z.object({
  claimKey: z.string().min(1).max(80),
  statement: z.string().min(4).max(4000),
  evidenceKeys: z.array(z.string().min(1).max(80)).min(1).max(30),
  status: z.enum(["candidate", "confirmed", "locked", "invalidated"]),
  risk: z.enum(["low", "medium", "high"]),
  notes: z.string().max(2000).optional(),
});

export const skillDistillationRouter = router({
  catalog: protectedProcedure.query(() => ({
    catalog: getDistillationCatalog(),
    automaticDistillation: false,
    automaticPublish: false,
  })),

  projects: protectedProcedure.query(({ ctx }) => {
    assertSkillDistillationGovernor(ctx.user);
    return listDistillationProjects(workspaceIdFromContext(ctx));
  }),

  eligibleSources: protectedProcedure.input(z.object({ sourceDomain: sourceDomainSchema.optional(), query: z.string().max(120).optional() }).default({})).query(({ ctx, input }) => {
    assertSkillDistillationGovernor(ctx.user);
    return listEligibleDistillationSources({ workspaceId: workspaceIdFromContext(ctx), ...input });
  }),

  projectDetail: protectedProcedure.input(z.object({ projectKey: z.string().min(1).max(80) })).query(({ ctx, input }) => {
    assertSkillDistillationGovernor(ctx.user);
    return getDistillationProjectDetail({ workspaceId: workspaceIdFromContext(ctx), projectKey: input.projectKey });
  }),

  createProject: protectedProcedure.input(z.object({ name: z.string().min(2).max(255), description: z.string().max(4000).nullable().optional(), profile: profileSchema.default({}) })).mutation(({ ctx, input }) => {
    assertSkillDistillationGovernor(ctx.user);
    return createDistillationProject({ workspaceId: workspaceIdFromContext(ctx), userId: ctx.user.id, ...input });
  }),

  addSource: protectedProcedure.input(z.object({ projectKey: z.string().min(1).max(80), sourceDomain: sourceDomainSchema, sourceRowId: z.number().int().positive() })).mutation(({ ctx, input }) => {
    assertSkillDistillationGovernor(ctx.user);
    return addDistillationSource({ workspaceId: workspaceIdFromContext(ctx), userId: ctx.user.id, ...input });
  }),

  createEvidence: protectedProcedure.input(z.object({ projectKey: z.string().min(1).max(80), sourceKey: z.string().min(1).max(80), evidenceType: z.enum(["specification", "benefit", "compatibility", "proof", "objection", "visual_pattern", "compliance", "brand"]), claim: z.string().min(4).max(4000), normalizedAttributes: z.record(z.string(), z.unknown()).default({}), confidence: z.number().min(0).max(1).default(0.5) })).mutation(({ ctx, input }) => {
    assertSkillDistillationGovernor(ctx.user);
    return createEvidenceCard({ workspaceId: workspaceIdFromContext(ctx), userId: ctx.user.id, ...input });
  }),

  reviewEvidence: protectedProcedure.input(z.object({ projectKey: z.string().min(1).max(80), evidenceKey: z.string().min(1).max(80), approved: z.boolean(), reviewNote: z.string().max(4000).nullable().optional() })).mutation(({ ctx, input }) => {
    assertSkillDistillationGovernor(ctx.user);
    return reviewEvidenceCard({ workspaceId: workspaceIdFromContext(ctx), userId: ctx.user.id, ...input });
  }),

  createDraft: protectedProcedure.input(z.object({ projectKey: z.string().min(1).max(80), skillTypeKey: z.string().min(1).max(128), title: z.string().min(2).max(255), profile: profileSchema.default({}), evidenceKeys: z.array(z.string().min(1).max(80)).min(1).max(100), manifestDraft: z.record(z.string(), z.unknown()).optional(), proposedSkillSlug: z.string().min(3).max(128).nullable().optional() })).mutation(({ ctx, input }) => {
    assertSkillDistillationGovernor(ctx.user);
    return createSkillDraft({ workspaceId: workspaceIdFromContext(ctx), userId: ctx.user.id, ...input });
  }),

  transitionDraft: protectedProcedure.input(z.object({ projectKey: z.string().min(1).max(80), draftKey: z.string().min(1).max(80), status: z.enum(["draft", "conflict", "review", "approved", "rejected", "published", "superseded"]), reviewSummary: z.string().max(4000).nullable().optional(), conflictReport: z.unknown().optional() })).mutation(({ ctx, input }) => {
    assertSkillDistillationGovernor(ctx.user);
    if (input.status === "published") throw new Error("发布必须使用独立的审批发布入口");
    return transitionSkillDraft({ workspaceId: workspaceIdFromContext(ctx), userId: ctx.user.id, ...input });
  }),

  publishDraft: protectedProcedure.input(z.object({ projectKey: z.string().min(1).max(80), draftKey: z.string().min(1).max(80), releaseNote: z.string().min(5).max(4000) })).mutation(({ ctx, input }) => {
    assertSkillDistillationGovernor(ctx.user);
    return publishApprovedSkillDraft({ workspaceId: workspaceIdFromContext(ctx), userId: ctx.user.id, ...input });
  }),

  recordFeedback: protectedProcedure.input(z.object({ projectKey: z.string().min(1).max(80).nullable().optional(), skillSlug: z.string().min(1).max(128), skillVersion: z.number().int().positive().nullable().optional(), consumerDomain: z.enum(["listing", "image", "other"]), consumerRef: z.string().min(1).max(192), outcome: z.enum(["accepted", "revised", "rejected", "published", "issue"]), editDelta: z.unknown().optional(), note: z.string().max(4000).nullable().optional() })).mutation(({ ctx, input }) => recordDistillationFeedback({ workspaceId: workspaceIdFromContext(ctx), userId: ctx.user.id, ...input })),

  claimLedgers: protectedProcedure.input(z.object({ businessProjectId: z.number().int().positive().nullable().optional(), listingId: z.number().int().positive().nullable().optional(), imageWorkflowSessionId: z.number().int().positive().nullable().optional() }).default({})).query(({ ctx, input }) =>
    listClaimLedgers({ workspaceId: workspaceIdFromContext(ctx), ...input })),

  claimLedgerDetail: protectedProcedure.input(z.object({ ledgerKey: z.string().min(1).max(80) })).query(({ ctx, input }) =>
    getClaimLedgerDetail({ workspaceId: workspaceIdFromContext(ctx), ledgerKey: input.ledgerKey })),

  createClaimLedger: protectedProcedure.input(z.object({ businessProjectId: z.number().int().positive().nullable().optional(), listingId: z.number().int().positive().nullable().optional(), imageWorkflowSessionId: z.number().int().positive().nullable().optional(), profile: profileSchema.default({}), claims: z.array(claimSchema).min(1).max(20) })).mutation(({ ctx, input }) => {
    assertSkillDistillationGovernor(ctx.user);
    return createClaimLedger({ workspaceId: workspaceIdFromContext(ctx), userId: ctx.user.id, ...input });
  }),

  createClaimLedgerVersion: protectedProcedure.input(z.object({ ledgerKey: z.string().min(1).max(80), profile: profileSchema.optional(), claims: z.array(claimSchema).min(1).max(20) })).mutation(({ ctx, input }) => {
    assertSkillDistillationGovernor(ctx.user);
    return createClaimLedgerVersion({ workspaceId: workspaceIdFromContext(ctx), userId: ctx.user.id, ...input });
  }),

  lockClaimLedger: protectedProcedure.input(z.object({ ledgerKey: z.string().min(1).max(80) })).mutation(({ ctx, input }) => {
    assertSkillDistillationGovernor(ctx.user);
    return lockClaimLedger({ workspaceId: workspaceIdFromContext(ctx), userId: ctx.user.id, ledgerKey: input.ledgerKey });
  }),

  linkClaim: protectedProcedure.input(z.object({ ledgerKey: z.string().min(1).max(80), claimKey: z.string().min(1).max(80), targetDomain: z.enum(["listing", "image", "brand_story"]), targetType: z.string().min(1).max(64), targetRef: z.string().min(1).max(192), targetPosition: z.string().max(128).nullable().optional(), confirmed: z.boolean().default(false) })).mutation(({ ctx, input }) => {
    assertSkillDistillationGovernor(ctx.user);
    return linkLedgerClaim({ workspaceId: workspaceIdFromContext(ctx), userId: ctx.user.id, ...input });
  }),

  reviewClaimCoherence: protectedProcedure.input(z.object({ ledgerKey: z.string().min(1).max(80) })).query(({ ctx, input }) => reviewClaimLedgerCoherence({ workspaceId: workspaceIdFromContext(ctx), ledgerKey: input.ledgerKey })),
  claimChangeImpact: protectedProcedure.input(z.object({ ledgerKey: z.string().min(1).max(80) })).query(({ ctx, input }) => analyzeClaimLedgerChangeImpact({ workspaceId: workspaceIdFromContext(ctx), ledgerKey: input.ledgerKey })),
  consumableSkills: protectedProcedure.input(z.object({ profile: profileSchema.optional() }).default({})).query(({ ctx, input }) => listPublishedDistilledSkills({ workspaceId: workspaceIdFromContext(ctx), profile: input.profile })),
  resolveWorkflowGuidance: protectedProcedure.input(z.object({ ledgerKey: z.string().min(1).max(80).nullable().optional(), skillSlugs: z.array(z.string().min(1).max(128)).max(12).optional() }).default({})).query(({ ctx, input }) =>
    resolveWorkflowGuidance({ workspaceId: workspaceIdFromContext(ctx), ...input })),
});
