import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), http: vi.fn(), legacy: vi.fn(), key: vi.fn(), metric: vi.fn(), evaluation: vi.fn(), rollout: vi.fn() }));
vi.mock("../../repositories/dbClient", () => ({ getDb: mocks.getDb }));
vi.mock("../../_core/llm", () => ({ invokeLLM: mocks.legacy }));
vi.mock("../../infrastructure/http/safeHttpClient", () => ({ SafeHttpError: class extends Error {}, safeHttpRequest: mocks.http }));
vi.mock("../ai_os/services/teamorouterCatalog", async original => ({ ...await original<object>(), resolveGovernedModelApiKey: mocks.key }));
vi.mock("../ai_os/services/observability", () => ({ recordAiOsMetric: mocks.metric, recordAiOsEvaluation: mocks.evaluation }));
vi.mock("../ai_os/services/skillRollout", () => ({ resolveActiveSkillRollout: mocks.rollout }));
import { ImageTaggingCandidateSchema } from "../../../shared/imageTagging";
import { configurationHash, assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash } from "../ai_os/services/assistantConversationSourcePrimitives";
import { strictModelSnapshotFromRow, strictRuntimeHash } from "../ai_os/services/strictSkillRuntime";
import { createFixedImageTaggingApprovalResolver, createFileImageTaggingApprovalResolver, createImageTaggingRuntime,
  ImageTaggingRuntimeError, type ImageTaggingRuntimeInput } from "./imageTaggingRuntime";
import { ImageTaggingSourceApprovalSchema, ImageTaggingRuntimeSnapshotSchema, type ImageTaggingSourceApproval,
  type ImageTaggingEvidence } from "./imageTaggingRuntimeContract";

