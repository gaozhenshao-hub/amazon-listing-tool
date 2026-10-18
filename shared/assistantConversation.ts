import { z } from "zod";
import { AgentLibraryKeySchema, AgentLibraryRulesSchema } from "./agentLibraryContracts";
import { AssistantDigestSchema, AssistantRevisionSchema } from "./assistantConfigurations";

/** Private conversation protocol. Importing it does not enable an Agent or a worker. */
export const ASSISTANT_CONVERSATION_LIMITS = {
  titleCharacters: 80,
  messageCharacters: 8_000,
  files: 3,
  fileBytes: 3 * 1024 * 1024,
  fileBase64Characters: 4 * 1024 * 1024,
  imagePixels: 30_000_000,
  archiveExpandedBytes: 20 * 1024 * 1024,
  archiveEntries: 1_000,
  pdfPages: 30,
  workbookSheets: 5,
  sheetRows: 300,
  extractedCharacters: 40_000,
  contextTurns: 6,
  pageSize: 50,
} as const;

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const slug = z.string().trim().min(1).max(128);
export const AssistantConversationModeSchema = z.enum(["work", "coach"]);
export type AssistantConversationMode = z.infer<typeof AssistantConversationModeSchema>;
export const AssistantConversationSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("automatic") }).strict(),
  z.object({ kind: z.literal("explicit"), skillSlug: slug }).strict(),
]);
export type AssistantConversationSelection = z.infer<typeof AssistantConversationSelectionSchema>;

// expectedWorkspaceId is only a freshness precondition. An authenticated server
// context supplies the actual workspace/user; these requests cannot supply userId.
const scope = z.object({ expectedWorkspaceId: AssistantRevisionSchema, agentKey: AgentLibraryKeySchema }).strict();
export const AssistantConversationThreadInputSchema = scope.extend({ threadId: uuid }).strict();
export const AssistantConversationCreateThreadInputSchema = AssistantConversationThreadInputSchema.extend({
  title: z.string().trim().min(1).max(ASSISTANT_CONVERSATION_LIMITS.titleCharacters),
}).strict();
export const AssistantConversationThreadsInputSchema = scope.extend({
  beforeId: AssistantRevisionSchema.optional(),
  limit: z.number().int().min(1).max(ASSISTANT_CONVERSATION_LIMITS.pageSize).default(20),
}).strict();
export const AssistantConversationHistoryInputSchema = AssistantConversationThreadInputSchema.extend({
  beforeSequence: AssistantRevisionSchema.optional(),
  limit: z.number().int().min(1).max(ASSISTANT_CONVERSATION_LIMITS.pageSize).default(20),
}).strict();
export const AssistantConversationFileInputSchema = z.object({
  name: z.string().trim().min(1).max(180),
  // Actual canonical base64, signatures, decompression and byte limits are checked
  // by the server parser. Length validation here is not a MIME/security verdict.
  base64: z.string().min(4).max(ASSISTANT_CONVERSATION_LIMITS.fileBase64Characters),
}).strict();
export const AssistantConversationSubmitInputSchema = AssistantConversationThreadInputSchema.extend({
  operationId: uuid,
  expectedThreadVersion: AssistantRevisionSchema,
  expectedConfiguration: z.object({ revision: AssistantRevisionSchema, hash: AssistantDigestSchema }).strict(),
  mode: AssistantConversationModeSchema,
  selection: AssistantConversationSelectionSchema,
  message: z.string().trim().min(1).max(ASSISTANT_CONVERSATION_LIMITS.messageCharacters),
  files: z.array(AssistantConversationFileInputSchema).max(ASSISTANT_CONVERSATION_LIMITS.files),
}).strict();
export const AssistantConversationOperationInputSchema = AssistantConversationThreadInputSchema.extend({ operationId: uuid }).strict();
export const AssistantConversationConfirmRulesInputSchema = AssistantConversationOperationInputSchema.extend({
  confirmationId: uuid,
  expectedProposalHash: AssistantDigestSchema,
  expectedConfigurationRevision: AssistantRevisionSchema,
  expectedConfigurationHash: AssistantDigestSchema,
  rules: AgentLibraryRulesSchema,
  confirmSharedScope: z.literal(true),
  confirmClearAll: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.confirmationId === value.operationId) context.addIssue({ code: "custom", path: ["confirmationId"], message: "Confirmation requires a distinct operation UUID" });
  if (value.rules.length === 0 && !value.confirmClearAll) context.addIssue({ code: "custom", path: ["confirmClearAll"], message: "Clearing all shared rules requires explicit confirmation" });
});

