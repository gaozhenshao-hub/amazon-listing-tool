import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import type { AssistantConversationSavedConfiguration } from "../ai_os/services/assistantConversationContext";
import { assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash, assistantConversationSkillScopeMatches,
  type AssistantConversationRegistrySkill } from "../ai_os/services/assistantConversationSourcePrimitives";
import { runEmperorSkill, renderSkillTemplate, type StrictSkillDispatchReceipt } from "../ai_os/services/skillRunner";
import { strictRuntimeCanonical, strictRuntimeHash, strictModelSnapshotFromRow, strictSkillMessages,
  strictCostUpperBound, strictSkillAuditIdentity, StrictSkillRuntimeError } from "../ai_os/services/strictSkillRuntime";
import { resolveGovernedModelApiKey } from "../ai_os/services/teamorouterCatalog";
import { createSourceApprovalFileLoader, SourceApprovalFileError } from "../../services/sourceApprovalFileLoader";
import { VIDEO_CONFIGURED_DEFINITIONS, VideoConfiguredIdentitySchema, VideoConfiguredOperationIdSchema,
  VideoConfiguredSavedConfigurationSchema, VideoConfiguredSourceApprovalSchema, VideoConfiguredRuntimeSnapshotSchema,
  VideoConfiguredDispatchReceiptSchema, VideoConfiguredDispatchBudgetSchema,
  type VideoConfiguredDefinition, type VideoConfiguredSavedConfiguration, type VideoConfiguredSourceApproval,
  type VideoConfiguredRuntimeSnapshot, type VideoConfiguredDispatchReceipt } from "./videoConfiguredRuntimeContract";
export * from "./videoConfiguredRuntimeContract";

export class VideoConfiguredRuntimeError extends Error {
  readonly retryable = false;
  constructor(readonly code: string) { super(`VIDEO_CONFIGURED_${code}`); this.name = "VideoConfiguredRuntimeError"; }
}
function fail(code: string): never { throw new VideoConfiguredRuntimeError(code); }
export interface VideoConfiguredExecutor { execute(query: SQL): Promise<unknown> }
export type VideoConfiguredRuntimeInput = { executor: VideoConfiguredExecutor; identity: { userId: number; workspaceId: number };
  operationId: string; configuration: AssistantConversationSavedConfiguration; sourceHash: string; sourceContext: unknown };
export type VideoConfiguredPreparedStage = Readonly<{ stage: VideoConfiguredDefinition["stage"]; bindingHash: string;
  contextHash: string; snapshotHash: string; providerRequestHash: string; budget: VideoConfiguredDispatchReceipt["budget"] }>;
export type VideoConfiguredStageResult<T> = { stage: VideoConfiguredDefinition["stage"]; candidate: T; runId: string;
  bindingHash: string; contextHash: string; snapshotHash: string; providerRequestHash: string;
  auditWarnings: Array<"METRICS_UNAVAILABLE" | "CALL_COUNT_UNAVAILABLE"> };
export type VideoConfiguredApprovalResolver = (input: { executor: VideoConfiguredExecutor; identity: VideoConfiguredRuntimeInput["identity"];
  operation: VideoConfiguredDefinition["operation"]; stage: VideoConfiguredDefinition["stage"]; agentKey: VideoConfiguredDefinition["agentKey"] }) => Promise<VideoConfiguredSourceApproval | null>;
