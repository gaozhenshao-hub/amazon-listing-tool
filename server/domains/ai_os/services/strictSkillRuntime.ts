import { createHash } from "node:crypto";
import { z } from "zod";
/** Pure endpoint identity; credential resolution stays in teamorouterCatalog. */
export const TEAMOROUTER_OPENAI_BASE_URL = "https://api.teamorouter.cn/v1";
export const TEAMOROUTER_DIRECT_HOST = "api.teamorouter.cn";
export const TEAMOROUTER_LEGACY_SOCKS_HOST = "api.teamorouter.com";
export const TEAMOROUTER_CREDENTIAL_REF = "env:EXTERNAL_LLM_API_KEY";

/** Canonicalize only the retired Teamorouter OpenAI endpoint; leave all other providers untouched. */
export function canonicalizeTeamorouterOpenAiBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (url.hostname !== TEAMOROUTER_LEGACY_SOCKS_HOST) return baseUrl;
    url.hostname = TEAMOROUTER_DIRECT_HOST;
    return url.toString().replace(/\/$/, "");
  } catch {
    return baseUrl;
  }
}

/** Opt-in only. These are admission limits, not a tokenizer or a billing quote. */
export const STRICT_SKILL_LIMITS = Object.freeze({ textBytes: 1024 * 1024, imageCount: 3,
  imageBytes: 3 * 1024 * 1024, wireBytes: 14 * 1024 * 1024, responseBytes: 1024 * 1024,
  outputTokens: 32768, imageContextAllowance: 8192, messageOverheadAllowance: 1024 });
export class StrictSkillRuntimeError extends Error {
  readonly retryable = false;
  constructor(readonly code: string) { super(code); this.name = "StrictSkillRuntimeError"; }
}
export function strictRuntimeRefuse(code: string): never { throw new StrictSkillRuntimeError(code); }
export function strictRuntimeCanonical(value: unknown): string {
  let nodes = 0;
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > 100000 || depth > 40) return strictRuntimeRefuse("STRICT_RUNTIME_DATA_INVALID");
    if (item === null || typeof item === "boolean" || typeof item === "string") return item;
    if (typeof item === "number" && Number.isFinite(item) && !Object.is(item, -0)) return item;
    if (!item || typeof item !== "object" || (Object.getPrototypeOf(item) !== Object.prototype && !Array.isArray(item))) return strictRuntimeRefuse("STRICT_RUNTIME_DATA_INVALID");
    if (Object.getOwnPropertySymbols(item).length) return strictRuntimeRefuse("STRICT_RUNTIME_DATA_INVALID");
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(item) && key === "length") continue;
      if (!("value" in descriptor) || !descriptor.enumerable) return strictRuntimeRefuse("STRICT_RUNTIME_DATA_INVALID");
    }
    if (Array.isArray(item)) {
      if (Object.keys(descriptors).length !== item.length + 1) return strictRuntimeRefuse("STRICT_RUNTIME_DATA_INVALID");
      return item.map(child => visit(child, depth + 1));
    }
    return Object.fromEntries(Object.keys(descriptors).sort().map(key => [key, visit(descriptors[key].value, depth + 1)]));
  };
  const result = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(result) > STRICT_SKILL_LIMITS.wireBytes) return strictRuntimeRefuse("STRICT_RUNTIME_DATA_TOO_LARGE");
  return result;
}
export const strictRuntimeHash = (value: unknown) => createHash("sha256").update(strictRuntimeCanonical(value)).digest("hex");
const id = z.number().int().min(1).max(2147483647);
const name = z.string().min(1).max(256).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const rate = z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,12})?$/u).nullable();
const modelSchema = z.object({ workspaceId: id.nullable(), slug: name, provider: z.literal("custom"), modelId: name,
  baseUrl: z.string().min(1).max(2048), endpoint: z.string().min(1).max(2048),
  apiKeyRef: z.literal(TEAMOROUTER_CREDENTIAL_REF), isActive: z.literal(true),
  capabilityTags: z.array(name).max(100), maxContextTokens: z.number().int().min(1024).max(10000000),
  costPer1kInputTokens: rate, costPer1kOutputTokens: rate }).strict();
