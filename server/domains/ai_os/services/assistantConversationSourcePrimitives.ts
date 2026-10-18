import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { AgentLibraryKeySchema } from "../../../../shared/agentLibraryContracts";
import type { AssistantConfiguration } from "../../../../shared/assistantConfigurations";
import type { AssistantConversationContextSkill } from "./assistantConversationSourceTypes";

/** Pure existing fingerprints/admission only: no DB, environment, registry fetch,
 * model execution, singleton construction, or source approval occurs on import.
 * Original public modules re-export these same functions and error classes. */
export class AssistantConversationStorageError extends Error {
  constructor(public readonly code: string, public readonly conflict = false) { super(`ASSISTANT_CONVERSATION_${code}`); this.name = "AssistantConversationStorageError"; }
}
function storageRefuse(code: string): never { throw new AssistantConversationStorageError(code); }
export function assistantConversationCanonical(value: unknown, maxBytes = 1024 * 1024): string {
  const seen = new Set<object>(); let nodes = 0;
  function visit(item: unknown, depth: number): unknown {
    if (++nodes > 200000 || depth > 40) storageRefuse("JSON_LIMIT");
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item) && !Object.is(item, -0)) return item;
    if (!item || typeof item !== "object" || seen.has(item) || !Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) storageRefuse("JSON_INVALID");
    seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Reflect.ownKeys(item).some(key => typeof key !== "string") || Object.values(descriptors).some(descriptor => !("value" in descriptor))) storageRefuse("JSON_INVALID");
    const result = Array.isArray(item) ? item.map(child => visit(child, depth + 1)) : Object.fromEntries(Object.keys(item).sort().map(key => [key, visit(descriptors[key].value, depth + 1)]));
    if (Array.isArray(item) && (Object.keys(item).length !== item.length || Object.keys(item).some((key, index) => key !== String(index)))) storageRefuse("JSON_INVALID");
    seen.delete(item); return result;
  }
  const text = JSON.stringify(visit(value, 0)); if (Buffer.byteLength(text) > maxBytes) storageRefuse("JSON_LIMIT"); return text;
}

function configurationRefuse(message: string): never { throw new TRPCError({ code: "PRECONDITION_FAILED", message }); }
function configurationJson(value: unknown): unknown {
  try { return typeof value === "string" ? JSON.parse(value) : value; }
  catch { return configurationRefuse("ASSISTANT_DATA_INVALID"); }
}
/** Stable JSON for this validated JSON-only configuration; not an execution signature. */
export function canonicalConfigurationJson(value: AssistantConfiguration): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map(name => [name, sort((item as Record<string, unknown>)[name])])) : item;
  return JSON.stringify(sort(value));
}
export function configurationHash(value: AssistantConfiguration): string {
  return createHash("sha256").update(canonicalConfigurationJson(value)).digest("hex");
}
export function skillManifestHash(value: unknown): string {
  const manifest = configurationJson(value);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) configurationRefuse("ASSISTANT_SKILL_MANIFEST_INVALID");
  const sort = (item: unknown): unknown => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) return Object.fromEntries(Object.keys(item).sort().map(name => [name, sort((item as Row)[name])]));
    return configurationRefuse("ASSISTANT_SKILL_MANIFEST_INVALID");
  };
  return createHash("sha256").update(JSON.stringify(sort(manifest))).digest("hex");
}

type Row = Record<string, unknown>;
const id = z.number().int().min(1).max(2147483647), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value));
const imageBudgetSchema = z.object({ policyId: text(256), maxInputTokensPerImage: z.number().int().min(1).max(10_000_000) }).strict();
const pinSchema = z.object({
  id, workspaceId: id.nullable(), scope: text(32), slug: text(128), name: text(255), version: id, status: z.literal("Released"),
  manifestSha256: hash, manifestRawSha256: hash, systemPromptSha256: hash, userPromptSha256: hash,
  modelOverride: text(256).nullable(), timeoutSeconds: z.number().int().min(5).max(600),
  maxTokens: z.number().int().min(1).max(32768), temperature: z.number().min(0).max(2).nullable(), supportsJsonMode: z.boolean(),
}).strict();
export type AssistantConversationSkillPin = z.infer<typeof pinSchema>;
export const AssistantConversationSkillPinSchema = pinSchema;

/** Server-reviewed mapping only. Neither RPC data, a Released tag nor a seed
 * script is an approval. The mapping pins the complete registry row projection. */