type Captured = Omit<VideoConfiguredRuntimeInput, "configuration"> & { configuration: VideoConfiguredSavedConfiguration };
const clone = <T>(value: T): T => structuredClone(value);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  try { strictRuntimeCanonical(value); return schema.parse(clone(value)); } catch { return fail(code); }
}
export function createFixedVideoConfiguredApprovalResolver(records: readonly VideoConfiguredSourceApproval[]): VideoConfiguredApprovalResolver {
  const copy = parse(z.array(VideoConfiguredSourceApprovalSchema).max(1000), records, "APPROVAL_INVALID");
  if (new Set(copy.map(row => `${row.workspaceId}:${row.operation}`)).size !== copy.length) fail("APPROVAL_DUPLICATE");
  return async input => clone(copy.find(row => row.workspaceId === input.identity.workspaceId && row.operation === input.operation && row.stage === input.stage && row.agentKey === input.agentKey) ?? null);
}
export function createFileVideoConfiguredApprovalResolver(definition: VideoConfiguredDefinition): VideoConfiguredApprovalResolver {
  const load = createSourceApprovalFileLoader({ kind: definition.approvalKind, decode: records => {
    const parsed = z.array(VideoConfiguredSourceApprovalSchema).max(1000).parse(records);
    // File may contain all seven explicitly approved operation contracts.
    return createFixedVideoConfiguredApprovalResolver(parsed);
  } });
  return async input => {
    try { const result = await load(); return result.status === "ready" ? result.value(input) : null; }
    catch (error) { return fail(error instanceof SourceApprovalFileError ? `APPROVAL_${error.code}` : "SOURCE_UNAVAILABLE"); }
  };
}
async function rows(executor: VideoConfiguredExecutor, query: string, params: unknown[]) {
  try {
    const parts = query.split("?"); if (parts.length !== params.length + 1) fail("REGISTRY_UNAVAILABLE");
    const result = await executor.execute(sql.join(parts.flatMap((part, i) => i < params.length ? [sql.raw(part), sql`${params[i]}`] : [sql.raw(part)]), sql.raw("")));
    if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > 2) fail("REGISTRY_UNAVAILABLE");
    strictRuntimeCanonical(result[0]); return clone(result[0]) as Array<Record<string, unknown>>;
  } catch { return fail("REGISTRY_UNAVAILABLE"); }
}
async function one(executor: VideoConfiguredExecutor, query: string, params: unknown[]) {
  const found = await rows(executor, query, params); if (found.length !== 1) fail("REGISTRY_UNAVAILABLE"); return found[0];
}
/** Video-only mechanics for seven explicit operation contracts. Callers supply their
 * actual complete-source validator, transactional authority and output schema.
 * Nothing here registers handlers or changes any legacy Skill execution. */