const clone = <T>(value: T): T => structuredClone(value), dialect = new MySqlDialect();
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const folders: string[] = [];
const candidate = { tagCategory: "", tagImageTypeMain: "", tagImageTypeSub: "", tagSellingPointCategory: "", tagSellingPointDetail: "",
  tagComposition: "", tagColorSchemeV2: "", tagDesignStyleV2: "", accentColor: "", evidence: "SYNTHETIC_IMAGE_EVIDENCE" };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("IMAGE_TAGGING_APPROVAL_FILE", undefined); vi.stubEnv("IMAGE_TAGGING_APPROVAL_SHA256", undefined);
  mocks.legacy.mockImplementation(() => { throw new Error("NO_REAL_LEGACY_MODEL"); }); mocks.key.mockReturnValue("SYNTHETIC_SECRET_NEVER_LOG");
  mocks.metric.mockResolvedValue({ recorded: true }); mocks.evaluation.mockResolvedValue({ recorded: true }); mocks.rollout.mockResolvedValue(null);
  mocks.http.mockResolvedValue({ ok: true, json: () => ({ choices: [{ message: { content: JSON.stringify(candidate) } }], usage: { prompt_tokens: 50, completion_tokens: 30 } }) });
});
afterEach(async () => { vi.unstubAllEnvs(); for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true }); });
function fixture() {
  const skills = [{ id: 12, workspaceId: 3 as number | null, scope: "workspace", slug: "qingdao.synthetic.tags", name: "Synthetic reviewed Skill", version: 4,
    status: "Released", modelOverride: "synthetic-vision" as string | null, timeout_seconds: 120,
    manifest: { implementation: { systemPrompt: "SYNTHETIC_PROMPT_NOT_APPROVAL", userPromptTemplate: "{{context}}", maxTokens: 1024, temperature: 0.2, supportsJsonMode: true } } }];
  const models = [{ workspaceId: 3 as number | null, slug: "synthetic-vision", name: "Synthetic model", provider: "custom", modelId: "synthetic-model", baseUrl: "https://model.example.invalid/v1",
    apiKeyRef: "env:EXTERNAL_LLM_API_KEY", isActive: 1, capabilityTags: ["text", "vision"], maxContextTokens: 200000,
    costPer1kInputTokens: "0.01" as string | null, costPer1kOutputTokens: "0.02" as string | null }];
  const engines = [{ tableName: "emperor_skills", engine: "InnoDB" }, { tableName: "emperor_model_providers", engine: "InnoDB" }];
  const pin = assistantConversationSkillSnapshotFromRow(skills[0]).pin, model = strictModelSnapshotFromRow(3, models[0].slug, models[0]);
  const config = { name: "Synthetic tagger", description: "", enabled: true, modelSlug: "synthetic-vision", instructions: "SYNTHETIC_RULES", rules: ["Synthetic human-approved rule"],
    skills: [{ slug: pin.slug, enabled: true, trigger: "Explicit image tagging only", instructions: "Synthetic binding", version: pin.version, manifestSha256: pin.manifestSha256 }] };
  const configuration = { workspaceId: 3, agentKey: "tagger" as const, revision: 2, hash: configurationHash(config), config };
  const approval: ImageTaggingSourceApproval = { version: 1, workspaceId: 3, agentKey: "tagger", stage: "image_tagging", skillSlug: pin.slug,
    skillSnapshotHash: assistantConversationSkillSnapshotHash(pin), modelSlug: model.model.slug, modelConfigurationHash: model.configurationHash,
    source: { origin: "qingdao", revision: "synthetic-source-revision", approvalRef: "SYNTHETIC_NOT_PRODUCTION_APPROVAL", evidenceId: "fixture", evidenceHash: "e".repeat(64) },
    inputContract: "image_tagging_evidence_v1", outputContract: "image_tagging_labels_v1", maxCostCents: 100,
    imageBudget: { policyId: "SYNTHETIC_PROVIDER_POLICY", maxInputTokensPerImage: 8192, stage: "image_tagging", maxImageBytes: 8388608, maxImages: 1 } };
  const execute = vi.fn(async (query: SQL) => {
    const statement = dialect.sqlToQuery(query).sql;
    if (statement.includes("information_schema.TABLES")) return [clone(engines)];
    if (statement.includes("FROM emperor_skills")) return [clone(skills)];
    if (statement.includes("FROM emperor_model_providers")) return [clone(models)];
    return [{ affectedRows: 1 }];
  });
  const executor = { execute }; mocks.getDb.mockResolvedValue(executor);
  const input: ImageTaggingRuntimeInput = { executor, identity: { workspaceId: 3, userId: 7 }, operationId: "b7d29fe8-2c53-4c34-bfe7-cbe34c102125",
    sourceHash: "a".repeat(64), imageCount: 3, configuration };
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YG9QmcAAAAASUVORK5CYII=", "base64");
  const evidence: ImageTaggingEvidence = { imageSetId: 5, imageId: 9, imageRevision: "b".repeat(64), sourceUrlRef: "storage://private/SYNTHETIC_SOURCE", contentHash: sha(bytes), byteSize: bytes.length, contentType: "image/png" };
  const resolve = vi.fn(async () => clone(approval)), runtime = createImageTaggingRuntime({ approvalResolver: resolve, credentialResolver: mocks.key });
  const rehash = () => { configuration.hash = configurationHash(configuration.config); };
  const updateApproval = () => { approval.skillSnapshotHash = assistantConversationSkillSnapshotHash(assistantConversationSkillSnapshotFromRow(skills[0]).pin);
    approval.modelConfigurationHash = strictModelSnapshotFromRow(3, models[0].slug, models[0]).configurationHash; };
  async function stage(originalBytes: Uint8Array = bytes, source: ImageTaggingEvidence = evidence) {
    const { runtimeSnapshot } = await runtime.prepare(input); return runtime.prepareStage({ ...input, runtimeSnapshot, evidence: source, originalBytes });
  }
  const fence = vi.fn(async (_receipt: unknown, verify: Parameters<Parameters<typeof runtime.executeStage>[1]["beforeDispatch"]>[1]) => {
    await verify(executor, configuration, input.sourceHash, evidence);
  });
  return { skills, models, engines, configuration, approval, execute, executor, input, bytes, evidence, runtime, resolve, rehash, updateApproval, stage, fence };
}
describe("tagger Qingdao-only reviewed runtime", () => {
  it("freezes exact batch/config/skill/model budget without reading images or dispatching", async () => {
    const f = fixture(), value = await f.runtime.prepare(f.input);
    expect(ImageTaggingRuntimeSnapshotSchema.parse(value.runtimeSnapshot)).toMatchObject({ identity: f.input.identity, sourceHash: f.input.sourceHash,
      imageCount: 3, configuration: { agentKey: "tagger", revision: 2, hash: f.configuration.hash }, budgetPlan: { maxImageBytes: 8388608, outputTokens: 1024, maxCostCentsPerImage: 100, maxCostCentsTotal: 300 } });
    expect(JSON.stringify(value)).not.toMatch(/SYNTHETIC_SECRET|SYNTHETIC_RULES|SYNTHETIC_PROMPT|base64/u);
    expect(mocks.http).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each(["reviewed_supplement", "user_listing", "friend", "Qingdao"])("rejects %s as general Skill approval origin", origin => {
    const f = fixture(); expect(ImageTaggingSourceApprovalSchema.safeParse({ ...f.approval, source: { ...f.approval.source, origin } }).success).toBe(false);
  });
  it("fixed approval resolver copies records, forbids duplicate workspace, and never falls back", async () => {
    const f = fixture(), resolver = createFixedImageTaggingApprovalResolver([f.approval]); f.approval.source.revision = "changed";
    expect((await resolver({ executor: f.executor, identity: f.input.identity, agentKey: "tagger", stage: "image_tagging" }))?.source.revision).toBe("synthetic-source-revision");
    expect(await resolver({ executor: f.executor, identity: { ...f.input.identity, workspaceId: 4 }, agentKey: "tagger", stage: "image_tagging" })).toBeNull();
    expect(() => createFixedImageTaggingApprovalResolver([f.approval, f.approval])).toThrow("APPROVAL_DUPLICATE");
  });
  it("default resolver is unavailable and lazy; exact local file/hash enables only matching Qingdao record", async () => {
    const f = fixture(), runtime = createImageTaggingRuntime({ credentialResolver: mocks.key });
    await expect(runtime.prepare(f.input)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" }); expect(f.execute).not.toHaveBeenCalled();
    const directory = await mkdtemp(join(tmpdir(), "tagger-approval-unit-")); folders.push(directory); const path = join(directory, "approval.json");
    const body = JSON.stringify({ version: 1, kind: "image_tagging", records: [f.approval] }); await writeFile(path, body, { mode: 0o600 });
    vi.stubEnv("IMAGE_TAGGING_APPROVAL_FILE", path); vi.stubEnv("IMAGE_TAGGING_APPROVAL_SHA256", sha(body));
    expect((await runtime.prepare(f.input)).runtimeSnapshot.approval).toEqual(f.approval);
    vi.stubEnv("IMAGE_TAGGING_APPROVAL_SHA256", "0".repeat(64)); await expect(runtime.prepare(f.input)).rejects.toMatchObject({ code: "APPROVAL_HASH_MISMATCH" });
    expect(mocks.http).not.toHaveBeenCalled();
  });
  it("rejects another domain file rather than treating it as approval", async () => {
    const f = fixture(); vi.stubEnv("PROFIT_ANALYSIS_APPROVAL_FILE", "/SYNTHETIC/unused.json");
    expect(await createFileImageTaggingApprovalResolver()({ executor: f.executor, identity: f.input.identity, agentKey: "tagger", stage: "image_tagging" })).toBeNull();
  });
  it.each(["disabled", "binding_disabled", "binding_missing", "version", "manifest", "hash", "workspace", "wrong_agent"])("rejects invalid saved configuration: %s", async kind => {
    const f = fixture();
    if (kind === "disabled") f.configuration.config.enabled = false;
    if (kind === "binding_disabled") f.configuration.config.skills[0].enabled = false;
    if (kind === "binding_missing") f.configuration.config.skills = [];
    if (kind === "version") f.configuration.config.skills[0].version++;
    if (kind === "manifest") f.configuration.config.skills[0].manifestSha256 = "0".repeat(64);
    if (kind === "workspace") f.configuration.workspaceId = 4;
    if (kind === "wrong_agent") (f.configuration as { agentKey: string }).agentKey = "listing";
    f.rehash(); if (kind === "hash") f.configuration.hash = "0".repeat(64);
    await expect(f.runtime.prepare(f.input)).rejects.toBeInstanceOf(ImageTaggingRuntimeError); expect(mocks.http).not.toHaveBeenCalled();
  });
  it("inherits only the approved Skill model when persisted model selection is empty", async () => {
    const f = fixture(); f.configuration.config.modelSlug = ""; f.rehash(); expect((await f.runtime.prepare(f.input)).runtimeSnapshot.model.model.slug).toBe("synthetic-vision");
    f.skills[0].modelOverride = null; f.updateApproval(); await expect(f.runtime.prepare(f.input)).rejects.toMatchObject({ code: "MODEL_BINDING_MISMATCH" });
  });
  it.each(["duplicate_skill", "duplicate_model", "shared_scope", "foreign_skill", "prompt_changed", "no_vision", "missing_price", "wrong_engine", "model_changed", "unapproved_model", "cost"])("rejects source/model admission: %s", async kind => {
    const f = fixture();
    if (kind === "duplicate_skill") f.skills.push(clone(f.skills[0]));
    if (kind === "duplicate_model") f.models.push(clone(f.models[0]));
    if (kind === "shared_scope") { f.skills[0].workspaceId = null; f.skills[0].scope = "shared"; }
    if (kind === "foreign_skill") f.skills[0].workspaceId = 4;
    if (kind === "prompt_changed") f.skills[0].manifest.implementation.systemPrompt += "modified";
    if (kind === "no_vision") { f.models[0].capabilityTags = ["text"]; f.updateApproval(); }
    if (kind === "missing_price") { f.models[0].costPer1kInputTokens = null; f.updateApproval(); }
    if (kind === "wrong_engine") f.engines[0].engine = "MyISAM";
    if (kind === "model_changed") f.models[0].modelId = "changed";
    if (kind === "unapproved_model") { f.configuration.config.modelSlug = "another"; f.rehash(); }
    if (kind === "cost") f.approval.maxCostCents = 0;
    await expect(f.runtime.prepare(f.input)).rejects.toBeInstanceOf(ImageTaggingRuntimeError); expect(mocks.http).not.toHaveBeenCalled();
  });
  it("does not truncate an over-budget rules/context envelope or omit it from a template", async () => {
    const f = fixture(); f.skills[0].manifest.implementation.userPromptTemplate = "unrelated"; f.updateApproval();
    f.configuration.config.skills[0].manifestSha256 = assistantConversationSkillSnapshotFromRow(f.skills[0]).pin.manifestSha256; f.rehash();
    await expect(f.runtime.prepare(f.input)).rejects.toMatchObject({ code: "INPUT_CONTRACT_UNSUPPORTED" });
  });
});
describe("actual strict adapter with synthetic SQL/provider transports", () => {
  it("dispatches one pinned image only after fresh callback, then returns validated candidates without KB writes", async () => {
    const f = fixture(), prepared = await f.stage();
    const result = await f.runtime.executeStage(prepared, { beforeDispatch: f.fence });
    expect(result).toMatchObject({ candidate, stage: "image_tagging", evidenceHash: strictRuntimeHash(f.evidence), providerRequestHash: prepared.providerRequestHash });
    expect(ImageTaggingCandidateSchema.parse(result.candidate)).toEqual(candidate); expect(mocks.http).toHaveBeenCalledOnce(); expect(f.fence).toHaveBeenCalledOnce();
    const request = mocks.http.mock.calls[0][1]; expect(request.auditContext.operation).toBe("knowledge.image_tagging.strict");
    expect(request.body).toContain("SYNTHETIC_RULES"); expect(request.body).not.toContain(f.evidence.sourceUrlRef);
    expect(request.body).toContain(f.bytes.toString("base64")); expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.rollout).not.toHaveBeenCalled();
    const writes = f.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query)).filter(value => !value.sql.startsWith("SELECT"));
    expect(writes.every(value => /emperor_skill_runs|emperor_skills/u.test(value.sql))).toBe(true);
    expect(JSON.stringify(writes)).not.toMatch(/SYNTHETIC_RULES|SYNTHETIC_SECRET|SYNTHETIC_SOURCE|SYNTHETIC_IMAGE_EVIDENCE/u);
    await expect(f.runtime.executeStage(prepared, { beforeDispatch: f.fence })).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" }); expect(mocks.http).toHaveBeenCalledOnce();
  });
  it("awaits durable transaction ACK after verification before any provider call", async () => {
    const f = fixture(), prepared = await f.stage(); let release!: () => void;
    const running = f.runtime.executeStage(prepared, { beforeDispatch: async (receipt, verify) => {
      await f.fence(receipt, verify); await new Promise<void>(resolve => { release = resolve; });
    } });
    await vi.waitFor(() => expect(release).toBeTypeOf("function")); expect(mocks.http).not.toHaveBeenCalled(); release(); await running; expect(mocks.http).toHaveBeenCalledOnce();
  });
  it.each(["no_verify", "unawaited", "twice", "ack_lost", "source", "evidence", "configuration", "approval", "lease_denied"])("blocks pre-dispatch violation %s without a provider call", async kind => {
    const f = fixture(), prepared = await f.stage();
    await expect(f.runtime.executeStage(prepared, { beforeDispatch: async (receipt, verify) => {
      if (kind === "no_verify") return;
      if (kind === "unawaited") { void verify(f.executor, f.configuration, f.input.sourceHash, f.evidence); return; }
      if (kind === "source") f.input.sourceHash = "d".repeat(64);
      if (kind === "evidence") f.evidence.imageRevision = "d".repeat(64);
      if (kind === "configuration") { f.configuration.config.rules.push("changed"); f.rehash(); }
      if (kind === "approval") f.approval.source.revision = "changed";
      if (kind === "lease_denied") throw new Error("SYNTHETIC_PERMISSION_DENIED");
      await f.fence(receipt, verify);
      if (kind === "twice") await f.fence(receipt, verify);
      if (kind === "ack_lost") throw new Error("SYNTHETIC_COMMIT_ACK_LOST");
    } })).rejects.toBeInstanceOf(ImageTaggingRuntimeError);
    expect(mocks.http).not.toHaveBeenCalled(); await expect(f.runtime.executeStage(prepared, { beforeDispatch: f.fence })).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" });
  });
  it.each(["bytes", "size", "mime", "revision", "snapshot"])("rejects changed per-image %s before dispatch", async kind => {
    const f = fixture(), { runtimeSnapshot } = await f.runtime.prepare(f.input), evidence = clone(f.evidence), bytes = Buffer.from(f.bytes);
    if (kind === "bytes") bytes[bytes.length - 1] ^= 1;
    if (kind === "size") evidence.byteSize++;
    if (kind === "mime") evidence.contentType = "image/jpeg";
    if (kind === "revision") evidence.imageRevision = "not-a-hash";
    if (kind === "snapshot") runtimeSnapshot.sourceHash = "d".repeat(64);
    await expect(f.runtime.prepareStage({ ...f.input, runtimeSnapshot, evidence, originalBytes: bytes })).rejects.toBeInstanceOf(ImageTaggingRuntimeError); expect(mocks.http).not.toHaveBeenCalled();
  });
  it("admits exactly 8 MiB through the real strict adapter but rejects 8 MiB + 1", async () => {
    const f = fixture(), bytes = Buffer.alloc(8388608); f.bytes.copy(bytes);
    const evidence = { ...f.evidence, byteSize: bytes.length, contentHash: sha(bytes) }, prepared = await f.stage(bytes, evidence);
    const result = await f.runtime.executeStage(prepared, { beforeDispatch: async (_receipt, verify) => { await verify(f.executor, f.configuration, f.input.sourceHash, evidence); } });
    expect(result.candidate).toEqual(candidate); expect(mocks.http).toHaveBeenCalledOnce();
    await expect(f.stage(Buffer.concat([bytes, Buffer.from([0])]), { ...evidence, byteSize: 8388609 })).rejects.toMatchObject({ code: "EVIDENCE_INVALID" });
  });
  it("copies original bytes/evidence/config instead of trusting mutable prepared-looking objects", async () => {
    const f = fixture(), bytes = Buffer.from(f.bytes), prepared = await f.stage(bytes); bytes.fill(0);
    await expect(f.runtime.executeStage({ ...prepared }, { beforeDispatch: f.fence })).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" });
    expect((await f.runtime.executeStage(prepared, { beforeDispatch: f.fence })).candidate).toEqual(candidate);
    expect(mocks.http.mock.calls[0][1].body).toContain(f.bytes.toString("base64"));
  });
  it("keeps a paid valid reply after advisory failures or later config changes", async () => {
    const f = fixture(), prepared = await f.stage(); mocks.metric.mockRejectedValue(new Error("PRIVATE_METRIC_FAILURE"));
    mocks.http.mockImplementation(async () => { f.configuration.config.enabled = false; f.rehash(); return { ok: true, json: () => ({ choices: [{ message: { content: JSON.stringify(candidate) } }], usage: { prompt_tokens: 50, completion_tokens: 30 } }) }; });
    expect(await f.runtime.executeStage(prepared, { beforeDispatch: f.fence })).toMatchObject({ candidate, auditWarnings: ["METRICS_UNAVAILABLE"] });
  });
  it.each(["network_unknown", "invalid_enum", "extra_field", "missing_field"])("never retries paid %s and never invents candidate fields", async kind => {
    const f = fixture(), prepared = await f.stage();
    if (kind === "network_unknown") mocks.http.mockRejectedValue(new Error("PRIVATE_PROVIDER_BODY"));
    else { const bad: Record<string, unknown> = clone(candidate); if (kind === "invalid_enum") bad.tagSellingPointDetail = "更牛逼";
      if (kind === "extra_field") bad.extra = "unknown"; if (kind === "missing_field") delete bad.evidence;
      mocks.http.mockResolvedValue({ ok: true, json: () => ({ choices: [{ message: { content: JSON.stringify(bad) } }], usage: { prompt_tokens: 50, completion_tokens: 30 } }) }); }
    await expect(f.runtime.executeStage(prepared, { beforeDispatch: f.fence })).rejects.toBeInstanceOf(ImageTaggingRuntimeError);
    expect(mocks.http).toHaveBeenCalledOnce(); expect(mocks.legacy).not.toHaveBeenCalled();
    await expect(f.runtime.executeStage(prepared, { beforeDispatch: f.fence })).rejects.toMatchObject({ code: "STAGE_ALREADY_CONSUMED" });
  });
  it("cancellation before execution uses no provider and consumes the one-shot capability", async () => {
    const f = fixture(), prepared = await f.stage(), controller = new AbortController(); controller.abort();
    await expect(f.runtime.executeStage(prepared, { beforeDispatch: f.fence, signal: controller.signal })).rejects.toMatchObject({ code: "CANCELED" });
    expect(mocks.http).not.toHaveBeenCalled();
  });
  it("rejects fake getters/private registry failures without retaining their cause", async () => {
    const f = fixture(); f.execute.mockRejectedValue(new Error("PRIVATE_SQL_HOST_PASSWORD"));
    try { await f.runtime.prepare(f.input); throw new Error("Expected refusal"); } catch (error) {
      expect(error).toBeInstanceOf(ImageTaggingRuntimeError); expect(String(error)).not.toMatch(/PRIVATE_SQL/u); expect((error as Error).cause).toBeUndefined();
    }
  });
});
