import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { AssistantConfigurationSchema } from "../../../shared/assistantConfigurations";
import { monthlyFinancialJsonBytes } from "../../../shared/monthlyFinancialRead";
import { PROFIT_ANALYSIS_LIMITS, ProfitAnalysisSourceSchema, ProfitAnalysisEvidenceSchema,
  ProfitAnalysisReplySchema, ProfitAnalysisScopeSchema, buildProfitAnalysisEvidence, finishProfitAnalysis,
  type ProfitAnalysisSource, type ProfitAnalysisEvidence, type ProfitAnalysisResult } from "../../../shared/profitAnalysis";
import type { AssistantConversationExecutor } from "../ai_os/repositories/assistantConversations";
import type { AssistantConversationSavedConfiguration } from "../ai_os/services/assistantConversationContext";
import { configurationHash, AssistantConversationSkillPinSchema, assistantConversationSkillSnapshotFromRow,
  assistantConversationSkillSnapshotHash, assistantConversationSkillScopeMatches,
  type AssistantConversationRegistrySkill } from "../ai_os/services/assistantConversationSourcePrimitives";
import { runEmperorSkill, renderSkillTemplate, type StrictSkillDispatchReceipt } from "../ai_os/services/skillRunner";
import { STRICT_SKILL_LIMITS, StrictRegisteredModelSnapshotSchema, StrictSkillRuntimeError, strictModelSnapshotFromRow,
  strictSkillMessages, strictCostUpperBound, strictRuntimeHash, type StrictRegisteredModelSnapshot } from "../ai_os/services/strictSkillRuntime";
import { resolveGovernedModelApiKey } from "../ai_os/services/teamorouterCatalog";

/** Server-only execution bridge. An approved Qingdao mapping is required; a
 * Released label, configuration binding, registry seed or test fixture is not approval. */
export class ProfitAnalysisRuntimeError extends Error {
  readonly retryable = false;
  constructor(readonly code: string) { super(`PROFIT_ANALYSIS_${code}`); this.name = "ProfitAnalysisRuntimeError"; }
}
function fail(code: string): never { throw new ProfitAnalysisRuntimeError(code); }
const id = z.number().int().min(1).max(2147483647), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
const identitySchema = z.object({ workspaceId: id, userId: id }).strict();
const savedSchema = z.object({ workspaceId: id, agentKey: z.literal("finance"), revision: id, hash, config: AssistantConfigurationSchema }).strict();
const snapshotBytes = 128 * 1024;
function canonical(value: unknown, maxBytes = snapshotBytes): string {
  try {
    if (monthlyFinancialJsonBytes(value, { jsonDepth: 40, jsonNodes: PROFIT_ANALYSIS_LIMITS.nodes, stringLength: maxBytes }) > maxBytes) fail("DATA_LIMIT");
    const visit = (item: unknown): unknown => Array.isArray(item) ? item.map(visit) : item && typeof item === "object"
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, visit((item as Record<string, unknown>)[key])])) : item;
    return JSON.stringify(visit(value));
  } catch { return fail("DATA_INVALID_OR_LIMIT"); }
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const digest = (value: unknown, maxBytes?: number) => sha(canonical(value, maxBytes));
function parsed<T>(schema: z.ZodType<T>, value: unknown, code: string, maxBytes = snapshotBytes): T {
  try { canonical(value, maxBytes); const result = schema.safeParse(structuredClone(value)); if (result.success) return result.data; }
  catch { /* Never expose a private value or validation/provider error body. */ }
  return fail(code);
}
const jsonAdmission = (maxBytes: number) => z.unknown().superRefine((value, ctx) => {
  try { canonical(value, maxBytes); } catch { ctx.addIssue({ code: "custom", message: "Bounded plain JSON required" }); }
});

