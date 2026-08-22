import { randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../../../_core/trpc";
import {
  actorFromContext,
  assertResourceAction,
  buildWorkspaceScopeFilter,
  recordSecurityAuditLog,
  workspaceIdFromContext,
} from "../../../services/securityGovernance";
import { rawExecute } from "../routerContext";
import { startAgentRun } from "../services/agentRunner";
import { invokeEmperorTool } from "../services/toolGateway/executors";
import { runEmperorSkill } from "../../../services/emperorSkillRunner";
import { safeParseSkillJSON } from "../services/skillRunner";
import { storagePut } from "../../../storage";
import { registerStorageObject, registerUnifiedArtifact } from "../services/artifactLifecycle";
import { appendRunLedgerEvent, completeRunTrace, ensureRunTrace, recordContextManifest } from "../services/runLedger";
import { compileConversationContext } from "../services/conversationContext";
import {
  EXECUTION_LIFECYCLE_STAGES,
  appendConversationLifecycleStage,
  buildRecoveryIdempotencyKey,
  claimExecutionRecoveryRequest,
  completeExecutionRecoveryRequest,
  createExecutionStateSnapshot,
  resolveConversationLifecyclePolicy,
} from "../services/executionLifecycle";
import {
  CONVERSATION_PLANNER_MAX_ATTEMPTS,
  conversationExecutionPolicy,
  conversationPlannerRetryDelayMs,
  conversationStepRequiresApproval,
  filterConversationPlanSteps,
  highestConversationRisk,
  parseConversationStructuredJson,
  shouldRetryConversationPlannerError,
} from "../services/conversationPolicy";
import type { MessageContent } from "../../../_core/llm";

const PLAN_STEP_TYPES = ["skill", "agent", "tool"] as const;
const RISK_LEVELS = ["L0", "L1", "L2", "L3"] as const;

const planStepInput = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(4_000).optional(),
  capabilityType: z.enum(PLAN_STEP_TYPES),
  capabilitySlug: z.string().min(1).max(128),
  input: z.record(z.string(), z.any()).optional(),
  riskLevel: z.enum(RISK_LEVELS).default("L1"),
  approvalRequired: z.boolean().optional(),
});
const suggestedPlanSchema = z.object({
  goal: z.string().min(1).max(8_000),
  assumptions: z.array(z.string().max(1_000)).default([]),
  unresolvedQuestions: z.array(z.string().max(1_000)).default([]),
  steps: z.array(planStepInput).max(20).default([]),
});

function parseJson(value: unknown, fallback: unknown = null) { return parseConversationStructuredJson(value, fallback); }

function isAdmin(role: string) { return role === "super_admin" || role === "admin"; }
function json(value: unknown) { return value === undefined ? null : JSON.stringify(value); }
function wait(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }

async function audit(ctx: any, input: {
  action: string; conversationId: string; status?: "success" | "denied" | "failed";
  riskLevel?: "low" | "medium" | "high" | "critical"; metadata?: unknown;
}) {
  await recordSecurityAuditLog({
    ctx,
    workspaceId: workspaceIdFromContext(ctx),
    action: input.action,
    resourceType: "conversation",
    resourceId: input.conversationId,
    status: input.status || "success",
    riskLevel: input.riskLevel || "medium",
    metadata: input.metadata,
  });
}

async function getConversationForAction(ctx: any, conversationId: string, action: any) {
  const workspaceId = workspaceIdFromContext(ctx);
  const scope = buildWorkspaceScopeFilter(workspaceId);
  const rows = await rawExecute(
    `SELECT * FROM emperor_conversations WHERE conversationId=? AND ${scope.clause} LIMIT 1`,
    [conversationId, ...scope.params],
  );
  const conversation = rows[0];
  if (!conversation) throw new TRPCError({ code: "NOT_FOUND", message: "对话任务不存在或不在当前工作空间" });
  await assertResourceAction({
    actor: actorFromContext(ctx), resource: "conversation", action, workspaceId,
    resourceId: conversationId, ownerUserId: Number(conversation.userId),
  });
  if (!isAdmin(ctx.user.role) && Number(conversation.userId) !== ctx.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅创建者或管理员可访问该对话任务" });
  }
  return conversation;
}

async function resolveCapabilityGovernance(ctx: any, type: typeof PLAN_STEP_TYPES[number], slug: string) {
  const workspaceId = workspaceIdFromContext(ctx);
  const scope = buildWorkspaceScopeFilter(workspaceId);
  const source = type === "skill"
    ? { table: "emperor_skills", risk: "COALESCE(NULLIF(riskTier,''),'L1')" }
    : type === "agent"
      ? { table: "emperor_agents", risk: "'L2'" }
      : { table: "emperor_tools", risk: "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(governancePolicy,'$.riskLevel')),'L1')" };
  const rows = await rawExecute(
    `SELECT slug,${source.risk} AS riskLevel FROM ${source.table} WHERE slug=? AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`,
    [slug, ...scope.params],
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: `未找到当前工作空间可用的${type}能力：${slug}` });
  const rawRisk = String(rows[0].riskLevel || "L3");
  const riskLevel = rawRisk === "L0" || rawRisk === "L1" || rawRisk === "L2" || rawRisk === "L3" ? rawRisk : "L3";
  return { riskLevel };
}

