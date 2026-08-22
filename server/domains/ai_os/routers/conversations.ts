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
import {
  CONVERSATION_PLANNER_MAX_ATTEMPTS,
  conversationPlannerRetryDelayMs,
  conversationStepRequiresApproval,
  filterConversationPlanSteps,
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

async function assertCapabilityVisible(ctx: any, type: typeof PLAN_STEP_TYPES[number], slug: string) {
  const workspaceId = workspaceIdFromContext(ctx);
  const scope = buildWorkspaceScopeFilter(workspaceId);
  const table = type === "skill" ? "emperor_skills" : type === "agent" ? "emperor_agents" : "emperor_tools";
  const rows = await rawExecute(
    `SELECT slug FROM ${table} WHERE slug=? AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`,
    [slug, ...scope.params],
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: `未找到当前工作空间可用的${type}能力：${slug}` });
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
        rawExecute("SELECT fileName,mimeType,contextPolicy,contextSummary,artifactId FROM emperor_conversation_attachments WHERE conversationId=? AND scanStatus='ready' ORDER BY createdAt ASC", [input.conversationId]),
        rawExecute("SELECT referenceId,sourceKind,title,contextSummary,tags FROM emperor_conversation_knowledge_refs WHERE conversationId=? ORDER BY createdAt ASC", [input.conversationId]),
      ]);
      const capabilityCatalog = [...skills, ...agents, ...tools].map((item: any) => ({
        capabilityType: item.capabilityType, slug: item.slug, name: item.name, description: item.description || "", riskLevel: item.riskTier || "L1",
      }));
      let result: Awaited<ReturnType<typeof runEmperorSkill<string>>> | undefined;
      let lastError: unknown;
      for (let attemptIndex = 0; attemptIndex < CONVERSATION_PLANNER_MAX_ATTEMPTS; attemptIndex += 1) {
        try {
          result = await runEmperorSkill<string>({
            skillSlug: "emperor.conversation.plan",
            userId: ctx.user.id,
            workspaceId: workspaceIdFromContext(ctx),
            context: JSON.stringify({ userGoal: input.goal, attachments: attachments.map((item: any) => ({ fileName: item.fileName, mimeType: item.mimeType, contextPolicy: item.contextPolicy, contextSummary: item.contextSummary, artifactId: item.artifactId })), knowledgeReferences: knowledgeRefs.map((item: any) => ({ referenceId: item.referenceId, sourceKind: item.sourceKind, title: item.title, contextSummary: item.contextSummary, tags: parseJson(item.tags, []) })), capabilityCatalog }),
            variables: { goal: input.goal, conversationId: input.conversationId, capabilityCatalog, attachments, knowledgeRefs },
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
      for (const step of input.steps) await assertCapabilityVisible(ctx, step.capabilityType, step.capabilitySlug);
      const versionRows = await rawExecute("SELECT COALESCE(MAX(version),0) AS version FROM emperor_conversation_plans WHERE conversationId=?", [input.conversationId]);
      const version = Number(versionRows[0]?.version || 0) + 1;
      const planId = `plan_${randomUUID().replace(/-/g, "")}`;
      const requiresApproval = input.steps.some((step) => conversationStepRequiresApproval(step));
      await rawExecute(
        `INSERT INTO emperor_conversation_plans (workspaceId,planId,conversationId,version,status,goal,assumptions,planJson,riskSummary,createdBy) VALUES (?,?,?,?, 'proposed',?,?,?,?,?)`,
        [workspaceIdFromContext(ctx), planId, input.conversationId, version, input.goal, json(input.assumptions || []), json({ source: "user_editable_conversation_plan", steps: input.steps }), json({ requiresApproval, highestRisk: input.steps.map((s) => s.riskLevel).sort().at(-1) || "L0" }), ctx.user.id],
      );
      for (const [index, step] of input.steps.entries()) {
        const approvalRequired = conversationStepRequiresApproval(step);
        await rawExecute(
          `INSERT INTO emperor_conversation_plan_steps (workspaceId,stepId,planId,sequence,title,description,capabilityType,capabilitySlug,input,riskLevel,approvalRequired,approvalState,status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending')`,
          [workspaceIdFromContext(ctx), `step_${randomUUID().replace(/-/g, "")}`, planId, index + 1, step.title, step.description || null, step.capabilityType, step.capabilitySlug, json(step.input || {}), step.riskLevel, approvalRequired ? 1 : 0, approvalRequired ? "pending" : "not_required"],
        );
      }
      await rawExecute("UPDATE emperor_conversations SET status='awaiting_plan_confirmation', activePlanId=? WHERE conversationId=?", [planId, input.conversationId]);
      await audit(ctx, { action: "conversation.plan.propose", conversationId: input.conversationId, riskLevel: requiresApproval ? "high" : "medium", metadata: { planId, version, stepCount: input.steps.length } });
      return { planId, version, requiresApproval, conversationId: conversation.conversationId };
    }),

  approvePlan: protectedProcedure.input(z.object({ conversationId: z.string(), planId: z.string() })).mutation(async ({ ctx, input }) => {
    await getConversationForAction(ctx, input.conversationId, "confirm");
    const rows = await rawExecute("SELECT status FROM emperor_conversation_plans WHERE planId=? AND conversationId=? LIMIT 1", [input.planId, input.conversationId]);
    if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "计划不存在" });
    if (rows[0].status !== "proposed") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "仅可批准待确认计划" });
    await rawExecute("UPDATE emperor_conversation_plans SET status='approved',approvedBy=?,approvedAt=NOW() WHERE planId=?", [ctx.user.id, input.planId]);
    await rawExecute("UPDATE emperor_conversation_plan_steps SET status=IF(approvalRequired=1,'waiting_human','ready') WHERE planId=?", [input.planId]);
    await rawExecute("UPDATE emperor_conversations SET status='waiting_human',activePlanId=? WHERE conversationId=?", [input.planId, input.conversationId]);
    await audit(ctx, { action: "conversation.plan.approve", conversationId: input.conversationId, riskLevel: "high", metadata: { planId: input.planId } });
    return { success: true };
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

  runStep: protectedProcedure.input(z.object({ conversationId: z.string(), stepId: z.string() })).mutation(async ({ ctx, input }) => {
    await getConversationForAction(ctx, input.conversationId, "run");
    const rows = await rawExecute(
      `SELECT s.*,p.status AS planStatus FROM emperor_conversation_plan_steps s JOIN emperor_conversation_plans p ON p.planId=s.planId WHERE s.stepId=? AND p.conversationId=? LIMIT 1`,
      [input.stepId, input.conversationId],
    );
    const step = rows[0];
    if (!step) throw new TRPCError({ code: "NOT_FOUND", message: "计划步骤不存在" });
    if (step.status !== "ready") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "步骤未准备就绪，可能尚待人工确认" });
    await assertCapabilityVisible(ctx, step.capabilityType, step.capabilitySlug);
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
    const attachmentContext = attachmentRows.map((attachment: any) =>
      `[受控附件] ${attachment.fileName}（${attachment.mimeType}；策略：${attachment.contextPolicy}；${attachment.contextSummary || "仅可按受控引用使用"}）`,
    ).join("\n");
    const knowledgeRefs = knowledgeRows.map((item: any) => ({ referenceId: item.referenceId, sourceKind: item.sourceKind, title: item.title, contextSummary: item.contextSummary, tags: parseJson(item.tags, []) }));
    const knowledgeContext = knowledgeRefs.map((item: any) => `[受控知识] ${item.title}（${item.sourceKind}；${item.contextSummary}）`).join("\n");
    const executionPayload = { ...payload, conversationId: input.conversationId, conversationAttachments: attachmentRefs, conversationKnowledgeReferences: knowledgeRefs };
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
      sourceCount: attachmentRefs.length + knowledgeRefs.length,
      manifest: { conversationId: input.conversationId, stepId: input.stepId, capability: { type: step.capabilityType, slug: step.capabilitySlug }, attachments: attachmentRefs, knowledgeReferences: knowledgeRefs },
    });
    await appendRunLedgerEvent({ traceId, eventType: "conversation.step.started", entityType: "system", entityId: input.stepId, skillSlug: step.capabilityType === "skill" ? step.capabilitySlug : null, toolSlug: step.capabilityType === "tool" ? step.capabilitySlug : null, actorUserId: ctx.user.id, payload: { capabilityType: step.capabilityType, riskLevel: step.riskLevel } });
    await rawExecute("UPDATE emperor_conversation_plan_steps SET status='running',startedAt=NOW() WHERE stepId=?", [input.stepId]);
    await rawExecute("UPDATE emperor_conversation_plans SET status='executing' WHERE planId=?", [step.planId]);
    await rawExecute("UPDATE emperor_conversations SET status='running' WHERE conversationId=?", [input.conversationId]);
    try {
      let runRef: Record<string, unknown>;
      if (step.capabilityType === "agent") {
        const result = await startAgentRun({ slug: step.capabilitySlug, inputs: executionPayload, userId: ctx.user.id, workspaceId: workspaceIdFromContext(ctx), projectId: Number(payload.projectId) || null });
        runRef = { agentRunId: (result as any).runId };
        await rawExecute("UPDATE emperor_conversation_plan_steps SET status='running',agentRunId=? WHERE stepId=?", [(result as any).runId || null, input.stepId]);
      } else if (step.capabilityType === "skill") {
        const result = await runEmperorSkill<string>({ skillSlug: step.capabilitySlug, userId: ctx.user.id, workspaceId: workspaceIdFromContext(ctx), context: [String(payload.context || ""), attachmentContext, knowledgeContext].filter(Boolean).join("\n\n"), variables: executionPayload, attachments: skillAttachments, migrationSource: "emperor.conversations", validate: (content) => content });
        runRef = { skillRunId: result.runId, output: result.content };
        await rawExecute("UPDATE emperor_conversation_plan_steps SET status='succeeded',skillRunId=?,completedAt=NOW(),metadata=? WHERE stepId=?", [result.runId, json({ outputPreview: String(result.content).slice(0, 2_000) }), input.stepId]);
      } else {
        const result = await invokeEmperorTool({ toolSlug: step.capabilitySlug, params: executionPayload, userId: ctx.user.id, userRole: ctx.user.role, workspaceId: workspaceIdFromContext(ctx) });
        runRef = { toolRunId: (result as any).metadata?.toolRunId || null, success: (result as any).success };
        await rawExecute("UPDATE emperor_conversation_plan_steps SET status=?,toolRunId=?,completedAt=NOW(),metadata=? WHERE stepId=?", [(result as any).success ? "succeeded" : "failed", (result as any).metadata?.toolRunId || null, json({ status: (result as any).metadata?.status || null }), input.stepId]);
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
      await audit(ctx, { action: "conversation.step.run", conversationId: input.conversationId, riskLevel: step.riskLevel === "L3" ? "critical" : step.riskLevel === "L2" ? "high" : "medium", metadata: { stepId: input.stepId, capabilityType: step.capabilityType, capabilitySlug: step.capabilitySlug, ...runRef } });
      return { success: true, ...runRef };
    } catch (error) {
      await rawExecute("UPDATE emperor_conversation_plan_steps SET status='failed',errorMessage=?,completedAt=NOW() WHERE stepId=?", [error instanceof Error ? error.message : "步骤执行失败", input.stepId]);
      await appendRunLedgerEvent({ traceId, eventType: "conversation.step.failed", entityType: "system", entityId: input.stepId, skillSlug: step.capabilityType === "skill" ? step.capabilitySlug : null, toolSlug: step.capabilityType === "tool" ? step.capabilitySlug : null, actorUserId: ctx.user.id, payload: { error: error instanceof Error ? error.message : "unknown" } }).catch(() => null);
      await completeRunTrace(traceId, "failed").catch(() => null);
      await audit(ctx, { action: "conversation.step.run", conversationId: input.conversationId, status: "failed", riskLevel: "high", metadata: { stepId: input.stepId, error: error instanceof Error ? error.message : "unknown" } });
      throw error;
    }
  }),
});