export const StrictRegisteredModelSnapshotSchema = z.object({ version: z.literal(1), workspaceId: id,
  model: modelSchema, configurationHash: hash }).strict().superRefine((value, ctx) => {
  if ((value.model.workspaceId !== null && value.model.workspaceId !== value.workspaceId)
    || value.configurationHash !== strictRuntimeHash({ version: value.version, workspaceId: value.workspaceId, model: value.model }))
    ctx.addIssue({ code: "custom", message: "STRICT_MODEL_SNAPSHOT_INVALID" });
});
export type StrictRegisteredModelSnapshot = z.infer<typeof StrictRegisteredModelSnapshotSchema>;
const decimal = (value: unknown) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") return strictRuntimeRefuse("STRICT_MODEL_CONFIGURATION_INVALID");
  const text = String(value);
  if (!rate.safeParse(text).success) return strictRuntimeRefuse("STRICT_MODEL_CONFIGURATION_INVALID");
  return text;
};
export function strictModelSnapshotFromRow(workspaceId: number, slug: string, raw: unknown): StrictRegisteredModelSnapshot {
  // Copy only enumerated registry configuration; the key VALUE is never accepted or returned.
  if (!id.safeParse(workspaceId).success || !name.safeParse(slug).success || !raw || typeof raw !== "object") return strictRuntimeRefuse("STRICT_MODEL_CONFIGURATION_INVALID");
  const row = raw as Record<string, unknown>;
  if (row.slug !== slug || row.provider !== "custom" || ![true, 1].includes(row.isActive as boolean | number)
    || row.apiKeyRef !== TEAMOROUTER_CREDENTIAL_REF || typeof row.baseUrl !== "string") return strictRuntimeRefuse("STRICT_MODEL_UNAVAILABLE");
  let endpoint: string;
  try {
    const url = new URL(canonicalizeTeamorouterOpenAiBaseUrl(row.baseUrl));
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return strictRuntimeRefuse("STRICT_MODEL_ENDPOINT_INVALID");
    endpoint = `${url.toString().replace(/\/$/, "")}/chat/completions`;
  } catch { return strictRuntimeRefuse("STRICT_MODEL_ENDPOINT_INVALID"); }
  let tags: unknown;
  try { tags = typeof row.capabilityTags === "string" ? JSON.parse(row.capabilityTags) : row.capabilityTags; }
  catch { return strictRuntimeRefuse("STRICT_MODEL_CONFIGURATION_INVALID"); }
  const parsed = modelSchema.safeParse({ workspaceId: row.workspaceId, slug, provider: row.provider, modelId: row.modelId,
    baseUrl: row.baseUrl, endpoint, apiKeyRef: row.apiKeyRef, isActive: true, capabilityTags: tags,
    maxContextTokens: row.maxContextTokens, costPer1kInputTokens: decimal(row.costPer1kInputTokens), costPer1kOutputTokens: decimal(row.costPer1kOutputTokens) });
  if (!parsed.success || new Set(parsed.data.capabilityTags).size !== parsed.data.capabilityTags.length
    || (parsed.data.workspaceId !== null && parsed.data.workspaceId !== workspaceId)) return strictRuntimeRefuse("STRICT_MODEL_CONFIGURATION_INVALID");
  const body = { version: 1 as const, workspaceId, model: parsed.data };
  return { ...body, configurationHash: strictRuntimeHash(body) };
}
export const StrictSkillStageSchema = z.enum(["route", "reply", "profit_analysis"]);
export type StrictSkillStage = z.infer<typeof StrictSkillStageSchema>;
/** Fixed server-owned audit identities. A stage is not authorization to run a
 * business Skill: callers still supply approved pins and the durable fence. */
