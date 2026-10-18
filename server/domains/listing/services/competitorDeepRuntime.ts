import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { canonicalCompetitorResearchEvidence as canonical } from "../../../../shared/competitorResearchEvidence";
import { assistantConversationSkillSnapshotFromRow, type AssistantConversationRegistrySkill } from "../../ai_os/services/assistantConversationSourcePrimitives";
import { strictModelSnapshotFromRow, strictSkillMessages, strictCostUpperBound, strictRuntimeHash, STRICT_SKILL_LIMITS } from "../../ai_os/services/strictSkillRuntime";
import { runEmperorSkill, renderSkillTemplate, type StrictSkillDispatchReceipt } from "../../ai_os/services/skillRunner";
import { resolveGovernedModelApiKey } from "../../ai_os/services/teamorouterCatalog";
import { createSourceApprovalFileLoader } from "../../../services/sourceApprovalFileLoader";
import { DEEP_STAGES, CompetitorDeepApprovalSchema, CompetitorDeepRuntimeSnapshotSchema, deepRuntimeHash,
  type CompetitorDeepRuntimeSnapshot, type CompetitorDeepApproval } from "./competitorDeepRuntimeContract";
import { deepSkillPlanSchema, type DeepExecutionRequest, type DeepModelReceipt } from "./competitorDeepExecution";
type Executor = { execute(query: SQL): Promise<unknown> };
type Identity = { userId: number; workspaceId: number };
export class CompetitorDeepRuntimeError extends Error {
  constructor(readonly code: string) { super(`COMPETITOR_DEEP_${code}`); this.name = "CompetitorDeepRuntimeError"; }
}
function fail(code: string): never { throw new CompetitorDeepRuntimeError(code); }
export function createFixedCompetitorDeepApprovalResolver(raw: unknown) {
  const values = z.array(CompetitorDeepApprovalSchema).max(1000).parse(raw);
  if (new Set(values.map(value => `${value.workspaceId}:${value.stage}`)).size !== values.length) fail("APPROVAL_AMBIGUOUS");
  return (workspaceId: number) => values.filter(value => value.workspaceId === workspaceId).map(value => structuredClone(value));
}
export function createFileCompetitorDeepApprovalResolver() {
  const load = createSourceApprovalFileLoader({ kind: "listing_deep_analysis", decode: createFixedCompetitorDeepApprovalResolver });
  return async (workspaceId: number) => { try { const file = await load(); return file.status === "ready" ? file.value(workspaceId) : []; }
    catch { return fail("APPROVAL_UNAVAILABLE"); } };
}
async function one(executor: Executor, text: string, args: unknown[]) {
  const parts = text.split("?");
  const response = await executor.execute(sql.join(parts.flatMap((part, i) => i < args.length ? [sql.raw(part), sql`${args[i]}`] : [sql.raw(part)]), sql.raw("")));
  if (!Array.isArray(response) || !Array.isArray(response[0]) || response[0].length !== 1) fail("REGISTRY_UNAVAILABLE");
  return response[0][0] as Record<string, unknown>;
}
export function createCompetitorDeepRuntime(deps: { approvals?: (workspaceId: number) => Promise<CompetitorDeepApproval[]>;
  runSkill?: typeof runEmperorSkill; credential?: typeof resolveGovernedModelApiKey } = {}) {
  const approvals = deps.approvals ?? createFileCompetitorDeepApprovalResolver(), run = deps.runSkill ?? runEmperorSkill;
  const credential = deps.credential ?? resolveGovernedModelApiKey;
  async function build(executor: Executor, workspaceId: number) {
    if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) fail("WORKSPACE_REQUIRED");
    const approved = createFixedCompetitorDeepApprovalResolver(await approvals(workspaceId))(workspaceId);
    if (approved.length !== 5) fail("SOURCE_UNAVAILABLE");
    const stages = [], originals: AssistantConversationRegistrySkill[] = [];
    for (const key of DEEP_STAGES) {
      const approval = approved.find(item => item.stage === key)!;
      const skill = assistantConversationSkillSnapshotFromRow(await one(executor,
        "SELECT id,workspaceId,scope,slug,name,version,status,modelOverride,timeout_seconds,IF(OCTET_LENGTH(manifest)<=1048576,manifest,NULL) AS manifest FROM emperor_skills WHERE BINARY slug=BINARY ? AND (workspaceId=? OR (workspaceId IS NULL AND scope='global')) LIMIT 2 FOR SHARE", [approval.skillSlug, workspaceId]));
      const model = strictModelSnapshotFromRow(workspaceId, approval.modelSlug, await one(executor,
        "SELECT workspaceId,slug,name,provider,modelId,baseUrl,apiKeyRef,isActive,capabilityTags,maxContextTokens,costPer1kInputTokens,costPer1kOutputTokens FROM emperor_model_providers WHERE BINARY slug=BINARY ? AND (workspaceId=? OR workspaceId IS NULL) LIMIT 2 FOR SHARE", [approval.modelSlug, workspaceId]));
      if (!credential(model.model.apiKeyRef)) fail("MODEL_CREDENTIAL_UNAVAILABLE");
      stages.push({ approval, skill: skill.pin, model }); originals.push(skill);
    }
    const body = { version: 1 as const, workspaceId, stages };
    const runtime = CompetitorDeepRuntimeSnapshotSchema.parse({ ...body, snapshotHash: deepRuntimeHash(body) });
    const skills = deepSkillPlanSchema.parse({ version: 1, authority: "user-primary", approvalRef: runtime.snapshotHash,
      ...Object.fromEntries(stages.map(item => [item.approval.stage, { skillSlug: item.skill.slug, version: String(item.skill.version), status: "Released",
        systemPromptHash: item.skill.systemPromptSha256.slice(0, 16), userPromptHash: item.skill.userPromptSha256.slice(0, 16), manifestHash: item.skill.manifestRawSha256.slice(0, 16) }])) });
    return { runtime, skills, originals };
  }
  async function revalidate(executor: Executor, runtime: CompetitorDeepRuntimeSnapshot) {
    const expected = CompetitorDeepRuntimeSnapshotSchema.parse(runtime), current = await safeBuild(executor, expected.workspaceId);
    if (current.runtime.snapshotHash !== expected.snapshotHash) fail("APPROVED_RUNTIME_CHANGED");
    return current;
  }
  async function safeBuild(executor: Executor, workspaceId: number) {
    try { return await build(executor, workspaceId); } catch (error) { if (error instanceof CompetitorDeepRuntimeError) throw error; return fail("REGISTRY_UNAVAILABLE"); }
  }
  type Prepared = Readonly<{ requestHash: string; snapshotHash: string }>;
  const preparedStages = new WeakMap<Prepared, { used: boolean; built: Awaited<ReturnType<typeof build>>; identity: Identity; request: DeepExecutionRequest }>();
  return {
    async prepare(executor: Executor, workspaceId: number) { const { runtime, skills } = await safeBuild(executor, workspaceId); return { runtime, skills }; },
    revalidate,
    async prepareStage(input: { executor: Executor; identity: Identity; runtime: CompetitorDeepRuntimeSnapshot; request: DeepExecutionRequest }): Promise<Prepared> {
      const built = await revalidate(input.executor, input.runtime);
      const prepared = Object.freeze({ requestHash: input.request.requestHash, snapshotHash: built.runtime.snapshotHash });
      preparedStages.set(prepared, { used: false, built, identity: structuredClone(input.identity), request: structuredClone(input.request) }); return prepared;
    },
    async invoke(options: { prepared: Prepared;
      signal: AbortSignal; beforeDispatch: (receipt: StrictSkillDispatchReceipt, verify: (executor: Executor) => Promise<void>) => Promise<void>;
    }): Promise<{ raw: unknown; receipt: DeepModelReceipt }> {
      const captured = preparedStages.get(options.prepared); if (!captured || captured.used) fail("STAGE_ALREADY_CONSUMED"); captured.used = true;
      const input = { ...options, identity: captured.identity, request: captured.request };
      const { runtime, originals, skills } = captured.built;
      if (input.identity.workspaceId !== runtime.workspaceId || !Number.isSafeInteger(input.identity.userId) || input.identity.userId <= 0) fail("IDENTITY_INVALID");
      const key = input.request.stage.startsWith("buyers:") ? "buyers_batch" : input.request.stage;
      const index = DEEP_STAGES.indexOf(key as typeof DEEP_STAGES[number]);
      if (index < 0 || canonical(input.request.binding) !== canonical(skills[DEEP_STAGES[index]])) fail("SKILL_BINDING_CHANGED");
      const item = runtime.stages[index], skill = originals[index];
      const context = canonical({ schema: "competitor-deep-input/v1", inputContract: item.approval.inputContract, request: input.request });
      if (Buffer.byteLength(context) > STRICT_SKILL_LIMITS.textBytes) fail("INPUT_LIMIT");
      const userPrompt = renderSkillTemplate(skill.userPrompt, { context });
      if (!userPrompt.includes(context)) fail("INPUT_CONTRACT_UNSUPPORTED");
      const admission = strictSkillMessages(skill.systemPrompt, userPrompt, [], item.model, item.skill.maxTokens);
      if (strictCostUpperBound(item.model, admission.budget.contextAdmissionUnits, admission.budget.outputTokens) > item.approval.maxCostCents) fail("COST_BUDGET_EXCEEDED");
      const providerHash = strictRuntimeHash({ model: item.model.model.modelId, messages: admission.messages, max_tokens: admission.budget.outputTokens,
        ...(item.skill.temperature === null ? {} : { temperature: item.skill.temperature }), ...(item.skill.supportsJsonMode ? { response_format: { type: "json_object" } } : {}) });
      const bindingHash = deepRuntimeHash({ runtime: runtime.snapshotHash, request: input.request.requestHash, dispatch: input.request.dispatchId, providerHash });
      let dispatched = false, runId: string | null = null, calls = 0;
      const validate = (text: string): unknown => { if (Buffer.byteLength(text) > STRICT_SKILL_LIMITS.responseBytes) fail("OUTPUT_LIMIT");
        const raw: unknown = JSON.parse(text); canonical(raw); return raw; };
      const result = await run({ skillSlug: item.skill.slug, userId: input.identity.userId, workspaceId: runtime.workspaceId, context, variables: {}, attachments: [], skillVersionPolicy: "pinned",
        expectedSkillVersion: String(item.skill.version), expectedSkillStatus: "Released", expectedSkillPromptHash: item.skill.systemPromptSha256.slice(0, 16),
        expectedSkillUserPromptHash: item.skill.userPromptSha256.slice(0, 16), expectedSkillManifestHash: item.skill.manifestRawSha256.slice(0, 16),
        modelOverride: item.model.model.slug, fallbackModels: [], maxModelAttempts: 1, executionPreset: "standard", migrationSource: "listing.competitor.deep.strict",
        signal: input.signal, validate, strictExecution: { stage: "competitor_deep", modelSnapshot: item.model, bindingHash,
          expectedSkillModelOverride: item.skill.modelOverride, expectedSkillTimeoutSeconds: item.skill.timeoutSeconds, maxCostCents: item.approval.maxCostCents,
          beforeDispatch: async receipt => {
            if (++calls !== 1 || input.signal.aborted || receipt.requestHash !== providerHash || receipt.bindingHash !== bindingHash
              || receipt.stage !== "competitor_deep" || receipt.modelConfigurationHash !== item.model.configurationHash
              || canonical(receipt.budget) !== canonical(admission.budget)) fail("DISPATCH_DENIED");
            let verified = false, open = true, verifying = false, invalid = false;
            try { await input.beforeDispatch(receipt, executor => {
              const pending = (async () => { if (!open || verifying) { invalid = true; fail("FRESH_VERIFICATION_REUSED"); } verifying = true;
                await revalidate(executor, runtime); if (!open) { invalid = true; fail("FRESH_VERIFICATION_NOT_AWAITED"); } verified = true; })();
              void pending.catch(() => { invalid = true; }); return pending;
            }); } finally { open = false; }
            if (!verified || invalid || input.signal.aborted) fail("DISPATCH_DENIED");
            dispatched = true; runId = receipt.runId;
          } } });
      if (!dispatched || result.runId !== runId || result.provider !== "custom" || result.fallbackCount !== 0
        || result.skillSlug !== item.skill.slug || result.modelSlug !== item.model.model.slug) fail("RESULT_RECEIPT_INVALID");
      const raw = validate(result.content);
      if (canonical(raw) !== canonical(result.parsed)) fail("RESULT_INVALID");
      return { raw, receipt: { runId: result.runId, skillSlug: item.skill.slug, skillVersion: String(item.skill.version),
        skillPromptHash: item.skill.systemPromptSha256.slice(0, 16), skillManifestHash: item.skill.manifestRawSha256.slice(0, 16), modelSlug: item.model.model.slug } };
    },
  };
}
export const competitorDeepRuntime = createCompetitorDeepRuntime();
