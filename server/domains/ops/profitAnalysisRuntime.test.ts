import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const external = vi.hoisted(() => ({ db: vi.fn(() => { throw new Error("NO_REAL_DATABASE"); }), provider: vi.fn(() => { throw new Error("NO_REAL_PROVIDER"); }) }));
vi.mock("../../repositories/dbClient", () => ({ getDb: external.db }));
vi.mock("../../_core/llm", () => ({ invokeLLM: external.provider }));
vi.mock("../../infrastructure/http/safeHttpClient", () => ({ SafeHttpError: class extends Error {}, safeHttpRequest: external.provider }));
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import { buildProfitAnalysisEvidence, ProfitAnalysisResultSchema, type ProfitAnalysisSource, type ProfitAnalysisEvidence } from "../../../shared/profitAnalysis";
import { configurationHash, assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash } from "../ai_os/services/assistantConversationSourcePrimitives";
import type { AssistantConversationExecutor } from "../ai_os/repositories/assistantConversations";
import type { AssistantConversationSavedConfiguration } from "../ai_os/services/assistantConversationContext";
import { renderSkillTemplate, type RunSkillInput, type RunSkillResult } from "../ai_os/services/skillRunner";
import { strictModelSnapshotFromRow, strictRuntimeHash, strictSkillMessages, StrictSkillRuntimeError } from "../ai_os/services/strictSkillRuntime";
import { createProfitAnalysisRuntime, createFixedProfitAnalysisApprovalResolver, ProfitAnalysisRuntimeSnapshotSchema, ProfitAnalysisSourceApprovalSchema,
  type ProfitAnalysisSourceApproval, type ProfitAnalysisRuntimeInput } from "./profitAnalysisRuntime";