export const ProfitAnalysisSourceApprovalSchema = jsonAdmission(snapshotBytes).pipe(z.object({
  version: z.literal(1), workspaceId: id, agentKey: z.literal("finance"), stage: z.literal("profit_analysis"),
  skillSlug: text(128), skillSnapshotHash: hash, modelConfigurationHash: hash,
  source: z.object({ origin: z.literal("qingdao"), revision: text(256), approvalRef: text(512), evidenceId: text(256), evidenceHash: hash }).strict(),
  inputContract: z.literal("profit_evidence_v1"), outputContract: z.literal("profit_evidence_selection_v1"),
  maxCostCents: z.number().int().min(0).max(1_000_000_000),
}).strict());
export type ProfitAnalysisSourceApproval = z.infer<typeof ProfitAnalysisSourceApprovalSchema>;
export type ProfitAnalysisApprovalResolver = (input: {
  executor: AssistantConversationExecutor; identity: { workspaceId: number; userId: number }; agentKey: "finance"; stage: "profit_analysis";
}) => Promise<ProfitAnalysisSourceApproval | null>;
/** This injection seam copies a server-reviewed mapping, not an RPC input. */
export function createFixedProfitAnalysisApprovalResolver(records: readonly ProfitAnalysisSourceApproval[]): ProfitAnalysisApprovalResolver {
  const copy = parsed(z.array(ProfitAnalysisSourceApprovalSchema).max(1000), records, "APPROVAL_INVALID");
  if (new Set(copy.map(row => row.workspaceId)).size !== copy.length) fail("APPROVAL_DUPLICATE");
  return async input => {
    const value = copy.find(row => row.workspaceId === input.identity.workspaceId);
    return value ? structuredClone(value) : null;
  };
}
const budgetSchema = z.object({ textBytes: z.number().int().nonnegative(), imageCount: z.literal(0), imageBytes: z.literal(0),
  contextAdmissionUnits: z.number().int().nonnegative(), outputTokens: z.number().int().positive(), contextLimit: z.number().int().positive(), tokenEstimateIsExact: z.literal(false) }).strict();
const snapshotBodySchema = z.object({
  schema: z.literal("profit-analysis-runtime/v1"), identity: identitySchema, operationId: uuid, stage: z.literal("profit_analysis"),
  configuration: z.object({ agentKey: z.literal("finance"), revision: id, hash }).strict(),
  source: z.object({ scope: ProfitAnalysisScopeSchema, month: text(7), previousMonth: text(7), sourceHash: hash, selectionHash: hash,
    authorizationHash: hash, captureHash: hash, evidenceHash: hash, sourceRows: z.number().int().min(1).max(20_000), evidenceCount: z.number().int().positive().max(250_000) }).strict(),
  approval: ProfitAnalysisSourceApprovalSchema, approvalHash: hash, skill: AssistantConversationSkillPinSchema,
  model: StrictRegisteredModelSnapshotSchema, contextHash: hash, providerRequestHash: hash, budget: budgetSchema,
  estimatedMaxCostCents: z.number().int().min(0).max(1_000_000_000),
}).strict();
export const ProfitAnalysisRuntimeSnapshotSchema = jsonAdmission(snapshotBytes).pipe(snapshotBodySchema.extend({ snapshotHash: hash }).strict().superRefine((value, ctx) => {
  try {
    const { snapshotHash, ...body } = value;
    if (snapshotHash !== digest(body) || value.approvalHash !== digest(value.approval)
      || value.approval.workspaceId !== value.identity.workspaceId || value.model.workspaceId !== value.identity.workspaceId
      || value.approval.skillSnapshotHash !== assistantConversationSkillSnapshotHash(value.skill)
      || !assistantConversationSkillScopeMatches(value.skill, value.identity.workspaceId, value.approval.skillSlug)
      || value.approval.modelConfigurationHash !== value.model.configurationHash || value.estimatedMaxCostCents > value.approval.maxCostCents)
      ctx.addIssue({ code: "custom", message: "Runtime snapshot binding mismatch" });
  } catch { ctx.addIssue({ code: "custom", message: "Runtime snapshot invalid" }); }
}));
export type ProfitAnalysisRuntimeSnapshot = z.infer<typeof ProfitAnalysisRuntimeSnapshotSchema>;
export type ProfitAnalysisRuntimeInput = {
  executor: AssistantConversationExecutor; identity: { workspaceId: number; userId: number }; operationId: string;
  configuration: AssistantConversationSavedConfiguration; source: ProfitAnalysisSource; evidence: ProfitAnalysisEvidence;
};
export type ProfitAnalysisPreparedStage = Readonly<{ stage: "profit_analysis"; bindingHash: string; contextHash: string; snapshotHash: string }>;
export type ProfitAnalysisRuntimeStageResult = { stage: "profit_analysis"; result: ProfitAnalysisResult; runId: string;
  contextHash: string; bindingHash: string; snapshotHash: string; auditWarnings: Array<"METRICS_UNAVAILABLE" | "CALL_COUNT_UNAVAILABLE"> };