export const emperorConversationsRouter = router({
  list: protectedProcedure
    .input(z.object({ status: z.string().optional(), limit: z.number().min(1).max(100).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      await assertResourceAction({ actor: actorFromContext(ctx), resource: "conversation", action: "read", workspaceId: workspaceIdFromContext(ctx) });
      const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
      const ownership = isAdmin(ctx.user.role) ? "" : " AND userId=?";
      const status = input?.status ? " AND status=?" : "";
      const params: unknown[] = [...scope.params];
      if (!isAdmin(ctx.user.role)) params.push(ctx.user.id);
      if (input?.status) params.push(input.status);
      params.push(input?.limit || 30);
      const rows = await rawExecute(
        `SELECT conversationId,title,status,activePlanId,lastTraceId,userId,createdAt,updatedAt
         FROM emperor_conversations WHERE ${scope.clause}${ownership}${status}
         ORDER BY updatedAt DESC LIMIT ?`, params,
      );
      return rows;
    }),

  get: protectedProcedure.input(z.object({ conversationId: z.string() })).query(async ({ ctx, input }) => {
    const conversation = await getConversationForAction(ctx, input.conversationId, "read");
      const [messages, attachments, plans] = await Promise.all([
      rawExecute("SELECT * FROM emperor_conversation_messages WHERE conversationId=? ORDER BY createdAt ASC", [input.conversationId]),
      rawExecute("SELECT * FROM emperor_conversation_attachments WHERE conversationId=? ORDER BY createdAt ASC", [input.conversationId]),
        rawExecute("SELECT * FROM emperor_conversation_plans WHERE conversationId=? ORDER BY version DESC", [input.conversationId]),
      ]);
    const knowledgeRefs = await rawExecute("SELECT * FROM emperor_conversation_knowledge_refs WHERE conversationId=? ORDER BY createdAt ASC", [input.conversationId]);
    const planIds = plans.map((plan: any) => plan.planId);
    const steps = planIds.length
      ? await rawExecute(`SELECT * FROM emperor_conversation_plan_steps WHERE planId IN (${planIds.map(() => "?").join(",")}) ORDER BY planId, sequence ASC`, planIds)
      : [];
    return {
      conversation: { ...conversation, metadata: parseJson(conversation.metadata, {}) },
      messages: messages.map((item: any) => ({ ...item, structuredContent: parseJson(item.structuredContent, null) })),
      attachments: attachments.map((item: any) => ({ ...item, metadata: parseJson(item.metadata, {}) })),
      knowledgeRefs: knowledgeRefs.map((item: any) => ({ ...item, tags: parseJson(item.tags, []) })),
      plans: plans.map((item: any) => ({ ...item, assumptions: parseJson(item.assumptions, []), planJson: parseJson(item.planJson, {}), riskSummary: parseJson(item.riskSummary, {}) })),
      steps: steps.map((item: any) => ({ ...item, input: parseJson(item.input, {}), metadata: parseJson(item.metadata, {}) })),
    };
  }),

  capabilities: protectedProcedure.query(async ({ ctx }) => {
    await assertResourceAction({ actor: actorFromContext(ctx), resource: "conversation", action: "read", workspaceId: workspaceIdFromContext(ctx) });
    const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
    const [skills, agents, tools] = await Promise.all([
      rawExecute(`SELECT slug,name,description,riskTier,status FROM emperor_skills WHERE status IN ('Approved','Released') AND ${scope.clause} ORDER BY workspaceId IS NULL ASC,name LIMIT 200`, scope.params),
      rawExecute(`SELECT slug,name,description,'L2' AS riskTier,status FROM emperor_agents WHERE status='active' AND ${scope.clause} ORDER BY workspaceId IS NULL ASC,name LIMIT 100`, scope.params),
      rawExecute(`SELECT slug,name,description,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(governancePolicy,'$.riskLevel')),'L1') AS riskLevel,CASE WHEN isActive=1 THEN 'active' ELSE 'inactive' END AS status FROM emperor_tools WHERE isActive=1 AND ${scope.clause} ORDER BY workspaceId IS NULL ASC,name LIMIT 200`, scope.params),
    ]);
    return { skills, agents, tools };
  }),

  knowledgeCandidates: protectedProcedure
    .input(z.object({ query: z.string().max(256).optional(), sourceKind: z.enum(["emperor_memory", "amz_ops_skill", "all"]).default("all"), limit: z.number().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      await assertResourceAction({ actor: actorFromContext(ctx), resource: "conversation", action: "read", workspaceId: workspaceIdFromContext(ctx) });
      const workspaceId = workspaceIdFromContext(ctx);
      const queryLike = `%${input.query?.trim() || ""}%`;
      const candidates: any[] = [];
      if (input.sourceKind === "all" || input.sourceKind === "emperor_memory") {
        const scope = buildWorkspaceScopeFilter(workspaceId);
        const rows = await rawExecute(
          `SELECT id,title,memoryType AS subtype,tags,LEFT(content,2000) AS contextSummary,'emperor_memory' AS sourceKind
           FROM emperor_knowledge WHERE is_active=1 AND ${scope.clause} AND (title LIKE ? OR content LIKE ?) ORDER BY updated_at DESC LIMIT ?`,
          [...scope.params, queryLike, queryLike, input.limit],
        );
        candidates.push(...rows.map((item: any) => ({ ...item, sourceId: item.id, tags: parseJson(item.tags, []) })));
      }
      if (input.sourceKind === "all" || input.sourceKind === "amz_ops_skill") {
        const rows = await rawExecute(
          `SELECT id,title,sourceType AS subtype,tags,LEFT(COALESCE(userEditedSummary,aiSummary,extractedContent,''),2000) AS contextSummary,'amz_ops_skill' AS sourceKind
           FROM kb_operation_skills
           WHERE workspaceId=? AND status='confirmed' AND reviewStatus='approved'
             AND (userId=? OR visibility IN ('team','public') OR accessLevel='public' OR JSON_SEARCH(COALESCE(allowedRoles,'[]'),'one',?) IS NOT NULL)
             AND (title LIKE ? OR COALESCE(userEditedSummary,aiSummary,extractedContent,'') LIKE ?)
           ORDER BY updatedAt DESC LIMIT ?`,
          [workspaceId, ctx.user.id, ctx.user.role, queryLike, queryLike, input.limit],
        );
        candidates.push(...rows.map((item: any) => ({ ...item, sourceId: item.id, tags: parseJson(item.tags, []) })));
      }
      return candidates.slice(0, input.limit);
    }),

  addKnowledgeReference: protectedProcedure
    .input(z.object({ conversationId: z.string(), sourceKind: z.enum(["emperor_memory", "amz_ops_skill"]), sourceId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await getConversationForAction(ctx, input.conversationId, "update");
      const workspaceId = workspaceIdFromContext(ctx);
      let item: any;
      if (input.sourceKind === "emperor_memory") {
        const scope = buildWorkspaceScopeFilter(workspaceId);
        const rows = await rawExecute(`SELECT id,title,tags,LEFT(content,2000) AS contextSummary FROM emperor_knowledge WHERE id=? AND is_active=1 AND ${scope.clause} LIMIT 1`, [input.sourceId, ...scope.params]);
        item = rows[0];
      } else {
        const rows = await rawExecute(
          `SELECT id,title,tags,LEFT(COALESCE(userEditedSummary,aiSummary,extractedContent,''),2000) AS contextSummary FROM kb_operation_skills
           WHERE id=? AND workspaceId=? AND status='confirmed' AND reviewStatus='approved'
             AND (userId=? OR visibility IN ('team','public') OR accessLevel='public' OR JSON_SEARCH(COALESCE(allowedRoles,'[]'),'one',?) IS NOT NULL) LIMIT 1`,
          [input.sourceId, workspaceId, ctx.user.id, ctx.user.role],
        );
        item = rows[0];
      }
      if (!item?.contextSummary) throw new TRPCError({ code: "NOT_FOUND", message: "知识条目不存在、未确认或当前无权引用" });
      const referenceId = `kref_${randomUUID().replace(/-/g, "")}`;
      await rawExecute(
        `INSERT INTO emperor_conversation_knowledge_refs (workspaceId,referenceId,conversationId,sourceKind,sourceId,title,contextSummary,tags,createdBy)
         VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE referenceId=referenceId`,
        [workspaceId, referenceId, input.conversationId, input.sourceKind, input.sourceId, item.title, String(item.contextSummary).slice(0, 2_000), json(parseJson(item.tags, [])), ctx.user.id],
      );
      await audit(ctx, { action: "conversation.knowledge.reference", conversationId: input.conversationId, riskLevel: "medium", metadata: { referenceId, sourceKind: input.sourceKind, sourceId: input.sourceId } });
      return { referenceId };
    }),

  create: protectedProcedure
    .input(z.object({ title: z.string().min(1).max(255), projectId: z.number().optional(), initialMessage: z.string().max(12_000).optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertResourceAction({ actor: actorFromContext(ctx), resource: "conversation", action: "create", workspaceId: workspaceIdFromContext(ctx) });
      const conversationId = `conv_${randomUUID().replace(/-/g, "")}`;
      const workspaceId = workspaceIdFromContext(ctx);
      await rawExecute(
        `INSERT INTO emperor_conversations (workspaceId,conversationId,userId,projectId,title,status,metadata) VALUES (?,?,?,?,?,'draft',?)`,
        [workspaceId, conversationId, ctx.user.id, input.projectId || null, input.title, json({ source: "emperor_conversation_manager" })],
      );
      if (input.initialMessage?.trim()) {
        await rawExecute(
          `INSERT INTO emperor_conversation_messages (workspaceId,messageId,conversationId,role,status,content,createdBy) VALUES (?,?,?,'user','completed',?,?)`,
          [workspaceId, `msg_${randomUUID().replace(/-/g, "")}`, conversationId, input.initialMessage.trim(), ctx.user.id],
        );
      }
      await audit(ctx, { action: "conversation.create", conversationId, riskLevel: "low", metadata: { projectId: input.projectId || null } });
      return { conversationId };
    }),

  addMessage: protectedProcedure
    .input(z.object({ conversationId: z.string(), content: z.string().min(1).max(12_000), structuredContent: z.any().optional() }))
    .mutation(async ({ ctx, input }) => {
      await getConversationForAction(ctx, input.conversationId, "update");
      const messageId = `msg_${randomUUID().replace(/-/g, "")}`;
      await rawExecute(
        `INSERT INTO emperor_conversation_messages (workspaceId,messageId,conversationId,role,status,content,structuredContent,createdBy) VALUES (?,?,?,'user','completed',?,?,?)`,
        [workspaceIdFromContext(ctx), messageId, input.conversationId, input.content, json(input.structuredContent), ctx.user.id],
      );
      await rawExecute("UPDATE emperor_conversations SET status='planning' WHERE conversationId=?", [input.conversationId]);
      await audit(ctx, { action: "conversation.message.add", conversationId: input.conversationId, riskLevel: "low", metadata: { messageId } });
      return { messageId };
    }),

  suggestPlan: protectedProcedure
    .input(z.object({ conversationId: z.string(), goal: z.string().min(1).max(8_000) }))
    .mutation(async ({ ctx, input }) => {
      await getConversationForAction(ctx, input.conversationId, "update");
      const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
      const [skills, agents, tools, attachments, knowledgeRefs] = await Promise.all([
        rawExecute(`SELECT slug,name,description,riskTier,'skill' AS capabilityType FROM emperor_skills WHERE status IN ('Approved','Released') AND slug<>'emperor.conversation.plan' AND ${scope.clause} ORDER BY workspaceId IS NULL ASC,name LIMIT 120`, scope.params),
        rawExecute(`SELECT slug,name,description,'L2' AS riskTier,'agent' AS capabilityType FROM emperor_agents WHERE status='active' AND ${scope.clause} ORDER BY workspaceId IS NULL ASC,name LIMIT 80`, scope.params),
        rawExecute(`SELECT slug,name,description,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(governancePolicy,'$.riskLevel')),'L1') AS riskTier,'tool' AS capabilityType FROM emperor_tools WHERE isActive=1 AND ${scope.clause} ORDER BY workspaceId IS NULL ASC,name LIMIT 120`, scope.params),
        rawExecute("SELECT attachmentId,fileName,mimeType,contextPolicy,contextSummary,artifactId FROM emperor_conversation_attachments WHERE conversationId=? AND scanStatus='ready' ORDER BY createdAt ASC", [input.conversationId]),
        rawExecute("SELECT referenceId,sourceKind,title,contextSummary,tags FROM emperor_conversation_knowledge_refs WHERE conversationId=? ORDER BY createdAt ASC", [input.conversationId]),
      ]);
      const capabilityCatalog = [...skills, ...agents, ...tools].map((item: any) => ({
        capabilityType: item.capabilityType, slug: item.slug, name: item.name, description: item.description || "", riskLevel: item.riskTier || "L1",
      }));
      const compiledContext = compileConversationContext({
        goal: input.goal,
        attachments: attachments as any[],
        knowledgeReferences: knowledgeRefs.map((item: any) => ({ ...item, tags: parseJson(item.tags, []) })),
      });
      let result: Awaited<ReturnType<typeof runEmperorSkill<string>>> | undefined;
      let lastError: unknown;
      for (let attemptIndex = 0; attemptIndex < CONVERSATION_PLANNER_MAX_ATTEMPTS; attemptIndex += 1) {
        try {
          result = await runEmperorSkill<string>({
            skillSlug: "emperor.conversation.plan",
            userId: ctx.user.id,
            workspaceId: workspaceIdFromContext(ctx),
            context: JSON.stringify({ userGoal: input.goal, conversationContext: compiledContext.context, capabilityCatalog }),
            variables: { goal: input.goal, conversationId: input.conversationId, capabilityCatalog, conversationContext: compiledContext.context, contextPolicyHash: compiledContext.policyHash },
            migrationSource: "emperor.conversations.plan",
            fallbackModels: [],
            maxModelAttempts: 1,
            validate: (content) => content,
          });
          break;
        } catch (error) {
          lastError = error;
          if (!shouldRetryConversationPlannerError(error) || attemptIndex === CONVERSATION_PLANNER_MAX_ATTEMPTS - 1) {
            await audit(ctx, {
              action: "conversation.plan.suggest",
              conversationId: input.conversationId,
              status: "failed",
              riskLevel: "medium",
              metadata: { reason: "MODEL_TEMPORARILY_UNAVAILABLE", attemptCount: attemptIndex + 1 },
            });
            throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "模型服务暂时不可用，已保留你的消息、附件和知识引用；请稍后重试。", cause: error });
          }
          await wait(conversationPlannerRetryDelayMs(attemptIndex));
        }
      }
      if (!result) throw lastError instanceof Error ? lastError : new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "模型服务暂时不可用，请稍后重试。" });
      await ensureRunTrace({ runId: result.runId, rootRunType: "skill_run", workspaceId: workspaceIdFromContext(ctx), agentSlug: "emperor.conversation.plan", userId: ctx.user.id, metadata: { conversationId: input.conversationId, contextPolicyHash: compiledContext.policyHash } });
      await recordContextManifest({ traceId: result.runId, runId: result.runId, manifest: compiledContext.manifest, sourceCount: compiledContext.sourceCount, estimatedTokens: compiledContext.estimatedTokens, maxTokens: compiledContext.maxTokens });
      await appendRunLedgerEvent({ traceId: result.runId, eventType: "conversation.plan.context_compiled", entityType: "skill_run", entityId: result.runId, skillSlug: "emperor.conversation.plan", actorUserId: ctx.user.id, payload: { conversationId: input.conversationId, sourceCount: compiledContext.sourceCount, estimatedTokens: compiledContext.estimatedTokens, policyHash: compiledContext.policyHash } });
      await completeRunTrace(result.runId, "completed");
      const parsedCandidate = safeParseSkillJSON<Record<string, unknown>>(result.content, {});
      const candidateResult = suggestedPlanSchema.safeParse(parsedCandidate);
      if (!candidateResult.success) {
        const fallback = {
          goal: input.goal,
          assumptions: [],
          unresolvedQuestions: ["AI规划结果格式异常，请补充目标后重试；系统未创建或执行任何步骤。"],
          steps: [],
          invalidSuggestionCount: 0,
        };
        await rawExecute(
          `INSERT INTO emperor_conversation_messages (workspaceId,messageId,conversationId,role,status,content,structuredContent,skillRunId,createdBy)
           VALUES (?,?,?,'assistant','completed',?,?,?,?)`,
          [workspaceIdFromContext(ctx), `msg_${randomUUID().replace(/-/g, "")}`, input.conversationId, fallback.unresolvedQuestions[0], json(fallback), result.runId, ctx.user.id],
        );
        await audit(ctx, { action: "conversation.plan.suggest", conversationId: input.conversationId, status: "failed", riskLevel: "medium", metadata: { skillRunId: result.runId, reason: "INVALID_OUTPUT" } });
        return { skillRunId: result.runId, ...fallback };
      }
      const candidate = candidateResult.data;
      const filtered = filterConversationPlanSteps(candidate.steps, capabilityCatalog);
      const invalidSuggestions = filtered.invalid;
      const steps = filtered.valid.map((step) => ({ ...step, approvalRequired: conversationStepRequiresApproval(step) }));
      await rawExecute(
        `INSERT INTO emperor_conversation_messages (workspaceId,messageId,conversationId,role,status,content,structuredContent,skillRunId,createdBy)
         VALUES (?,?,?,'assistant','completed',?,?,?,?)`,
        [workspaceIdFromContext(ctx), `msg_${randomUUID().replace(/-/g, "")}`, input.conversationId, "已生成受治理的候选执行计划，请人工编辑并提交确认。", json({ ...candidate, steps, invalidSuggestionCount: invalidSuggestions.length }), result.runId, ctx.user.id],
      );
      await audit(ctx, { action: "conversation.plan.suggest", conversationId: input.conversationId, riskLevel: steps.some((step) => step.approvalRequired) ? "high" : "medium", metadata: { skillRunId: result.runId, suggestedStepCount: steps.length, invalidSuggestionCount: invalidSuggestions.length } });
      return { skillRunId: result.runId, goal: candidate.goal, assumptions: candidate.assumptions, unresolvedQuestions: candidate.unresolvedQuestions, steps, invalidSuggestionCount: invalidSuggestions.length };
    }),

  addAttachmentReference: protectedProcedure
    .input(z.object({
      conversationId: z.string(), messageId: z.string().optional(), storageObjectId: z.number().optional(), artifactId: z.string().optional(),
      fileName: z.string().min(1).max(255), mimeType: z.string().min(1).max(128), sizeBytes: z.number().nonnegative().optional(),
      contextPolicy: z.enum(["summary_only", "extracted_text", "image_vision"]).default("summary_only"), contextSummary: z.string().max(12_000).optional(), metadata: z.any().optional(),
    }).refine((value) => Boolean(value.storageObjectId || value.artifactId), { message: "附件必须关联既有Storage Object或Artifact" }))
    .mutation(async ({ ctx, input }) => {
      await getConversationForAction(ctx, input.conversationId, "upload");
      const attachmentId = `att_${randomUUID().replace(/-/g, "")}`;
      await rawExecute(
        `INSERT INTO emperor_conversation_attachments (workspaceId,attachmentId,conversationId,messageId,storageObjectId,artifactId,fileName,mimeType,sizeBytes,contextPolicy,scanStatus,contextSummary,metadata,createdBy)
         VALUES (?,?,?,?,?,?,?,?,? ,?,'ready',?,?,?)`,
        [workspaceIdFromContext(ctx), attachmentId, input.conversationId, input.messageId || null, input.storageObjectId || null, input.artifactId || null, input.fileName, input.mimeType, input.sizeBytes || null, input.contextPolicy, input.contextSummary || null, json(input.metadata), ctx.user.id],
      );
      await audit(ctx, { action: "conversation.attachment.reference", conversationId: input.conversationId, riskLevel: "medium", metadata: { attachmentId, mimeType: input.mimeType, contextPolicy: input.contextPolicy } });
      return { attachmentId };
    }),

  uploadAttachment: protectedProcedure
    .input(z.object({
      conversationId: z.string(), messageId: z.string().optional(), fileName: z.string().min(1).max(255),
      mimeType: z.string().min(1).max(128), contentBase64: z.string().min(1),
      contextPolicy: z.enum(["summary_only", "extracted_text", "image_vision"]).default("summary_only"),
    }))
    .mutation(async ({ ctx, input }) => {
      await getConversationForAction(ctx, input.conversationId, "upload");
      const buffer = Buffer.from(input.contentBase64, "base64");
      if (!buffer.length) throw new TRPCError({ code: "BAD_REQUEST", message: "上传附件为空" });
      if (buffer.length > 15 * 1024 * 1024) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "对话附件最大为15MB" });
      const workspaceId = workspaceIdFromContext(ctx);
      const attachmentId = `att_${randomUUID().replace(/-/g, "")}`;
      const safeFileName = input.fileName.replace(/[^\p{L}\p{N}._ -]/gu, "_");
      const storageResult = await storagePut(`emperor-conversations/${workspaceId ?? "global"}/${input.conversationId}/${attachmentId}-${safeFileName}`, buffer, input.mimeType);
      const storage = await registerStorageObject({
        workspaceId, storageUri: storageResult.storageUri, publicUrl: storageResult.url, mimeType: input.mimeType,
        fileName: input.fileName, sizeBytes: buffer.length, content: buffer, sourceDomain: "other", sourceType: "upload",
        sourceId: attachmentId, metadata: { conversationId: input.conversationId, contextPolicy: input.contextPolicy }, createdBy: ctx.user.id,
      });
      if (!storage?.id) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "附件存储对象登记失败" });
      const textPreview = input.mimeType.startsWith("text/") || input.mimeType === "application/json"
        ? buffer.toString("utf8").slice(0, 2_000)
        : null;
      await rawExecute(
        `INSERT INTO emperor_conversation_attachments (workspaceId,attachmentId,conversationId,messageId,storageObjectId,fileName,mimeType,sizeBytes,contextPolicy,scanStatus,contextSummary,metadata,createdBy)
         VALUES (?,?,?,?,?,?,?,?,?,'ready',?,?,?)`,
        [workspaceId, attachmentId, input.conversationId, input.messageId || null, storage.id, input.fileName, input.mimeType, buffer.length, input.contextPolicy, textPreview ? "已提取文本预览；执行计划可按上下文策略引用。" : "附件已登记；执行计划可按上下文策略引用。", json({ storageUri: storage.storageUri, contextPolicy: input.contextPolicy }), ctx.user.id],
      );
      const artifact = await registerUnifiedArtifact({
        workspaceId, domain: "other", artifactKey: "emperor.conversation.attachment", artifactType: "file" as any,
        sourceType: "upload", sourceTable: "emperor_conversation_attachments", sourceRowId: attachmentId,
        storageObjectId: Number(storage.id), storageUri: storage.storageUri, mimeType: input.mimeType, fileName: input.fileName,
        fileSizeBytes: buffer.length, summary: textPreview ? "对话附件文本预览已提取" : "对话附件已上传", userId: ctx.user.id,
        metadata: { conversationId: input.conversationId, attachmentId, contextPolicy: input.contextPolicy },
      });
      if (artifact?.artifactId) {
        await rawExecute("UPDATE emperor_conversation_attachments SET artifactId=? WHERE attachmentId=?", [artifact.artifactId, attachmentId]);
      }
      await audit(ctx, { action: "conversation.attachment.upload", conversationId: input.conversationId, riskLevel: "medium", metadata: { attachmentId, mimeType: input.mimeType, sizeBytes: buffer.length, contextPolicy: input.contextPolicy } });
      return { attachmentId, storageObjectId: storage.id, artifactId: artifact?.artifactId || null, contextSummary: textPreview ? "文本附件已提取预览" : "附件已受控登记" };
    }),

  proposePlan: protectedProcedure
    .input(z.object({ conversationId: z.string(), goal: z.string().min(1).max(8_000), assumptions: z.array(z.string().max(1_000)).optional(), steps: z.array(planStepInput).min(1).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await getConversationForAction(ctx, input.conversationId, "update");
      const governedSteps = await Promise.all(input.steps.map(async (step) => {
        const capability = await resolveCapabilityGovernance(ctx, step.capabilityType, step.capabilitySlug);
        const riskLevel = highestConversationRisk(step.riskLevel, capability.riskLevel as any);
        const execution = conversationExecutionPolicy({ riskLevel, approvalRequired: step.approvalRequired, capabilityType: step.capabilityType });
        return { ...step, riskLevel, approvalRequired: execution.requiresStepApproval, execution };
      }));
      const versionRows = await rawExecute("SELECT COALESCE(MAX(version),0) AS version FROM emperor_conversation_plans WHERE conversationId=?", [input.conversationId]);
      const version = Number(versionRows[0]?.version || 0) + 1;
      const planId = `plan_${randomUUID().replace(/-/g, "")}`;
      const requiresApproval = governedSteps.some((step) => conversationStepRequiresApproval(step));
      const highestRisk = governedSteps.reduce((risk, step) => highestConversationRisk(risk, step.riskLevel), "L0" as const);
      await rawExecute(
        `INSERT INTO emperor_conversation_plans (workspaceId,planId,conversationId,version,status,goal,assumptions,planJson,riskSummary,createdBy) VALUES (?,?,?,?, 'proposed',?,?,?,?,?)`,
        [workspaceIdFromContext(ctx), planId, input.conversationId, version, input.goal, json(input.assumptions || []), json({ source: "user_editable_conversation_plan", executionMode: "serial", steps: governedSteps }), json({ requiresApproval, highestRisk, executionMode: "serial", allowParallel: false }), ctx.user.id],
      );
      for (const [index, step] of governedSteps.entries()) {
        const approvalRequired = conversationStepRequiresApproval(step);
        await rawExecute(
          `INSERT INTO emperor_conversation_plan_steps (workspaceId,stepId,planId,sequence,title,description,capabilityType,capabilitySlug,input,riskLevel,approvalRequired,approvalState,status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending')`,
          [workspaceIdFromContext(ctx), `step_${randomUUID().replace(/-/g, "")}`, planId, index + 1, step.title, step.description || null, step.capabilityType, step.capabilitySlug, json(step.input || {}), step.riskLevel, approvalRequired ? 1 : 0, approvalRequired ? "pending" : "not_required"],
        );
      }
      await rawExecute("UPDATE emperor_conversations SET status='awaiting_plan_confirmation', activePlanId=? WHERE conversationId=?", [planId, input.conversationId]);
      await audit(ctx, { action: "conversation.plan.propose", conversationId: input.conversationId, riskLevel: requiresApproval ? "high" : "medium", metadata: { planId, version, stepCount: governedSteps.length, executionMode: "serial", highestRisk } });
      return { planId, version, requiresApproval, executionMode: "serial", conversationId: conversation.conversationId };
    }),

  approvePlan: protectedProcedure.input(z.object({ conversationId: z.string(), planId: z.string() })).mutation(async ({ ctx, input }) => {
    await getConversationForAction(ctx, input.conversationId, "confirm");
    const rows = await rawExecute("SELECT status,version,stateVersion,planJson,riskSummary FROM emperor_conversation_plans WHERE planId=? AND conversationId=? LIMIT 1", [input.planId, input.conversationId]);
    if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "计划不存在" });
    if (rows[0].status !== "proposed") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "仅可批准待确认计划" });
    const priorStateVersion = Number(rows[0].stateVersion || 0);
    await rawExecute("UPDATE emperor_conversation_plans SET status='approved',stateVersion=stateVersion+1,approvedBy=?,approvedAt=NOW() WHERE planId=? AND status='proposed' AND stateVersion=?", [ctx.user.id, input.planId, priorStateVersion]);
    const approvedRows = await rawExecute("SELECT status,stateVersion FROM emperor_conversation_plans WHERE planId=? LIMIT 1", [input.planId]);
    if (approvedRows[0]?.status !== "approved" || Number(approvedRows[0]?.stateVersion) !== priorStateVersion + 1) {
      throw new TRPCError({ code: "CONFLICT", message: "计划状态已变化；请刷新后重新确认" });
    }
    await rawExecute("UPDATE emperor_conversation_plan_steps SET status=IF(approvalRequired=1,'waiting_human','ready') WHERE planId=?", [input.planId]);
    await rawExecute("UPDATE emperor_conversations SET status='waiting_human',activePlanId=? WHERE conversationId=?", [input.planId, input.conversationId]);
    const traceId = `conversation_plan_${input.planId}`;
    await ensureRunTrace({ runId: traceId, rootRunType: "conversation_plan", workspaceId: workspaceIdFromContext(ctx), userId: ctx.user.id, metadata: { conversationId: input.conversationId, planId: input.planId, planVersion: Number(rows[0].version || 0) } });
    const planSnapshot = await createExecutionStateSnapshot({
      workspaceId: workspaceIdFromContext(ctx), traceId, targetType: "conversation_plan", targetId: input.planId,
      stateVersion: priorStateVersion + 1, planId: input.planId, planVersion: Number(rows[0].version || 0),
      approvalState: "approved", createdBy: ctx.user.id,
      snapshot: { conversationId: input.conversationId, planId: input.planId, planVersion: rows[0].version, status: "approved", plan: parseJson(rows[0].planJson, {}), riskSummary: parseJson(rows[0].riskSummary, {}) },
    });
    await appendRunLedgerEvent({ traceId, eventType: "lifecycle.snapshot_created", entityType: "system", entityId: input.planId, actorUserId: ctx.user.id, payload: { targetType: "conversation_plan", snapshotId: planSnapshot.snapshotId, stateVersion: priorStateVersion + 1 } });
    await completeRunTrace(traceId, "completed");
    await audit(ctx, { action: "conversation.plan.approve", conversationId: input.conversationId, riskLevel: "high", metadata: { planId: input.planId } });
    return { success: true };
  }),

  recoverPlan: protectedProcedure.input(z.object({
    conversationId: z.string(),
    planId: z.string(),
    expectedStateVersion: z.number().int().nonnegative(),
    idempotencyKey: z.string().min(16).max(128).optional(),
  })).mutation(async ({ ctx, input }) => {
    await getConversationForAction(ctx, input.conversationId, "confirm");
    const rows = await rawExecute(
      "SELECT * FROM emperor_conversation_plans WHERE planId=? AND conversationId=? LIMIT 1",
      [input.planId, input.conversationId],
    );
    const plan = rows[0];
    if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "计划不存在" });
    const traceId = `conversation_plan_${input.planId}`;
    await ensureRunTrace({ runId: traceId, rootRunType: "conversation_plan", workspaceId: workspaceIdFromContext(ctx), userId: ctx.user.id, metadata: { conversationId: input.conversationId, planId: input.planId, recovery: true } });
    const snapshot = await createExecutionStateSnapshot({
      workspaceId: workspaceIdFromContext(ctx), traceId, targetType: "conversation_plan", targetId: input.planId,
      stateVersion: Number(plan.stateVersion || 0) + 1, planId: input.planId, planVersion: Number(plan.version || 0),
      approvalState: plan.status, createdBy: ctx.user.id,
      snapshot: { conversationId: input.conversationId, planId: input.planId, status: plan.status, sourceStateVersion: plan.stateVersion, targetStateVersion: Number(plan.stateVersion || 0) + 1, planVersion: plan.version, riskSummary: parseJson(plan.riskSummary, {}) },
    });
    const idempotencyKey = input.idempotencyKey || buildRecoveryIdempotencyKey({ snapshotId: snapshot.snapshotId, targetType: "conversation_plan", targetId: input.planId, expectedStateVersion: input.expectedStateVersion, requestedAction: "restore_proposed" });
    const recovery = await claimExecutionRecoveryRequest({ idempotencyKey, snapshotId: snapshot.snapshotId, traceId, targetType: "conversation_plan", targetId: input.planId, requestedAction: "restore_proposed", expectedStateVersion: input.expectedStateVersion, requestedBy: ctx.user.id });
    if (recovery.replayed) return { success: recovery.request.status === "completed", replayed: true, status: recovery.request.status, recoveryId: recovery.request.recoveryId };
    const reject = async (status: "rejected" | "compensation_required", reasonCode: string, message: string) => {
      await completeExecutionRecoveryRequest({ recoveryId: recovery.request.recoveryId, status, reasonCode, result: { planStatus: plan.status, stateVersion: plan.stateVersion } });
      await appendRunLedgerEvent({ traceId, eventType: status === "compensation_required" ? "lifecycle.compensation_required" : "lifecycle.recovery_rejected", entityType: "system", entityId: input.planId, actorUserId: ctx.user.id, payload: { recoveryId: recovery.request.recoveryId, reasonCode, targetType: "conversation_plan" } });
      throw new TRPCError({ code: "PRECONDITION_FAILED", message });
    };
    if (Number(plan.stateVersion || 0) !== input.expectedStateVersion) return reject("rejected", "PLAN_STATE_VERSION_CONFLICT", "计划状态已变化；请刷新后重新确认恢复");
    const steps = await rawExecute("SELECT status FROM emperor_conversation_plan_steps WHERE planId=?", [input.planId]);
    const hasExecutedStep = steps.some((step: any) => ["running", "succeeded", "failed", "skipped", "canceled"].includes(String(step.status)));
    if (plan.status !== "approved" || hasExecutedStep) return reject("compensation_required", "PLAN_EXECUTION_OR_RISK_REVIEW_REQUIRED", "计划已执行或不处于可恢复批准状态；已记录补偿审计，不会撤回或运行任何步骤");
    await rawExecute("UPDATE emperor_conversation_plans SET status='proposed',stateVersion=stateVersion+1,recoverySnapshotId=?,approvedBy=NULL,approvedAt=NULL WHERE planId=? AND status='approved' AND stateVersion=?", [snapshot.snapshotId, input.planId, input.expectedStateVersion]);
    await rawExecute("UPDATE emperor_conversation_plan_steps SET status='pending',approvalState=IF(approvalRequired=1,'pending','not_required') WHERE planId=?", [input.planId]);
    const refreshed = await rawExecute("SELECT status,stateVersion FROM emperor_conversation_plans WHERE planId=? LIMIT 1", [input.planId]);
    if (refreshed[0]?.status !== "proposed" || Number(refreshed[0]?.stateVersion) !== input.expectedStateVersion + 1) return reject("rejected", "PLAN_STATE_VERSION_CONFLICT", "计划状态在恢复期间已变化；未执行任何能力");
    await rawExecute("UPDATE emperor_conversations SET status='awaiting_plan_confirmation',activePlanId=? WHERE conversationId=?", [input.planId, input.conversationId]);
    await completeExecutionRecoveryRequest({ recoveryId: recovery.request.recoveryId, status: "completed", result: { restoredState: "proposed", stateVersion: refreshed[0].stateVersion, snapshotId: snapshot.snapshotId } });
    await appendRunLedgerEvent({ traceId, eventType: "lifecycle.recovery_completed", entityType: "system", entityId: input.planId, actorUserId: ctx.user.id, payload: { recoveryId: recovery.request.recoveryId, targetType: "conversation_plan", snapshotId: snapshot.snapshotId, stateVersion: refreshed[0].stateVersion } });
    await completeRunTrace(traceId, "completed");
    await audit(ctx, { action: "conversation.plan.recover", conversationId: input.conversationId, riskLevel: "high", metadata: { planId: input.planId, recoveryId: recovery.request.recoveryId, snapshotId: snapshot.snapshotId } });
    return { success: true, replayed: false, recoveryId: recovery.request.recoveryId, stateVersion: refreshed[0].stateVersion };
  }),

  approveStep: protectedProcedure.input(z.object({ conversationId: z.string(), stepId: z.string() })).mutation(async ({ ctx, input }) => {
    await getConversationForAction(ctx, input.conversationId, "confirm");
    const rows = await rawExecute(
      `SELECT s.* FROM emperor_conversation_plan_steps s JOIN emperor_conversation_plans p ON p.planId=s.planId WHERE s.stepId=? AND p.conversationId=? LIMIT 1`,
      [input.stepId, input.conversationId],
    );
    if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "计划步骤不存在" });
    if (rows[0].approvalState !== "pending") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "该步骤当前无需或已完成确认" });
    await rawExecute("UPDATE emperor_conversation_plan_steps SET approvalState='approved',status='ready' WHERE stepId=?", [input.stepId]);
    await audit(ctx, { action: "conversation.step.approve", conversationId: input.conversationId, riskLevel: "high", metadata: { stepId: input.stepId } });
    return { success: true };
  }),

  recoverStep: protectedProcedure.input(z.object({
    conversationId: z.string(),
    stepId: z.string(),
    expectedStateVersion: z.number().int().nonnegative(),
    idempotencyKey: z.string().min(16).max(128).optional(),
  })).mutation(async ({ ctx, input }) => {
    await getConversationForAction(ctx, input.conversationId, "run");
    const rows = await rawExecute(
      `SELECT s.*,p.status AS planStatus,p.version AS planVersion
       FROM emperor_conversation_plan_steps s JOIN emperor_conversation_plans p ON p.planId=s.planId
       WHERE s.stepId=? AND p.conversationId=? LIMIT 1`,
      [input.stepId, input.conversationId],
    );
    const step = rows[0];
    if (!step) throw new TRPCError({ code: "NOT_FOUND", message: "计划步骤不存在" });
    const traceId = String(step.traceId || `conversation_step_${input.stepId}`);
    const snapshotRows = await rawExecute(
      "SELECT * FROM emperor_execution_state_snapshots WHERE targetType='conversation_step' AND targetId=? ORDER BY stateVersion DESC,id DESC LIMIT 1",
      [input.stepId],
    );
    const snapshot = snapshotRows[0];
    if (!snapshot) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "该步骤没有可恢复的状态快照，请重新生成计划后再执行" });
    const idempotencyKey = input.idempotencyKey || buildRecoveryIdempotencyKey({
      snapshotId: String(snapshot.snapshotId), targetType: "conversation_step", targetId: input.stepId,
      expectedStateVersion: input.expectedStateVersion, requestedAction: "restore_ready",
    });
    const invalidatedSources = await rawExecute(
      "SELECT sourceType,sourceKey FROM emperor_context_source_provenance WHERE traceId=? AND status='invalidated' ORDER BY id ASC LIMIT 20",
      [traceId],
    );
    const claim = await claimExecutionRecoveryRequest({
      idempotencyKey, snapshotId: String(snapshot.snapshotId), traceId, targetType: "conversation_step", targetId: input.stepId,
      requestedAction: "restore_ready", expectedStateVersion: input.expectedStateVersion, requestedBy: ctx.user.id,
    });
    if (claim.replayed) return { success: claim.request.status === "completed", replayed: true, status: claim.request.status, recoveryId: claim.request.recoveryId };
    await appendConversationLifecycleStage({ traceId, stepId: input.stepId, actorUserId: ctx.user.id, stage: "recovery_requested", payload: { recoveryId: claim.request.recoveryId, expectedStateVersion: input.expectedStateVersion, snapshotId: snapshot.snapshotId } });
    const reject = async (reasonCode: string, message: string) => {
      await completeExecutionRecoveryRequest({ recoveryId: claim.request.recoveryId, status: "rejected", reasonCode, result: { currentStateVersion: step.stateVersion, status: step.status } });
      await appendConversationLifecycleStage({ traceId, stepId: input.stepId, actorUserId: ctx.user.id, stage: "recovery_rejected", payload: { recoveryId: claim.request.recoveryId, reasonCode } });
      throw new TRPCError({ code: "PRECONDITION_FAILED", message });
    };
    if (invalidatedSources.length) {
      return reject("context_source_invalidated", "关联上下文来源已失效；请重新编译上下文并再次人工确认后再运行");
    }
    if (Number(step.stateVersion || 0) !== input.expectedStateVersion) {
      return reject("version_conflict", "步骤状态已变化；请刷新后重新确认恢复操作");
    }
    if (step.status !== "failed") return reject("invalid_state", "仅失败的步骤可以恢复至待运行状态");
    const capability = await resolveCapabilityGovernance(ctx, step.capabilityType, step.capabilitySlug);
    const effectiveRisk = highestConversationRisk(step.riskLevel, capability.riskLevel as any);
    const lifecyclePolicy = resolveConversationLifecyclePolicy({ capabilityType: step.capabilityType, riskLevel: effectiveRisk, approvalRequired: Boolean(step.approvalRequired), approvalState: String(step.approvalState) });
    if (!lifecyclePolicy.recoveryAllowed) {
      const status = lifecyclePolicy.compensationRequiredOnFailure ? "compensation_required" : "rejected";
      await completeExecutionRecoveryRequest({ recoveryId: claim.request.recoveryId, status, reasonCode: lifecyclePolicy.compensationRequiredOnFailure ? "human_compensation_required" : "human_approval_required", result: { capabilityType: step.capabilityType, riskLevel: effectiveRisk } });
      await appendConversationLifecycleStage({ traceId, stepId: input.stepId, actorUserId: ctx.user.id, stage: lifecyclePolicy.compensationRequiredOnFailure ? "compensation_required" : "recovery_rejected", payload: { recoveryId: claim.request.recoveryId, capabilityType: step.capabilityType, riskLevel: effectiveRisk } });
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: lifecyclePolicy.compensationRequiredOnFailure ? "该步骤可能具有副作用，已记录补偿审计；请人工复核后新建或重新确认步骤" : "高风险步骤恢复必须重新经过人工确认" });
    }
    await rawExecute(
      "UPDATE emperor_conversation_plan_steps SET status='ready',errorMessage=NULL,stateVersion=stateVersion+1,recoverySnapshotId=? WHERE stepId=? AND status='failed' AND stateVersion=?",
      [snapshot.snapshotId, input.stepId, input.expectedStateVersion],
    );
    const refreshed = await rawExecute("SELECT stateVersion,status FROM emperor_conversation_plan_steps WHERE stepId=? LIMIT 1", [input.stepId]);
    if (refreshed[0]?.status !== "ready" || Number(refreshed[0]?.stateVersion) !== input.expectedStateVersion + 1) {
      return reject("version_conflict", "步骤状态在恢复期间已变化；未重新执行任何能力");
    }
    await completeExecutionRecoveryRequest({ recoveryId: claim.request.recoveryId, status: "completed", result: { restoredState: "ready", stateVersion: refreshed[0].stateVersion } });
    await appendConversationLifecycleStage({ traceId, stepId: input.stepId, actorUserId: ctx.user.id, stage: "recovery_completed", payload: { recoveryId: claim.request.recoveryId, snapshotId: snapshot.snapshotId, stateVersion: refreshed[0].stateVersion } });
    await audit(ctx, { action: "conversation.step.recover", conversationId: input.conversationId, riskLevel: "medium", metadata: { stepId: input.stepId, recoveryId: claim.request.recoveryId, snapshotId: snapshot.snapshotId } });
    return { success: true, replayed: false, recoveryId: claim.request.recoveryId, stateVersion: refreshed[0].stateVersion };
  }),

  runStep: protectedProcedure.input(z.object({ conversationId: z.string(), stepId: z.string() })).mutation(async ({ ctx, input }) => {
    await getConversationForAction(ctx, input.conversationId, "run");
    const rows = await rawExecute(
      `SELECT s.*,p.status AS planStatus,p.version AS planVersion FROM emperor_conversation_plan_steps s JOIN emperor_conversation_plans p ON p.planId=s.planId WHERE s.stepId=? AND p.conversationId=? LIMIT 1`,
      [input.stepId, input.conversationId],
    );
    const step = rows[0];
    if (!step) throw new TRPCError({ code: "NOT_FOUND", message: "计划步骤不存在" });
    if (step.status !== "ready") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "步骤未准备就绪，可能尚待人工确认" });
    const capability = await resolveCapabilityGovernance(ctx, step.capabilityType, step.capabilitySlug);
    const effectiveRisk = highestConversationRisk(step.riskLevel, capability.riskLevel as any);
    const executionPolicy = conversationExecutionPolicy({ riskLevel: effectiveRisk, approvalRequired: Boolean(step.approvalRequired), capabilityType: step.capabilityType });
    const lifecyclePolicy = resolveConversationLifecyclePolicy({ capabilityType: step.capabilityType, riskLevel: effectiveRisk, approvalRequired: Boolean(step.approvalRequired), approvalState: String(step.approvalState) });
    if (executionPolicy.requiresStepApproval && step.approvalState !== "approved") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "高风险或写入步骤必须在计划批准后单独完成人工确认" });
    }
    const payload = parseJson(step.input, {}) as Record<string, unknown>;
    const attachmentRows = await rawExecute(
      `SELECT a.attachmentId,a.fileName,a.mimeType,a.contextPolicy,a.contextSummary,a.artifactId,s.publicUrl
       FROM emperor_conversation_attachments a
       LEFT JOIN ai_storage_objects s ON s.id=a.storageObjectId
       WHERE a.conversationId=? AND a.scanStatus='ready' ORDER BY a.createdAt ASC`,
      [input.conversationId],
    );
    const knowledgeRows = await rawExecute("SELECT referenceId,sourceKind,title,contextSummary,tags FROM emperor_conversation_knowledge_refs WHERE conversationId=? ORDER BY createdAt ASC", [input.conversationId]);
    const attachmentRefs = attachmentRows.map((attachment: any) => ({
      attachmentId: attachment.attachmentId,
      artifactId: attachment.artifactId || null,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      contextPolicy: attachment.contextPolicy,
    }));
    const knowledgeRefs = knowledgeRows.map((item: any) => ({ referenceId: item.referenceId, sourceKind: item.sourceKind, title: item.title, contextSummary: item.contextSummary, tags: parseJson(item.tags, []) }));
    const compiledContext = compileConversationContext({
      explicitContext: String(payload.context || ""),
      attachments: attachmentRows.map((attachment: any) => ({ attachmentId: attachment.attachmentId, artifactId: attachment.artifactId || null, fileName: attachment.fileName, mimeType: attachment.mimeType, contextPolicy: attachment.contextPolicy, contextSummary: attachment.contextSummary })),
      knowledgeReferences: knowledgeRefs,
    });
    const executionPayload = { ...payload, conversationId: input.conversationId, conversationAttachments: attachmentRefs, conversationKnowledgeReferences: knowledgeRefs, conversationContext: compiledContext.context, contextPolicyHash: compiledContext.policyHash, executionPolicy };
    const skillAttachments: MessageContent[] = attachmentRows.flatMap((attachment: any) => {
      if (!attachment.publicUrl) return [];
      if (attachment.contextPolicy === "image_vision" && String(attachment.mimeType).startsWith("image/")) {
        return [{ type: "image_url", image_url: { url: attachment.publicUrl, detail: "high" } }];
      }
      if (attachment.contextPolicy === "extracted_text" && attachment.mimeType === "application/pdf") {
        return [{ type: "file_url", file_url: { url: attachment.publicUrl, mime_type: "application/pdf" } }];
      }
      return [];
    });
    const traceId = `conversation_step_${input.stepId}`;
    await ensureRunTrace({
      runId: traceId,
      rootRunType: "conversation_step",
      workspaceId: workspaceIdFromContext(ctx),
      agentSlug: `conversation.${step.capabilityType}`,
      projectId: Number(payload.projectId) || null,
      userId: ctx.user.id,
      metadata: { conversationId: input.conversationId, stepId: input.stepId, capabilityType: step.capabilityType, capabilitySlug: step.capabilitySlug },
    });
    await recordContextManifest({
      traceId,
      runId: traceId,
      nodeId: input.stepId,
      sourceCount: compiledContext.sourceCount,
      estimatedTokens: compiledContext.estimatedTokens,
      maxTokens: compiledContext.maxTokens,
      manifest: { ...compiledContext.manifest, conversationId: input.conversationId, stepId: input.stepId, capability: { type: step.capabilityType, slug: step.capabilitySlug }, executionPolicy },
    });
    for (const stage of EXECUTION_LIFECYCLE_STAGES.slice(0, 5)) {
      await appendConversationLifecycleStage({ traceId, stepId: input.stepId, actorUserId: ctx.user.id, stage, payload: { capabilityType: step.capabilityType, riskLevel: effectiveRisk, executionMode: "serial", stateVersion: Number(step.stateVersion || 0), contextPolicyHash: compiledContext.policyHash } });
    }
    const stateVersion = Number(step.stateVersion || 0);
    const executionSnapshot = await createExecutionStateSnapshot({
      workspaceId: workspaceIdFromContext(ctx), traceId, targetType: "conversation_step", targetId: input.stepId, stateVersion,
      planId: step.planId, planVersion: Number(step.planVersion || 0), capabilityType: step.capabilityType, capabilitySlug: step.capabilitySlug,
      approvalState: step.approvalState, contextManifestHash: compiledContext.policyHash, createdBy: ctx.user.id,
      snapshot: { conversationId: input.conversationId, stepId: input.stepId, planId: step.planId, planVersion: step.planVersion, status: step.status, riskLevel: effectiveRisk, capability: { type: step.capabilityType, slug: step.capabilitySlug }, executionPolicy: lifecyclePolicy, contextPolicyHash: compiledContext.policyHash, input: payload },
    });
    await appendConversationLifecycleStage({ traceId, stepId: input.stepId, actorUserId: ctx.user.id, stage: "snapshot_created", payload: { snapshotId: executionSnapshot.snapshotId, stateVersion, inputHash: executionSnapshot.inputHash } });
    await appendRunLedgerEvent({ traceId, eventType: "conversation.step.started", entityType: "system", entityId: input.stepId, skillSlug: step.capabilityType === "skill" ? step.capabilitySlug : null, toolSlug: step.capabilityType === "tool" ? step.capabilitySlug : null, actorUserId: ctx.user.id, payload: { capabilityType: step.capabilityType, riskLevel: effectiveRisk, executionMode: executionPolicy.executionMode, contextPolicyHash: compiledContext.policyHash } });
    await rawExecute("UPDATE emperor_conversation_plan_steps SET status='running',stateVersion=stateVersion+1,traceId=?,recoverySnapshotId=?,startedAt=NOW() WHERE stepId=? AND status='ready' AND stateVersion=?", [traceId, executionSnapshot.snapshotId, input.stepId, stateVersion]);
    const claimedStepRows = await rawExecute("SELECT status,stateVersion FROM emperor_conversation_plan_steps WHERE stepId=? LIMIT 1", [input.stepId]);
    if (claimedStepRows[0]?.status !== "running" || Number(claimedStepRows[0]?.stateVersion) !== stateVersion + 1) {
      await appendConversationLifecycleStage({ traceId, stepId: input.stepId, actorUserId: ctx.user.id, stage: "error_classified", payload: { reasonCode: "version_conflict", expectedStateVersion: stateVersion } }).catch(() => null);
      await completeRunTrace(traceId, "failed").catch(() => null);
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "步骤状态已变化；未执行任何能力，请刷新后重试" });
    }
    await appendConversationLifecycleStage({ traceId, stepId: input.stepId, actorUserId: ctx.user.id, stage: "execution_started", payload: { snapshotId: executionSnapshot.snapshotId, stateVersion: stateVersion + 1, automaticRetryAllowed: lifecyclePolicy.automaticRetryAllowed } });
    await rawExecute("UPDATE emperor_conversation_plans SET status='executing' WHERE planId=?", [step.planId]);
    await rawExecute("UPDATE emperor_conversations SET status='running' WHERE conversationId=?", [input.conversationId]);
    try {
      let runRef: Record<string, unknown>;
      if (step.capabilityType === "agent") {
        const result = await startAgentRun({ slug: step.capabilitySlug, inputs: executionPayload, userId: ctx.user.id, workspaceId: workspaceIdFromContext(ctx), projectId: Number(payload.projectId) || null });
        runRef = { agentRunId: (result as any).runId || null, status: (result as any).status || "queued" };
        if (runRef.agentRunId) {
          const agentSnapshot = await createExecutionStateSnapshot({
            workspaceId: workspaceIdFromContext(ctx), traceId, targetType: "agent_run", targetId: String(runRef.agentRunId), stateVersion: 0,
            planId: step.planId, planVersion: Number(step.planVersion || 0), capabilityType: "agent", capabilitySlug: step.capabilitySlug,
            approvalState: step.approvalState, contextManifestHash: compiledContext.policyHash, createdBy: ctx.user.id,
            snapshot: { conversationId: input.conversationId, stepId: input.stepId, agentRunId: runRef.agentRunId, status: runRef.status, capabilitySlug: step.capabilitySlug, executionPolicy: lifecyclePolicy, contextPolicyHash: compiledContext.policyHash },
          });
          await appendRunLedgerEvent({ traceId, eventType: "lifecycle.snapshot_created", entityType: "agent_run", entityId: String(runRef.agentRunId), actorUserId: ctx.user.id, payload: { targetType: "agent_run", snapshotId: agentSnapshot.snapshotId, stateVersion: 0 } });
        }
        await rawExecute("UPDATE emperor_conversation_plan_steps SET status='running',agentRunId=? WHERE stepId=?", [(result as any).runId || null, input.stepId]);
      } else if (step.capabilityType === "skill") {
        const result = await runEmperorSkill<string>({ skillSlug: step.capabilitySlug, userId: ctx.user.id, workspaceId: workspaceIdFromContext(ctx), context: compiledContext.contextText, variables: executionPayload, attachments: skillAttachments, migrationSource: "emperor.conversations", maxModelAttempts: lifecyclePolicy.maxAutomaticAttempts, validate: (content) => content });
        runRef = { skillRunId: result.runId, output: result.content };
        await rawExecute("UPDATE emperor_conversation_plan_steps SET status='succeeded',stateVersion=stateVersion+1,skillRunId=?,completedAt=NOW(),metadata=? WHERE stepId=?", [result.runId, json({ outputPreview: String(result.content).slice(0, 2_000) }), input.stepId]);
      } else {
        const result = await invokeEmperorTool({ toolSlug: step.capabilitySlug, params: executionPayload, userId: ctx.user.id, userRole: ctx.user.role, workspaceId: workspaceIdFromContext(ctx) });
        runRef = { toolRunId: (result as any).metadata?.toolRunId || null, success: (result as any).success };
        await rawExecute("UPDATE emperor_conversation_plan_steps SET status=?,stateVersion=stateVersion+1,toolRunId=?,completedAt=NOW(),metadata=? WHERE stepId=?", [(result as any).success ? "succeeded" : "failed", (result as any).metadata?.toolRunId || null, json({ status: (result as any).metadata?.status || null }), input.stepId]);
      }
      await appendRunLedgerEvent({
        traceId,
        eventType: step.capabilityType === "agent" ? "conversation.step.dispatched" : "conversation.step.succeeded",
        entityType: step.capabilityType === "agent" ? "agent_run" : step.capabilityType === "skill" ? "skill_run" : "tool_run",
        entityId: String(runRef.agentRunId || runRef.skillRunId || runRef.toolRunId || input.stepId),
        skillSlug: step.capabilityType === "skill" ? step.capabilitySlug : null,
        toolSlug: step.capabilityType === "tool" ? step.capabilitySlug : null,
        actorUserId: ctx.user.id,
        payload: { stepId: input.stepId, capabilityType: step.capabilityType, success: runRef.success ?? true },
      });
      await completeRunTrace(traceId, step.capabilityType === "agent" ? "running" : "completed");
      await appendConversationLifecycleStage({ traceId, stepId: input.stepId, actorUserId: ctx.user.id, stage: "completed", payload: { capabilityType: step.capabilityType, runRef } });
      await audit(ctx, { action: "conversation.step.run", conversationId: input.conversationId, riskLevel: step.riskLevel === "L3" ? "critical" : step.riskLevel === "L2" ? "high" : "medium", metadata: { stepId: input.stepId, capabilityType: step.capabilityType, capabilitySlug: step.capabilitySlug, ...runRef } });
      return { success: true, ...runRef };
    } catch (error) {
      await rawExecute("UPDATE emperor_conversation_plan_steps SET status='failed',stateVersion=stateVersion+1,errorMessage=?,completedAt=NOW() WHERE stepId=?", [error instanceof Error ? error.message : "步骤执行失败", input.stepId]);
      const failedStateVersion = stateVersion + 2;
      const failureSnapshot = await createExecutionStateSnapshot({
        workspaceId: workspaceIdFromContext(ctx), traceId, targetType: "conversation_step", targetId: input.stepId, stateVersion: failedStateVersion,
        planId: step.planId, planVersion: Number(step.planVersion || 0), capabilityType: step.capabilityType, capabilitySlug: step.capabilitySlug,
        approvalState: step.approvalState, contextManifestHash: compiledContext.policyHash, createdBy: ctx.user.id,
        snapshot: { conversationId: input.conversationId, stepId: input.stepId, planId: step.planId, status: "failed", riskLevel: effectiveRisk, capability: { type: step.capabilityType, slug: step.capabilitySlug }, executionPolicy: lifecyclePolicy, contextPolicyHash: compiledContext.policyHash, failure: error instanceof Error ? error.message : "unknown" },
      }).catch(() => null);
      if (failureSnapshot) await rawExecute("UPDATE emperor_conversation_plan_steps SET recoverySnapshotId=? WHERE stepId=?", [failureSnapshot.snapshotId, input.stepId]);
      await appendConversationLifecycleStage({ traceId, stepId: input.stepId, actorUserId: ctx.user.id, stage: "error_classified", payload: { error: error instanceof Error ? error.message : "unknown", recoveryAllowed: lifecyclePolicy.recoveryAllowed } }).catch(() => null);
      if (lifecyclePolicy.compensationRequiredOnFailure) await appendConversationLifecycleStage({ traceId, stepId: input.stepId, actorUserId: ctx.user.id, stage: "compensation_required", payload: { capabilityType: step.capabilityType, riskLevel: effectiveRisk, automaticCompensation: false } }).catch(() => null);
      await appendRunLedgerEvent({ traceId, eventType: "conversation.step.failed", entityType: "system", entityId: input.stepId, skillSlug: step.capabilityType === "skill" ? step.capabilitySlug : null, toolSlug: step.capabilityType === "tool" ? step.capabilitySlug : null, actorUserId: ctx.user.id, payload: { error: error instanceof Error ? error.message : "unknown" } }).catch(() => null);
      await completeRunTrace(traceId, "failed").catch(() => null);
      await audit(ctx, { action: "conversation.step.run", conversationId: input.conversationId, status: "failed", riskLevel: "high", metadata: { stepId: input.stepId, error: error instanceof Error ? error.message : "unknown" } });
      throw error;
    }
  }),
});