export const AssistantConversationSourceApprovalSchema = z.object({
  workspaceId: id, agentKey: AgentLibraryKeySchema, purpose: z.enum(["route", "reply", "context"]),
  skillSlug: text(128), skillSnapshotHash: hash,
  source: z.object({ origin: z.enum(["qingdao", "user_listing", "reviewed_supplement"]), revision: text(256), approvalRef: text(512) }).strict(),
  inputContract: z.enum(["private_context_v1", "friend_route_v1", "friend_reply_v1", "context_only"]),
  outputContract: z.enum(["route_slug_v1", "route_skill_slug_v1", "reply_v1", "context_only"]),
  modelConfigurationHash: hash.nullable(), maxCostCents: z.number().int().min(0).max(1_000_000_000).nullable(),
  imageBudget: imageBudgetSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.purpose === "context" ? value.outputContract !== "context_only" || value.maxCostCents !== null || value.modelConfigurationHash !== null || value.imageBudget !== null
    : value.maxCostCents === null || value.modelConfigurationHash === null || (value.purpose === "reply" ? value.outputContract !== "reply_v1" : !value.outputContract.startsWith("route_")))
    context.addIssue({ code: "custom", message: "APPROVAL_CONTRACT_INVALID" });
  if (value.skillSlug.startsWith("listing.") && value.source.origin !== "user_listing")
    context.addIssue({ code: "custom", message: "LISTING_SOURCE_MUST_BE_USER" });
  if (value.purpose === "context" ? value.inputContract !== "context_only"
    : value.inputContract === "context_only" || value.purpose === "route" && value.inputContract === "friend_reply_v1" || value.purpose === "reply" && value.inputContract === "friend_route_v1")
    context.addIssue({ code: "custom", message: "APPROVAL_INPUT_CONTRACT_INVALID" });
});
export type AssistantConversationSourceApproval = z.infer<typeof AssistantConversationSourceApprovalSchema>;

export class AssistantConversationRuntimeError extends Error {
  constructor(readonly code: string) { super(`ASSISTANT_CONVERSATION_${code}`); this.name = "AssistantConversationRuntimeError"; }
}
function fail(code: string): never { throw new AssistantConversationRuntimeError(code); }
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown, maxBytes = 512 * 1024) => assistantConversationCanonical(value, maxBytes);
const digest = (value: unknown, maxBytes?: number) => sha(canonical(value, maxBytes));
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(JSON.parse(canonical(value)));
  if (!result.success) return fail("RUNTIME_SNAPSHOT_INVALID");
  return result.data;
}


export type AssistantConversationRegistrySkill = { pin: AssistantConversationSkillPin; context: AssistantConversationContextSkill; manifest: Record<string, unknown>; systemPrompt: string; userPrompt: string };

/** Pure registry fingerprint used by both live admission and offline source
 * comparison. This does NOT approve a source or make a shared row global. */
export function assistantConversationSkillSnapshotFromRow(raw: unknown): AssistantConversationRegistrySkill {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("SKILL_UNAVAILABLE");
  const row = raw as Row;
  let manifest: unknown;
  try { manifest = typeof row.manifest === "string" ? JSON.parse(row.manifest) : row.manifest; canonical(manifest, 256 * 1024); }
  catch { return fail("SKILL_UNAVAILABLE"); }
  const schema = z.object({ implementation: z.object({ systemPrompt: z.string().min(1), userPromptTemplate: z.string().optional(), maxTokens: z.number().int().min(1).max(32768).optional(), temperature: z.number().min(0).max(2).optional(), supportsJsonMode: z.boolean().optional() }).passthrough() }).passthrough();
  const result = schema.safeParse(manifest);
  if (!result.success) fail("SKILL_UNAVAILABLE");
  const implementation = result.data.implementation;
  const pin = parsed(pinSchema, { id: row.id, workspaceId: row.workspaceId, scope: row.scope, slug: row.slug, name: row.name, version: row.version, status: row.status,
    manifestSha256: skillManifestHash(manifest), manifestRawSha256: sha(JSON.stringify(manifest)), systemPromptSha256: sha(implementation.systemPrompt), userPromptSha256: sha(implementation.userPromptTemplate ?? ""),
    modelOverride: row.modelOverride || null, timeoutSeconds: Number(row.timeout_seconds || 120), maxTokens: implementation.maxTokens ?? 4096, temperature: implementation.temperature ?? null, supportsJsonMode: implementation.supportsJsonMode ?? false });
  return { pin, context: { workspaceId: pin.workspaceId, scope: pin.scope, slug: pin.slug, name: pin.name, version: pin.version, status: pin.status, manifest }, manifest: manifest as Record<string, unknown>, systemPrompt: implementation.systemPrompt, userPrompt: implementation.userPromptTemplate || "{{context}}" };
}
export function assistantConversationSkillSnapshotHash(pin: AssistantConversationSkillPin): string {
  return digest(parsed(pinSchema, pin));
}
export function assistantConversationSkillScopeMatches(pin: AssistantConversationSkillPin, workspaceId: number, slug: string): boolean {
  return pin.slug === slug && (pin.workspaceId === workspaceId || pin.workspaceId === null && pin.scope === "global");
}
