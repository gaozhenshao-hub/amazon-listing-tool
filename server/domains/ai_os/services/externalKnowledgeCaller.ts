import { createHash, randomBytes } from "node:crypto";

export const EXTERNAL_KNOWLEDGE_CALLER_KIND = "external_knowledge_api";
export const EXTERNAL_KNOWLEDGE_SCOPES = ["stats", "search", "rag"] as const;
export type ExternalKnowledgeScope = (typeof EXTERNAL_KNOWLEDGE_SCOPES)[number];

export function createExternalKnowledgeCallerToken() {
  return `akb_${randomBytes(32).toString("base64url")}`;
}

export function hashExternalKnowledgeCallerToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseExternalKnowledgeCallerConfig(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