export function strictSkillAuditIdentity(stage: StrictSkillStage) {
  if (!StrictSkillStageSchema.safeParse(stage).success) return strictRuntimeRefuse("STRICT_RUNTIME_OPTIONS_INVALID");
  return stage === "profit_analysis"
    ? { migrationSource: "ops.profit.private.strict", operation: "ops.profit.private.strict" } as const
    : { migrationSource: "assistant.private.strict", operation: "ai_os.assistant.private.strict" } as const;
}
export type StrictSkillDispatchReceipt = {
  runId: string; stage: StrictSkillStage; requestHash: string; modelConfigurationHash: string; bindingHash: string;
  budget: { textBytes: number; imageCount: number; imageBytes: number; contextAdmissionUnits: number;
    outputTokens: number; contextLimit: number; tokenEstimateIsExact: false };
};
export type StrictSkillExecutionOptions = {
  modelSnapshot: StrictRegisteredModelSnapshot;
  /** Server-owned hash of the complete approved business/Agent, rules and input snapshot. */
  bindingHash: string;
  stage: StrictSkillStage;
  expectedSkillModelOverride: string | null;
  expectedSkillTimeoutSeconds: number;
  /** Trusted per-stage spend admission; not an assertion of the provider's final bill. */
  maxCostCents: number;
  /** Images require an explicitly approved provider-specific admission policy. */
  imageBudget?: { policyId: string; maxInputTokensPerImage: number };
  beforeDispatch: (receipt: StrictSkillDispatchReceipt) => Promise<void>;
};
export function parseStrictExecutionOptions(raw: StrictSkillExecutionOptions): StrictSkillExecutionOptions {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype) return strictRuntimeRefuse("STRICT_RUNTIME_OPTIONS_INVALID");
  const descriptor = Object.getOwnPropertyDescriptor(raw, "beforeDispatch");
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") return strictRuntimeRefuse("STRICT_RUNTIME_OPTIONS_INVALID");
  const copied: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== "string") return strictRuntimeRefuse("STRICT_RUNTIME_OPTIONS_INVALID");
    const field = Object.getOwnPropertyDescriptor(raw, key)!;
    if (!("value" in field) || !field.enumerable) return strictRuntimeRefuse("STRICT_RUNTIME_OPTIONS_INVALID");
    if (key !== "beforeDispatch") copied[key] = field.value;
  }
  const schema = z.object({ modelSnapshot: StrictRegisteredModelSnapshotSchema, bindingHash: hash, stage: StrictSkillStageSchema,
    expectedSkillModelOverride: name.nullable(), expectedSkillTimeoutSeconds: z.number().int().min(5).max(600),
    maxCostCents: z.number().int().min(0).max(1000000000),
    imageBudget: z.object({ policyId: name, maxInputTokensPerImage: z.number().int().min(1).max(10000000) }).strict().optional() }).strict();
  const parsed = schema.safeParse(JSON.parse(strictRuntimeCanonical(copied)));
  if (!parsed.success) return strictRuntimeRefuse("STRICT_RUNTIME_OPTIONS_INVALID");
  return { ...parsed.data, beforeDispatch: descriptor.value };
}
export function strictCostUpperBound(snapshot: StrictRegisteredModelSnapshot, inputTokens: number, outputTokens: number): number {
  const rates = [snapshot.model.costPer1kInputTokens, snapshot.model.costPer1kOutputTokens];
  if (rates.some(value => value === null) || !Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)
    || inputTokens < 0 || outputTokens < 0) return strictRuntimeRefuse("STRICT_RUNTIME_PRICING_UNAVAILABLE");
  const scaled = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 10n ** 12n + BigInt(fraction.padEnd(12, "0")); };
  const numerator = BigInt(inputTokens) * scaled(rates[0]!) + BigInt(outputTokens) * scaled(rates[1]!);
  const denominator = 10n ** 13n; // Registry USD/1k tokens -> cents, rounded upwards.
  const cents = (numerator + denominator - 1n) / denominator;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return strictRuntimeRefuse("STRICT_RUNTIME_COST_BUDGET_EXCEEDED");
  return Number(cents);
}
export function strictSkillMessages(system: string, user: string, rawAttachments: unknown, snapshot: StrictRegisteredModelSnapshot, maxTokens: unknown, imageBudget?: StrictSkillExecutionOptions["imageBudget"]) {
  if (!Number.isSafeInteger(maxTokens) || Number(maxTokens) < 1 || Number(maxTokens) > STRICT_SKILL_LIMITS.outputTokens) return strictRuntimeRefuse("STRICT_RUNTIME_OUTPUT_BUDGET_INVALID");
  const textBytes = Buffer.byteLength(system) + Buffer.byteLength(user);
  if (textBytes > STRICT_SKILL_LIMITS.textBytes) return strictRuntimeRefuse("STRICT_RUNTIME_INPUT_TOO_LARGE");
  const attachments: Array<{ type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }> = [];
  const raw = rawAttachments ?? [];
  if (!Array.isArray(raw) || raw.length > STRICT_SKILL_LIMITS.imageCount) return strictRuntimeRefuse("STRICT_RUNTIME_ATTACHMENTS_INVALID");
  let imageBytes = 0;
  for (const item of raw) {
    const parsed = z.object({ type: z.literal("image_url"), image_url: z.object({ url: z.string().max(4200000), detail: z.enum(["auto", "low", "high"]).optional() }).strict() }).strict().safeParse(item);
    if (!parsed.success) return strictRuntimeRefuse("STRICT_RUNTIME_ATTACHMENTS_INVALID");
    const comma = parsed.data.image_url.url.indexOf(","), prefix = parsed.data.image_url.url.slice(0, comma), content = parsed.data.image_url.url.slice(comma + 1);
    if (!/^data:image\/(?:png|jpeg|webp|gif);base64$/u.test(prefix) || !content || content.length % 4 !== 0 || /[^A-Za-z0-9+/=]/u.test(content)) return strictRuntimeRefuse("STRICT_RUNTIME_ATTACHMENTS_INVALID");
    const bytes = Buffer.from(content, "base64");
    if (!bytes.length || bytes.length > STRICT_SKILL_LIMITS.imageBytes || bytes.toString("base64") !== content) return strictRuntimeRefuse("STRICT_RUNTIME_ATTACHMENTS_INVALID");
    imageBytes += bytes.length; attachments.push(parsed.data);
  }
  if (attachments.length && !snapshot.model.capabilityTags.includes("vision")) return strictRuntimeRefuse("STRICT_MODEL_VISION_REQUIRED");
  if (attachments.length && (!imageBudget || !name.safeParse(imageBudget.policyId).success || !Number.isSafeInteger(imageBudget.maxInputTokensPerImage)
    || imageBudget.maxInputTokensPerImage < 1 || imageBudget.maxInputTokensPerImage > snapshot.model.maxContextTokens)) return strictRuntimeRefuse("STRICT_RUNTIME_IMAGE_BUDGET_REQUIRED");
  // Conservative UTF-8-byte admission plus explicit image allowance, NOT exact tokens.
  const contextAdmissionUnits = textBytes + attachments.length * (imageBudget?.maxInputTokensPerImage ?? 0) + STRICT_SKILL_LIMITS.messageOverheadAllowance;
  if (contextAdmissionUnits + Number(maxTokens) > snapshot.model.maxContextTokens) return strictRuntimeRefuse("STRICT_RUNTIME_CONTEXT_BUDGET_EXCEEDED");
  const messages = [{ role: "system", content: system }, { role: "user", content: attachments.length ? [{ type: "text", text: user }, ...attachments] : user }];
  return { messages, budget: { textBytes, imageCount: attachments.length, imageBytes, contextAdmissionUnits,
    outputTokens: Number(maxTokens), contextLimit: snapshot.model.maxContextTokens, tokenEstimateIsExact: false as const } };
}
