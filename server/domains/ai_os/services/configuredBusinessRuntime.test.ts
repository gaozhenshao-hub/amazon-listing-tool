import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), http: vi.fn(), legacy: vi.fn(), key: vi.fn(), metric: vi.fn(), evaluation: vi.fn(), rollout: vi.fn() }));
vi.mock("../../../repositories/dbClient", () => ({ getDb: mocks.getDb }));
vi.mock("../../../_core/llm", () => ({ invokeLLM: mocks.legacy }));
vi.mock("../../../infrastructure/http/safeHttpClient", () => ({ SafeHttpError: class extends Error {}, safeHttpRequest: mocks.http }));
vi.mock("./teamorouterCatalog", async original => ({ ...await original<object>(), resolveGovernedModelApiKey: mocks.key }));
vi.mock("./observability", () => ({ recordAiOsMetric: mocks.metric, recordAiOsEvaluation: mocks.evaluation }));
vi.mock("./skillRollout", () => ({ resolveActiveSkillRollout: mocks.rollout }));
import { DevelopmentMarketCandidateSchema } from "../../../../shared/developmentMarket";
import { normalizeImagePlanningOutline } from "../../../../shared/imagePlanning";
import { configurationHash, assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash } from "./assistantConversationSourcePrimitives";
import { strictModelSnapshotFromRow, strictRuntimeHash, strictSkillAuditIdentity } from "./strictSkillRuntime";
import { createConfiguredBusinessRuntime, createFixedConfiguredBusinessApprovalResolver, createFileConfiguredBusinessApprovalResolver,
  ConfiguredBusinessRuntimeError, type ConfiguredBusinessRuntimeInput } from "./configuredBusinessRuntime";
import { CONFIGURED_BUSINESS_DEFINITIONS, ConfiguredBusinessSourceApprovalSchema, ConfiguredBusinessRuntimeSnapshotSchema,
  type ConfiguredBusinessSourceApproval, type ConfiguredBusinessSavedConfiguration } from "./configuredBusinessRuntimeContract";

const clone = <T>(value: T): T => structuredClone(value), dialect = new MySqlDialect();
const sha = (value: string) => createHash("sha256").update(value).digest("hex"), directories: string[] = [];
type Domain = keyof typeof CONFIGURED_BUSINESS_DEFINITIONS;
const domains = ["imagePlanning", "developmentMarket"] as const;
const marketCandidate = { maturityLevel: null, maturityReason: "SYNTHETIC_NO_MATURITY_EVIDENCE", growthTrend: null, growthRate: null,
  seasonality: { hasSeasonality: null, peakMonths: [], lowMonths: [], description: "No historical evidence" },
  marketCapacity: { level: null, monthlyRevenue: null, potential: "Synthetic bounded evidence" },
  entryTiming: { recommendation: null, bestEntryTime: null, reason: "No unsupported recommendation" },
  summary: "SYNTHETIC_CANDIDATE_ONLY", risks: ["Synthetic uncertainty"], opportunities: [] };
const outlineCandidate = { mainImage: { purpose: "Synthetic main image", contentBrief: "SYNTHETIC_COMPLETE_BRIEF" },
  secondaryImages: Array.from({ length: 6 }, (_, i) => ({ imageNumber: i + 2, purpose: `Synthetic secondary ${i + 2}`, contentBrief: "SYNTHETIC_COMPLETE_BRIEF" })),
  aPlusModules: Array.from({ length: 7 }, (_, i) => ({ moduleNumber: i + 1, purpose: `Synthetic A+ ${i + 1}`, contentBrief: "SYNTHETIC_COMPLETE_BRIEF" })),
  brandStory: { theme: "Synthetic story", contentBrief: "SYNTHETIC_COMPLETE_BRIEF" } };
