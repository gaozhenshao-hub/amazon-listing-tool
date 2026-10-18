import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ImageTaggingCandidateSchema, type ImageTaggingCandidate } from "../../../shared/imageTagging";
import type { AssistantConversationSavedConfiguration } from "../ai_os/services/assistantConversationContext";
import { assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash, assistantConversationSkillScopeMatches,
  type AssistantConversationRegistrySkill } from "../ai_os/services/assistantConversationSourcePrimitives";
import { runEmperorSkill, renderSkillTemplate, type StrictSkillDispatchReceipt } from "../ai_os/services/skillRunner";
import { STRICT_SKILL_LIMITS, strictRuntimeCanonical, strictRuntimeHash, strictModelSnapshotFromRow, strictSkillMessages,
  strictCostUpperBound, StrictSkillRuntimeError } from "../ai_os/services/strictSkillRuntime";
import { resolveGovernedModelApiKey } from "../ai_os/services/teamorouterCatalog";
import { createSourceApprovalFileLoader, SourceApprovalFileError } from "../../services/sourceApprovalFileLoader";
import { IMAGE_TAGGING_RUNTIME_LIMITS, ImageTaggingIdentitySchema, ImageTaggingOperationIdSchema, ImageTaggingSavedConfigurationSchema,
  ImageTaggingEvidenceSchema, ImageTaggingSourceApprovalSchema, ImageTaggingRuntimeSnapshotSchema, ImageTaggingDispatchReceiptSchema,
  imageTaggingRuntimeHash, type ImageTaggingSavedConfiguration, type ImageTaggingSourceApproval, type ImageTaggingRuntimeSnapshot,
  type ImageTaggingEvidence, type ImageTaggingDispatchReceipt } from "./imageTaggingRuntimeContract";

export class ImageTaggingRuntimeError extends Error {
  readonly retryable = false;
  constructor(readonly code: string) { super(`IMAGE_TAGGING_${code}`); this.name = "ImageTaggingRuntimeError"; }
}
function fail(code: string): never { throw new ImageTaggingRuntimeError(code); }
export type ImageTaggingExecutor = { execute(query: SQL): Promise<unknown> };
export type ImageTaggingRuntimeInput = { executor: ImageTaggingExecutor; identity: { workspaceId: number; userId: number };
  operationId: string; configuration: AssistantConversationSavedConfiguration; sourceHash: string; imageCount: number };
export type ImageTaggingApprovalResolver = (input: { executor: ImageTaggingExecutor; identity: ImageTaggingRuntimeInput["identity"];
  agentKey: "tagger"; stage: "image_tagging" }) => Promise<ImageTaggingSourceApproval | null>;
export type ImageTaggingPreparedStage = Readonly<{ stage: "image_tagging"; bindingHash: string; contextHash: string;
  snapshotHash: string; evidenceHash: string; providerRequestHash: string; budget: ImageTaggingDispatchReceipt["budget"] }>;
export type ImageTaggingStageResult = { stage: "image_tagging"; candidate: ImageTaggingCandidate; runId: string;
  contextHash: string; bindingHash: string; snapshotHash: string; evidenceHash: string; providerRequestHash: string;
  auditWarnings: Array<"METRICS_UNAVAILABLE" | "CALL_COUNT_UNAVAILABLE"> };