export const ASSISTANT_CONVERSATION_STATES = [
  "queued", "route_dispatched", "route_ready", "reply_dispatched", "reply_ready",
  "succeeded", "failed", "canceled", "unknown",
] as const;
export const AssistantConversationStateSchema = z.enum(ASSISTANT_CONVERSATION_STATES);
export type AssistantConversationState = z.infer<typeof AssistantConversationStateSchema>;
export type AssistantConversationStage = "route" | "reply";

const transitions: Readonly<Record<AssistantConversationState, readonly AssistantConversationState[]>> = {
  queued: ["route_dispatched", "reply_dispatched", "failed", "canceled"],
  route_dispatched: ["route_ready", "failed", "canceled", "unknown"],
  route_ready: ["reply_dispatched", "failed", "canceled"],
  reply_dispatched: ["reply_ready", "failed", "canceled", "unknown"],
  reply_ready: ["succeeded", "failed", "canceled"],
  succeeded: [], failed: [], canceled: [], unknown: ["canceled"],
};

/** SQL lease/CAS enforcement is still required; this pure function grants no authority. */
export function canTransitionAssistantConversation(from: AssistantConversationState, to: AssistantConversationState): boolean {
  return transitions[AssistantConversationStateSchema.parse(from)].includes(AssistantConversationStateSchema.parse(to));
}

/** A dispatched stage without a durable result must NEVER be called again. */
export function assistantConversationLeaseRecovery(state: AssistantConversationState): "claim" | "mark_unknown" | "none" {
  switch (AssistantConversationStateSchema.parse(state)) {
    case "queued": case "route_ready": case "reply_ready": return "claim";
    case "route_dispatched": case "reply_dispatched": return "mark_unknown";
    default: return "none";
  }
}

export type AssistantConversationExecutionPlan = {
  executionKind: "conversation_only";
  mode: AssistantConversationMode;
  stages: readonly AssistantConversationStage[];
  maxProviderCalls: 1 | 2;
  selectedSkillSlug: string | null;
  automaticCandidates: readonly string[];
  businessSkillDispatched: false;
};

/** Preserves the friend's route→reply behavior. A selected Skill supplies
 * conversation context only; business dispatch remains a separate capability. */
export function planAssistantConversation(
  mode: AssistantConversationMode,
  selection: AssistantConversationSelection,
  enabledSkillSlugs: readonly string[],
): AssistantConversationExecutionPlan {
  const parsedMode = AssistantConversationModeSchema.parse(mode);
  const parsedSelection = AssistantConversationSelectionSchema.parse(selection);
  const candidates = z.array(slug).max(80).parse(enabledSkillSlugs);
  if (new Set(candidates).size !== candidates.length) throw new Error("ASSISTANT_CONVERSATION_DUPLICATE_SKILL");
  if (parsedSelection.kind === "explicit" && !candidates.includes(parsedSelection.skillSlug)) {
    throw new Error("ASSISTANT_CONVERSATION_SKILL_NOT_ENABLED");
  }
  const route = parsedMode === "work" && parsedSelection.kind === "automatic" && candidates.length > 0;
  return Object.freeze({
    executionKind: "conversation_only",
    mode: parsedMode,
    stages: Object.freeze(route ? ["route", "reply"] as const : ["reply"] as const),
    maxProviderCalls: route ? 2 : 1,
    selectedSkillSlug: parsedSelection.kind === "explicit" ? parsedSelection.skillSlug : null,
    automaticCandidates: Object.freeze(route ? [...candidates] : []),
    businessSkillDispatched: false,
  });
}

/** Strict output schema: no model-produced rule can become persistent authority
 * without the separate human confirmation/configuration-CAS operation. */
export const AssistantConversationReplySchema = z.object({
  reply: z.string().trim().min(1).max(64_000),
  proposedRules: AgentLibraryRulesSchema.nullable(),
}).strict();

export function validateAssistantConversationReply(mode: AssistantConversationMode, value: unknown) {
  const result = AssistantConversationReplySchema.parse(value);
  if (AssistantConversationModeSchema.parse(mode) === "work" && result.proposedRules !== null) {
    throw new Error("ASSISTANT_CONVERSATION_WORK_RULE_PROPOSAL_FORBIDDEN");
  }
  return result;
}

export function validateAssistantConversationRoute(value: unknown, candidates: readonly string[]): string | null {
  const result = z.object({ skillSlug: slug.nullable() }).strict().parse(value);
  if (result.skillSlug !== null && !candidates.includes(result.skillSlug)) throw new Error("ASSISTANT_CONVERSATION_ROUTE_NOT_ENABLED");
  return result.skillSlug;
}
