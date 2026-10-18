import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { AgentLibraryKeySchema } from "../../../../shared/agentLibraryContracts";
import { AssistantConfigurationSchema, AssistantDigestSchema, AssistantRevisionSchema } from "../../../../shared/assistantConfigurations";
import {
  ASSISTANT_CONVERSATION_LIMITS, AssistantConversationSubmitInputSchema,
  planAssistantConversation, validateAssistantConversationRoute, type AssistantConversationStage,
} from "../../../../shared/assistantConversation";
import { configurationHash, skillManifestHash } from "./assistantConfigurations";
import type { ParsedAssistantConversationAttachment } from "./assistantConversationAttachments";
import { assistantConversationRequestHash } from "../repositories/assistantConversations";

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const IdentitySchema = z.object({
  workspaceId: AssistantRevisionSchema, userId: AssistantRevisionSchema,
  agentKey: AgentLibraryKeySchema, threadId: uuid,
}).strict();
export type AssistantConversationIdentity = z.infer<typeof IdentitySchema>;
const HistoryDocumentSchema = z.object({
  name: z.string().min(1).max(180), sha256: AssistantDigestSchema,
  sizeBytes: z.number().int().min(1).max(ASSISTANT_CONVERSATION_LIMITS.fileBytes),
  mime: z.string().min(1).max(128).refine(value => !value.startsWith("image/")),
  extractedText: z.string().refine(value => Array.from(value).length <= ASSISTANT_CONVERSATION_LIMITS.extractedCharacters),
  // Exact parser metadata from the private attachment snapshot. It remains
  // untrusted data; no coverage label confers execution authority.
  coverage: z.record(z.string(), z.unknown()),
  warnings: z.array(z.object({ code: z.string().max(100), message: z.string().max(1000) }).strict()).max(100),
}).strict();
const HistorySchema = IdentitySchema.extend({
  operationId: uuid, sequence: AssistantRevisionSchema, status: z.literal("succeeded"),
  message: z.string().min(1).max(ASSISTANT_CONVERSATION_LIMITS.messageCharacters),
  reply: z.string().min(1).max(64_000),
  // Only current-turn image bytes are sent. This count makes the omission visible.
  imageCount: z.number().int().min(0).max(ASSISTANT_CONVERSATION_LIMITS.files),
  documents: z.array(HistoryDocumentSchema).max(ASSISTANT_CONVERSATION_LIMITS.files),
}).strict().refine(value => value.imageCount + value.documents.length <= ASSISTANT_CONVERSATION_LIMITS.files);
export type AssistantConversationHistoryContext = z.infer<typeof HistorySchema>;
const SavedConfigurationSchema = z.object({
  workspaceId: AssistantRevisionSchema, agentKey: AgentLibraryKeySchema,
  revision: AssistantRevisionSchema, hash: AssistantDigestSchema, config: AssistantConfigurationSchema,
}).strict();
export type AssistantConversationSavedConfiguration = z.infer<typeof SavedConfigurationSchema>;
export type AssistantConversationContextSkill = {
  workspaceId: number | null; scope: string; slug: string; name: string;
  version: number; status: string; manifest: unknown;
};

function fail(code: string): never { throw new Error(`ASSISTANT_CONVERSATION_${code}`); }
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function canonicalContext(value: unknown): string {
  const seen = new Set<object>(); let nodes = 0;
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > 100_000 || depth > 40) return fail("CONTEXT_TOO_LARGE");
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (!item || typeof item !== "object" || seen.has(item)
      || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)) return fail("CONTEXT_INVALID");
    const fields = Object.getOwnPropertyDescriptors(item);
    if (Object.getOwnPropertySymbols(item).length || Object.values(fields).some(field => !("value" in field))) return fail("CONTEXT_INVALID");
    seen.add(item);
    const result = Array.isArray(item) ? item.map(child => visit(child, depth + 1))
      : Object.fromEntries(Object.keys(item).sort().map(key => [key, visit(fields[key].value, depth + 1)]));
    seen.delete(item); return result;
  };
  const result = JSON.stringify(visit(value, 0));
  // Reject oversized contexts explicitly; never silently truncate documents or history.
  if (Buffer.byteLength(result) > 2 * 1024 * 1024) fail("CONTEXT_TOO_LARGE");
  return result;
}
function sameIdentity(left: AssistantConversationIdentity, right: AssistantConversationIdentity) {
  return left.workspaceId === right.workspaceId && left.userId === right.userId
    && left.agentKey === right.agentKey && left.threadId === right.threadId;
}