export function createVideoConfiguredRuntime<T>(dependencies: { definition: VideoConfiguredDefinition;
  parseCandidate: (value: unknown) => T; approvalResolver?: VideoConfiguredApprovalResolver;
  runSkill?: typeof runEmperorSkill; credentialResolver?: (reference: string) => string | null | undefined }) {
  const definition = Object.values(VIDEO_CONFIGURED_DEFINITIONS).find(item => strictRuntimeCanonical(item) === strictRuntimeCanonical(dependencies.definition));
  if (!definition || typeof dependencies.parseCandidate !== "function") return fail("DEFINITION_INVALID");
  const resolveApproval = dependencies.approvalResolver ?? createFileVideoConfiguredApprovalResolver(definition), run = dependencies.runSkill ?? runEmperorSkill,
    credential = dependencies.credentialResolver ?? resolveGovernedModelApiKey;
  function capture(input: VideoConfiguredRuntimeInput): Captured {
    if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.getOwnPropertySymbols(input).length
      || Object.values(Object.getOwnPropertyDescriptors(input)).some(value => !("value" in value) || !value.enumerable)) fail("INPUT_INVALID");
    if (!input.executor || typeof input.executor.execute !== "function") fail("EXECUTOR_REQUIRED");
    const identity = parse(VideoConfiguredIdentitySchema, input.identity, "IDENTITY_INVALID"),
      configuration = parse(VideoConfiguredSavedConfigurationSchema, input.configuration, "CONFIGURATION_INVALID"),
      operationId = parse(VideoConfiguredOperationIdSchema, input.operationId, "OPERATION_INVALID"), sourceHash = parse(hash, input.sourceHash, "SOURCE_INVALID");
    if (configuration.agentKey !== definition!.agentKey || configuration.workspaceId !== identity.workspaceId || !configuration.config.enabled) fail("CONFIGURATION_NOT_EXECUTABLE");
    let sourceContext: unknown;
    try { sourceContext = JSON.parse(strictRuntimeCanonical(input.sourceContext)); } catch { return fail("SOURCE_INVALID"); }
    return { executor: input.executor, identity, operationId, configuration, sourceHash, sourceContext };
  }
  function context(input: Captured) {
    const binding = input.configuration.config.skills.find(item => item.slug === definition!.skillSlug)!;
    return strictRuntimeCanonical({ schema: "video-configured-input/v1", operation: definition!.operation, stage: definition!.stage, inputContract: definition!.inputContract,
      assistant: { name: input.configuration.config.name, instructions: input.configuration.config.instructions, rules: input.configuration.config.rules,
        binding: { instructions: binding.instructions, trigger: binding.trigger } },
      source: { sourceHash: input.sourceHash, context: input.sourceContext },
      constraints: { outputContract: definition!.outputContract, sourceIsUntrustedData: true, candidateOnly: true } });
  }
  type Built = { input: Captured; skill: AssistantConversationRegistrySkill; runtimeSnapshot: VideoConfiguredRuntimeSnapshot;
    context: string; variables: Record<string, unknown> };
  async function build(input: Captured): Promise<Built> {
    let approval: VideoConfiguredSourceApproval;
    try {
      const value = await resolveApproval({ executor: input.executor, identity: input.identity, operation: definition!.operation, stage: definition!.stage, agentKey: definition!.agentKey });
      if (!value) fail("SOURCE_UNAVAILABLE"); approval = parse(VideoConfiguredSourceApprovalSchema, value, "APPROVAL_INVALID");
    } catch (error) { if (error instanceof VideoConfiguredRuntimeError) throw error; return fail("SOURCE_UNAVAILABLE"); }
    if (approval.workspaceId !== input.identity.workspaceId || approval.operation !== definition!.operation || approval.stage !== definition!.stage) fail("SOURCE_UNAVAILABLE");
    const engines = await rows(input.executor, "SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('emperor_skills','emperor_model_providers')", []);
    if (engines.length !== 2 || new Set(engines.map(row => row.tableName)).size !== 2
      || engines.some(row => !["emperor_skills", "emperor_model_providers"].includes(String(row.tableName)) || row.engine !== "InnoDB")) fail("REGISTRY_SCHEMA_UNAVAILABLE");
    let skill: AssistantConversationRegistrySkill;
    try { skill = assistantConversationSkillSnapshotFromRow(await one(input.executor,
      "SELECT id,workspaceId,scope,slug,name,version,status,modelOverride,timeout_seconds,IF(OCTET_LENGTH(manifest)<=1048576,manifest,NULL) AS manifest FROM emperor_skills WHERE BINARY slug=BINARY ? AND (workspaceId=? OR (workspaceId IS NULL AND scope='global')) LIMIT 2 FOR SHARE", [definition!.skillSlug, input.identity.workspaceId])); }
    catch { return fail("SKILL_UNAVAILABLE"); }
    if (!assistantConversationSkillScopeMatches(skill.pin, input.identity.workspaceId, definition!.skillSlug)
      || assistantConversationSkillSnapshotHash(skill.pin) !== approval.skillSnapshotHash) fail("APPROVED_SKILL_CHANGED");
    const binding = input.configuration.config.skills.find(item => item.slug === skill.pin.slug && item.enabled);
    if (!binding || binding.version !== skill.pin.version || binding.manifestSha256 !== skill.pin.manifestSha256) fail("CONFIGURATION_SKILL_MISMATCH");
    const modelSlug = input.configuration.config.modelSlug || skill.pin.modelOverride;
    if (!modelSlug || modelSlug !== approval.modelSlug) fail("MODEL_BINDING_MISMATCH");
    let model: VideoConfiguredRuntimeSnapshot["model"];
    try { model = strictModelSnapshotFromRow(input.identity.workspaceId, modelSlug, await one(input.executor,
      "SELECT workspaceId,slug,name,provider,modelId,baseUrl,apiKeyRef,isActive,capabilityTags,maxContextTokens,costPer1kInputTokens,costPer1kOutputTokens FROM emperor_model_providers WHERE BINARY slug=BINARY ? AND (workspaceId=? OR workspaceId IS NULL) LIMIT 2 FOR SHARE", [modelSlug, input.identity.workspaceId])); }
    catch { return fail("MODEL_UNAVAILABLE"); }
    if (model.configurationHash !== approval.modelConfigurationHash) fail("APPROVED_MODEL_CHANGED");
    if (!model.model.capabilityTags.includes("text")) fail("MODEL_TEXT_REQUIRED");
    try { if (!credential(model.model.apiKeyRef)?.trim()) fail("MODEL_CREDENTIAL_UNAVAILABLE"); } catch { return fail("MODEL_CREDENTIAL_UNAVAILABLE"); }
    const renderedContext = context(input), variables = { agentKey: definition!.agentKey, agentRevision: input.configuration.revision,
      operationId: input.operationId, stage: definition!.stage }, user = renderSkillTemplate(skill.userPrompt, { context: renderedContext, ...variables });
    if (!user.includes(renderedContext)) fail("INPUT_CONTRACT_UNSUPPORTED");
    let budget: VideoConfiguredDispatchReceipt["budget"];
    try {
      budget = parse(VideoConfiguredDispatchBudgetSchema, strictSkillMessages(skill.systemPrompt, user, [], model, skill.pin.maxTokens).budget, "PAYLOAD_BUDGET_UNAVAILABLE");
      if (strictCostUpperBound(model, budget.contextAdmissionUnits, budget.outputTokens) > approval.maxCostCents) fail("COST_BUDGET_EXCEEDED");
    } catch (error) { if (error instanceof VideoConfiguredRuntimeError) throw error; return fail(error instanceof StrictSkillRuntimeError ? error.code : "PRICING_UNAVAILABLE"); }
    const body = { schema: "video-configured-runtime/v1" as const, identity: input.identity, operationId: input.operationId,
      operation: definition!.operation, stage: definition!.stage, sourceHash: input.sourceHash, sourceContextHash: strictRuntimeHash(input.sourceContext),
      configuration: { agentKey: definition!.agentKey, revision: input.configuration.revision, hash: input.configuration.hash },
      approval, approvalHash: strictRuntimeHash(approval), skill: skill.pin, model,
      budgetPlan: { maxCalls: 1 as const, maxCostCentsTotal: approval.maxCostCents, budget } };
    return { input, skill, context: renderedContext, variables,
      runtimeSnapshot: parse(VideoConfiguredRuntimeSnapshotSchema, { ...body, snapshotHash: strictRuntimeHash(body) }, "RUNTIME_SNAPSHOT_INVALID") };
  }
  async function revalidate(input: VideoConfiguredRuntimeInput & { runtimeSnapshot: unknown }) {
    const expected = parse(VideoConfiguredRuntimeSnapshotSchema, input.runtimeSnapshot, "RUNTIME_SNAPSHOT_INVALID"), current = await build(capture(input));
    if (strictRuntimeCanonical(current.runtimeSnapshot) !== strictRuntimeCanonical(expected)) fail("RUNTIME_SNAPSHOT_CHANGED"); return current;
  }
  const prepared = new WeakMap<VideoConfiguredPreparedStage, { used: boolean; built: Built }>();
  return {
    async prepare(input: VideoConfiguredRuntimeInput) { return { runtimeSnapshot: (await build(capture(input))).runtimeSnapshot }; },
    async revalidate(input: VideoConfiguredRuntimeInput & { runtimeSnapshot: unknown }) { await revalidate(input); },
    async prepareStage(input: VideoConfiguredRuntimeInput & { runtimeSnapshot: unknown }): Promise<VideoConfiguredPreparedStage> {
      const built = await revalidate(input), snapshot = built.runtimeSnapshot, pin = snapshot.skill, budget = snapshot.budgetPlan.budget;
      const user = renderSkillTemplate(built.skill.userPrompt, { context: built.context, ...built.variables });
      const admission = strictSkillMessages(built.skill.systemPrompt, user, [], snapshot.model, pin.maxTokens);
      const providerRequestHash = strictRuntimeHash({ model: snapshot.model.model.modelId, messages: admission.messages, max_tokens: pin.maxTokens,
        ...(pin.temperature === null ? {} : { temperature: pin.temperature }), ...(pin.supportsJsonMode ? { response_format: { type: "json_object" } } : {}) });
      const contextHash = strictRuntimeHash(built.context), snapshotHash = snapshot.snapshotHash,
        bindingHash = strictRuntimeHash({ schema: "video-configured-stage/v1", stage: definition!.stage, snapshotHash, contextHash, providerRequestHash });
      const value = Object.freeze({ stage: definition!.stage, bindingHash, contextHash, snapshotHash, providerRequestHash,
        budget: Object.freeze(clone(budget)) }); prepared.set(value, { used: false, built }); return value;
    },
    async executeStage(value: VideoConfiguredPreparedStage, options: { signal?: AbortSignal;
      beforeDispatch: (receipt: StrictSkillDispatchReceipt, verifyFresh: (executor: VideoConfiguredExecutor,
        configuration: AssistantConversationSavedConfiguration, sourceHash: string, sourceContext: unknown) => Promise<void>) => Promise<void> }): Promise<VideoConfiguredStageResult<T>> {
      const state = prepared.get(value); if (!state || state.used) fail("STAGE_ALREADY_CONSUMED"); state.used = true;
      if (!options || typeof options.beforeDispatch !== "function" || options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail("EXECUTION_OPTIONS_INVALID");
      if (options.signal?.aborted) fail("CANCELED");
      const built = state.built, snapshot = built.runtimeSnapshot, pin = snapshot.skill;
      const validate = (content: string): T => {
        try { if (typeof content !== "string" || Buffer.byteLength(content) > 512 * 1024) fail("RESULT_CONTRACT_INVALID");
          const candidate = dependencies.parseCandidate(JSON.parse(content)); strictRuntimeCanonical(candidate); return candidate;
        } catch { return fail("RESULT_CONTRACT_INVALID"); }
      };
      let count = 0, dispatched: string | null = null;
      try {
        const result = await run({ skillSlug: pin.slug, userId: snapshot.identity.userId, workspaceId: snapshot.identity.workspaceId,
          context: built.context, variables: built.variables, skillVersionPolicy: "pinned", expectedSkillVersion: String(pin.version), expectedSkillStatus: "Released",
          expectedSkillPromptHash: pin.systemPromptSha256.slice(0, 16), expectedSkillUserPromptHash: pin.userPromptSha256.slice(0, 16),
          expectedSkillManifestHash: pin.manifestRawSha256.slice(0, 16), modelOverride: snapshot.model.model.slug,
          fallbackModels: [], maxModelAttempts: 1, executionPreset: "standard", migrationSource: strictSkillAuditIdentity(definition!.stage).migrationSource,
          signal: options.signal, validate, strictExecution: { modelSnapshot: snapshot.model, stage: definition!.stage, bindingHash: value.bindingHash,
            expectedSkillModelOverride: pin.modelOverride, expectedSkillTimeoutSeconds: pin.timeoutSeconds, maxCostCents: snapshot.approval.maxCostCents,
            beforeDispatch: async receipt => {
              if (++count !== 1 || options.signal?.aborted) fail("DISPATCH_DENIED");
              const checked = parse(VideoConfiguredDispatchReceiptSchema, receipt, "DISPATCH_RECEIPT_INVALID");
              if (checked.stage !== definition!.stage || checked.requestHash !== value.providerRequestHash || checked.bindingHash !== value.bindingHash
                || checked.modelConfigurationHash !== snapshot.model.configurationHash || strictRuntimeCanonical(checked.budget) !== strictRuntimeCanonical(value.budget)) fail("DISPATCH_RECEIPT_MISMATCH");
              let open = true, verifying = false, verified = false, invalid = false;
              try { await options.beforeDispatch(clone(checked), (executor, configuration, sourceHash, sourceContext) => {
                const verification = (async () => {
                  if (!open || verifying || verified) { invalid = true; fail("FRESH_VERIFICATION_REUSED"); } verifying = true;
                  await revalidate({ executor, identity: snapshot.identity, operationId: snapshot.operationId, configuration, sourceHash, sourceContext, runtimeSnapshot: snapshot });
                  if (!open) { invalid = true; fail("FRESH_VERIFICATION_NOT_AWAITED"); } verified = true;
                })(); void verification.catch(() => { invalid = true; }); return verification;
              }); } catch { return fail("DISPATCH_DENIED"); } finally { open = false; }
              if (!verified || invalid) fail("FRESH_AUTHORIZATION_REQUIRED");
              if (options.signal?.aborted) fail("CANCELED"); dispatched = checked.runId;
            } } });
        if (!dispatched || result.runId !== dispatched || result.skillSlug !== pin.slug || result.modelSlug !== snapshot.model.model.slug
          || result.provider !== "custom" || result.fallbackCount !== 0) fail("RESULT_RECEIPT_MISMATCH");
        const candidate = validate(result.content);
        if (strictRuntimeCanonical(candidate) !== strictRuntimeCanonical(result.parsed)) fail("RESULT_CONTRACT_MISMATCH");
        return { stage: definition!.stage, candidate, runId: result.runId, contextHash: value.contextHash, bindingHash: value.bindingHash,
          snapshotHash: value.snapshotHash, providerRequestHash: value.providerRequestHash,
          auditWarnings: parse(z.array(z.enum(["METRICS_UNAVAILABLE", "CALL_COUNT_UNAVAILABLE"])).max(2), result.auditWarnings ?? [], "RESULT_RECEIPT_INVALID") };
      } catch (error) {
        if (error instanceof VideoConfiguredRuntimeError) throw error;
        if (error instanceof StrictSkillRuntimeError && /^STRICT_[A-Z0-9_]{1,90}$/u.test(error.code)) return fail(error.code);
        return fail("RUNTIME_RESULT_UNKNOWN");
      }
    },
  };
}