const clone = <T>(value: T): T => structuredClone(value);
const identity = { workspaceId: 3, userId: 7 }, operationId = "b7d29fe8-2c53-4c34-bfe7-cbe34c102125";
const scope = { storeName: "SYNTHETIC_STORE", country: "US", parentAsin: "SYNTHETIC_PARENT", currency: "USD", basis: "child_rows" as const };
const dialect = new MySqlDialect();
function source(unchanged = false): ProfitAnalysisSource {
  const periods = ["2026-08", "2026-09"].map((month, index) => {
    const payload = [{ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])), salesQty: 10, salesAmount: 100,
      financialProfit: unchanged ? 20 : 20 + index * 10, yearMonth: month, parentAsin: scope.parentAsin, asin: "SYNTHETIC_CHILD", sku: "SYNTHETIC_SKU", title: "Synthetic only",
      storeName: scope.storeName, site: "US", operator: null, raw: { currency: "USD", unusedPrivateField: "SYNTHETIC_PRIVATE_ORIGINAL" } }];
    const record = { id: index + 8, workspaceId: 3, userId: 7, fileName: "synthetic.xlsx", fileHash: "f".repeat(64), status: "completed", totalRows: 1, skippedRows: 0, unallocatedRows: 0,
      months: [month], payload, createdAt: "2026-10-01 00:00:00.000000", confirmedAt: "2026-10-01 00:00:00.000000", fileReferenceKind: "storage", sourceRunId: null } as MonthlyFinancialBatchRecord;
    return { month, rows: parseMonthlyFinancialBatch(record).rows, selection: { complete: true as const, rule: "latest_completed_batch_per_month_store_site" as const,
      selectedBatchId: record.id, recordHash: String(index + 8).repeat(64), scopeRowCount: 1, authorizedRowCount: 1 } };
  });
  return { version: 1, identity, scope, month: "2026-09", previousMonth: "2026-08", periods, sourceHash: "a".repeat(64), selectionHash: "b".repeat(64), authorizationHash: "c".repeat(64) };
}
function harness(unchanged = false) {
  const skills = [{ id: 4, workspaceId: 3 as number | null, scope: "workspace", slug: "ops.profit.synthetic", name: "Synthetic profit Skill", version: 2, status: "Released", modelOverride: null as string | null, timeout_seconds: 120,
    manifest: { implementation: { systemPrompt: "SYNTHETIC_REVIEWED_PROMPT_NOT_APPROVAL", userPromptTemplate: "{{context}}", maxTokens: 4096, temperature: 0.2, supportsJsonMode: true } } }];
  const models = [{ workspaceId: 3 as number | null, slug: "synthetic-finance-model", name: "Synthetic finance model", provider: "custom", modelId: "synthetic-model-id", baseUrl: "https://example.invalid/v1", apiKeyRef: "env:EXTERNAL_LLM_API_KEY", isActive: 1,
    capabilityTags: ["text"], maxContextTokens: 2000000, costPer1kInputTokens: "0.001" as string | null, costPer1kOutputTokens: "0.002" as string | null }];
  const skill = assistantConversationSkillSnapshotFromRow(skills[0]);
  const config = { name: "Synthetic finance agent", description: "Synthetic", enabled: true, modelSlug: models[0].slug, instructions: "SYNTHETIC_PRIVATE_INSTRUCTIONS", rules: ["SYNTHETIC_PRIVATE_RULE"],
    skills: [{ slug: skill.pin.slug, enabled: true, trigger: "synthetic trigger", instructions: "synthetic binding instructions", version: skill.pin.version, manifestSha256: skill.pin.manifestSha256 }] };
  const configuration: AssistantConversationSavedConfiguration = { workspaceId: 3, agentKey: "finance", revision: 1, hash: configurationHash(config), config };
  const original = source(unchanged), evidence = buildProfitAnalysisEvidence(original);
  const input: ProfitAnalysisRuntimeInput = { executor: { execute: async () => [] }, identity, operationId, configuration, source: original, evidence };
  let approval: ProfitAnalysisSourceApproval | null = { version: 1, workspaceId: 3, agentKey: "finance", stage: "profit_analysis", skillSlug: skill.pin.slug,
    skillSnapshotHash: assistantConversationSkillSnapshotHash(skill.pin), modelConfigurationHash: strictModelSnapshotFromRow(3, models[0].slug, models[0]).configurationHash,
    source: { origin: "qingdao", revision: "synthetic-revision", approvalRef: "synthetic-only-not-real-approval", evidenceId: "synthetic-source-evidence", evidenceHash: "e".repeat(64) },
    inputContract: "profit_evidence_v1", outputContract: "profit_evidence_selection_v1", maxCostCents: 10000 };
  const executor = { execute: vi.fn(async (statement: Parameters<AssistantConversationExecutor["execute"]>[0]) => {
    const query = dialect.sqlToQuery(statement);
    if (query.sql.includes("FROM emperor_skills")) return [clone(skills.filter(row => row.slug === query.params[0]))];
    if (query.sql.includes("FROM emperor_model_providers")) return [clone(models.filter(row => row.slug === query.params[0]))];
    throw new Error("UNEXPECTED_SQL");
  }) };
  input.executor = executor;
  const credentialResolver = vi.fn(() => "SYNTHETIC_CREDENTIAL_NEVER_REAL");
  const resolver = vi.fn(async () => clone(approval));
  let output: unknown = { severity: "需关注", reasons: [{ evidenceId: evidence.evidence[0]?.id ?? "unused", explanation: "已知指标变化，需要结合完整覆盖核对。" }] };
  let providerCalls = 0, providerFailure: unknown = null, skipFence = false, parsedOverride: unknown, alterReceipt: ((value: Record<string, unknown>) => void) | null = null;
  const requests: RunSkillInput<unknown>[] = [];
  const runSkill = async <T>(request: RunSkillInput<T>): Promise<RunSkillResult<T>> => {
    requests.push(request as RunSkillInput<unknown>);
    const current = skills.find(row => row.slug === request.skillSlug)!;
    const model = request.strictExecution!.modelSnapshot;
    const user = renderSkillTemplate(current.manifest.implementation.userPromptTemplate, { context: request.context, emphasis: "", ...request.variables });
    const messages = strictSkillMessages(current.manifest.implementation.systemPrompt, user, [], model, current.manifest.implementation.maxTokens);
    const requestHash = strictRuntimeHash({ model: model.model.modelId, messages: messages.messages, max_tokens: messages.budget.outputTokens, temperature: current.manifest.implementation.temperature, response_format: { type: "json_object" } });
    const receipt = { runId: "synthetic-run", stage: request.strictExecution!.stage, requestHash, modelConfigurationHash: model.configurationHash, bindingHash: request.strictExecution!.bindingHash, budget: messages.budget };
    alterReceipt?.(receipt);
    if (!skipFence) await request.strictExecution!.beforeDispatch(receipt);
    providerCalls++; if (providerFailure) throw providerFailure;
    const content = typeof output === "string" ? output : JSON.stringify(output);
    return { runId: "synthetic-run", skillSlug: request.skillSlug, skillName: current.name, skillVersion: "2", skillPromptHash: request.expectedSkillPromptHash!, skillManifestHash: request.expectedSkillManifestHash!,
      content, parsed: (parsedOverride === undefined ? request.validate!(content) : parsedOverride) as T, modelSlug: model.model.slug, provider: "custom", durationMs: 1, costCents: 1,
      inputTokens: 10, outputTokens: 10, fallbackCount: 0, executionPreset: "standard", governance: null, auditWarnings: ["METRICS_UNAVAILABLE"] };
  };
  const runtime = createProfitAnalysisRuntime({ approvalResolver: resolver, runSkill, credentialResolver });
  const fence = async (_: unknown, verify: (executor: AssistantConversationExecutor, configuration: AssistantConversationSavedConfiguration, source: ProfitAnalysisSource, evidence: ProfitAnalysisEvidence) => Promise<void>) => {
    await verify(input.executor, input.configuration, input.source, input.evidence);
  };
  return { input, runtime, skills, models, resolver, credentialResolver, executor, runSkill, requests, fence,
    getApproval: () => approval!, setApproval: (value: ProfitAnalysisSourceApproval | null) => { approval = value; }, calls: () => providerCalls,
    setOutput: (value: unknown) => { output = value; }, failProvider: (error: unknown) => { providerFailure = error; }, skipFence: () => { skipFence = true; },
    setParsed: (value: unknown) => { parsedOverride = value; }, alterReceipt: (fn: (value: Record<string, unknown>) => void) => { alterReceipt = fn; } };
}
beforeEach(() => vi.clearAllMocks());
async function ready(h = harness()) { const { runtimeSnapshot } = await h.runtime.prepare(h.input); const stage = await h.runtime.prepareStage({ ...h.input, runtimeSnapshot }); return { h, runtimeSnapshot, stage }; }