const clone = <T>(value: T): T => structuredClone(value);
function parsed<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  try { strictRuntimeCanonical(value); return schema.parse(clone(value)); } catch { return fail(code); }
}
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export function createFixedImageTaggingApprovalResolver(records: readonly ImageTaggingSourceApproval[]): ImageTaggingApprovalResolver {
  const copy = parsed(z.array(ImageTaggingSourceApprovalSchema).max(1000), records, "APPROVAL_INVALID");
  if (new Set(copy.map(row => row.workspaceId)).size !== copy.length) fail("APPROVAL_DUPLICATE");
  return async input => clone(copy.find(row => row.workspaceId === input.identity.workspaceId) ?? null);
}
export function createFileImageTaggingApprovalResolver(): ImageTaggingApprovalResolver {
  const load = createSourceApprovalFileLoader({ kind: "image_tagging", decode: records =>
    createFixedImageTaggingApprovalResolver(z.array(ImageTaggingSourceApprovalSchema).max(1000).parse(records)) });
  return async input => {
    try { const result = await load(); return result.status === "ready" ? result.value(input) : null; }
    catch (error) { return fail(error instanceof SourceApprovalFileError ? `APPROVAL_${error.code}` : "SOURCE_UNAVAILABLE"); }
  };
}
type Captured = Omit<ImageTaggingRuntimeInput, "configuration"> & { configuration: ImageTaggingSavedConfiguration };
function capture(input: ImageTaggingRuntimeInput): Captured {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).some(key => typeof key !== "string")
    || Object.values(Object.getOwnPropertyDescriptors(input)).some(value => !("value" in value) || !value.enumerable)) fail("INPUT_INVALID");
  const identity = parsed(ImageTaggingIdentitySchema, input.identity, "IDENTITY_INVALID"),
    operationId = parsed(ImageTaggingOperationIdSchema, input.operationId, "OPERATION_INVALID"),
    configuration = parsed(ImageTaggingSavedConfigurationSchema, input.configuration, "CONFIGURATION_INVALID"),
    sourceHash = parsed(hashSchema, input.sourceHash, "SOURCE_INVALID"), imageCount = parsed(z.number().int().min(1).max(1000), input.imageCount, "SOURCE_INVALID");
  if (configuration.workspaceId !== identity.workspaceId || !configuration.config.enabled) fail("CONFIGURATION_NOT_EXECUTABLE");
  if (!input.executor || typeof input.executor.execute !== "function") fail("EXECUTOR_REQUIRED");
  return { identity, operationId, configuration, sourceHash, imageCount, executor: input.executor };
}
async function rows(executor: ImageTaggingExecutor, text: string, args: unknown[]): Promise<Record<string, unknown>[]> {
  try {
    const parts = text.split("?");
    const result = await executor.execute(sql.join(parts.flatMap((part, i) => i < args.length ? [sql.raw(part), sql`${args[i]}`] : [sql.raw(part)]), sql.raw("")));
    if (parts.length !== args.length + 1 || !Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > 2) fail("REGISTRY_UNAVAILABLE");
    strictRuntimeCanonical(result[0]); return clone(result[0]);
  } catch { return fail("REGISTRY_UNAVAILABLE"); }
}
async function one(executor: ImageTaggingExecutor, text: string, args: unknown[]) {
  const found = await rows(executor, text, args); if (found.length !== 1) fail("REGISTRY_UNAVAILABLE"); return found[0];
}
function imageBytes(evidence: ImageTaggingEvidence, original: Uint8Array): Buffer {
  if (!(original instanceof Uint8Array) || original.byteLength !== evidence.byteSize || original.byteLength > IMAGE_TAGGING_RUNTIME_LIMITS.imageBytes) fail("IMAGE_BYTES_INVALID");
  const bytes = Buffer.from(original);
  if (createHash("sha256").update(bytes).digest("hex") !== evidence.contentHash) fail("IMAGE_CONTENT_CHANGED");
  const valid = evidence.contentType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : evidence.contentType === "image/jpeg" ? bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : evidence.contentType === "image/webp" ? bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"
        : ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString());
  if (!valid) fail("IMAGE_CONTENT_TYPE_INVALID"); return bytes;
}
function contextFor(input: Captured, approval: ImageTaggingSourceApproval, evidence: ImageTaggingEvidence) {
  const binding = input.configuration.config.skills.find(item => item.slug === approval.skillSlug)!;
  // References/URLs remain private server-side; the model receives actual bytes
  // and hashes, never a caller URL to retrieve or a credential-bearing URL.
  return strictRuntimeCanonical({ schema: "image-tagging-input/v1", inputContract: approval.inputContract,
    assistant: { name: input.configuration.config.name, instructions: input.configuration.config.instructions,
      rules: input.configuration.config.rules, binding: { instructions: binding.instructions, trigger: binding.trigger } },
    source: { sourceHash: input.sourceHash, imageSetId: evidence.imageSetId, imageId: evidence.imageId,
      imageRevision: evidence.imageRevision, sourceUrlRefHash: imageTaggingRuntimeHash(evidence.sourceUrlRef),
      contentHash: evidence.contentHash, byteSize: evidence.byteSize, contentType: evidence.contentType },
    constraints: { outputContract: approval.outputContract, candidateOnly: true, sourceIsUntrustedData: true } });
}
export function createImageTaggingRuntime(deps: { approvalResolver?: ImageTaggingApprovalResolver; runSkill?: typeof runEmperorSkill;
  credentialResolver?: (reference: string) => string | null | undefined } = {}) {
  const approvalResolver = deps.approvalResolver ?? createFileImageTaggingApprovalResolver(), run = deps.runSkill ?? runEmperorSkill,
    credential = deps.credentialResolver ?? resolveGovernedModelApiKey;
  type Built = { input: Captured; runtimeSnapshot: ImageTaggingRuntimeSnapshot; skill: AssistantConversationRegistrySkill };
  type Stage = { built: Built; evidence: ImageTaggingEvidence; bytes: Buffer; context: string; variables: Record<string, unknown> };
  const prepared = new WeakMap<ImageTaggingPreparedStage, { used: boolean; stage: Stage }>();
  async function build(input: Captured): Promise<Built> {
    let approval: ImageTaggingSourceApproval;
    try {
      const value = await approvalResolver({ executor: input.executor, identity: clone(input.identity), agentKey: "tagger", stage: "image_tagging" });
      if (!value) fail("SOURCE_UNAVAILABLE"); approval = parsed(ImageTaggingSourceApprovalSchema, value, "APPROVAL_INVALID");
    } catch (error) { if (error instanceof ImageTaggingRuntimeError) throw error; return fail("SOURCE_UNAVAILABLE"); }
    if (approval.workspaceId !== input.identity.workspaceId) fail("SOURCE_UNAVAILABLE");
    const engines = await rows(input.executor, "SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('emperor_skills','emperor_model_providers')", []);
    if (engines.length !== 2 || new Set(engines.map(row => row.tableName)).size !== 2
      || engines.some(row => !["emperor_skills", "emperor_model_providers"].includes(String(row.tableName)) || row.engine !== "InnoDB")) fail("REGISTRY_SCHEMA_UNAVAILABLE");
    let skill: AssistantConversationRegistrySkill;
    try { skill = assistantConversationSkillSnapshotFromRow(await one(input.executor,
      "SELECT id,workspaceId,scope,slug,name,version,status,modelOverride,timeout_seconds,IF(OCTET_LENGTH(manifest)<=1048576,manifest,NULL) AS manifest FROM emperor_skills WHERE BINARY slug=BINARY ? AND (workspaceId=? OR (workspaceId IS NULL AND scope='global')) LIMIT 2 FOR SHARE", [approval.skillSlug, input.identity.workspaceId])); }
    catch { return fail("SKILL_UNAVAILABLE"); }
    if (!assistantConversationSkillScopeMatches(skill.pin, input.identity.workspaceId, approval.skillSlug)
      || assistantConversationSkillSnapshotHash(skill.pin) !== approval.skillSnapshotHash) fail("APPROVED_SKILL_CHANGED");
    const binding = input.configuration.config.skills.find(item => item.slug === skill.pin.slug && item.enabled);
    if (!binding || binding.version !== skill.pin.version || binding.manifestSha256 !== skill.pin.manifestSha256) fail("CONFIGURATION_SKILL_MISMATCH");
    // The existing saved configuration represents inheritance as an empty string.
    // Only the exact approved Skill override is inherited; never registry defaults.
    const modelSlug = input.configuration.config.modelSlug || skill.pin.modelOverride;
    if (!modelSlug || modelSlug !== approval.modelSlug) fail("MODEL_BINDING_MISMATCH");
    let model: ImageTaggingRuntimeSnapshot["model"];
    try { model = strictModelSnapshotFromRow(input.identity.workspaceId, modelSlug, await one(input.executor,
      "SELECT workspaceId,slug,name,provider,modelId,baseUrl,apiKeyRef,isActive,capabilityTags,maxContextTokens,costPer1kInputTokens,costPer1kOutputTokens FROM emperor_model_providers WHERE BINARY slug=BINARY ? AND (workspaceId=? OR workspaceId IS NULL) LIMIT 2 FOR SHARE", [modelSlug, input.identity.workspaceId])); }
    catch { return fail("MODEL_UNAVAILABLE"); }
    if (model.configurationHash !== approval.modelConfigurationHash) fail("APPROVED_MODEL_CHANGED");
    if (!model.model.capabilityTags.includes("vision")) fail("MODEL_VISION_REQUIRED");
    try { if (!credential(model.model.apiKeyRef)?.trim()) fail("MODEL_CREDENTIAL_UNAVAILABLE"); }
    catch { return fail("MODEL_CREDENTIAL_UNAVAILABLE"); }
    const worst = contextFor(input, approval, { imageSetId: 2147483647, imageId: 2147483647, imageRevision: "f".repeat(64),
      sourceUrlRef: "SYNTHETIC_BUDGET_BOUND_NOT_SOURCE", contentHash: "f".repeat(64), byteSize: 8388608, contentType: "image/jpeg" });
    const variables = { agentKey: "tagger", agentRevision: input.configuration.revision, operationId: input.operationId, stage: "image_tagging" };
    const worstUser = renderSkillTemplate(skill.userPrompt, { context: worst, ...variables });
    if (!worstUser.includes(worst)) fail("INPUT_CONTRACT_UNSUPPORTED");
    const textBytes = Buffer.byteLength(skill.systemPrompt) + Buffer.byteLength(worstUser),
      units = textBytes + approval.imageBudget.maxInputTokensPerImage + STRICT_SKILL_LIMITS.messageOverheadAllowance;
    if (textBytes > STRICT_SKILL_LIMITS.textBytes || units + skill.pin.maxTokens > model.model.maxContextTokens
      || approval.imageBudget.maxInputTokensPerImage > model.model.maxContextTokens) fail("PAYLOAD_BUDGET_UNAVAILABLE");
    try { if (strictCostUpperBound(model, units, skill.pin.maxTokens) > approval.maxCostCents) fail("COST_BUDGET_EXCEEDED"); }
    catch (error) { if (error instanceof ImageTaggingRuntimeError) throw error; return fail("PRICING_UNAVAILABLE"); }
    const body = { schema: "image-tagging-runtime/v1" as const, identity: input.identity, operationId: input.operationId, stage: "image_tagging" as const,
      sourceHash: input.sourceHash, imageCount: input.imageCount, configuration: { agentKey: "tagger" as const, revision: input.configuration.revision, hash: input.configuration.hash },
      approval, approvalHash: imageTaggingRuntimeHash(approval), skill: skill.pin, model,
      budgetPlan: { maxImageBytes: 8388608 as const, maxContextAdmissionUnits: units, outputTokens: skill.pin.maxTokens,
        maxCostCentsPerImage: approval.maxCostCents, maxCostCentsTotal: input.imageCount * approval.maxCostCents } };
    return { input, skill, runtimeSnapshot: parsed(ImageTaggingRuntimeSnapshotSchema, { ...body, snapshotHash: imageTaggingRuntimeHash(body) }, "RUNTIME_SNAPSHOT_INVALID") };
  }
  async function revalidate(input: ImageTaggingRuntimeInput & { runtimeSnapshot: unknown }) {
    const expected = parsed(ImageTaggingRuntimeSnapshotSchema, input.runtimeSnapshot, "RUNTIME_SNAPSHOT_INVALID"), current = await build(capture(input));
    if (strictRuntimeCanonical(current.runtimeSnapshot) !== strictRuntimeCanonical(expected)) fail("RUNTIME_SNAPSHOT_CHANGED"); return current;
  }
  return {
    async prepare(input: ImageTaggingRuntimeInput) { return { runtimeSnapshot: (await build(capture(input))).runtimeSnapshot }; },
    async revalidate(input: ImageTaggingRuntimeInput & { runtimeSnapshot: unknown }) { await revalidate(input); },
    async prepareStage(input: ImageTaggingRuntimeInput & { runtimeSnapshot: unknown; evidence: ImageTaggingEvidence; originalBytes: Uint8Array }): Promise<ImageTaggingPreparedStage> {
      const evidence = parsed(ImageTaggingEvidenceSchema, input.evidence, "EVIDENCE_INVALID"), bytes = imageBytes(evidence, input.originalBytes);
      const built = await revalidate(input), runtime = built.runtimeSnapshot;
      const context = contextFor(built.input, runtime.approval, evidence), variables = { agentKey: "tagger", agentRevision: built.input.configuration.revision,
        operationId: built.input.operationId, stage: "image_tagging" }, user = renderSkillTemplate(built.skill.userPrompt, { context, ...variables });
      if (!user.includes(context)) fail("INPUT_CONTRACT_UNSUPPORTED");
      const attachments = [{ type: "image_url" as const, image_url: { url: `data:${evidence.contentType};base64,${bytes.toString("base64")}` } }];
      const admission = strictSkillMessages(built.skill.systemPrompt, user, attachments, runtime.model, runtime.skill.maxTokens, runtime.approval.imageBudget);
      if (admission.budget.contextAdmissionUnits > runtime.budgetPlan.maxContextAdmissionUnits
        || strictCostUpperBound(runtime.model, admission.budget.contextAdmissionUnits, admission.budget.outputTokens) > runtime.approval.maxCostCents) fail("PAYLOAD_BUDGET_UNAVAILABLE");
      const providerRequestHash = strictRuntimeHash({ model: runtime.model.model.modelId, messages: admission.messages, max_tokens: admission.budget.outputTokens,
        ...(runtime.skill.temperature === null ? {} : { temperature: runtime.skill.temperature }), ...(runtime.skill.supportsJsonMode ? { response_format: { type: "json_object" } } : {}) });
      const evidenceHash = imageTaggingRuntimeHash(evidence), contextHash = createHash("sha256").update(context).digest("hex"),
        snapshotHash = runtime.snapshotHash, bindingHash = imageTaggingRuntimeHash({ schema: "image-tagging-stage/v1", stage: "image_tagging", snapshotHash, evidenceHash, contextHash, providerRequestHash });
      const budget = Object.freeze(parsed(ImageTaggingDispatchReceiptSchema.shape.budget, admission.budget, "BUDGET_INVALID"));
      const value = Object.freeze({ stage: "image_tagging" as const, bindingHash, contextHash, snapshotHash, evidenceHash, providerRequestHash, budget });
      prepared.set(value, { used: false, stage: { built, evidence, bytes, context, variables } }); return value;
    },
    async executeStage(value: ImageTaggingPreparedStage, options: { signal?: AbortSignal;
      beforeDispatch: (receipt: StrictSkillDispatchReceipt, verifyFresh: (executor: ImageTaggingExecutor, configuration: AssistantConversationSavedConfiguration,
        sourceHash: string, evidence: ImageTaggingEvidence) => Promise<void>) => Promise<void> }): Promise<ImageTaggingStageResult> {
      const state = prepared.get(value); if (!state || state.used) fail("STAGE_ALREADY_CONSUMED"); state.used = true;
      if (!options || typeof options.beforeDispatch !== "function" || options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail("EXECUTION_OPTIONS_INVALID");
      if (options.signal?.aborted) fail("CANCELED");
      const { built, evidence, bytes, context, variables } = state.stage, runtime = built.runtimeSnapshot, pin = built.skill.pin;
      let allowed = false, dispatchedRunId: string | null = null, calls = 0;
      const validate = (content: string): ImageTaggingCandidate => {
        if (typeof content !== "string" || Buffer.byteLength(content) > 65536) fail("RESULT_CONTRACT_INVALID");
        try { return parsed(ImageTaggingCandidateSchema, JSON.parse(content), "RESULT_CONTRACT_INVALID"); } catch { return fail("RESULT_CONTRACT_INVALID"); }
      };
      try {
        const result = await run({ skillSlug: pin.slug, userId: runtime.identity.userId, workspaceId: runtime.identity.workspaceId, context, variables,
          attachments: [{ type: "image_url", image_url: { url: `data:${evidence.contentType};base64,${bytes.toString("base64")}` } }], skillVersionPolicy: "pinned",
          expectedSkillVersion: String(pin.version), expectedSkillStatus: "Released", expectedSkillPromptHash: pin.systemPromptSha256.slice(0, 16),
          expectedSkillUserPromptHash: pin.userPromptSha256.slice(0, 16), expectedSkillManifestHash: pin.manifestRawSha256.slice(0, 16),
          modelOverride: runtime.model.model.slug, fallbackModels: [], maxModelAttempts: 1, executionPreset: "standard", migrationSource: "knowledge.image_tagging.strict",
          signal: options.signal, validate, strictExecution: { stage: "image_tagging", modelSnapshot: runtime.model, bindingHash: value.bindingHash,
            expectedSkillModelOverride: pin.modelOverride, expectedSkillTimeoutSeconds: pin.timeoutSeconds, maxCostCents: runtime.approval.maxCostCents,
            imageBudget: runtime.approval.imageBudget, beforeDispatch: async receipt => {
              if (++calls !== 1 || options.signal?.aborted) fail("DISPATCH_DENIED");
              const checked = parsed(ImageTaggingDispatchReceiptSchema, receipt, "DISPATCH_RECEIPT_INVALID");
              if (checked.requestHash !== value.providerRequestHash || checked.bindingHash !== value.bindingHash
                || checked.modelConfigurationHash !== runtime.model.configurationHash || strictRuntimeCanonical(checked.budget) !== strictRuntimeCanonical(value.budget)) fail("DISPATCH_RECEIPT_MISMATCH");
              let open = true, verifying = false, verified = false, invalid = false;
              try { await options.beforeDispatch(clone(checked), (executor, configuration, sourceHash, freshEvidence) => {
                const verification = (async () => {
                  if (!open || verifying || verified) { invalid = true; fail("FRESH_VERIFICATION_REUSED"); } verifying = true;
                  if (imageTaggingRuntimeHash(parsed(ImageTaggingEvidenceSchema, freshEvidence, "EVIDENCE_INVALID")) !== value.evidenceHash) fail("EVIDENCE_CHANGED");
                  await revalidate({ executor, identity: runtime.identity, operationId: runtime.operationId, imageCount: runtime.imageCount,
                    configuration, sourceHash, runtimeSnapshot: runtime });
                  if (!open) { invalid = true; fail("FRESH_VERIFICATION_NOT_AWAITED"); } verified = true;
                })(); void verification.catch(() => { invalid = true; }); return verification;
              }); } catch { return fail("DISPATCH_DENIED"); } finally { open = false; }
              if (!verified || invalid) fail("FRESH_AUTHORIZATION_REQUIRED");
              if (options.signal?.aborted) fail("CANCELED"); allowed = true; dispatchedRunId = checked.runId;
            } } });
        if (!allowed || result.runId !== dispatchedRunId || result.skillSlug !== pin.slug || result.modelSlug !== runtime.model.model.slug
          || result.provider !== "custom" || result.fallbackCount !== 0) fail("RESULT_RECEIPT_MISMATCH");
        const candidate = validate(result.content);
        if (strictRuntimeCanonical(candidate) !== strictRuntimeCanonical(result.parsed)) fail("RESULT_CONTRACT_MISMATCH");
        const auditWarnings = parsed(z.array(z.enum(["METRICS_UNAVAILABLE", "CALL_COUNT_UNAVAILABLE"])).max(2), result.auditWarnings ?? [], "RESULT_RECEIPT_INVALID");
        return { stage: "image_tagging", candidate, runId: result.runId, contextHash: value.contextHash, bindingHash: value.bindingHash,
          snapshotHash: value.snapshotHash, evidenceHash: value.evidenceHash, providerRequestHash: value.providerRequestHash, auditWarnings };
      } catch (error) {
        if (error instanceof ImageTaggingRuntimeError) throw error;
        if (error instanceof StrictSkillRuntimeError && /^STRICT_[A-Z0-9_]{1,90}$/u.test(error.code)) return fail(error.code);
        return fail("RUNTIME_RESULT_UNKNOWN");
      }
    },
  };
}
export type ImageTaggingRuntime = ReturnType<typeof createImageTaggingRuntime>;
export const imageTaggingRuntime = createImageTaggingRuntime();
