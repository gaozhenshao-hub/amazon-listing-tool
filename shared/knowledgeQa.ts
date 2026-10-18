import { z } from "zod";
import SHA256 from "crypto-js/sha256";

export const KNOWLEDGE_QA_LIMITS = { question: 5000, items: 1000, sourceBytes: 4 * 1024 * 1024, fieldBytes: 262144, historyMessages: 6, answerBytes: 65535 } as const;
export const KnowledgeQaIdSchema = z.number().int().positive().max(2147483647);
export const KnowledgeQaUuidSchema = z.string().uuid().refine(value => value === value.toLowerCase());
export const KnowledgeQaHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const KnowledgeQaIdentitySchema = z.object({ userId: KnowledgeQaIdSchema, workspaceId: KnowledgeQaIdSchema }).strict();
export const KnowledgeQaTypeSchema = z.enum(["product", "listing", "image", "skill", "video"]);
export const KnowledgeQaScopeSchema = z.object({ expectedWorkspaceId: KnowledgeQaIdSchema, threadId: KnowledgeQaUuidSchema }).strict();
export const KnowledgeQaOperationInputSchema = KnowledgeQaScopeSchema.extend({ operationId: KnowledgeQaUuidSchema }).strict();
export const KnowledgeQaPreviewInputSchema = KnowledgeQaOperationInputSchema.extend({ question: z.string().trim().min(1).max(KNOWLEDGE_QA_LIMITS.question) }).strict();
export const KnowledgeQaStartInputSchema = KnowledgeQaPreviewInputSchema.extend({ expectedSourceHash: KnowledgeQaHashSchema, expectedRuntimeHash: KnowledgeQaHashSchema,
  maxCostCents: z.number().int().nonnegative().max(1000000), chargeConfirmed: z.literal(true) }).strict();
export const KnowledgeQaPageInputSchema = z.object({ expectedWorkspaceId: KnowledgeQaIdSchema, beforeId: KnowledgeQaIdSchema.optional(), limit: z.number().int().min(1).max(50).default(20) }).strict();
export const KnowledgeQaHistoryInputSchema = KnowledgeQaPageInputSchema.extend({ threadId: KnowledgeQaUuidSchema }).strict();
export const KnowledgeQaRenameInputSchema = KnowledgeQaScopeSchema.extend({ title: z.string().trim().min(1).max(255), expectedVersion: KnowledgeQaIdSchema }).strict();
export const KnowledgeQaDeleteInputSchema = KnowledgeQaScopeSchema.extend({ expectedVersion: KnowledgeQaIdSchema }).strict();
export const KnowledgeQaFeedbackInputSchema = KnowledgeQaOperationInputSchema.extend({ itemKey: z.string().regex(/^(product|listing|image|skill|video):[1-9][0-9]*$/u), rating: z.enum(["helpful", "irrelevant", "wrong"]), comment: z.string().trim().max(500) }).strict();
export const KnowledgeQaItemSchema = z.object({ id: KnowledgeQaIdSchema, type: KnowledgeQaTypeSchema, key: z.string(), title: z.string(), asin: z.string(), category: z.string(), tags: z.string(),
  score: z.number().finite().nullable(), summary: z.string(), keyPoints: z.string(), fullContent: z.string(), aiAnalysis: z.string(), revisionHash: KnowledgeQaHashSchema,
  summaryCoverage: z.object({ charactersAvailable: z.number().int().nonnegative(), charactersIncluded: z.number().int().nonnegative(), truncated: z.boolean() }).strict() }).strict()
  .refine(item => item.key === `${item.type}:${item.id}`);
export const KnowledgeQaSourceSchema = z.object({ version: z.literal(1), identity: KnowledgeQaIdentitySchema, scope: KnowledgeQaScopeSchema,
  question: z.string().min(1).max(5000), threadVersion: z.number().int().nonnegative(), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }).strict()).max(6),
  historySourceKeys: z.array(z.string().regex(/^(product|listing|image|skill|video):[1-9][0-9]*$/u)).max(1000),
  items: z.array(KnowledgeQaItemSchema).max(KNOWLEDGE_QA_LIMITS.items), types: z.array(KnowledgeQaTypeSchema).max(5),
  coverage: z.object({ completeMatchingIndex: z.literal(true), scope: z.literal("same_workspace_confirmed_shared"), historyIncluded: z.number().int().min(0).max(6),
    historyAvailable: z.number().int().nonnegative(), pixelInputs: z.literal(false), externalNetwork: z.literal(false) }).strict(), sourceHash: KnowledgeQaHashSchema }).strict()
  .superRefine((value, ctx) => { const { sourceHash, ...body } = value; if (sourceHash !== knowledgeQaHash(body) || new TextEncoder().encode(knowledgeQaCanonical(value)).byteLength > KNOWLEDGE_QA_LIMITS.sourceBytes
    || new Set(value.items.map(item => item.key)).size !== value.items.length || new Set(value.types).size !== value.types.length
    || value.items.some(item => !value.types.includes(item.type)) || value.identity.workspaceId !== value.scope.expectedWorkspaceId || value.coverage.historyIncluded !== value.history.length
    || value.coverage.historyAvailable < value.history.length || new Set(value.historySourceKeys).size !== value.historySourceKeys.length || !value.history.length && value.historySourceKeys.length > 0) ctx.addIssue({ code: "custom", message: "SOURCE_BINDING_INVALID" }); });
