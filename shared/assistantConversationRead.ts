import { z } from "zod";
import { AgentLibraryKeySchema, AgentLibraryRulesSchema } from "./agentLibraryContracts";
import { AssistantConversationOperationInputSchema, AssistantConversationStateSchema } from "./assistantConversation";

const id = z.number().int().positive().max(2147483647), hash = z.string().regex(/^[a-f0-9]{64}$/u), uuid = z.string().uuid(), time = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/u);
export const AssistantConversationOptionsInputSchema = z.object({ expectedWorkspaceId: id, agentKey: AgentLibraryKeySchema }).strict();
export const AssistantConversationAttachmentInputSchema = AssistantConversationOperationInputSchema.extend({ ordinal: z.number().int().min(0).max(2) }).strict();
export const AssistantConversationPublicIdentitySchema = z.object({ workspaceId: id, userId: id, agentKey: AgentLibraryKeySchema }).strict();
export const AssistantConversationCapabilitySchema = z.object({ available: z.boolean(), reasonCode: z.string().max(100).nullable() }).strict();
export const AssistantConversationPublicThreadSchema = z.object({ threadId: uuid, title: z.string().min(1).max(80), version: id, activeOperationId: uuid.nullable(), createdAt: time, updatedAt: time }).strict();
export const AssistantConversationAttachmentMetadataSchema = z.object({ ordinal: z.number().int().min(0).max(2), name: z.string().min(1).max(180), mime: z.string().min(1).max(128), sizeBytes: z.number().int().min(1).max(3 * 1024 * 1024), sha256: hash, kind: z.enum(["image", "document"]), coverage: z.record(z.string(), z.unknown()), warnings: z.array(z.object({ code: z.string().max(100), message: z.string().max(1000) }).strict()).max(100) }).strict();
export const AssistantConversationPublicTurnSchema = z.object({ operationId: uuid, threadId: uuid, sequence: id.nullable(), mode: z.enum(["work", "coach"]).nullable(), message: z.string().max(8000).nullable(), reply: z.string().max(64000).nullable(), state: AssistantConversationStateSchema, errorCode: z.string().max(100).nullable(), selectedSkillSlug: z.string().max(128).nullable(), configurationRevision: id.nullable(), configurationHash: hash.nullable(), attachments: z.array(AssistantConversationAttachmentMetadataSchema).max(3), proposedRules: AgentLibraryRulesSchema.nullable(), createdAt: time, updatedAt: time, completedAt: time.nullable() }).strict();
export const AssistantConversationOptionsResultSchema = z.object({
  identity: AssistantConversationPublicIdentitySchema,
  configuration: z.object({ revision: id, hash, name: z.string().max(60), enabled: z.boolean(), modelSlug: z.string().max(128), modelName: z.string().max(255).nullable(), vision: z.boolean().nullable() }).strict().nullable(),
  skills: z.array(z.object({ slug: z.string().max(128), name: z.string().max(255), version: id }).strict()).max(80),
  capabilities: z.object({ create: AssistantConversationCapabilitySchema, submit: AssistantConversationCapabilitySchema, cancel: AssistantConversationCapabilitySchema, upload: AssistantConversationCapabilitySchema, download: AssistantConversationCapabilitySchema, confirmRules: AssistantConversationCapabilitySchema }).strict(),
  executionKind: z.literal("conversation_only"), businessExecutionAvailable: z.literal(false), runtimeEnabled: z.boolean(),
}).strict();
export const AssistantConversationThreadResultSchema = z.object({ identity: AssistantConversationPublicIdentitySchema, thread: AssistantConversationPublicThreadSchema }).strict();
export const AssistantConversationThreadsResultSchema = z.object({ identity: AssistantConversationPublicIdentitySchema, items: z.array(AssistantConversationPublicThreadSchema).max(50), nextBeforeId: id.nullable() }).strict();
export const AssistantConversationHistoryResultSchema = z.object({ identity: AssistantConversationPublicIdentitySchema, thread: AssistantConversationPublicThreadSchema, items: z.array(AssistantConversationPublicTurnSchema).max(50), nextBeforeSequence: id.nullable(), runtimeEnabled: z.boolean() }).strict();
export const AssistantConversationOperationResultSchema = z.object({ identity: AssistantConversationPublicIdentitySchema, thread: AssistantConversationPublicThreadSchema, operation: AssistantConversationPublicTurnSchema.nullable(), reasonCode: z.enum(["OPERATION_UNKNOWN"]).nullable(), runtimeEnabled: z.boolean() }).strict();
export const AssistantConversationAttachmentsResultSchema = z.object({ identity: AssistantConversationPublicIdentitySchema, threadId: uuid, operationId: uuid, items: z.array(AssistantConversationAttachmentMetadataSchema).max(3) }).strict();
export const AssistantConversationAttachmentResultSchema = z.object({ identity: AssistantConversationPublicIdentitySchema, threadId: uuid, operationId: uuid, file: AssistantConversationAttachmentMetadataSchema, base64: z.string().min(4).max(4 * 1024 * 1024) }).strict();
export type AssistantConversationOptionsResult = z.infer<typeof AssistantConversationOptionsResultSchema>;
export type AssistantConversationPublicThread = z.infer<typeof AssistantConversationPublicThreadSchema>;
export type AssistantConversationPublicTurn = z.infer<typeof AssistantConversationPublicTurnSchema>;
export type AssistantConversationOperationResult = z.infer<typeof AssistantConversationOperationResultSchema>;