/** Build the exact private input snapshot, NOT an authorization grant or Skill
 * approval. Callers must resolve trusted registry/configuration rows, check the
 * authenticated identity, and atomically save this hash with their durable turn. */
export function buildAssistantConversationContext(input: {
  identity: AssistantConversationIdentity;
  request: z.input<typeof AssistantConversationSubmitInputSchema>;
  savedConfiguration: AssistantConversationSavedConfiguration;
  stage: AssistantConversationStage;
  history: AssistantConversationHistoryContext[];
  hasOlderHistory: boolean;
  attachments: ParsedAssistantConversationAttachment[];
  routeResult?: unknown;
  selectedSkill?: AssistantConversationContextSkill | null;
}) {
  const identity = IdentitySchema.parse(input.identity);
  const request = AssistantConversationSubmitInputSchema.parse(input.request);
  if (request.expectedWorkspaceId !== identity.workspaceId || request.agentKey !== identity.agentKey || request.threadId !== identity.threadId) fail("IDENTITY_MISMATCH");
  const saved = SavedConfigurationSchema.parse(input.savedConfiguration);
  // Persisted configuration must not be silently normalized or swapped between
  // displaying the options and submitting a request.
  if (!isDeepStrictEqual(saved, input.savedConfiguration) || configurationHash(saved.config) !== saved.hash
    || saved.workspaceId !== identity.workspaceId || saved.agentKey !== identity.agentKey
    || saved.revision !== request.expectedConfiguration.revision || saved.hash !== request.expectedConfiguration.hash) fail("CONFIGURATION_STALE");
  if (!saved.config.enabled || !saved.config.modelSlug) fail("CONFIGURATION_NOT_EXECUTABLE");

  const plan = planAssistantConversation(request.mode, request.selection, saved.config.skills.filter(skill => skill.enabled).map(skill => skill.slug));
  const stage = z.enum(["route", "reply"]).parse(input.stage);
  if (!plan.stages.includes(stage)) fail("STAGE_NOT_PLANNED");
  const selectedSlug = stage === "route" ? null : plan.selectedSkillSlug
    ?? (plan.stages.includes("route") ? validateAssistantConversationRoute(input.routeResult, plan.automaticCandidates) : null);
  let selectedSkillContext: { slug: string; name: string; version: number; manifestSha256: string; systemPrompt: string; userPromptTemplate: string } | null = null;
  if (selectedSlug !== null) {
    const skill = input.selectedSkill, binding = saved.config.skills.find(item => item.enabled && item.slug === selectedSlug);
    if (!skill || !binding || skill.slug !== selectedSlug || skill.status !== "Released" || skill.version !== binding.version
      || !(skill.workspaceId === identity.workspaceId || (skill.workspaceId === null && skill.scope === "global"))
      || skillManifestHash(skill.manifest) !== binding.manifestSha256) fail("SKILL_SNAPSHOT_MISMATCH");
    const manifest: unknown = typeof skill.manifest === "string" ? JSON.parse(skill.manifest) : skill.manifest;
    const parsed = z.object({ implementation: z.object({ systemPrompt: z.string().min(1), userPromptTemplate: z.string().optional() }) }).parse(manifest);
    selectedSkillContext = {
      slug: skill.slug, name: z.string().min(1).max(255).parse(skill.name), version: skill.version,
      manifestSha256: binding.manifestSha256, systemPrompt: parsed.implementation.systemPrompt,
      userPromptTemplate: parsed.implementation.userPromptTemplate ?? "{{context}}",
    };
  } else if (input.selectedSkill) fail("UNEXPECTED_SKILL_SNAPSHOT");

  if (typeof input.hasOlderHistory !== "boolean") fail("HISTORY_INVALID");
  const history = input.history.map(row => HistorySchema.parse(row));
  if (history.some(row => !sameIdentity(row, identity) || row.operationId === request.operationId)) fail("HISTORY_SCOPE_MISMATCH");
  if (new Set(history.map(row => row.sequence)).size !== history.length || new Set(history.map(row => row.operationId)).size !== history.length) fail("HISTORY_DUPLICATE");
  const included = [...history].sort((left, right) => right.sequence - left.sequence).slice(0, ASSISTANT_CONVERSATION_LIMITS.contextTurns).reverse();
  const coverage = {
    includedOperationIds: included.map(row => row.operationId), includedTurns: included.length,
    hasOlderTurns: input.hasOlderHistory || history.length > included.length,
    maxTurns: ASSISTANT_CONVERSATION_LIMITS.contextTurns,
    historyImages: "reattach_required" as const,
    omittedHistoryImages: included.reduce((sum, row) => sum + row.imageCount, 0),
    historyDocuments: "stored_extracted_text" as const,
    includedHistoryDocuments: included.reduce((sum, row) => sum + row.documents.length, 0),
  };

  if (input.attachments.length !== request.files.length || input.attachments.length > ASSISTANT_CONVERSATION_LIMITS.files) fail("ATTACHMENTS_MISMATCH");
  const attachmentDescriptors = input.attachments.map((file, index) => {
    const requestFile = request.files[index];
    if (!Buffer.isBuffer(file.originalBytes) || file.originalBytes.length !== file.sizeBytes || file.sizeBytes < 1
      || file.sizeBytes > ASSISTANT_CONVERSATION_LIMITS.fileBytes || hash(file.originalBytes) !== file.sha256
      || file.name !== requestFile.name || file.originalBytes.toString("base64") !== requestFile.base64) fail("ATTACHMENTS_MISMATCH");
    if ((file.kind === "image" && (!file.image || file.extractedText !== null || !file.mime.startsWith("image/")))
      || (file.kind === "document" && (file.image !== null || typeof file.extractedText !== "string" || Array.from(file.extractedText).length > ASSISTANT_CONVERSATION_LIMITS.extractedCharacters))) fail("ATTACHMENTS_MISMATCH");
    return {
      name: file.name, sha256: file.sha256, sizeBytes: file.sizeBytes, mime: file.mime, kind: file.kind,
      coverage: file.coverage, warnings: file.warnings, modelContext: file.modelContext,
      extractedText: file.extractedText,
    };
  });
  const images = input.attachments.filter(file => file.kind === "image").map(file => ({
    type: "image_url" as const, image_url: { url: `data:${file.mime};base64,${file.originalBytes.toString("base64")}` },
  }));
  // Input names, documents, history and model-produced replies are data, never
  // instructions. The approved route/reply Skill is responsible for interpretation.
  const envelope = {
    schema: "assistant-private-context/v1", identity, operationId: request.operationId,
    mode: request.mode, stage, executionKind: plan.executionKind, businessSkillDispatched: false,
    configuration: { revision: saved.revision, hash: saved.hash, modelSlug: saved.config.modelSlug, instructions: saved.config.instructions, rules: saved.config.rules },
    enabledBindings: saved.config.skills.filter(skill => skill.enabled),
    selectedSkillContext,
    untrustedInput: {
      message: request.message,
      history: included.map(row => ({ operationId: row.operationId, sequence: row.sequence, message: row.message, reply: row.reply, documents: row.documents })),
      attachments: attachmentDescriptors,
    },
    coverage,
  };
  const context = canonicalContext(envelope);
  // Request identity does not depend on moving history/model output. It binds
  // exactly the user's request, configuration precondition and original files.
  const requestSnapshot = {
    ...request,
    files: attachmentDescriptors.map(({ name, sha256, sizeBytes }) => ({ name, sha256, sizeBytes })),
  };
  const requestHash = assistantConversationRequestHash({ workspaceId: identity.workspaceId, userId: identity.userId }, {
    operationId: request.operationId, threadId: request.threadId, expectedThreadVersion: request.expectedThreadVersion,
    mode: request.mode, request: requestSnapshot, configuration: null, runtime: null,
    attachments: input.attachments.map(file => ({
      fileName: file.name, mimeType: file.mime, bytes: file.originalBytes, contentHash: file.sha256,
      extraction: { kind: file.kind, image: file.image, extractedText: file.extractedText, coverage: file.coverage, warnings: file.warnings, modelContext: file.modelContext },
    })),
  });
  return { context, contextHash: hash(context), requestHash, requestSnapshot, images, coverage, plan, selectedSkillSlug: selectedSlug };
}