describe("profit runtime trusted approval and complete capture", () => {
  it("defaults to no approved source without any registry, credential or provider calls", async () => {
    const h = harness(), runtime = createProfitAnalysisRuntime({ runSkill: h.runSkill, credentialResolver: h.credentialResolver });
    await expect(runtime.prepare(h.input)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    expect(h.executor.execute).not.toHaveBeenCalled(); expect(h.credentialResolver).not.toHaveBeenCalled(); expect(h.calls()).toBe(0);
  });
  it("fixed resolver copies mappings and rejects duplicate workspace approvals", async () => {
    const h = harness(), record = h.getApproval(), resolver = createFixedProfitAnalysisApprovalResolver([record]); record.source.revision = "mutated";
    expect((await resolver({ executor: h.executor, identity, agentKey: "finance", stage: "profit_analysis" }))?.source.revision).toBe("synthetic-revision");
    expect(() => createFixedProfitAnalysisApprovalResolver([record, record])).toThrow("APPROVAL_DUPLICATE");
    expect(await resolver({ executor: h.executor, identity: { ...identity, workspaceId: 4 }, agentKey: "finance", stage: "profit_analysis" })).toBeNull();
  });
  it.each(["friend", "user_listing", "reviewed_supplement"])("never converts %s into Qingdao authority", origin => {
    const h = harness(); expect(ProfitAnalysisSourceApprovalSchema.safeParse({ ...h.getApproval(), source: { ...h.getApproval().source, origin } }).success).toBe(false);
  });
  it.each(["inputContract", "outputContract", "agentKey", "stage", "workspaceId"])("rejects foreign approval %s", async field => {
    const h = harness(); h.setApproval({ ...h.getApproval(), [field]: field === "workspaceId" ? 9 : "wrong" } as ProfitAnalysisSourceApproval);
    await expect(h.runtime.prepare(h.input)).rejects.toThrow(); expect(h.calls()).toBe(0);
  });
  it("snapshot freezes full pins, complete original hash and metadata, not private bodies or keys", async () => {
    const h = harness(), { runtimeSnapshot: r } = await h.runtime.prepare(h.input);
    expect(ProfitAnalysisRuntimeSnapshotSchema.parse(r)).toEqual(r); expect(r).toMatchObject({ stage: "profit_analysis", source: { sourceRows: 2 }, configuration: { agentKey: "finance" } });
    const stored = JSON.stringify(r); for (const body of ["SYNTHETIC_CREDENTIAL_NEVER_REAL", "SYNTHETIC_PRIVATE_ORIGINAL", "SYNTHETIC_PRIVATE_RULE", "SYNTHETIC_PRIVATE_INSTRUCTIONS", "SYNTHETIC_REVIEWED_PROMPT_NOT_APPROVAL"]) expect(stored).not.toContain(body);
    expect(stored).not.toContain('"raw":'); expect(stored).not.toContain('"metrics":');
    h.input.source.periods[0].rows[0].raw.unusedPrivateField = "CHANGED_UNROUNDED_ORIGINAL";
    const changed = await h.runtime.prepare(h.input); expect(changed.runtimeSnapshot.source.captureHash).not.toBe(r.source.captureHash); expect(changed.runtimeSnapshot.snapshotHash).not.toBe(r.snapshotHash);
  });
  it.each(["revision", "hash", "workspaceId", "agentKey", "enabled", "binding"])("rejects stale/foreign configuration %s", async field => {
    const h = harness();
    if (field === "revision") h.input.configuration.revision = 0;
    if (field === "hash") h.input.configuration.hash = "d".repeat(64);
    if (field === "workspaceId") h.input.configuration.workspaceId = 4;
    if (field === "agentKey") h.input.configuration.agentKey = "listing";
    if (field === "enabled") h.input.configuration.config.enabled = false;
    if (field === "binding") { h.input.configuration.config.skills[0].enabled = false; h.input.configuration.hash = configurationHash(h.input.configuration.config); }
    await expect(h.runtime.prepare(h.input)).rejects.toThrow(); expect(h.calls()).toBe(0);
  });
  it.each(["version", "name", "status", "manifest", "modelOverride", "timeout_seconds"])("rejects changed approved Skill %s", async field => {
    const h = harness(); Object.assign(h.skills[0], { [field]: field === "version" ? 3 : field === "timeout_seconds" ? 90 : field === "manifest" ? { implementation: { systemPrompt: "changed" } } : "changed" });
    await expect(h.runtime.prepare(h.input)).rejects.toThrow(); expect(h.calls()).toBe(0);
  });
  it("does not choose an arbitrary global/workspace registry duplicate", async () => {
    const h = harness(); h.skills.push({ ...h.skills[0], workspaceId: null, scope: "global" });
    await expect(h.runtime.prepare(h.input)).rejects.toMatchObject({ code: "SKILL_UNAVAILABLE" }); expect(h.calls()).toBe(0);
  });
  it("rejects shared NULL Skill scope even with its hash in a supplied approval", async () => {
    const h = harness(); h.skills[0].workspaceId = null; h.skills[0].scope = "shared";
    h.getApproval().skillSnapshotHash = assistantConversationSkillSnapshotHash(assistantConversationSkillSnapshotFromRow(h.skills[0]).pin);
    await expect(h.runtime.prepare(h.input)).rejects.toMatchObject({ code: "APPROVED_SKILL_CHANGED" });
  });
  it.each(["modelId", "baseUrl", "provider", "isActive", "apiKeyRef", "costPer1kInputTokens"])("rejects invalid or unapproved model %s without fallback", async field => {
    const h = harness(); Object.assign(h.models[0], { [field]: field === "isActive" ? 0 : field === "costPer1kInputTokens" ? null : "changed" });
    await expect(h.runtime.prepare(h.input)).rejects.toThrow(); expect(h.calls()).toBe(0);
  });
  it("requires a valid controlled credential but never retains its value", async () => {
    const h = harness(); h.credentialResolver.mockReturnValue(""); await expect(h.runtime.prepare(h.input)).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    expect(h.credentialResolver).toHaveBeenCalledWith("env:EXTERNAL_LLM_API_KEY"); expect(h.calls()).toBe(0);
  });
  it("never accepts forged evidence, a foreign actor or a blocked source", async () => {
    const h = harness(); h.input.evidence.aggregates[0].metrics.salesAmount = 999;
    await expect(h.runtime.prepare(h.input)).rejects.toThrow();
    const foreign = harness(); foreign.input.identity = { ...identity, userId: 8 }; await expect(foreign.runtime.prepare(foreign.input)).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    const blocked = harness(); blocked.input.source.periods[0].rows = []; blocked.input.source.periods[0].selection.scopeRowCount = 0; blocked.input.source.periods[0].selection.authorizedRowCount = 0;
    blocked.input.evidence = buildProfitAnalysisEvidence(blocked.input.source); await expect(blocked.runtime.prepare(blocked.input)).rejects.toMatchObject({ code: "SOURCE_BLOCKED" });
  });
  it("reads no getter when admitting caller data and detects snapshot mutation", async () => {
    const h = harness(); let getters = 0; Object.defineProperty(h.input.source, "sourceHash", { enumerable: true, get() { getters++; return "a".repeat(64); } });
    await expect(h.runtime.prepare(h.input)).rejects.toThrow(); expect(getters).toBe(0);
    const other = harness(), { runtimeSnapshot } = await other.runtime.prepare(other.input); runtimeSnapshot.operationId = "a7d29fe8-2c53-4c34-bfe7-cbe34c102125";
    await expect(other.runtime.prepareStage({ ...other.input, runtimeSnapshot })).rejects.toMatchObject({ code: "RUNTIME_SNAPSHOT_INVALID" });
  });
  it("deterministic no-change finish needs no configuration, approval or provider", () => {
    const h = harness(true); h.setApproval(null); h.models.splice(0); h.skills.splice(0);
    const result = h.runtime.deterministic(h.input); expect(result).toMatchObject({ modelCalled: false, severity: null, mode: "deterministic_no_comparable_change" });
    expect(h.resolver).not.toHaveBeenCalled(); expect(h.executor.execute).not.toHaveBeenCalled(); expect(h.calls()).toBe(0);
  });
  it("does not prepare an unnecessary model call or deterministically invent a changed result", async () => {
    const noChange = harness(true); await expect(noChange.runtime.prepare(noChange.input)).rejects.toMatchObject({ code: "MODEL_NOT_REQUIRED" }); expect(noChange.resolver).not.toHaveBeenCalled();
    const changed = harness(); expect(() => changed.runtime.deterministic(changed.input)).toThrow("MODEL_RESULT_REQUIRED");
  });
  it("rejects an approved legacy template that drops the complete evidence input", async () => {
    const h = harness(); h.skills[0].manifest.implementation.userPromptTemplate = "{{unknownLegacyField}}";
    const pin = assistantConversationSkillSnapshotFromRow(h.skills[0]).pin; h.getApproval().skillSnapshotHash = assistantConversationSkillSnapshotHash(pin);
    h.input.configuration.config.skills[0].manifestSha256 = pin.manifestSha256; h.input.configuration.hash = configurationHash(h.input.configuration.config);
    await expect(h.runtime.prepare(h.input)).rejects.toMatchObject({ code: "INPUT_CONTRACT_UNSUPPORTED" });
  });
  it("fails a fully priced but over-budget request without shortening the payload", async () => {
    const h = harness(); h.getApproval().maxCostCents = 0; await expect(h.runtime.prepare(h.input)).rejects.toMatchObject({ code: "COST_BUDGET_EXCEEDED" }); expect(h.calls()).toBe(0);
  });
  it("preserves original manifest ordering while using canonical configuration hashes", async () => {
    const h = harness(), { runtimeSnapshot } = await h.runtime.prepare(h.input);
    expect(runtimeSnapshot.skill).toEqual(assistantConversationSkillSnapshotFromRow(h.skills[0]).pin);
    const original = h.skills[0].manifest.implementation;
    h.skills[0].manifest.implementation = Object.fromEntries(Object.entries(original).reverse()) as typeof original;
    // The old runner pins JSON.stringify(manifest), so reordering is a real pin
    // mismatch until a reviewed approval is updated, not silently normalized.
    await expect(h.runtime.prepareStage({ ...h.input, runtimeSnapshot })).rejects.toMatchObject({ code: "APPROVED_SKILL_CHANGED" });
  });
  it("retains source details in original raw-column order", async () => {
    const h = harness();
    for (const period of h.input.source.periods) {
      const row = period.rows[0]; row.raw = { currency: "USD", "9:广告花费/SP": -4, "8:广告花费/SB": -3 };
      // Rebuild using the existing parser, rather than spoofing details order.
      const stored = { yearMonth: row.yearMonth, parentAsin: row.parentAsin, asin: row.asin, sku: row.sku, title: row.title, storeName: row.storeName, site: row.site, operator: row.operator, ...row.metrics, raw: row.raw };
      period.rows = parseMonthlyFinancialBatch({ id: row.batchId, workspaceId: 3, userId: 7, fileName: "synthetic.xlsx", fileHash: "f".repeat(64), status: "completed", totalRows: 1, skippedRows: 0, unallocatedRows: 0, months: [row.yearMonth], payload: [stored], createdAt: "2026-10-01 00:00:00.000000", confirmedAt: "2026-10-01 00:00:00.000000", fileReferenceKind: "storage", sourceRunId: null }).rows;
    }
    h.input.evidence = buildProfitAnalysisEvidence(h.input.source);
    expect((await h.runtime.prepare(h.input)).runtimeSnapshot.source.sourceRows).toBe(2);
  });
  it("rejects complete evidence over the payload bound instead of truncating children", async () => {
    const h = harness();
    for (const period of h.input.source.periods) {
      const first = period.rows[0];
      period.rows = Array.from({ length: 140 }, (_, index) => ({ ...clone(first), rowIndex: index, asin: `SYNTHETIC_CHILD_${index}`, sku: `SYNTHETIC_SKU_${index}`, title: `SYNTHETIC_${index} ${"界".repeat(500)}` }));
      period.selection.scopeRowCount = period.rows.length; period.selection.authorizedRowCount = period.rows.length;
    }
    h.input.evidence = buildProfitAnalysisEvidence(h.input.source);
    expect(Buffer.byteLength(JSON.stringify(h.input.evidence))).toBeGreaterThan(1024 * 1024);
    await expect(h.runtime.prepare(h.input)).rejects.toMatchObject({ code: "DATA_INVALID_OR_LIMIT" }); expect(h.calls()).toBe(0);
  });
  it("rejects registered context limit exhaustion even if bytes fit", async () => {
    const h = harness(); h.models[0].maxContextTokens = 4096;
    h.getApproval().modelConfigurationHash = strictModelSnapshotFromRow(3, h.models[0].slug, h.models[0]).configurationHash;
    await expect(h.runtime.prepare(h.input)).rejects.toMatchObject({ code: "PAYLOAD_BUDGET_UNAVAILABLE" }); expect(h.calls()).toBe(0);
  });
});

describe("one-shot private profit stage", () => {
  it("executes exact strict model once and returns only system-valued selected evidence", async () => {
    const { h, stage } = await ready(), result = await h.runtime.executeStage(stage, { beforeDispatch: h.fence });
    expect(ProfitAnalysisResultSchema.parse(result.result)).toEqual(result.result); expect(result).toMatchObject({ stage: "profit_analysis", auditWarnings: ["METRICS_UNAVAILABLE"], result: { modelCalled: true, before: 20, after: 30, delta: 10 } });
    expect(h.requests[0]).toMatchObject({ skillVersionPolicy: "pinned", expectedSkillStatus: "Released", modelOverride: "synthetic-finance-model", maxModelAttempts: 1, fallbackModels: [], attachments: [], migrationSource: "ops.profit.private.strict" });
    expect(h.requests[0].strictExecution).toMatchObject({ stage: "profit_analysis", bindingHash: stage.bindingHash, expectedSkillTimeoutSeconds: 120 });
    expect(h.requests[0].context).toContain("SYNTHETIC_PRIVATE_RULE"); expect(h.requests[0].context).toContain('"evidence"'); expect(h.requests[0].context).not.toContain("SYNTHETIC_PRIVATE_ORIGINAL");
    expect(h.calls()).toBe(1); await expect(h.runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toThrow("STAGE_ALREADY_CONSUMED");
    expect(external.db).not.toHaveBeenCalled(); expect(external.provider).not.toHaveBeenCalled();
  });
  it("cannot forge or copy a prepared capability", async () => {
    const { h, stage } = await ready(); await expect(h.runtime.executeStage({ ...stage }, { beforeDispatch: h.fence })).rejects.toThrow("STAGE_ALREADY_CONSUMED"); expect(h.calls()).toBe(0);
  });
  it("requires fresh verification inside the durable checkpoint callback", async () => {
    const { h, stage } = await ready(); await expect(h.runtime.executeStage(stage, { beforeDispatch: async () => {} })).rejects.toThrow("FRESH_AUTHORIZATION_REQUIRED"); expect(h.calls()).toBe(0);
  });
  it("rejects detached unawaited verification without an unhandled rejection", async () => {
    const { h, stage } = await ready();
    await expect(h.runtime.executeStage(stage, { beforeDispatch: async (_receipt, verify) => { void verify(h.input.executor, h.input.configuration, h.input.source, h.input.evidence); } })).rejects.toMatchObject({ code: "FRESH_AUTHORIZATION_REQUIRED" });
    await new Promise(resolve => setTimeout(resolve, 0)); expect(h.calls()).toBe(0);
  });
  it("refuses reused verification even if callback swallows the second denial", async () => {
    const { h, stage } = await ready();
    await expect(h.runtime.executeStage(stage, { beforeDispatch: async (receipt, verify) => { await h.fence(receipt, verify); await h.fence(receipt, verify).catch(() => {}); } })).rejects.toMatchObject({ code: "FRESH_AUTHORIZATION_REQUIRED" }); expect(h.calls()).toBe(0);
  });
  it.each(["source", "evidence", "configuration", "approval", "model", "skill", "actor"])("blocks fresh %s drift immediately before dispatch", async field => {
    const { h, stage } = await ready();
    if (field === "source") h.input.source.periods[0].rows[0].raw.unusedPrivateField = "CHANGED";
    if (field === "evidence") h.input.evidence.sourceHash = "d".repeat(64);
    if (field === "configuration") { h.input.configuration.config.rules.push("NEW"); h.input.configuration.hash = configurationHash(h.input.configuration.config); }
    if (field === "approval") h.setApproval(null);
    if (field === "model") h.models[0].modelId = "different";
    if (field === "skill") h.skills[0].version = 3;
    if (field === "actor") h.input.source.identity = { ...identity, userId: 8 };
    await expect(h.runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toMatchObject({ code: "DISPATCH_DENIED" }); expect(h.calls()).toBe(0);
  });
  it("awaits transaction acknowledgement and blocks cancellation before network", async () => {
    const { h, stage } = await ready(); let release!: () => void; const abort = new AbortController();
    const promise = h.runtime.executeStage(stage, { signal: abort.signal, beforeDispatch: async (receipt, verify) => { await h.fence(receipt, verify); await new Promise<void>(resolve => { release = resolve; }); } });
    await vi.waitFor(() => expect(release).toBeTypeOf("function")); expect(h.calls()).toBe(0); abort.abort(); release();
    await expect(promise).rejects.toMatchObject({ code: "CANCELED" }); expect(h.calls()).toBe(0);
  });
  it("sanitizes callback failures and never exposes private exception text", async () => {
    const { h, stage } = await ready(); const error = await h.runtime.executeStage(stage, { beforeDispatch: async () => { throw new Error("PRIVATE_SQL_PASSWORD_OR_BODY"); } }).catch(value => value);
    expect(error).toMatchObject({ code: "DISPATCH_DENIED", retryable: false }); expect(error.message).not.toContain("PRIVATE_SQL"); expect(h.calls()).toBe(0);
  });
  it.each(["stage", "requestHash", "modelConfigurationHash", "bindingHash", "budget"])("rejects mismatched dispatch receipt %s before calling the checkpoint", async field => {
    const { h, stage } = await ready(); h.alterReceipt(receipt => { receipt[field] = field === "budget" ? { ...(receipt.budget as object), textBytes: 0 } : field === "stage" ? "reply" : "d".repeat(64); });
    const fence = vi.fn(h.fence); await expect(h.runtime.executeStage(stage, { beforeDispatch: fence })).rejects.toThrow(); expect(fence).not.toHaveBeenCalled(); expect(h.calls()).toBe(0);
  });
  it("provider uncertainty cannot consume a second attempt and contains no raw cause", async () => {
    const { h, stage } = await ready(); h.failProvider(new Error("PRIVATE_PROVIDER_BODY"));
    await expect(h.runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toMatchObject({ code: "RUNTIME_RESULT_UNKNOWN", retryable: false });
    await expect(h.runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toThrow("STAGE_ALREADY_CONSUMED"); expect(h.calls()).toBe(1);
  });
  it("preserves only strict safe error codes without exposing provider details", async () => {
    const { h, stage } = await ready(); h.failProvider(new StrictSkillRuntimeError("STRICT_RUNTIME_RESULT_UNKNOWN"));
    await expect(h.runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toMatchObject({ code: "STRICT_RUNTIME_RESULT_UNKNOWN", retryable: false }); expect(h.calls()).toBe(1);
  });
  it.each(["unknown", "duplicate", "numbers", "invalid-json", "too-many", "too-long"])("rejects invalid model output %s after exactly one call", async kind => {
    const { h, stage } = await ready(); const reason = { evidenceId: h.input.evidence.evidence[0].id, explanation: "Synthetic explanation" };
    h.setOutput(kind === "invalid-json" ? "not JSON" : { severity: "需关注", reasons: kind === "duplicate" ? [reason, reason] : kind === "too-many" ? Array(6).fill(reason)
      : [{ ...reason, ...(kind === "unknown" ? { evidenceId: "UNKNOWN" } : kind === "numbers" ? { amount: 999 } : { explanation: "x".repeat(101) }) }] });
    await expect(h.runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toMatchObject({ code: "RESULT_CONTRACT_INVALID" }); expect(h.calls()).toBe(1);
  });
  it("independently validates parsed output rather than trusting an injected runner", async () => {
    const { h, stage } = await ready(); h.setParsed({ forged: true });
    await expect(h.runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toMatchObject({ code: "RESULT_CONTRACT_MISMATCH" }); expect(h.calls()).toBe(1);
  });
  it("will not accept a runner that omits the required checkpoint", async () => {
    const { h, stage } = await ready(); h.skipFence(); await expect(h.runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toMatchObject({ code: "RESULT_RECEIPT_MISMATCH" });
  });
  it("retains validated paid results after later configuration changes", async () => {
    const { h, stage } = await ready();
    const result = await h.runtime.executeStage(stage, { beforeDispatch: async (receipt, verify) => { await h.fence(receipt, verify); h.input.configuration.config.rules.push("AFTER_FENCE"); } });
    expect(result.result.modelCalled).toBe(true); expect(h.calls()).toBe(1);
  });
});
