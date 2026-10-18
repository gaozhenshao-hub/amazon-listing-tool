import { createHash } from "node:crypto";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), getDb: vi.fn(), invokeLLM: vi.fn(), http: vi.fn(), rollout: vi.fn(),
  key: vi.fn(), evaluation: vi.fn(), metric: vi.fn() }));
vi.mock("./repositories/dbClient", () => ({ getDb: mocks.getDb }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));
vi.mock("./infrastructure/http/safeHttpClient", () => ({ SafeHttpError: class SafeHttpError extends Error {}, safeHttpRequest: mocks.http }));
vi.mock("./domains/ai_os/services/skillRollout", () => ({ resolveActiveSkillRollout: mocks.rollout }));
vi.mock("./domains/ai_os/services/observability", () => ({ recordAiOsEvaluation: mocks.evaluation, recordAiOsMetric: mocks.metric }));
vi.mock("./domains/ai_os/services/teamorouterCatalog", async importOriginal => ({ ...await importOriginal<object>(), resolveGovernedModelApiKey: mocks.key }));
import { runEmperorSkill, resolveStrictRegisteredModelSnapshot, type RunSkillInput } from "./domains/ai_os/services/skillRunner";
import { strictRuntimeCanonical, strictCostUpperBound, StrictSkillRuntimeError, type StrictSkillExecutionOptions } from "./domains/ai_os/services/strictSkillRuntime";

const dialect = new MySqlDialect(), short = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);
const manifest = { implementation: { systemPrompt: "PRIVATE_SYSTEM", userPromptTemplate: "PRIVATE_TEMPLATE {{context}}", maxTokens: 1000, temperature: 0.2, supportsJsonMode: true } };
const baseModel = { workspaceId: 7, slug: "strict-model", provider: "custom", modelId: "actual-model", baseUrl: "https://model.example.invalid/v1",
  apiKeyRef: "env:EXTERNAL_LLM_API_KEY", isActive: 1, capabilityTags: ["text", "vision"], maxContextTokens: 128000,
  costPer1kInputTokens: "0.02", costPer1kOutputTokens: "0.06" };