type Captured = ProfitAnalysisRuntimeInput & { configuration: z.infer<typeof savedSchema> };
type Row = Record<string, unknown>;
async function rows(executor: AssistantConversationExecutor, query: string, values: unknown[]): Promise<Row[]> {
  try {
    const parts = query.split("?"); if (parts.length !== values.length + 1) fail("REGISTRY_UNAVAILABLE");
    const result = await executor.execute(sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw("")));
    if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length !== 1) fail("REGISTRY_UNAVAILABLE");
    canonical(result[0], 2 * 1024 * 1024);
    // Raw JSON insertion order participates in the existing runner's manifest
    // fingerprint. Validate canonically, but do not reorder the stored manifest.
    return structuredClone(result[0]);
  } catch { return fail("REGISTRY_UNAVAILABLE"); }
}
function financial(input: Pick<ProfitAnalysisRuntimeInput, "identity" | "source" | "evidence">) {
  const identity = parsed(identitySchema, input.identity, "IDENTITY_INVALID");
  const source = parsed(ProfitAnalysisSourceSchema, input.source, "SOURCE_INVALID", PROFIT_ANALYSIS_LIMITS.sourceBytes);
  const evidence = parsed(ProfitAnalysisEvidenceSchema, input.evidence, "EVIDENCE_INVALID", PROFIT_ANALYSIS_LIMITS.resultBytes);
  if (canonical(identity) !== canonical(source.identity)) fail("IDENTITY_MISMATCH");
  let expected: ProfitAnalysisEvidence;
  try { expected = buildProfitAnalysisEvidence(source); } catch { return fail("SOURCE_INVALID"); }
  if (canonical(expected, PROFIT_ANALYSIS_LIMITS.resultBytes) !== canonical(evidence, PROFIT_ANALYSIS_LIMITS.resultBytes)) fail("EVIDENCE_SOURCE_MISMATCH");
  if (evidence.status !== "ready") fail("SOURCE_BLOCKED");
  return { identity, source, evidence };
}
function capture(input: ProfitAnalysisRuntimeInput): Captured {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).some(key => typeof key !== "string")
    || Object.values(Object.getOwnPropertyDescriptors(input)).some(field => !("value" in field) || !field.enumerable)) fail("INPUT_INVALID");
  const data = financial(input), operationId = parsed(uuid, input.operationId, "OPERATION_INVALID");
  const configuration = parsed(savedSchema, input.configuration, "CONFIGURATION_INVALID");
  if (configuration.workspaceId !== data.identity.workspaceId || configuration.hash !== configurationHash(configuration.config)) fail("CONFIGURATION_STALE");
  if (!configuration.config.enabled || !configuration.config.modelSlug) fail("CONFIGURATION_NOT_EXECUTABLE");
  if (!input.executor || typeof input.executor.execute !== "function") fail("EXECUTOR_REQUIRED");
  if (!data.evidence.evidence.length) fail("MODEL_NOT_REQUIRED");
  return { ...data, operationId, configuration, executor: input.executor };
}