export const KnowledgeQaReferenceSchema = z.object({ id: KnowledgeQaIdSchema, type: KnowledgeQaTypeSchema, key: z.string(), title: z.string(), asin: z.string(), score: z.number().finite().nullable(),
  excerpt: z.string(), category: z.string(), revisionHash: KnowledgeQaHashSchema }).strict();
export const KnowledgeQaPathSchema = z.object({ level: z.enum(["L1", "L2", "L3"]), scannedCount: z.number().int().nonnegative(), matchedCount: z.number().int().nonnegative(),
  modelCalled: z.boolean(), tokensUsed: z.number().int().nonnegative().nullable() }).strict();
export const KnowledgeQaAnswerSchema = z.object({ content: z.string().min(1), references: z.array(KnowledgeQaReferenceSchema).max(5), searchPath: z.array(KnowledgeQaPathSchema).max(3),
  tokensUsed: z.number().int().nonnegative().nullable(), reviewRequired: z.literal(true), writesKnowledge: z.literal(false) }).strict();
export const KnowledgeQaStateSchema = z.enum(["queued", "running", "dispatched", "succeeded", "failed", "canceled", "outcome_unknown", "not_found"]);
export const KnowledgeQaStageSchema = z.enum(["l1_select", "l2_select", "answer"]);
const reason = z.string().regex(/^[A-Z][A-Z0-9_]{0,159}$/u).nullable();
export const KnowledgeQaViewSchema = z.object({ identity: KnowledgeQaIdentitySchema, scope: KnowledgeQaOperationInputSchema, state: KnowledgeQaStateSchema,
  stage: KnowledgeQaStageSchema.nullable(), sourceHash: KnowledgeQaHashSchema.nullable(), runtimeHash: KnowledgeQaHashSchema.nullable(), resultHash: KnowledgeQaHashSchema.nullable(),
  question: z.string().nullable(), answer: KnowledgeQaAnswerSchema.nullable(), configuration: z.object({ revision: KnowledgeQaIdSchema, hash: KnowledgeQaHashSchema }).strict().nullable(),
  reasonCode: reason, createdAt: z.string().nullable(), sourceChanged: z.boolean() }).strict().superRefine((value, ctx) => {
  if (value.identity.workspaceId !== value.scope.expectedWorkspaceId || (value.state === "succeeded") !== (value.answer !== null)
    || value.answer !== null && (!value.resultHash || !value.sourceHash || !value.runtimeHash)) ctx.addIssue({ code: "custom", message: "VIEW_BINDING_INVALID" });
});
export const KnowledgeQaCancelSchema = z.object({ identity: KnowledgeQaIdentitySchema, scope: KnowledgeQaOperationInputSchema, state: KnowledgeQaStateSchema, reasonCode: reason }).strict();
export const KnowledgeQaClearInputSchema = z.object({ expectedWorkspaceId: KnowledgeQaIdSchema, confirmAll: z.literal(true) }).strict();
export const KnowledgeQaPreviewSchema = z.object({ identity: KnowledgeQaIdentitySchema, scope: KnowledgeQaPreviewInputSchema, sourceHash: KnowledgeQaHashSchema,
  runtimeHash: KnowledgeQaHashSchema.nullable(), matchedCount: z.number().int().nonnegative(), types: z.array(KnowledgeQaTypeSchema),
  historyIncluded: z.number().int().min(0).max(6), historyAvailable: z.number().int().nonnegative(),
  configuration: z.object({ revision: KnowledgeQaIdSchema, hash: KnowledgeQaHashSchema }).strict().nullable(),
  budget: z.object({ maxCalls: z.number().int().min(0).max(3), maxCostCentsTotal: z.number().int().nonnegative(), currency: z.literal("USD") }).strict().nullable(),
  capability: z.object({ available: z.boolean(), reasonCode: reason }).strict() }).strict().superRefine((value, ctx) => {
  if (value.identity.workspaceId !== value.scope.expectedWorkspaceId || value.capability.available && (!value.runtimeHash || !value.budget || !value.configuration || value.capability.reasonCode !== null)) ctx.addIssue({ code: "custom", message: "PREVIEW_INVALID" });
});
export const KnowledgeQaThreadSchema = z.object({ threadId: KnowledgeQaUuidSchema, title: z.string().min(1).max(255), version: KnowledgeQaIdSchema, createdAt: z.string(), updatedAt: z.string() }).strict();
export const KnowledgeQaThreadsSchema = z.object({ identity: KnowledgeQaIdentitySchema, request: KnowledgeQaPageInputSchema, items: z.array(KnowledgeQaThreadSchema).max(50), nextBeforeId: KnowledgeQaIdSchema.nullable() }).strict();
export const KnowledgeQaHistorySchema = z.object({ identity: KnowledgeQaIdentitySchema, request: KnowledgeQaHistoryInputSchema, thread: KnowledgeQaThreadSchema,
  items: z.array(KnowledgeQaViewSchema).max(50), nextBeforeId: KnowledgeQaIdSchema.nullable() }).strict().refine(value => value.identity.workspaceId === value.request.expectedWorkspaceId && value.thread.threadId === value.request.threadId
    && value.items.every(item => item.identity.userId === value.identity.userId && item.identity.workspaceId === value.identity.workspaceId && item.scope.threadId === value.request.threadId)
    && new Set(value.items.map(item => item.scope.operationId)).size === value.items.length);
