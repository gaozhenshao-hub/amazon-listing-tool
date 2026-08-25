import { createHash } from "node:crypto";
import { estimateAgentContextTokens, fitValueToTokenBudget, summarizeContextValue, trimContextValueWithOptions } from "./agentRunner/artifactStore";

export type ConversationContextAttachment = {
  attachmentId?: string | null;
  artifactId?: string | null;
  fileName: string;
  mimeType: string;
  contextPolicy: "summary_only" | "extracted_text" | "image_vision";
  contextSummary?: string | null;
};

export type ConversationKnowledgeReference = {
  referenceId: string;
  sourceKind: "emperor_memory" | "amz_ops_skill";
  title: string;
  contextSummary: string;
  tags?: unknown;
};

export type ConversationContextCompilation = {
  version: "1.0";
  context: Record<string, unknown>;
  contextText: string;
  sourceCount: number;
  estimatedTokens: number;
  maxTokens: number;
  policyHash: string;
  manifest: Record<string, unknown>;
};

const MAX_CONTEXT_TOKENS = 8_000;
const MAX_SUMMARY_CHARS = 2_000;

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeTags(value: unknown) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").slice(0, 20).sort();
  if (typeof value !== "string") return [];
  try { return normalizeTags(JSON.parse(value)); } catch { return []; }
}

function normalizedSummary(value: unknown, path: string, stats: { truncatedFields: string[]; summarizedFields: string[]; resolvedArtifactRefs: string[] }) {
  return summarizeContextValue(String(value || ""), MAX_SUMMARY_CHARS, path, stats);
}

export function compileConversationContext(input: {
  goal?: string | null;
  explicitContext?: string | null;
  attachments?: ConversationContextAttachment[];
  knowledgeReferences?: ConversationKnowledgeReference[];
  maxTokens?: number;
}): ConversationContextCompilation {
  const maxTokens = Math.min(Math.max(input.maxTokens || MAX_CONTEXT_TOKENS, 1_000), 32_000);
  const stats = { truncatedFields: [] as string[], summarizedFields: [] as string[], resolvedArtifactRefs: [] as string[] };
  const attachments = (input.attachments || [])
    .map((item) => ({
      attachmentId: item.attachmentId || null,
      artifactId: item.artifactId || null,
      fileName: String(item.fileName || "未命名附件").slice(0, 255),
      mimeType: String(item.mimeType || "application/octet-stream").slice(0, 128),
      contextPolicy: item.contextPolicy,
      contextSummary: normalizedSummary(item.contextSummary, "attachments.contextSummary", stats),
    }))
    .sort((left, right) => `${left.attachmentId || ""}:${left.fileName}`.localeCompare(`${right.attachmentId || ""}:${right.fileName}`));
  const knowledgeReferences = (input.knowledgeReferences || [])
    .map((item) => ({
      referenceId: String(item.referenceId),
      sourceKind: item.sourceKind,
      title: String(item.title || "未命名知识").slice(0, 255),
      contextSummary: normalizedSummary(item.contextSummary, "knowledgeReferences.contextSummary", stats),
      tags: normalizeTags(item.tags),
    }))
    .sort((left, right) => left.referenceId.localeCompare(right.referenceId));
  const policy = {
    name: "conversation.context_compiler",
    version: "1.0",
    maxTokens,
    attachmentPolicy: "artifact_reference_and_summary_only",
    knowledgePolicy: "authorized_summary_only",
    ordering: "attachment_id_then_reference_id",
  };
  const source = {
    userGoal: normalizedSummary(input.goal, "goal", stats),
    explicitContext: normalizedSummary(input.explicitContext, "explicitContext", stats),
    attachments,
    knowledgeReferences,
  };
  const trimmed = trimContextValueWithOptions(source, {
    maxStringLength: MAX_SUMMARY_CHARS,
    maxArrayItems: 80,
    maxObjectKeys: 80,
    path: "conversationContext",
    stats,
  });
  const context = fitValueToTokenBudget(trimmed, maxTokens, "conversationContext", stats) as Record<string, unknown>;
  const estimatedTokens = estimateAgentContextTokens(context);
  const policyHash = hash(policy);
  return {
    version: "1.0",
    context,
    contextText: JSON.stringify(context),
    sourceCount: attachments.length + knowledgeReferences.length,
    estimatedTokens,
    maxTokens,
    policyHash,
    manifest: {
      schema: "conversation.context_package",
      version: "1.0",
      policy,
      policyHash,
      sourceCount: attachments.length + knowledgeReferences.length,
      estimatedTokens,
      maxTokens,
      truncatedFields: stats.truncatedFields,
      summarizedFields: stats.summarizedFields,
      context,
    },
  };
}