export function createProfitAnalysisRuntime(dependencies: {
  approvalResolver?: ProfitAnalysisApprovalResolver; runSkill?: typeof runEmperorSkill;
  credentialResolver?: (reference: string) => string | null | undefined;
} = {}) {
  const approvalResolver = dependencies.approvalResolver ?? createFixedProfitAnalysisApprovalResolver([]);
  const runSkill = dependencies.runSkill ?? runEmperorSkill, credentialResolver = dependencies.credentialResolver ?? resolveGovernedModelApiKey;
  type Built = { runtimeSnapshot: ProfitAnalysisRuntimeSnapshot; input: Captured; skill: AssistantConversationRegistrySkill;
    context: string; variables: Record<string, unknown> };
  const capabilities = new WeakMap<ProfitAnalysisPreparedStage, { used: boolean; built: Built }>();
  async function build(input: Captured): Promise<Built> {
    let approval: ProfitAnalysisSourceApproval;
    try {
      const value = await approvalResolver({ executor: input.executor, identity: structuredClone(input.identity), agentKey: "finance", stage: "profit_analysis" });
      if (!value) fail("SOURCE_UNAVAILABLE"); approval = parsed(ProfitAnalysisSourceApprovalSchema, value, "APPROVAL_INVALID");
    } catch (error) { if (error instanceof ProfitAnalysisRuntimeError) throw error; return fail("SOURCE_UNAVAILABLE"); }
    if (approval.workspaceId !== input.identity.workspaceId) fail("SOURCE_UNAVAILABLE");
    let skill: AssistantConversationRegistrySkill;
    try {
      const found = await rows(input.executor, "SELECT id,workspaceId,scope,slug,name,version,status,modelOverride,timeout_seconds,IF(OCTET_LENGTH(manifest)<=1048576,manifest,NULL) AS manifest FROM emperor_skills WHERE BINARY slug=BINARY ? AND (workspaceId=? OR (workspaceId IS NULL AND scope='global')) LIMIT 2 FOR SHARE", [approval.skillSlug, input.identity.workspaceId]);
      skill = assistantConversationSkillSnapshotFromRow(found[0]);
    } catch { return fail("SKILL_UNAVAILABLE"); }
    if (!assistantConversationSkillScopeMatches(skill.pin, input.identity.workspaceId, approval.skillSlug)
      || assistantConversationSkillSnapshotHash(skill.pin) !== approval.skillSnapshotHash) fail("APPROVED_SKILL_CHANGED");
    const binding = input.configuration.config.skills.find(value => value.slug === skill.pin.slug && value.enabled);
    if (!binding || binding.version !== skill.pin.version || binding.manifestSha256 !== skill.pin.manifestSha256) fail("CONFIGURATION_SKILL_MISMATCH");
    if (skill.pin.modelOverride !== null && skill.pin.modelOverride !== input.configuration.config.modelSlug) fail("MODEL_BINDING_MISMATCH");
    let model: StrictRegisteredModelSnapshot;
    try {
      const found = await rows(input.executor, "SELECT workspaceId,slug,name,provider,modelId,baseUrl,apiKeyRef,isActive,capabilityTags,maxContextTokens,costPer1kInputTokens,costPer1kOutputTokens FROM emperor_model_providers WHERE BINARY slug=BINARY ? AND (workspaceId=? OR workspaceId IS NULL) LIMIT 2 FOR SHARE", [input.configuration.config.modelSlug, input.identity.workspaceId]);
      model = strictModelSnapshotFromRow(input.identity.workspaceId, input.configuration.config.modelSlug, found[0]);
      const credential = credentialResolver(model.model.apiKeyRef);
      if (typeof credential !== "string" || !credential.trim()) fail("MODEL_CREDENTIAL_UNAVAILABLE");
    } catch { return fail("MODEL_UNAVAILABLE"); }
    if (model.configurationHash !== approval.modelConfigurationHash) fail("APPROVED_MODEL_CHANGED");
    const context = canonical({ schema: "profit-analysis-input/v1", inputContract: approval.inputContract,
      assistant: { name: input.configuration.config.name, instructions: input.configuration.config.instructions, rules: input.configuration.config.rules,
        skillBinding: { trigger: binding.trigger, instructions: binding.instructions } },
      evidence: input.evidence,
    }, STRICT_SKILL_LIMITS.textBytes);
    const variables = { agentKey: "finance", agentRevision: input.configuration.revision, operationId: input.operationId, stage: "profit_analysis" };
    const user = renderSkillTemplate(skill.userPrompt, { context, ...variables });
    // This approved contract consumes the entire JSON evidence envelope. An
    // unrelated legacy template must not silently drop or truncate that input.
    if (!user.includes(context)) fail("INPUT_CONTRACT_UNSUPPORTED");
    let admission: ReturnType<typeof strictSkillMessages>, estimatedMaxCostCents: number, providerRequestHash: string;
    try {
      admission = strictSkillMessages(skill.systemPrompt, user, [], model, skill.pin.maxTokens);
      estimatedMaxCostCents = strictCostUpperBound(model, admission.budget.contextAdmissionUnits, admission.budget.outputTokens);
      if (estimatedMaxCostCents > approval.maxCostCents) fail("COST_BUDGET_EXCEEDED");
      providerRequestHash = strictRuntimeHash({ model: model.model.modelId, messages: admission.messages, max_tokens: admission.budget.outputTokens,
        ...(skill.pin.temperature === null ? {} : { temperature: skill.pin.temperature }),
        ...(skill.pin.supportsJsonMode ? { response_format: { type: "json_object" } } : {}) });
    } catch (error) { if (error instanceof ProfitAnalysisRuntimeError) throw error; return fail("PAYLOAD_BUDGET_UNAVAILABLE"); }
    const body = { schema: "profit-analysis-runtime/v1" as const, identity: input.identity, operationId: input.operationId, stage: "profit_analysis" as const,
      configuration: { agentKey: "finance" as const, revision: input.configuration.revision, hash: input.configuration.hash },
      source: { scope: input.source.scope, month: input.source.month, previousMonth: input.source.previousMonth,
        sourceHash: input.source.sourceHash, selectionHash: input.source.selectionHash, authorizationHash: input.source.authorizationHash,
        captureHash: digest(input.source, PROFIT_ANALYSIS_LIMITS.sourceBytes), evidenceHash: digest(input.evidence, PROFIT_ANALYSIS_LIMITS.resultBytes),
        sourceRows: input.source.periods.reduce((sum, period) => sum + period.rows.length, 0), evidenceCount: input.evidence.evidence.length },
      approval, approvalHash: digest(approval), skill: skill.pin, model, contextHash: sha(context), providerRequestHash,
      budget: admission.budget, estimatedMaxCostCents };
    const runtimeSnapshot = parsed(ProfitAnalysisRuntimeSnapshotSchema, { ...body, snapshotHash: digest(body) }, "RUNTIME_SNAPSHOT_INVALID");
    return { input, runtimeSnapshot, skill, context, variables };
  }
  async function revalidate(input: ProfitAnalysisRuntimeInput & { runtimeSnapshot: unknown }): Promise<Built> {
    const captured = capture(input);
    const expected = parsed(ProfitAnalysisRuntimeSnapshotSchema, input.runtimeSnapshot, "RUNTIME_SNAPSHOT_INVALID");
    const current = await build(captured);
    if (canonical(current.runtimeSnapshot) !== canonical(expected)) fail("RUNTIME_SNAPSHOT_CHANGED");
    return current;
  }
  return {
    deterministic(input: Pick<ProfitAnalysisRuntimeInput, "identity" | "source" | "evidence">): ProfitAnalysisResult {
      const data = financial(input); if (data.evidence.evidence.length) fail("MODEL_RESULT_REQUIRED");
      return finishProfitAnalysis(data.evidence, null);
    },
    async prepare(input: ProfitAnalysisRuntimeInput) { const built = await build(capture(input)); return { runtimeSnapshot: built.runtimeSnapshot }; },
    async prepareStage(input: ProfitAnalysisRuntimeInput & { runtimeSnapshot: unknown }): Promise<ProfitAnalysisPreparedStage> {
      const built = await revalidate(input), runtime = built.runtimeSnapshot;
      const value = Object.freeze({ stage: "profit_analysis" as const, snapshotHash: runtime.snapshotHash, contextHash: runtime.contextHash,
        bindingHash: digest({ schema: "profit-analysis-stage/v1", stage: "profit_analysis", snapshotHash: runtime.snapshotHash, contextHash: runtime.contextHash, providerRequestHash: runtime.providerRequestHash }) });
      capabilities.set(value, { used: false, built }); return value;
    },
    async executeStage(value: ProfitAnalysisPreparedStage, options: { signal?: AbortSignal;
      beforeDispatch: (receipt: StrictSkillDispatchReceipt, verifyFresh: (executor: AssistantConversationExecutor, configuration: AssistantConversationSavedConfiguration, source: ProfitAnalysisSource, evidence: ProfitAnalysisEvidence) => Promise<void>) => Promise<void>;
    }): Promise<ProfitAnalysisRuntimeStageResult> {
      const state = capabilities.get(value); if (!state || state.used) fail("STAGE_ALREADY_CONSUMED"); state.used = true;
      if (!options || typeof options.beforeDispatch !== "function" || options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail("EXECUTION_OPTIONS_INVALID");
      if (options.signal?.aborted) fail("CANCELED");
      const { built } = state, { runtimeSnapshot: runtime, skill } = built;
      let allowed = false, dispatchedRunId: string | null = null, fenceCalls = 0;
      const validate = (content: string) => {
        if (typeof content !== "string" || Buffer.byteLength(content) > STRICT_SKILL_LIMITS.responseBytes) fail("RESULT_CONTRACT_INVALID");
        try { return finishProfitAnalysis(built.input.evidence, ProfitAnalysisReplySchema.parse(JSON.parse(content))); }
        catch { return fail("RESULT_CONTRACT_INVALID"); }
      };
      try {
        const result = await runSkill({ skillSlug: skill.pin.slug, userId: runtime.identity.userId, workspaceId: runtime.identity.workspaceId,
          context: built.context, variables: built.variables, attachments: [], skillVersionPolicy: "pinned", expectedSkillVersion: String(skill.pin.version), expectedSkillStatus: "Released",
          expectedSkillPromptHash: skill.pin.systemPromptSha256.slice(0, 16), expectedSkillUserPromptHash: skill.pin.userPromptSha256.slice(0, 16), expectedSkillManifestHash: skill.pin.manifestRawSha256.slice(0, 16),
          modelOverride: runtime.model.model.slug, fallbackModels: [], maxModelAttempts: 1, executionPreset: "standard", migrationSource: "ops.profit.private.strict", signal: options.signal, validate,
          strictExecution: { modelSnapshot: runtime.model, bindingHash: value.bindingHash, stage: "profit_analysis", expectedSkillModelOverride: skill.pin.modelOverride,
            expectedSkillTimeoutSeconds: skill.pin.timeoutSeconds, maxCostCents: runtime.approval.maxCostCents,
            beforeDispatch: async receipt => {
              if (++fenceCalls !== 1 || options.signal?.aborted) fail("DISPATCH_DENIED");
              const checked = parsed(z.object({ runId: text(128), stage: z.literal("profit_analysis"), requestHash: hash, modelConfigurationHash: hash, bindingHash: hash, budget: budgetSchema }).strict(), receipt, "DISPATCH_RECEIPT_INVALID");
              if (checked.requestHash !== runtime.providerRequestHash || checked.modelConfigurationHash !== runtime.model.configurationHash || checked.bindingHash !== value.bindingHash
                || canonical(checked.budget) !== canonical(runtime.budget)) fail("DISPATCH_RECEIPT_MISMATCH");
              let verified = false, verifying = false, invalid = false, open = true;
              try {
                await options.beforeDispatch(structuredClone(checked), (executor, configuration, source, evidence) => {
                  const verification = (async () => {
                    if (!open || verifying || verified) { invalid = true; fail("FRESH_VERIFICATION_REUSED"); } verifying = true;
                    await revalidate({ executor, identity: runtime.identity, operationId: runtime.operationId, configuration, source, evidence, runtimeSnapshot: runtime });
                    if (!open) { invalid = true; fail("FRESH_VERIFICATION_NOT_AWAITED"); } verified = true;
                  })();
                  // An incorrect callback that forgets to await verification is
                  // denied below; its detached rejection must not crash a worker.
                  void verification.catch(() => { invalid = true; });
                  return verification;
                });
              } catch { return fail("DISPATCH_DENIED"); } finally { open = false; }
              if (!verified || invalid) fail("FRESH_AUTHORIZATION_REQUIRED"); if (options.signal?.aborted) fail("CANCELED");
              dispatchedRunId = checked.runId; allowed = true;
            },
          } });
        if (!allowed || result.runId !== dispatchedRunId || result.skillSlug !== skill.pin.slug || result.modelSlug !== runtime.model.model.slug
          || result.provider !== "custom" || result.fallbackCount !== 0) fail("RESULT_RECEIPT_MISMATCH");
        const checked = validate(result.content);
        if (canonical(checked, PROFIT_ANALYSIS_LIMITS.resultBytes) !== canonical(result.parsed, PROFIT_ANALYSIS_LIMITS.resultBytes)) fail("RESULT_CONTRACT_MISMATCH");
        const auditWarnings = parsed(z.array(z.enum(["METRICS_UNAVAILABLE", "CALL_COUNT_UNAVAILABLE"])).max(2), result.auditWarnings ?? [], "RESULT_RECEIPT_INVALID");
        // Paid, validated results are not discarded for advisory metric warnings
        // or an after-dispatch config change. The domain owns durable persistence.
        return { stage: "profit_analysis", result: checked, runId: result.runId, contextHash: value.contextHash, bindingHash: value.bindingHash, snapshotHash: value.snapshotHash, auditWarnings };
      } catch (error) {
        if (error instanceof ProfitAnalysisRuntimeError) throw error;
        if (error instanceof StrictSkillRuntimeError && /^STRICT_[A-Z0-9_]{1,90}$/u.test(error.code)) return fail(error.code);
        return fail("RUNTIME_RESULT_UNKNOWN");
      }
    },
  };
}
export type ProfitAnalysisRuntime = ReturnType<typeof createProfitAnalysisRuntime>;
export const profitAnalysisRuntime = createProfitAnalysisRuntime();