export const KnowledgeQaRenameResultSchema = z.object({ identity: KnowledgeQaIdentitySchema, scope: KnowledgeQaScopeSchema, thread: KnowledgeQaThreadSchema }).strict().refine(value => value.identity.workspaceId === value.scope.expectedWorkspaceId && value.scope.threadId === value.thread.threadId);
export const KnowledgeQaDeleteResultSchema = z.object({ identity: KnowledgeQaIdentitySchema, scope: KnowledgeQaDeleteInputSchema, deleted: z.literal(true) }).strict().refine(value => value.identity.workspaceId === value.scope.expectedWorkspaceId);
export const KnowledgeQaClearResultSchema = z.object({ identity: KnowledgeQaIdentitySchema, cleared: z.number().int().min(0).max(1000) }).strict();
export const KnowledgeQaFeedbackResultSchema = z.object({ identity: KnowledgeQaIdentitySchema, scope: KnowledgeQaOperationInputSchema, recorded: z.literal(true) }).strict().refine(value => value.identity.workspaceId === value.scope.expectedWorkspaceId);
export type KnowledgeQaIdentity = z.infer<typeof KnowledgeQaIdentitySchema>;
export type KnowledgeQaScope = z.infer<typeof KnowledgeQaScopeSchema>;
export type KnowledgeQaOperationInput = z.infer<typeof KnowledgeQaOperationInputSchema>;
export type KnowledgeQaPreviewInput = z.infer<typeof KnowledgeQaPreviewInputSchema>;
export type KnowledgeQaStartInput = z.infer<typeof KnowledgeQaStartInputSchema>;
export type KnowledgeQaSource = z.infer<typeof KnowledgeQaSourceSchema>;
export type KnowledgeQaItem = z.infer<typeof KnowledgeQaItemSchema>;
export type KnowledgeQaAnswer = z.infer<typeof KnowledgeQaAnswerSchema>;
export type KnowledgeQaView = z.infer<typeof KnowledgeQaViewSchema>;
export type KnowledgeQaPreview = z.infer<typeof KnowledgeQaPreviewSchema>;
export type KnowledgeQaStage = z.infer<typeof KnowledgeQaStageSchema>;
export function knowledgeQaCanonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(knowledgeQaCanonical).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${knowledgeQaCanonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  throw new Error("KNOWLEDGE_QA_NON_JSON");
}
export const knowledgeQaHash = (value: unknown) => SHA256(knowledgeQaCanonical(value)).toString();
export function knowledgeQaOperation(input: KnowledgeQaOperationInput): KnowledgeQaOperationInput {
  return KnowledgeQaOperationInputSchema.parse({ expectedWorkspaceId: input.expectedWorkspaceId, threadId: input.threadId, operationId: input.operationId });
}
export function knowledgeQaValidateSelection(raw: unknown, count: number, maximum: 5 | 10): number[] {
  const value = z.object({ selectedIndices: z.array(z.number().int().min(1).max(count)).max(maximum), reasoning: z.string().max(4000).optional() }).strict().parse(raw);
  if (new Set(value.selectedIndices).size !== value.selectedIndices.length) throw new Error("SELECTION_DUPLICATE");
  return value.selectedIndices;
}
export function knowledgeQaValidateAnswer(content: unknown, items: KnowledgeQaItem[]): string {
  const text = z.string().trim().min(1).parse(content);
  if (new TextEncoder().encode(text).byteLength > KNOWLEDGE_QA_LIMITS.answerBytes) throw new Error("ANSWER_LIMIT");
  const citations = [...text.matchAll(/\[引用([^\]]*)\]/gu)];
  if (items.length && !citations.length || citations.some(match => !/^[1-9][0-9]*$/u.test(match[1]) || Number(match[1]) > items.length)) throw new Error("ANSWER_CITATION_INVALID");
  return text;
}