const baseSkill = { workspaceId: 7, scope: "workspace", slug: "strict.skill", name: "Fixture", version: 3, status: "Released", modelOverride: null, timeout_seconds: 120, manifest };
let models: Record<string, unknown>[], skills: Record<string, unknown>[];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sqlCalls = () => mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
const auditText = () => JSON.stringify({ sql: sqlCalls().filter(q => !q.sql.startsWith("SELECT")), evaluation: mocks.evaluation.mock.calls, metric: mocks.metric.mock.calls });
beforeEach(() => {
  vi.clearAllMocks(); models = [clone(baseModel)]; skills = [clone(baseSkill)];
  mocks.getDb.mockResolvedValue({ execute: mocks.execute }); mocks.key.mockReturnValue("PRIVATE_SECRET_KEY");
  mocks.rollout.mockResolvedValue(null); mocks.evaluation.mockResolvedValue({ recorded: true }); mocks.metric.mockResolvedValue({ recorded: true });
  mocks.execute.mockImplementation(async query => {
    const text = dialect.sqlToQuery(query).sql;
    if (text.startsWith("SELECT * FROM emperor_skills")) return [clone(skills)];
    if (text.includes("FROM emperor_model_providers")) return [clone(models)];
    return [[]];
  });
  mocks.http.mockResolvedValue({ ok: true, status: 200, json: () => ({ choices: [{ message: { content: "PRIVATE_REPLY" } }], usage: { prompt_tokens: 30, completion_tokens: 10 } }) });
  mocks.invokeLLM.mockResolvedValue({ choices: [{ message: { content: "legacy" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
});
async function input(): Promise<RunSkillInput<string>> {
  const modelSnapshot = await resolveStrictRegisteredModelSnapshot({ workspaceId: 7, modelSlug: "strict-model" });
  return { skillSlug: "strict.skill", userId: 13, workspaceId: 7, context: "PRIVATE_DOCUMENT", variables: { privateVariable: "PRIVATE_VARIABLE" },
    fallbackModels: [], maxModelAttempts: 1, modelOverride: "strict-model", skillVersionPolicy: "pinned", expectedSkillVersion: "3",
    expectedSkillPromptHash: short(manifest.implementation.systemPrompt), expectedSkillUserPromptHash: short(manifest.implementation.userPromptTemplate),
    expectedSkillManifestHash: short(JSON.stringify(manifest)), expectedSkillStatus: "Released", strictExecution: { modelSnapshot,
      bindingHash: "a".repeat(64), stage: "reply", expectedSkillModelOverride: null, expectedSkillTimeoutSeconds: 120, maxCostCents: 100, beforeDispatch: vi.fn().mockResolvedValue(undefined) } };
}
function noCalls() { expect(mocks.http).not.toHaveBeenCalled(); expect(mocks.invokeLLM).not.toHaveBeenCalled(); }

describe("strict registered model resolution", () => {
  it("returns canonical full configuration hash without key value and preserves registry identity", async () => {
    const snapshot = await resolveStrictRegisteredModelSnapshot({ workspaceId: 7, modelSlug: "strict-model" });
    expect(snapshot.model.modelId).toBe("actual-model"); expect(snapshot.configurationHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_SECRET_KEY"); noCalls();
  });
  it.each([{ rows: [] }, { rows: [baseModel, baseModel] }])("rejects missing or ambiguous registry without fallbacks", async ({ rows }) => {
    models = clone(rows); await expect(resolveStrictRegisteredModelSnapshot({ workspaceId: 7, modelSlug: "strict-model" })).rejects.toMatchObject({ code: "STRICT_MODEL_UNAVAILABLE" }); noCalls();
  });
  it.each([['provider', 'openai'], ['provider', 'manus_builtin'], ['isActive', 0], ['apiKeyRef', 'RAW_PRIVATE_KEY'], ['apiKeyRef', 'env:UNKNOWN'], ['workspaceId', 8], ['slug', 'STRICT-MODEL'], ['maxContextTokens', null], ['capabilityTags', 'broken'], ['baseUrl', 'http://model.example.invalid'], ['baseUrl', 'https://secret:password@model.example.invalid'], ['baseUrl', 'https://model.example.invalid?q=secret']])("rejects invalid field %s", async (field, value) => {
    models[0][field] = value;
    await expect(resolveStrictRegisteredModelSnapshot({ workspaceId: 7, modelSlug: "strict-model" })).rejects.toBeInstanceOf(StrictSkillRuntimeError); noCalls();
  });
  it("rejects missing governed credential", async () => { mocks.key.mockReturnValue(""); await expect(resolveStrictRegisteredModelSnapshot({ workspaceId: 7, modelSlug: "strict-model" })).rejects.toMatchObject({ code: "STRICT_MODEL_CREDENTIAL_UNAVAILABLE" }); noCalls(); });
  it("rejects malformed input before database access", async () => { await expect(resolveStrictRegisteredModelSnapshot({ workspaceId: 0, modelSlug: "strict-model" })).rejects.toBeInstanceOf(StrictSkillRuntimeError); expect(mocks.getDb).not.toHaveBeenCalled(); });
  it("canonical hash ignores object key order but not registry configuration changes", async () => {
    const first = await resolveStrictRegisteredModelSnapshot({ workspaceId: 7, modelSlug: "strict-model" });
    models = [Object.fromEntries(Object.entries(baseModel).reverse())]; expect((await resolveStrictRegisteredModelSnapshot({ workspaceId: 7, modelSlug: "strict-model" })).configurationHash).toBe(first.configurationHash);
    models[0].costPer1kInputTokens = "0.03"; expect((await resolveStrictRegisteredModelSnapshot({ workspaceId: 7, modelSlug: "strict-model" })).configurationHash).not.toBe(first.configurationHash);
  });
});
describe("private strict single-dispatch Skill execution", () => {
  it("admits the reviewed single-image tagging policy with its own immutable audit stage", async () => {
    const request = await input(); request.strictExecution!.stage = "image_tagging";
    request.strictExecution!.imageBudget = { policyId: "synthetic-tagging-policy", maxInputTokensPerImage: 8192, stage: "image_tagging", maxImageBytes: 8388608, maxImages: 1 };
    request.attachments = [{ type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.alloc(4 * 1024 * 1024, 1).toString("base64")}` } }];
    await runEmperorSkill(request);
    expect(mocks.http).toHaveBeenCalledOnce(); expect(mocks.http.mock.calls[0][1].auditContext.operation).toBe("knowledge.image_tagging.strict");
    expect(request.strictExecution!.beforeDispatch).toHaveBeenCalledWith(expect.objectContaining({ stage: "image_tagging", budget: expect.objectContaining({ imageCount: 1, imageBytes: 4 * 1024 * 1024 }) }));
  });
  it.each(["route", "reply", "profit_analysis", "competitor_deep"] as const)("cannot borrow the 8 MiB tagging policy for %s", async stage => {
    const request = await input(); request.strictExecution!.stage = stage;
    request.strictExecution!.imageBudget = { policyId: "synthetic", maxInputTokensPerImage: 8192, stage: "image_tagging", maxImageBytes: 8388608, maxImages: 1 };
    mocks.execute.mockClear(); await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: "STRICT_RUNTIME_OPTIONS_INVALID" });
    expect(mocks.execute).not.toHaveBeenCalled(); noCalls();
  });
  it.each(["two_images", "oversize", "changed_limit"])("rejects invalid tagging image policy: %s", async kind => {
    const request = await input(); request.strictExecution!.stage = "image_tagging";
    request.strictExecution!.imageBudget = { policyId: "synthetic", maxInputTokensPerImage: 8192, stage: "image_tagging", maxImageBytes: 8388608, maxImages: 1 };
    const attachment = { type: "image_url" as const, image_url: { url: `data:image/png;base64,${Buffer.alloc(kind === "oversize" ? 8388609 : 4, 1).toString("base64")}` } };
    request.attachments = kind === "two_images" ? [attachment, attachment] : [attachment];
    if (kind === "changed_limit") (request.strictExecution!.imageBudget as { maxImageBytes: number }).maxImageBytes++;
    await expect(runEmperorSkill(request)).rejects.toBeInstanceOf(StrictSkillRuntimeError); noCalls();
  });
  it.each([undefined, { policyId: "synthetic", maxInputTokensPerImage: 8192 }])("requires tagging-specific image policy rather than implicit 3 MiB defaults", async imageBudget => {
    const request = await input(); request.strictExecution!.stage = "image_tagging";
    if (imageBudget === undefined) delete request.strictExecution!.imageBudget; else request.strictExecution!.imageBudget = imageBudget;
    mocks.execute.mockClear(); await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: "STRICT_RUNTIME_OPTIONS_INVALID" });
    expect(mocks.execute).not.toHaveBeenCalled(); noCalls();
  });
  it.each(["route", "reply", "profit_analysis", "competitor_deep"] as const)("uses fixed %s audit identity without storing private source bodies", async stage => {
    const request = await input(); request.strictExecution!.stage = stage;
    await runEmperorSkill(request);
    const source = stage === "competitor_deep" ? "listing.competitor.deep.strict" : stage === "profit_analysis" ? "ops.profit.private.strict" : "assistant.private.strict";
    const operation = stage === "profit_analysis" || stage === "competitor_deep" ? source : "ai_os.assistant.private.strict";
    const insertion = sqlCalls().find(q => q.sql.startsWith("INSERT INTO emperor_skill_runs"))!;
    expect(insertion.params[7]).toBe(source);
    expect(JSON.parse(insertion.params[9] as string)).toMatchObject({ privateExecution: true, stage });
    expect(mocks.http.mock.calls[0][1].auditContext).toEqual({ workspaceId: 7, operation });
    expect(request.strictExecution!.beforeDispatch).toHaveBeenCalledWith(expect.objectContaining({ stage }));
    expect(mocks.http).toHaveBeenCalledOnce(); expect(mocks.invokeLLM).not.toHaveBeenCalled();
    for (const secret of ["PRIVATE_SYSTEM", "PRIVATE_TEMPLATE", "PRIVATE_DOCUMENT", "PRIVATE_VARIABLE", "PRIVATE_REPLY", "PRIVATE_SECRET_KEY"]) expect(auditText()).not.toContain(secret);
  });
  it.each(["profit", "ops.profit.analysis", "finance.monthly.profit", "competitor", "listing.competitor.deep", "title", "buyers:0", "", null])("rejects unregistered business stage %s without registry access or dispatch", async stage => {
    const request = await input(); (request.strictExecution as unknown as { stage: unknown }).stage = stage;
    mocks.execute.mockClear();
    await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: "STRICT_RUNTIME_OPTIONS_INVALID" });
    expect(mocks.execute).not.toHaveBeenCalled(); noCalls();
  });
  it.each((["profit_analysis", "competitor_deep"] as const).flatMap(stage =>
    ["missingPin", "changedModel", "deniedFence", "unknownOutcome", "arbitraryAuditTag"].map(kind => ({ stage, kind }))))("$stage preserves strict admission and single-dispatch behavior: $kind", async ({ stage, kind }) => {
    const request = await input(); request.strictExecution!.stage = stage;
    if (kind === "missingPin") request.expectedSkillManifestHash = undefined;
    if (kind === "changedModel") models[0].modelId = "unapproved-model";
    if (kind === "deniedFence") request.strictExecution!.beforeDispatch = async () => { throw new Error("PRIVATE_FINANCE_TRANSACTION"); };
    if (kind === "unknownOutcome") mocks.http.mockRejectedValue(new Error("PRIVATE_FINANCE_PROVIDER_BODY"));
    if (kind === "arbitraryAuditTag") (request.strictExecution as unknown as Record<string, unknown>).operation = "assistant.private.strict";
    await expect(runEmperorSkill(request)).rejects.toBeInstanceOf(StrictSkillRuntimeError);
    expect(mocks.http).toHaveBeenCalledTimes(kind === "unknownOutcome" ? 1 : 0);
    expect(mocks.invokeLLM).not.toHaveBeenCalled(); expect(mocks.rollout).not.toHaveBeenCalled();
    expect(auditText()).not.toMatch(/PRIVATE_FINANCE|PRIVATE_DOCUMENT|PRIVATE_SECRET_KEY/u);
  });
  it("awaits the fence after audit preparation and dispatches exactly the registered endpoint/model once", async () => {
    const request = await input(); let release!: () => void;
    request.strictExecution!.beforeDispatch = vi.fn(async receipt => {
      expect(sqlCalls().some(q => q.sql.startsWith("INSERT INTO emperor_skill_runs"))).toBe(true);
      expect(receipt).toMatchObject({ stage: "reply", bindingHash: "a".repeat(64) });
      await new Promise<void>(resolve => { release = resolve; });
    });
    const result = runEmperorSkill(request);
    await vi.waitFor(() => expect(release).toBeTypeOf("function")); noCalls(); release();
    expect(await result).toMatchObject({ content: "PRIVATE_REPLY", modelSlug: "strict-model", fallbackCount: 0 });
    expect(mocks.http).toHaveBeenCalledOnce(); expect(mocks.invokeLLM).not.toHaveBeenCalled(); expect(mocks.rollout).not.toHaveBeenCalled();
    expect(mocks.http.mock.calls[0][0]).toBe("https://model.example.invalid/v1/chat/completions");
    const options = mocks.http.mock.calls[0][1]; expect(options).toMatchObject({ maxRedirects: 0, allowPrivateNetwork: false });
    expect(JSON.parse(options.body)).toMatchObject({ model: "actual-model", max_tokens: 1000 });
    for (const secret of ["PRIVATE_SYSTEM", "PRIVATE_TEMPLATE", "PRIVATE_DOCUMENT", "PRIVATE_VARIABLE", "PRIVATE_REPLY", "PRIVATE_SECRET_KEY"]) expect(auditText()).not.toContain(secret);
  });
  it.each([['expectedSkillVersion', undefined], ['expectedSkillPromptHash', undefined], ['expectedSkillUserPromptHash', undefined], ['expectedSkillManifestHash', undefined], ['expectedSkillStatus', 'Draft'], ['skillVersionPolicy', 'latest'], ['maxModelAttempts', 2], ['fallbackModels', ['other']], ['modelOverride', 'other'], ['workspaceId', null], ['legacySystemPrompt', 'private'], ['executionPreset', 'quality_first']])("requires complete approved pins/options: %s", async (field, value) => {
    const request = await input(); (request as unknown as Record<string, unknown>)[field] = value;
    await expect(runEmperorSkill(request)).rejects.toBeInstanceOf(StrictSkillRuntimeError); noCalls();
  });
  it.each(['modelId', 'baseUrl', 'maxContextTokens', 'capabilityTags', 'costPer1kOutputTokens'])("refuses current model drift: %s", async field => {
    const request = await input(); models[0][field] = field === 'maxContextTokens' ? 100000 : field === 'capabilityTags' ? ['text'] : field === 'baseUrl' ? 'https://other.example.invalid/v1' : field === 'costPer1kOutputTokens' ? '0.07' : 'changed';
    await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: "STRICT_MODEL_CHANGED" }); noCalls();
  });
  it.each(['version', 'status', 'manifest', 'modelOverride', 'timeout_seconds'])("refuses current Skill drift: %s", async field => {
    const request = await input(); skills[0][field] = field === 'version' ? 4 : field === 'timeout_seconds' ? 60 : field === 'manifest' ? { implementation: { systemPrompt: 'changed' } } : 'changed';
    await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: "STRICT_RUNTIME_SKILL_CHANGED" }); noCalls();
  });
  it("rejects ambiguous Skill lookup", async () => { const request = await input(); skills.push(clone(baseSkill)); await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: "STRICT_RUNTIME_SKILL_UNAVAILABLE" }); noCalls(); });
  it("does not dispatch after denied callback and never retains its private cause", async () => {
    const request = await input(); request.strictExecution!.beforeDispatch = async () => { throw new Error("PRIVATE_CALLBACK_SQL"); };
    const error = await runEmperorSkill(request).catch(value => value); expect(error.code).toBe("STRICT_RUNTIME_DISPATCH_DENIED"); noCalls();
    expect(JSON.stringify(error) + auditText()).not.toContain("PRIVATE_CALLBACK_SQL"); expect(error.cause).toBeUndefined();
  });
  it("does not dispatch if callback aborts", async () => {
    const request = await input(), controller = new AbortController(); request.signal = controller.signal;
    request.strictExecution!.beforeDispatch = async () => { controller.abort("PRIVATE_ABORT"); };
    await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: "STRICT_RUNTIME_CANCELED" }); noCalls(); expect(auditText()).not.toContain("PRIVATE_ABORT");
  });
  it.each(['timeout', 'HTTP', 'invalidJSON', 'invalidOutput', 'missingUsage'])("never retries/fallbacks after %s", async kind => {
    const request = await input();
    if (kind === 'timeout') mocks.http.mockRejectedValue(new Error("PRIVATE_PROVIDER_BODY timeout"));
    if (kind === 'HTTP') mocks.http.mockResolvedValue({ ok: false, text: () => 'PRIVATE_PROVIDER_BODY' });
    if (kind === 'invalidJSON') mocks.http.mockResolvedValue({ ok: true, json: () => { throw new Error('PRIVATE_PROVIDER_BODY'); } });
    if (kind === 'invalidOutput') request.validate = () => { throw new Error('PRIVATE_VALIDATION_BODY'); };
    if (kind === 'missingUsage') mocks.http.mockResolvedValue({ ok: true, json: () => ({ choices: [{ message: { content: 'PRIVATE_REPLY' } }] }) });
    const error = await runEmperorSkill(request).catch(value => value);
    expect(error).toBeInstanceOf(StrictSkillRuntimeError); expect(mocks.http).toHaveBeenCalledOnce(); expect(mocks.invokeLLM).not.toHaveBeenCalled();
    for (const secret of ['PRIVATE_PROVIDER_BODY', 'PRIVATE_VALIDATION_BODY', 'PRIVATE_REPLY']) expect(JSON.stringify(error) + auditText()).not.toContain(secret);
  });
  it("captures caller JSON before asynchronous lookup, including callback identity", async () => {
    const request = await input(), original = request.strictExecution!.beforeDispatch;
    const pending = runEmperorSkill(request); request.context = 'MUTATED'; request.strictExecution!.beforeDispatch = async () => { throw new Error('should not run'); };
    await pending; expect(original).toHaveBeenCalledOnce(); expect(mocks.http.mock.calls[0][1].body).not.toContain('MUTATED');
  });
  it("refuses accessors without evaluating them", async () => {
    const request = await input(), getter = vi.fn(() => 'PRIVATE'); Object.defineProperty(request, 'context', { enumerable: true, get: getter });
    await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: 'STRICT_RUNTIME_INPUT_INVALID' }); expect(getter).not.toHaveBeenCalled(); noCalls();
  });
  it.each([new Date(), Infinity, undefined])("rejects non-JSON variable value %s", async value => {
    const request = await input(); request.variables = { value }; await expect(runEmperorSkill(request)).rejects.toBeInstanceOf(StrictSkillRuntimeError); noCalls();
  });
  it("rejects missing pricing and excessive spend before dispatch", async () => {
    models[0].costPer1kInputTokens = null; const request = await input(); await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: 'STRICT_RUNTIME_PRICING_UNAVAILABLE' }); noCalls();
    models = [clone(baseModel)]; const second = await input(); second.strictExecution!.maxCostCents = 0;
    await expect(runEmperorSkill(second)).rejects.toMatchObject({ code: 'STRICT_RUNTIME_COST_BUDGET_EXCEEDED' }); noCalls();
  });
  it("rejects context overflow without truncating", async () => { const request = await input(); request.context = 'x'.repeat(128000); await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: 'STRICT_RUNTIME_CONTEXT_BUDGET_EXCEEDED' }); noCalls(); });
  it("requires explicit image policy and preserves admitted image only in provider payload", async () => {
    const request = await input(), url = 'data:image/png;base64,' + Buffer.from('PRIVATE_IMAGE_BYTES').toString('base64');
    request.attachments = [{ type: 'image_url', image_url: { url } }];
    await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: 'STRICT_RUNTIME_IMAGE_BUDGET_REQUIRED' }); noCalls();
    request.strictExecution!.imageBudget = { policyId: 'approved-fixture', maxInputTokensPerImage: 8192 }; await runEmperorSkill(request);
    expect(mocks.http.mock.calls[0][1].body).toContain(url); expect(auditText()).not.toContain(url);
  });
  it.each(['https://images.example.invalid/private.png', 'data:image/png;base64,%%%%', 'data:image/png;base64,YQ==junk'])('refuses unbound image input %s', async url => {
    const request = await input(); request.attachments = [{ type: 'image_url', image_url: { url } }]; await expect(runEmperorSkill(request)).rejects.toBeInstanceOf(StrictSkillRuntimeError); noCalls();
  });
  it("leaves the old implicit fallback policy unchanged", async () => {
    models = []; await runEmperorSkill({ skillSlug: 'strict.skill', workspaceId: 7, userId: 13, variables: {}, fallbackModels: [], maxModelAttempts: 1 });
    expect(mocks.invokeLLM).toHaveBeenCalledOnce(); expect(mocks.http).not.toHaveBeenCalled();
  });
  it("computes pricing admission by exact integer ceiling", async () => {
    const request = await input(); expect(strictCostUpperBound(request.strictExecution!.modelSnapshot, 1, 0)).toBe(1);
    expect(strictCostUpperBound(request.strictExecution!.modelSnapshot, 0, 0)).toBe(0);
    expect(strictRuntimeCanonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it("strict options reject unknown fields and nonfunction fence", async () => {
    const request = await input(); (request.strictExecution as StrictSkillExecutionOptions & { extra?: unknown }).extra = 'PRIVATE';
    await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: 'STRICT_RUNTIME_OPTIONS_INVALID' }); noCalls();
  });
  it("refuses nonfunction and getter fences without execution", async () => {
    const request = await input(); request.strictExecution!.beforeDispatch = null as unknown as StrictSkillExecutionOptions['beforeDispatch'];
    await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: 'STRICT_RUNTIME_OPTIONS_INVALID' });
    const second = await input(), getter = vi.fn(); Object.defineProperty(second.strictExecution!, 'beforeDispatch', { enumerable: true, get: getter });
    await expect(runEmperorSkill(second)).rejects.toMatchObject({ code: 'STRICT_RUNTIME_OPTIONS_INVALID' }); expect(getter).not.toHaveBeenCalled(); noCalls();
  });
  it("refuses getter strictExecution without reading it", async () => {
    const request = await input(), getter = vi.fn(); Object.defineProperty(request, 'strictExecution', { enumerable: true, get: getter });
    await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: 'STRICT_RUNTIME_INPUT_INVALID' }); expect(getter).not.toHaveBeenCalled(); noCalls();
  });
  it("preserves three attachments at the full 3MiB per-file bound without regex overflow", async () => {
    const request = await input(), url = 'data:image/png;base64,' + Buffer.alloc(3 * 1024 * 1024, 7).toString('base64');
    request.attachments = Array.from({ length: 3 }, () => ({ type: 'image_url' as const, image_url: { url } }));
    request.strictExecution!.imageBudget = { policyId: 'approved-images', maxInputTokensPerImage: 8192 };
    await runEmperorSkill(request); expect(mocks.http).toHaveBeenCalledOnce();
    expect(JSON.parse(mocks.http.mock.calls[0][1].body).messages[1].content).toHaveLength(4);
    expect(auditText().length).toBeLessThan(15000);
  });
  it.each([4, 3 * 1024 * 1024 + 1])("rejects excessive image count/bytes %s before provider", async size => {
    const request = await input(); request.attachments = size === 4 ? Array.from({ length: 4 }, () => ({ type: 'image_url' as const, image_url: { url: 'data:image/png;base64,YQ==' } }))
      : [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + Buffer.alloc(size).toString('base64') } }];
    request.strictExecution!.imageBudget = { policyId: 'approved', maxInputTokensPerImage: 8192 };
    await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: 'STRICT_RUNTIME_ATTACHMENTS_INVALID' }); noCalls();
  });
  it("requires registered vision capability even with image policy", async () => {
    models[0].capabilityTags = ['text']; const request = await input(); request.attachments = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }];
    request.strictExecution!.imageBudget = { policyId: 'approved', maxInputTokensPerImage: 8192 };
    await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: 'STRICT_MODEL_VISION_REQUIRED' }); noCalls();
  });
  it("lost result audit ACK does not repeat provider request or expose its output", async () => {
    const request = await input(), execute = mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async query => { if (dialect.sqlToQuery(query).sql.startsWith('UPDATE emperor_skill_runs SET status=?,output=')) throw new Error('PRIVATE_SQL_ACK'); return execute(query); });
    const error = await runEmperorSkill(request).catch(value => value); expect(error.code).toBe('STRICT_RUNTIME_RESULT_UNKNOWN');
    expect(mocks.http).toHaveBeenCalledOnce(); expect(mocks.invokeLLM).not.toHaveBeenCalled();
    expect(JSON.stringify(error) + auditText()).not.toContain('PRIVATE_SQL_ACK'); expect(auditText()).not.toContain('PRIVATE_REPLY');
  });
  it("audit preparation failure occurs before callback and never dispatches", async () => {
    const request = await input(), execute = mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async query => { if (dialect.sqlToQuery(query).sql.startsWith('INSERT INTO emperor_skill_runs')) throw new Error('PRIVATE_SQL'); return execute(query); });
    const error = await runEmperorSkill(request).catch(value => value); expect(error.code).toBe('STRICT_RUNTIME_UNAVAILABLE');
    expect(request.strictExecution!.beforeDispatch).not.toHaveBeenCalled(); noCalls(); expect(JSON.stringify(error)).not.toContain('PRIVATE_SQL');
  });
  it("invalid maximum token budget and unknown price are never coerced to defaults", async () => {
    for (const value of [0, -1, 1.5, 32769]) {
      const request = await input(), changed = clone(manifest); changed.implementation.maxTokens = value; skills[0].manifest = changed;
      request.expectedSkillManifestHash = short(JSON.stringify(changed));
      await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: 'STRICT_RUNTIME_OUTPUT_BUDGET_INVALID' });
    }
    noCalls();
  });
  it("rejects excessive output usage and does not claim a free/zero usage response", async () => {
    const request = await input(); mocks.http.mockResolvedValue({ ok: true, json: () => ({ choices: [{ message: { content: 'PRIVATE_REPLY' } }], usage: { prompt_tokens: 1, completion_tokens: 1001 } }) });
    await expect(runEmperorSkill(request)).rejects.toMatchObject({ code: 'STRICT_RUNTIME_USAGE_INVALID' }); expect(mocks.http).toHaveBeenCalledOnce();
    expect(sqlCalls().some(q => q.params[0] === 'succeeded')).toBe(false);
  });
  it.each([7, null])("updates callCount only in the exact resolved Skill workspace %s", async workspaceId => {
    const request = await input(); skills[0].workspaceId = workspaceId; skills[0].scope = workspaceId === null ? 'global' : 'workspace';
    await runEmperorSkill(request);
    const update = sqlCalls().find(q => q.sql.startsWith('UPDATE emperor_skills SET callCount'))!;
    expect(update.sql).toBe(`UPDATE emperor_skills SET callCount = callCount + 1 WHERE slug = ? AND workspaceId ${workspaceId === null ? 'IS NULL' : '= ?'}`);
    expect(update.params).toEqual(workspaceId === null ? ['strict.skill'] : ['strict.skill', 7]);
  });
  it.each(['rejected', 'unacknowledged'])("metric %s never discards a paid reply or repeats a provider call", async failure => {
    const request = await input(); if (failure === 'rejected') mocks.metric.mockRejectedValue(new Error('PRIVATE_METRIC_ERROR')); else mocks.metric.mockResolvedValue({ recorded: false });
    const result = await runEmperorSkill(request); expect(result).toMatchObject({ content: 'PRIVATE_REPLY', auditWarnings: ['METRICS_UNAVAILABLE'] });
    expect(mocks.http).toHaveBeenCalledOnce(); expect(mocks.invokeLLM).not.toHaveBeenCalled(); expect(mocks.evaluation).not.toHaveBeenCalled();
    expect(JSON.stringify(result) + auditText()).not.toContain('PRIVATE_METRIC_ERROR');
  });
  it("an unavailable call counter is advisory and preserves the paid reply", async () => {
    const request = await input(), execute = mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async query => { if (dialect.sqlToQuery(query).sql.startsWith('UPDATE emperor_skills SET callCount')) throw new Error('PRIVATE_COUNTER_ERROR'); return execute(query); });
    const result = await runEmperorSkill(request); expect(result).toMatchObject({ content: 'PRIVATE_REPLY', auditWarnings: ['CALL_COUNT_UNAVAILABLE'] });
    expect(mocks.http).toHaveBeenCalledOnce(); expect(JSON.stringify(result) + auditText()).not.toContain('PRIVATE_COUNTER_ERROR');
  });
});