beforeEach(() => {
  vi.clearAllMocks();
  for (const prefix of ["IMAGE_PLANNING", "DEVELOPMENT_MARKET"]) { vi.stubEnv(`${prefix}_APPROVAL_FILE`, undefined); vi.stubEnv(`${prefix}_APPROVAL_SHA256`, undefined); }
  mocks.legacy.mockImplementation(() => { throw new Error("NO_REAL_LEGACY_MODEL"); }); mocks.key.mockReturnValue("SYNTHETIC_SECRET_NEVER_LOG");
  mocks.metric.mockResolvedValue({ recorded: true }); mocks.evaluation.mockResolvedValue({ recorded: true }); mocks.rollout.mockResolvedValue(null);
});
afterEach(async () => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
function fixture(domain: Domain = "developmentMarket") {
  const definition = CONFIGURED_BUSINESS_DEFINITIONS[domain], rawCandidate = domain === "imagePlanning" ? outlineCandidate : marketCandidate;
  const parseCandidate = (raw: unknown): unknown => domain === "imagePlanning" ? normalizeImagePlanningOutline(raw) : DevelopmentMarketCandidateSchema.parse(raw);
  const candidate = parseCandidate(rawCandidate);
  const skills = [{ id: 12, workspaceId: 3 as number | null, scope: "workspace", slug: definition.skillSlug, name: "Synthetic reviewed Skill", version: 4,
    status: "Released", modelOverride: "synthetic-text" as string | null, timeout_seconds: 120,
    manifest: { implementation: { systemPrompt: "SYNTHETIC_ORIGINAL_SYSTEM_NOT_APPROVAL", userPromptTemplate: "{{context}}\n{{agentKey}}/{{agentRevision}}/{{stage}}", maxTokens: 1024, temperature: 0.2, supportsJsonMode: true } } }];
  const models = [{ workspaceId: 3 as number | null, slug: "synthetic-text", name: "Synthetic only", provider: "custom", modelId: "synthetic-model", baseUrl: "https://model.example.invalid/v1",
    apiKeyRef: "env:EXTERNAL_LLM_API_KEY", isActive: 1, capabilityTags: ["text"], maxContextTokens: 200000,
    costPer1kInputTokens: "0.01" as string | null, costPer1kOutputTokens: "0.02" as string | null }];
  const engines = [{ tableName: "emperor_skills", engine: "InnoDB" }, { tableName: "emperor_model_providers", engine: "InnoDB" }];
  const pin = assistantConversationSkillSnapshotFromRow(skills[0]).pin, model = strictModelSnapshotFromRow(3, models[0].slug, models[0]);
  const config = { name: "Synthetic Agent", description: "", enabled: true, modelSlug: "synthetic-text", instructions: "SYNTHETIC_SAVED_COMMON_INSTRUCTIONS", rules: ["SYNTHETIC_SAVED_RULE"],
    skills: [{ slug: pin.slug, enabled: true, trigger: "Explicit business only", instructions: "SYNTHETIC_BINDING_INSTRUCTIONS", version: pin.version, manifestSha256: pin.manifestSha256 }] };
  const configuration: ConfiguredBusinessSavedConfiguration = { workspaceId: 3, agentKey: definition.agentKey, revision: 2, hash: configurationHash(config), config };
  const approval: ConfiguredBusinessSourceApproval = { version: 1, workspaceId: 3, agentKey: definition.agentKey, stage: definition.stage, skillSlug: definition.skillSlug,
    skillSnapshotHash: assistantConversationSkillSnapshotHash(pin), modelSlug: model.model.slug, modelConfigurationHash: model.configurationHash,
    source: { origin: "qingdao", revision: "synthetic-source-revision", approvalRef: "SYNTHETIC_NOT_PRODUCTION_APPROVAL", evidenceId: "fixture", evidenceHash: "e".repeat(64) },
    inputContract: definition.inputContract, outputContract: definition.outputContract, maxCostCents: 100 };
  const execute = vi.fn(async (query: SQL): Promise<unknown> => {
    const statement = dialect.sqlToQuery(query).sql;
    if (statement.includes("information_schema.TABLES")) return [clone(engines)];
    if (statement.includes("FROM emperor_skills")) return [clone(skills)];
    if (statement.includes("FROM emperor_model_providers")) return [clone(models)];
    return [{ affectedRows: 1 }];
  });
  const executor = { execute }; mocks.getDb.mockResolvedValue(executor);
  const input: ConfiguredBusinessRuntimeInput = { executor, identity: { workspaceId: 3, userId: 7 }, operationId: "b7d29fe8-2c53-4c34-bfe7-cbe34c102125",
    sourceHash: "a".repeat(64), sourceContext: { schema: "SYNTHETIC_COMPLETE_SOURCE", ids: [4, 8], evidenceHash: "b".repeat(64), text: "SYNTHETIC_PRIVATE_SOURCE", asOf: "2026-10-19" }, configuration };
  const response = () => ({ ok: true, json: () => ({ choices: [{ message: { content: JSON.stringify(rawCandidate) } }], usage: { prompt_tokens: 50, completion_tokens: 30 } }) });
  mocks.http.mockImplementation(async () => response());
  const resolve = vi.fn(async () => clone(approval)), runtime = createConfiguredBusinessRuntime({ definition, parseCandidate, approvalResolver: resolve, credentialResolver: mocks.key });
  const rehash = () => { configuration.hash = configurationHash(configuration.config); };
  const repin = () => { approval.skillSnapshotHash = assistantConversationSkillSnapshotHash(assistantConversationSkillSnapshotFromRow(skills[0]).pin);
    approval.modelConfigurationHash = strictModelSnapshotFromRow(3, models[0].slug, models[0]).configurationHash; };
  const stage = async () => { const { runtimeSnapshot } = await runtime.prepare(input); return runtime.prepareStage({ ...input, runtimeSnapshot }); };
  const fence = vi.fn(async (_receipt: unknown, verify: Parameters<Parameters<typeof runtime.executeStage>[1]["beforeDispatch"]>[1]) => {
    await verify(executor, configuration, input.sourceHash, input.sourceContext);
  });
  return { definition, parseCandidate, candidate, response, skills, models, engines, configuration, approval, execute, executor, input, runtime, resolve, rehash, repin, stage, fence };
}
describe("explicit configured business factory admission", () => {
  it.each(domains)("freezes %s exact source/config/approval budget without provider or registry writes", async domain => {
    const f = fixture(domain), { runtimeSnapshot } = await f.runtime.prepare(f.input);
    expect(ConfiguredBusinessRuntimeSnapshotSchema.parse(runtimeSnapshot)).toMatchObject({ identity: f.input.identity, sourceHash: f.input.sourceHash,
      sourceContextHash: strictRuntimeHash(f.input.sourceContext), stage: f.definition.stage, configuration: { agentKey: f.definition.agentKey, revision: 2, hash: f.configuration.hash },
      budgetPlan: { maxCalls: 1, maxCostCentsTotal: 100, budget: { imageCount: 0, imageBytes: 0, outputTokens: 1024 } } });
    expect(JSON.stringify(runtimeSnapshot)).not.toMatch(/SYNTHETIC_PRIVATE_SOURCE|SYNTHETIC_SECRET|SYNTHETIC_SAVED_RULE/u);
    expect(f.execute.mock.calls.every(([query]) => dialect.sqlToQuery(query).sql.startsWith("SELECT"))).toBe(true); expect(mocks.http).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("does not accept an arbitrary third domain or changed fixed Skill definition", () => {
    const f = fixture(); expect(() => createConfiguredBusinessRuntime({ definition: { ...f.definition, skillSlug: "another" } as unknown as typeof f.definition, parseCandidate: f.parseCandidate })).toThrow("DEFINITION_INVALID");
  });
  it.each(["reviewed_supplement", "user_listing", "friend", "Qingdao"])("rejects %s general Skill provenance", origin => {
    const f = fixture(); expect(ConfiguredBusinessSourceApprovalSchema.safeParse({ ...f.approval, source: { ...f.approval.source, origin } }).success).toBe(false);
  });
  it.each(["agentKey", "skillSlug", "inputContract", "outputContract"])("binds exact approved %s to the fixed business stage", field => {
    const f = fixture(); expect(ConfiguredBusinessSourceApprovalSchema.safeParse({ ...f.approval, [field]: "unapproved" }).success).toBe(false);
  });
  it("fixed resolver isolates workspace and domain, copies approvals and refuses duplicates", async () => {
    const f = fixture(), image = fixture("imagePlanning"), resolver = createFixedConfiguredBusinessApprovalResolver([f.approval, image.approval]); f.approval.source.revision = "mutated";
    expect((await resolver({ executor: f.executor, identity: f.input.identity, agentKey: "development", stage: "development_market_overview" }))?.source.revision).toBe("synthetic-source-revision");
    expect(await resolver({ executor: f.executor, identity: { workspaceId: 4, userId: 7 }, agentKey: "development", stage: "development_market_overview" })).toBeNull();
    expect(() => createFixedConfiguredBusinessApprovalResolver([f.approval, f.approval])).toThrow("APPROVAL_DUPLICATE");
  });
  it.each(domains)("default %s resolver is lazy and only accepts its own file kind and records", async domain => {
    const f = fixture(domain), runtime = createConfiguredBusinessRuntime({ definition: f.definition, parseCandidate: f.parseCandidate });
    await expect(runtime.prepare(f.input)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" }); expect(f.execute).not.toHaveBeenCalled();
    const directory = await mkdtemp(join(tmpdir(), "configured-business-unit-")); directories.push(directory); const path = join(directory, "approval.json");
    const prefix = domain === "imagePlanning" ? "IMAGE_PLANNING" : "DEVELOPMENT_MARKET";
    async function file(kind: string, records: unknown[]) { const bytes = JSON.stringify({ version: 1, kind, records }); await writeFile(path, bytes, { mode: 0o600 });
      vi.stubEnv(`${prefix}_APPROVAL_FILE`, path); vi.stubEnv(`${prefix}_APPROVAL_SHA256`, sha(bytes)); }
    await file(f.definition.approvalKind, [f.approval]); expect((await runtime.prepare(f.input)).runtimeSnapshot.approval).toEqual(f.approval);
    vi.stubEnv(`${prefix}_APPROVAL_SHA256`, "0".repeat(64)); await expect(runtime.prepare(f.input)).rejects.toMatchObject({ code: "APPROVAL_HASH_MISMATCH" });
    await file("listing_deep_analysis", [f.approval]); await expect(runtime.prepare(f.input)).rejects.toMatchObject({ code: "APPROVAL_DOCUMENT_INVALID" });
    const other = fixture(domain === "imagePlanning" ? "developmentMarket" : "imagePlanning");
    await file(f.definition.approvalKind, [other.approval]); await expect(runtime.prepare(f.input)).rejects.toMatchObject({ code: "APPROVAL_RECORDS_INVALID" });
    expect(mocks.http).not.toHaveBeenCalled();
  });
  it("unrelated domain approval environment cannot enable either factory", async () => {
    vi.stubEnv("IMAGE_TAGGING_APPROVAL_FILE", "/SYNTHETIC/unused.json"); vi.stubEnv("IMAGE_TAGGING_APPROVAL_SHA256", "a".repeat(64)); const f = fixture();
    expect(await createFileConfiguredBusinessApprovalResolver(f.definition)({ executor: f.executor, identity: f.input.identity, agentKey: f.definition.agentKey, stage: f.definition.stage })).toBeNull();
  });
  it.each(["disabled", "binding_disabled", "binding_missing", "version", "manifest", "hash", "workspace", "wrong_agent"])("rejects %s saved configuration without defaults", async kind => {
    const f = fixture(); if (kind === "disabled") f.configuration.config.enabled = false;
    if (kind === "binding_disabled") f.configuration.config.skills[0].enabled = false;
    if (kind === "binding_missing") f.configuration.config.skills = [];
    if (kind === "version") f.configuration.config.skills[0].version++;
    if (kind === "manifest") f.configuration.config.skills[0].manifestSha256 = "0".repeat(64);
    if (kind === "workspace") f.configuration.workspaceId = 4;
    if (kind === "wrong_agent") f.configuration.agentKey = "images";
    f.rehash(); if (kind === "hash") f.configuration.hash = "0".repeat(64);
    await expect(f.runtime.prepare(f.input)).rejects.toBeInstanceOf(ConfiguredBusinessRuntimeError); expect(mocks.http).not.toHaveBeenCalled();
  });
  it("empty model inherits only the pinned original Skill model; no fallback or model-name guess", async () => {
    const f = fixture(); f.configuration.config.modelSlug = ""; f.rehash(); expect((await f.runtime.prepare(f.input)).runtimeSnapshot.model.model.slug).toBe("synthetic-text");
    f.skills[0].modelOverride = null; f.repin(); await expect(f.runtime.prepare(f.input)).rejects.toMatchObject({ code: "MODEL_BINDING_MISMATCH" });
  });
  it.each(["duplicate_skill", "duplicate_model", "shared_scope", "foreign_skill", "prompt_changed", "capabilities_changed", "missing_price", "wrong_engine", "model_changed", "unapproved_model", "cost", "context_limit", "bad_endpoint"])("rejects registry/model/cost admission %s", async kind => {
    const f = fixture(); if (kind === "duplicate_skill") f.skills.push(clone(f.skills[0])); if (kind === "duplicate_model") f.models.push(clone(f.models[0]));
    if (kind === "shared_scope") { f.skills[0].workspaceId = null; f.skills[0].scope = "shared"; }
    if (kind === "foreign_skill") f.skills[0].workspaceId = 4;
    if (kind === "prompt_changed") f.skills[0].manifest.implementation.systemPrompt += "changed";
    if (kind === "capabilities_changed") f.models[0].capabilityTags = ["vision"];
    if (kind === "missing_price") { f.models[0].costPer1kInputTokens = null; f.repin(); }
    if (kind === "wrong_engine") f.engines[0].engine = "MyISAM";
    if (kind === "model_changed") f.models[0].modelId = "changed";
    if (kind === "unapproved_model") { f.configuration.config.modelSlug = "another"; f.rehash(); }
    if (kind === "cost") f.approval.maxCostCents = 0;
    if (kind === "context_limit") { f.models[0].maxContextTokens = 1024; f.repin(); }
    if (kind === "bad_endpoint") f.models[0].baseUrl = "http://127.0.0.1/private";
    await expect(f.runtime.prepare(f.input)).rejects.toBeInstanceOf(ConfiguredBusinessRuntimeError); expect(mocks.http).not.toHaveBeenCalled();
  });
  it("requires the complete source/config context in the actual rendered original template", async () => {
    const f = fixture(); f.skills[0].manifest.implementation.userPromptTemplate = "unrelated"; f.repin();
    f.configuration.config.skills[0].manifestSha256 = assistantConversationSkillSnapshotFromRow(f.skills[0]).pin.manifestSha256; f.rehash();
    await expect(f.runtime.prepare(f.input)).rejects.toMatchObject({ code: "INPUT_CONTRACT_UNSUPPORTED" });
  });
  it("refuses oversized source context without truncating or changing its hash", async () => {
    const f = fixture(); f.input.sourceContext = { text: "x".repeat(1024 * 1024) };
    await expect(f.runtime.prepare(f.input)).rejects.toBeInstanceOf(ConfiguredBusinessRuntimeError); expect(mocks.http).not.toHaveBeenCalled();
  });
});
describe("real strict runner with synthetic SQL and HTTP, not a runner stub", () => {
  it.each(domains)("%s dispatches exactly once after durable ACK with real domain output and frozen config in payload", async domain => {
    const f = fixture(domain), prepared = await f.stage(), result = await f.runtime.executeStage(prepared, { beforeDispatch: f.fence });
    expect(result).toMatchObject({ candidate: f.candidate, stage: f.definition.stage, providerRequestHash: prepared.providerRequestHash });
    expect(mocks.http).toHaveBeenCalledOnce(); expect(f.fence).toHaveBeenCalledOnce(); expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.rollout).not.toHaveBeenCalled();
    const request = mocks.http.mock.calls[0][1], payload = JSON.parse(request.body);
    expect(request.auditContext.operation).toBe(strictSkillAuditIdentity(f.definition.stage).operation);
    expect(payload.messages[0].content).toBe("SYNTHETIC_ORIGINAL_SYSTEM_NOT_APPROVAL");
    expect(request.body).toContain("SYNTHETIC_SAVED_COMMON_INSTRUCTIONS"); expect(request.body).toContain("SYNTHETIC_SAVED_RULE");
    expect(request.body).toContain("SYNTHETIC_BINDING_INSTRUCTIONS"); expect(request.body).toContain("SYNTHETIC_PRIVATE_SOURCE");
    const writes = f.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query)).filter(value => !value.sql.startsWith("SELECT"));
    expect(writes.every(value => /emperor_skill_runs|emperor_skills/u.test(value.sql))).toBe(true);
    expect(JSON.stringify(writes)).not.toMatch(/SYNTHETIC_PRIVATE_SOURCE|SYNTHETIC_SECRET|SYNTHETIC_SAVED_RULE/u);
    await expect(f.runtime.executeStage(prepared, { beforeDispatch: f.fence })).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" }); expect(mocks.http).toHaveBeenCalledOnce();
  });
  it("waits for the transaction acknowledgement after verified authority before HTTP", async () => {
    const f = fixture(), prepared = await f.stage(); let release!: () => void;
    const running = f.runtime.executeStage(prepared, { beforeDispatch: async (receipt, verify) => { await f.fence(receipt, verify); await new Promise<void>(resolve => { release = resolve; }); } });
    await vi.waitFor(() => expect(release).toBeTypeOf("function")); expect(mocks.http).not.toHaveBeenCalled(); release(); await running; expect(mocks.http).toHaveBeenCalledOnce();
  });
  it.each(["no_verify", "unawaited", "twice", "ack_lost", "source", "context", "configuration", "approval", "authority_denied"])("rejects %s before any paid call", async kind => {
    const f = fixture(), prepared = await f.stage();
    await expect(f.runtime.executeStage(prepared, { beforeDispatch: async (receipt, verify) => {
      if (kind === "no_verify") return;
      if (kind === "unawaited") { void verify(f.executor, f.configuration, f.input.sourceHash, f.input.sourceContext); return; }
      if (kind === "source") f.input.sourceHash = "d".repeat(64);
      if (kind === "context") f.input.sourceContext = { changed: true };
      if (kind === "configuration") { f.configuration.config.rules.push("changed"); f.rehash(); }
      if (kind === "approval") f.approval.source.revision = "changed";
      if (kind === "authority_denied") throw new Error("SYNTHETIC_REVOKED_AUTHORITY");
      await f.fence(receipt, verify); if (kind === "twice") await f.fence(receipt, verify); if (kind === "ack_lost") throw new Error("SYNTHETIC_COMMIT_ACK_LOST");
    } })).rejects.toBeInstanceOf(ConfiguredBusinessRuntimeError);
    expect(mocks.http).not.toHaveBeenCalled(); await expect(f.runtime.executeStage(prepared, { beforeDispatch: f.fence })).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" });
  });
  it("foreign or copied prepared objects are not execution capabilities", async () => {
    const f = fixture(), prepared = await f.stage(), foreign = createConfiguredBusinessRuntime({ definition: f.definition, parseCandidate: f.parseCandidate });
    await expect(foreign.executeStage(prepared, { beforeDispatch: f.fence })).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" });
    await expect(f.runtime.executeStage({ ...prepared }, { beforeDispatch: f.fence })).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" }); expect(mocks.http).not.toHaveBeenCalled();
  });
  it("copies source and config into the prepared stage rather than accepting later in-memory edits", async () => {
    const f = fixture(), prepared = await f.stage(), configuration = clone(f.configuration), source = clone(f.input.sourceContext);
    f.configuration.config.rules.push("UNSAVED_MUTATION"); f.input.sourceContext = { untrusted: "UNSAVED_MUTATION" };
    await f.runtime.executeStage(prepared, { beforeDispatch: async (_receipt, verify) => { await verify(f.executor, configuration, f.input.sourceHash, source); } });
    expect(mocks.http.mock.calls[0][1].body).not.toContain("UNSAVED_MUTATION");
  });
  it.each(["network_unknown", "invalid_enum", "extra_field", "missing_field", "invalid_json"])("paid %s is not repaired/retried/fallbacked", async kind => {
    const f = fixture(), prepared = await f.stage();
    if (kind === "network_unknown") mocks.http.mockRejectedValue(new Error("PRIVATE_PROVIDER_BODY"));
    else { const bad: Record<string, unknown> = clone(marketCandidate); if (kind === "invalid_enum") bad.maturityLevel = "made_up";
      if (kind === "extra_field") bad.extra = "unknown"; if (kind === "missing_field") delete bad.summary;
      mocks.http.mockResolvedValue({ ok: true, json: () => ({ choices: [{ message: { content: kind === "invalid_json" ? "{" : JSON.stringify(bad) } }], usage: { prompt_tokens: 50, completion_tokens: 30 } }) }); }
    await expect(f.runtime.executeStage(prepared, { beforeDispatch: f.fence })).rejects.toBeInstanceOf(ConfiguredBusinessRuntimeError);
    expect(mocks.http).toHaveBeenCalledOnce(); expect(mocks.legacy).not.toHaveBeenCalled();
    await expect(f.runtime.executeStage(prepared, { beforeDispatch: f.fence })).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" });
  });
  it("stop before dispatch makes zero model requests", async () => {
    const f = fixture(), prepared = await f.stage(), controller = new AbortController(); controller.abort();
    await expect(f.runtime.executeStage(prepared, { beforeDispatch: f.fence, signal: controller.signal })).rejects.toMatchObject({ code: "CANCELED" }); expect(mocks.http).not.toHaveBeenCalled();
  });
  it("returns a fully paid validated reply despite later stop/config changes and advisory errors", async () => {
    const f = fixture(), prepared = await f.stage(), controller = new AbortController();
    mocks.metric.mockImplementation(async () => { controller.abort(); f.configuration.config.enabled = false; throw new Error("PRIVATE_METRIC_FAILURE"); });
    expect(await f.runtime.executeStage(prepared, { beforeDispatch: f.fence, signal: controller.signal })).toMatchObject({ candidate: f.candidate, auditWarnings: ["METRICS_UNAVAILABLE"] });
    expect(mocks.http).toHaveBeenCalledOnce();
  });
  it("an in-flight provider abort remains unknown/non-retryable under the unchanged strict cancellation contract", async () => {
    const f = fixture(), prepared = await f.stage(), controller = new AbortController();
    mocks.http.mockImplementation(async () => { controller.abort(); return f.response(); });
    await expect(f.runtime.executeStage(prepared, { beforeDispatch: f.fence, signal: controller.signal })).rejects.toMatchObject({ code: "STRICT_RUNTIME_CANCELED" });
    expect(mocks.http).toHaveBeenCalledOnce();
    await expect(f.runtime.executeStage(prepared, { beforeDispatch: f.fence })).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" });
  });
  it("refuses private SQL errors without exposing host, parameters or raw source", async () => {
    const f = fixture(); f.execute.mockRejectedValue(new Error("PRIVATE_SQL_HOST_PASSWORD"));
    try { await f.runtime.prepare(f.input); throw new Error("Expected refusal"); } catch (error) {
      expect(error).toBeInstanceOf(ConfiguredBusinessRuntimeError); expect(String(error)).not.toContain("PRIVATE_SQL"); expect((error as Error).cause).toBeUndefined();
    }
  });
});
