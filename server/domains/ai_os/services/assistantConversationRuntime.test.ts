import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), getDb: vi.fn(), invokeLLM: vi.fn(), http: vi.fn(), rollout: vi.fn(), key: vi.fn(), evaluation: vi.fn(), metric: vi.fn() }));
vi.mock("../../../repositories/dbClient", () => ({ getDb: mocks.getDb }));
vi.mock("../../../_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));
vi.mock("../../../infrastructure/http/safeHttpClient", () => ({ SafeHttpError: class SafeHttpError extends Error {}, safeHttpRequest: mocks.http }));
vi.mock("./skillRollout", () => ({ resolveActiveSkillRollout: mocks.rollout }));
vi.mock("./observability", () => ({ recordAiOsEvaluation: mocks.evaluation, recordAiOsMetric: mocks.metric }));
vi.mock("./teamorouterCatalog", async importOriginal => ({ ...await importOriginal<object>(), resolveGovernedModelApiKey: mocks.key }));
import { assistantConversationCanonical, type AssistantConversationExecutor } from "../repositories/assistantConversations";
import { configurationHash, skillManifestHash } from "./assistantConfigurations";
import { parseAssistantConversationAttachment } from "./assistantConversationAttachments";
import { strictModelSnapshotFromRow } from "./strictSkillRuntime";
import { createAssistantConversationRuntime, createFixedAssistantConversationApprovalResolver, AssistantConversationRuntimeSnapshotSchema,
  assistantConversationRuntime,
  assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash, assistantConversationSkillScopeMatches,
  type AssistantConversationSourceApproval, type AssistantConversationRuntimePrepareInput } from "./assistantConversationRuntime";
import type { RunSkillInput, RunSkillResult } from "./skillRunner";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const digest = (value: unknown) => sha(assistantConversationCanonical(value));
const clone = <T>(value: T): T => structuredClone(value);
const identity = { workspaceId: 3, userId: 7, agentKey: "listing" as const, threadId: "a7d29fe8-2c53-4c34-bfe7-cbe34c102125" };
const operationId = "b7d29fe8-2c53-4c34-bfe7-cbe34c102125";
const dialect = new MySqlDialect();
const model = { workspaceId: 3, slug: "test-model", name: "Synthetic model", provider: "custom", modelId: "test-model-id", baseUrl: "https://example.invalid/v1", apiKeyRef: "env:EXTERNAL_LLM_API_KEY", isActive: 1, capabilityTags: ["text", "vision"], maxContextTokens: 2000000, costPer1kInputTokens: "0.001", costPer1kOutputTokens: "0.002" };
const approvalDirectories: string[] = [];
beforeEach(() => { vi.clearAllMocks(); mocks.key.mockReturnValue("SYNTHETIC_SECRET_NEVER_REAL"); vi.stubEnv("ASSISTANT_CONVERSATION_APPROVAL_FILE", undefined); vi.stubEnv("ASSISTANT_CONVERSATION_APPROVAL_SHA256", undefined); });
afterEach(async () => { vi.unstubAllEnvs(); for (const directory of approvalDirectories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function configuredApprovalFile(records: unknown[]) {
  const directory = await mkdtemp(join(tmpdir(), "assistant-approval-unit-")); approvalDirectories.push(directory);
  const path = join(directory, "approvals.json"), body = JSON.stringify({ version: 1, kind: "assistant_conversation", records });
  await writeFile(path, body, { mode: 0o600 }); vi.stubEnv("ASSISTANT_CONVERSATION_APPROVAL_FILE", path); vi.stubEnv("ASSISTANT_CONVERSATION_APPROVAL_SHA256", sha(body)); return path;
}
function skill(id: number, slug: string) {
  return { id, workspaceId: 3, scope: "workspace", slug, name: `Synthetic ${slug}`, version: 2, status: "Released", modelOverride: null, timeout_seconds: 120,
    manifest: { implementation: { systemPrompt: `Synthetic ${slug}: follow provided data`, userPromptTemplate: "{{context}}", maxTokens: 4096, temperature: 0.2, supportsJsonMode: true }, contract: { syntheticOnly: true } } };
}
function pin(row: ReturnType<typeof skill>) {
  return { id: row.id, workspaceId: row.workspaceId, scope: row.scope, slug: row.slug, name: row.name, version: row.version, status: row.status,
    manifestSha256: skillManifestHash(row.manifest), manifestRawSha256: sha(JSON.stringify(row.manifest)),
    systemPromptSha256: sha(row.manifest.implementation.systemPrompt), userPromptSha256: sha(row.manifest.implementation.userPromptTemplate), modelOverride: row.modelOverride,
    timeoutSeconds: row.timeout_seconds, maxTokens: row.manifest.implementation.maxTokens, temperature: row.manifest.implementation.temperature, supportsJsonMode: row.manifest.implementation.supportsJsonMode };
}
function harness() {
  const registry = [skill(1, "test.route"), skill(2, "test.reply"), skill(3, "listing.test")];
  const models = [clone(model)];
  let approved = true;
  const config = { name: "Synthetic assistant", description: "test", enabled: true, modelSlug: model.slug, instructions: "Do not invent facts", rules: ["Synthetic only"], skills: [{ slug: "listing.test", enabled: true, trigger: "test", instructions: "test", version: 2, manifestSha256: skillManifestHash(registry[2].manifest) }] };
  const savedConfiguration = { workspaceId: 3, agentKey: "listing" as const, revision: 1, hash: configurationHash(config), config };
  const approvals: AssistantConversationSourceApproval[] = registry.map((row, index) => ({ workspaceId: 3, agentKey: "listing", purpose: index === 0 ? "route" : index === 1 ? "reply" : "context", skillSlug: row.slug, skillSnapshotHash: digest(pin(row)), source: { origin: index === 2 ? "user_listing" : "reviewed_supplement", revision: "synthetic-approval-v1", approvalRef: "synthetic-only-not-a-production-approval" }, inputContract: index < 2 ? "private_context_v1" : "context_only", outputContract: index === 0 ? "route_slug_v1" : index === 1 ? "reply_v1" : "context_only", modelConfigurationHash: index < 2 ? strictModelSnapshotFromRow(3, model.slug, model).configurationHash : null, maxCostCents: index < 2 ? 10000 : null, imageBudget: index < 2 ? { policyId: "synthetic-image-policy", maxInputTokensPerImage: 2000 } : null }));
  const resolver = createFixedAssistantConversationApprovalResolver(approvals);
  const execute = vi.fn(async (statement: Parameters<AssistantConversationExecutor["execute"]>[0]) => {
    const query = dialect.sqlToQuery(statement);
    if (query.sql.includes("FROM emperor_model_providers")) return [clone(models)];
    if (query.sql.includes("FROM emperor_skills")) return [clone(registry.filter(row => row.slug === query.params[0]))];
    throw new Error("Unexpected SQL");
  });
  const executor = { execute };
  const requests: RunSkillInput<unknown>[] = [];
  let providerCalls = 0;
  let output: unknown = { slug: "listing.test" };
  let providerFailure = false;
  const runSkill = async <T>(request: RunSkillInput<T>): Promise<RunSkillResult<T>> => {
    requests.push(request as RunSkillInput<unknown>);
    await request.strictExecution!.beforeDispatch({ runId: "synthetic-run", stage: request.strictExecution!.stage, requestHash: "a".repeat(64), modelConfigurationHash: request.strictExecution!.modelSnapshot.configurationHash, bindingHash: request.strictExecution!.bindingHash, budget: { textBytes: 100, imageCount: 0, imageBytes: 0, contextAdmissionUnits: 1124, outputTokens: 4096, contextLimit: 2000000, tokenEstimateIsExact: false } });
    providerCalls++;
    if (providerFailure) throw new Error("SYNTHETIC_PROVIDER_UNKNOWN");
    const content = JSON.stringify(output);
    return { runId: "synthetic-run", skillSlug: request.skillSlug, skillName: "Synthetic", skillVersion: "2", skillPromptHash: request.expectedSkillPromptHash!, skillManifestHash: request.expectedSkillManifestHash!, content, parsed: request.validate!(content), modelSlug: model.slug, provider: "custom", durationMs: 1, costCents: 1, inputTokens: 10, outputTokens: 10, fallbackCount: 0, executionPreset: "standard", governance: null, auditWarnings: ["METRICS_UNAVAILABLE"] };
  };
  const runtime = createAssistantConversationRuntime({ approvalResolver: async input => approved ? resolver(input) : null, runSkill });
  const input: AssistantConversationRuntimePrepareInput = { executor, identity, savedConfiguration, request: { expectedWorkspaceId: 3, agentKey: "listing", threadId: identity.threadId, operationId, expectedThreadVersion: 1, expectedConfiguration: { revision: 1, hash: savedConfiguration.hash }, mode: "work", selection: { kind: "automatic" }, message: "Synthetic private message", files: [] }, history: [], hasOlderHistory: false, attachments: [] };
  const fence = async (_: unknown, verify: (executor: AssistantConversationExecutor, saved: typeof savedConfiguration) => Promise<void>) => { await verify(executor, savedConfiguration); };
  return { runtime, input, registry, models, approvals, execute, requests, fence, runSkill, calls: () => providerCalls, revoke: () => { approved = false; }, setOutput: (value: unknown) => { output = value; }, failProvider: () => { providerFailure = true; } };
}

describe("trusted assistant source and runtime preparation", () => {
  it("uses the same pure registry fingerprint for source comparison and live runtime", async () => {
    const h = harness(), snapshot = assistantConversationSkillSnapshotFromRow(h.registry[0]);
    expect(snapshot.pin).toEqual(pin(h.registry[0]));
    expect(assistantConversationSkillSnapshotHash(snapshot.pin)).toBe(h.approvals[0].skillSnapshotHash);
    const prepared = await h.runtime.prepare(h.input);
    expect(prepared.runtimeSnapshot.stages[0].pin).toEqual(snapshot.pin);
    expect(assistantConversationSkillScopeMatches(snapshot.pin, identity.workspaceId, snapshot.pin.slug)).toBe(true);
  });
  it("does not let pure capture turn NULL/shared into globally executable scope", async () => {
    const h = harness(); Object.assign(h.registry[0], { workspaceId: null, scope: "shared" });
    const snapshot = assistantConversationSkillSnapshotFromRow(h.registry[0]);
    expect(snapshot.pin).toMatchObject({ workspaceId: null, scope: "shared" });
    expect(assistantConversationSkillScopeMatches(snapshot.pin, identity.workspaceId, snapshot.pin.slug)).toBe(false);
    const approvals = h.approvals.map((approval, index) => index ? approval : { ...approval, skillSnapshotHash: assistantConversationSkillSnapshotHash(snapshot.pin) });
    const runtime = createAssistantConversationRuntime({ approvalResolver: createFixedAssistantConversationApprovalResolver(approvals), runSkill: h.runSkill });
    await expect(runtime.prepare(h.input)).rejects.toMatchObject({ code: "SKILL_UNAVAILABLE" }); expect(h.calls()).toBe(0);
  });
  it("does not treat Released registry rows as approval or touch a default provider", async () => {
    const h = harness(), runtime = createAssistantConversationRuntime();
    expect(await runtime.availability(h.input)).toMatchObject({ available: false, reasonCode: "SOURCE_UNAVAILABLE", model: null, skills: [] });
    await expect(runtime.prepare(h.input)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    expect(h.execute).not.toHaveBeenCalled(); expect(h.calls()).toBe(0);
  });
  it("provides a copied server mapping without converting a Listing source to friend authority", async () => {
    const h = harness(), resolver = createFixedAssistantConversationApprovalResolver(h.approvals);
    h.approvals[0].skillSlug = "changed";
    expect((await resolver({ executor: h.input.executor, identity, purpose: "route" }))?.skillSlug).toBe("test.route");
    expect(() => createFixedAssistantConversationApprovalResolver([{ ...h.approvals[2], source: { ...h.approvals[2].source, origin: "qingdao" } }])).toThrow();
    expect(() => createFixedAssistantConversationApprovalResolver([h.approvals[1], h.approvals[1]])).toThrow("APPROVAL_DUPLICATE");
  });
  it("exposes sanitized approved capabilities and pins actual raw and canonical manifest hashes separately", async () => {
    const h = harness(); expect(await h.runtime.availability(h.input)).toEqual({ available: true, reasonCode: null, model: { slug: model.slug, name: model.name, vision: true }, skills: [{ slug: "listing.test", name: "Synthetic listing.test", version: 2 }], executionKind: "conversation_only" });
    const value = await h.runtime.prepare(h.input);
    expect(value.runtimeSnapshot.stages[0].pin.manifestRawSha256).toBe(sha(JSON.stringify(h.registry[0].manifest)));
    expect(value.runtimeSnapshot.stages[0].pin.manifestSha256).toBe(skillManifestHash(h.registry[0].manifest));
    expect(value.runtimeSnapshot.stages[0].pin.manifestRawSha256).not.toBe(value.runtimeSnapshot.stages[0].pin.manifestSha256);
    expect(JSON.stringify(value.runtimeSnapshot)).not.toContain("Synthetic private message");
    expect(JSON.stringify(value.runtimeSnapshot)).not.toContain("systemPrompt\":");
    expect(AssistantConversationRuntimeSnapshotSchema.safeParse(value.runtimeSnapshot).success).toBe(true);
  });
  it.each(["version", "status", "name", "timeout_seconds", "modelOverride", "manifest"])("refuses changed approved Skill field %s", async field => {
    const h = harness(); Object.assign(h.registry[0], { [field]: field === "version" ? 3 : field === "timeout_seconds" ? 90 : field === "manifest" ? { implementation: { systemPrompt: "changed" } } : "changed" });
    await expect(h.runtime.prepare(h.input)).rejects.toThrow(); expect(h.calls()).toBe(0);
  });
  it("rejects missing/duplicate registry scopes and a changed selected model", async () => {
    const missing = harness(); missing.registry.shift(); await expect(missing.runtime.prepare(missing.input)).rejects.toThrow("SKILL_UNAVAILABLE");
    const duplicate = harness(); duplicate.registry.push(clone(duplicate.registry[0])); await expect(duplicate.runtime.prepare(duplicate.input)).rejects.toThrow("SKILL_UNAVAILABLE");
    const changed = harness(); changed.models[0].modelId = "changed"; await expect(changed.runtime.prepare(changed.input)).rejects.toThrow("APPROVED_MODEL_CHANGED");
  });
  it("refuses a missing controlled credential before advertising execution", async () => {
    const h = harness(); mocks.key.mockReturnValue("");
    expect(await h.runtime.availability(h.input)).toMatchObject({ available: false, reasonCode: "MODEL_UNAVAILABLE" });
    await expect(h.runtime.prepare(h.input)).rejects.toThrow("MODEL_UNAVAILABLE"); expect(h.calls()).toBe(0);
  });
  it("does not persist original bytes, base64, context or extracted text", async () => {
    const h = harness(), file = { name: "data.txt", base64: Buffer.from("PRIVATE_DOCUMENT").toString("base64") };
    h.input.request.files = [file]; h.input.attachments = [await parseAssistantConversationAttachment(file)];
    const value = await h.runtime.prepare(h.input), stored = JSON.stringify(value.runtimeSnapshot);
    expect(stored).not.toContain("PRIVATE_DOCUMENT"); expect(stored).not.toContain(file.base64);
    expect(value.runtimeSnapshot.attachments).toMatchObject([{ name: file.name, ordinal: 0, sizeBytes: 16 }]);
    expect(value.requestSnapshot.files).toEqual([{ name: file.name, sha256: h.input.attachments[0].sha256, sizeBytes: 16 }]);
  });
  it("pins historical document contents and exact six-turn references", async () => {
    const h = harness();
    h.input.history = Array.from({ length: 7 }, (_, i) => ({ ...identity, operationId: `c7d29fe8-2c53-4c34-bfe7-${String(i + 1).padStart(12, "0")}`, sequence: i + 1, status: "succeeded" as const, message: "prior message", reply: "prior reply", imageCount: 0, documents: [] }));
    const value = await h.runtime.prepare(h.input);
    expect(value.runtimeSnapshot.history.map(row => row.sequence)).toEqual([2, 3, 4, 5, 6, 7]); expect(value.runtimeSnapshot.hasOlderHistory).toBe(true);
    h.input.history[6].reply = "changed";
    await expect(h.runtime.prepareStage({ ...h.input, runtimeSnapshot: value.runtimeSnapshot, stage: "route" })).rejects.toThrow("INPUT_SNAPSHOT_CHANGED");
  });
  it("rejects changed current extraction and configuration before execution", async () => {
    const h = harness(), file = { name: "data.txt", base64: Buffer.from("private").toString("base64") }; h.input.request.files = [file]; h.input.attachments = [await parseAssistantConversationAttachment(file)];
    const value = await h.runtime.prepare(h.input); h.input.attachments[0].extractedText = "changed";
    await expect(h.runtime.prepareStage({ ...h.input, runtimeSnapshot: value.runtimeSnapshot, stage: "route" })).rejects.toThrow("INPUT_SNAPSHOT_CHANGED");
    const other = harness(), ready = await other.runtime.prepare(other.input); other.input.savedConfiguration.config.rules.push("changed");
    await expect(other.runtime.revalidate({ ...other.input, runtimeSnapshot: ready.runtimeSnapshot })).rejects.toThrow("CONFIGURATION_STALE");
  });
});

describe("application assistant singleton uses explicit server file approvals", () => {
  it("loads a reviewed file configured after module construction without dispatching a model", async () => {
    const h = harness(); await configuredApprovalFile(h.approvals);
    expect(await assistantConversationRuntime.availability(h.input)).toMatchObject({ available: true, reasonCode: null });
    const prepared = await assistantConversationRuntime.prepare(h.input); expect(prepared.runtimeSnapshot.stages).toHaveLength(2);
    expect(mocks.invokeLLM).not.toHaveBeenCalled(); expect(mocks.http).not.toHaveBeenCalled(); expect(h.calls()).toBe(0);
  });
  it("fails closed before registry access when complete file bytes no longer match the deployment SHA", async () => {
    const h = harness(), path = await configuredApprovalFile(h.approvals), runtime = createAssistantConversationRuntime({ runSkill: h.runSkill });
    const { runtimeSnapshot } = await runtime.prepare(h.input); h.execute.mockClear(); await writeFile(path, JSON.stringify({ version: 1, kind: "assistant_conversation", records: [] }));
    await expect(runtime.prepareStage({ ...h.input, runtimeSnapshot, stage: "route", routeResult: null })).rejects.toMatchObject({ code: "APPROVAL_HASH_MISMATCH" });
    expect(h.execute).not.toHaveBeenCalled(); expect(h.calls()).toBe(0);
  });
  it.each(["duplicate", "wrong_listing_source"])("does not relax the fixed approval schema for %s files", async kind => {
    const h = harness(), records = kind === "duplicate" ? [...h.approvals, h.approvals[0]] : h.approvals.map((record, index) => index === 2 ? { ...record, source: { ...record.source, origin: "qingdao" } } : record);
    await configuredApprovalFile(records);
    expect(await assistantConversationRuntime.availability(h.input)).toMatchObject({ available: false, reasonCode: "APPROVAL_RECORDS_INVALID" });
    expect(h.execute).not.toHaveBeenCalled(); expect(h.calls()).toBe(0);
  });
  it("rechecks an intentionally updated approval file and rejects a revoked stage", async () => {
    const h = harness(), path = await configuredApprovalFile(h.approvals), runtime = createAssistantConversationRuntime({ runSkill: h.runSkill });
    const { runtimeSnapshot } = await runtime.prepare(h.input), body = JSON.stringify({ version: 1, kind: "assistant_conversation", records: [] });
    await writeFile(path, body); vi.stubEnv("ASSISTANT_CONVERSATION_APPROVAL_SHA256", sha(body)); h.execute.mockClear();
    await expect(runtime.prepareStage({ ...h.input, runtimeSnapshot, stage: "route", routeResult: null })).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    expect(h.execute).not.toHaveBeenCalled(); expect(h.calls()).toBe(0);
  });
  it("preserves explicit resolver injection and never silently falls back from an invalid default file", async () => {
    const h = harness(); vi.stubEnv("ASSISTANT_CONVERSATION_APPROVAL_FILE", "invalid-relative.json");
    await expect(h.runtime.prepare(h.input)).resolves.toHaveProperty("runtimeSnapshot");
    expect(await assistantConversationRuntime.availability(h.input)).toMatchObject({ available: false, reasonCode: "APPROVAL_CONFIGURATION_INVALID" });
  });
});

describe("private single-stage bridge", () => {
  async function ready(h = harness()) { const { runtimeSnapshot } = await h.runtime.prepare(h.input); return { h, runtimeSnapshot, stage: await h.runtime.prepareStage({ ...h.input, runtimeSnapshot, stage: "route" }) }; }
  it("adapts friend slug output explicitly and calls strict runtime once", async () => {
    const { h, stage } = await ready();
    const result = await h.runtime.executeStage(stage, { beforeDispatch: h.fence });
    expect(result).toMatchObject({ stage: "route", result: { skillSlug: "listing.test" }, auditWarnings: ["METRICS_UNAVAILABLE"] });
    expect(h.calls()).toBe(1); expect(h.requests[0]).toMatchObject({ skillSlug: "test.route", skillVersionPolicy: "pinned", maxModelAttempts: 1, fallbackModels: [], expectedSkillVersion: "2", expectedSkillStatus: "Released", expectedSkillManifestHash: sha(JSON.stringify(h.registry[0].manifest)).slice(0, 16) });
    expect(h.requests[0].strictExecution).toMatchObject({ stage: "route", bindingHash: stage.bindingHash, expectedSkillTimeoutSeconds: 120, maxCostCents: 10000 });
    expect(h.requests[0].strictExecution!.bindingHash).not.toBe(stage.logicalRequestHash);
    await expect(h.runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toThrow("STAGE_ALREADY_CONSUMED"); expect(h.calls()).toBe(1);
  });
  it("cannot forge or copy a prepared execution capability", async () => {
    const { h, stage } = await ready(); await expect(h.runtime.executeStage({ ...stage }, { beforeDispatch: h.fence })).rejects.toThrow("STAGE_ALREADY_CONSUMED"); expect(h.calls()).toBe(0);
  });
  it("requires a completed fresh registry/approval check inside the dispatch fence", async () => {
    const { h, stage } = await ready(); await expect(h.runtime.executeStage(stage, { beforeDispatch: async () => {} })).rejects.toThrow("FRESH_AUTHORIZATION_REQUIRED"); expect(h.calls()).toBe(0);
  });
  it("refuses approval revocation between stage preparation and actual dispatch", async () => {
    const { h, stage } = await ready(); h.revoke(); await expect(h.runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toThrow("SOURCE_UNAVAILABLE"); expect(h.calls()).toBe(0);
  });
  it("refuses registry edits between stage preparation and actual dispatch", async () => {
    const { h, stage } = await ready(); h.registry[1].version = 3;
    await expect(h.runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toThrow("APPROVED_SOURCE_CHANGED"); expect(h.calls()).toBe(0);
  });
  it("awaits fence commit and refuses an abort or callback denial before provider dispatch", async () => {
    const { h, stage } = await ready(); let release!: () => void; const controller = new AbortController();
    const pending = h.runtime.executeStage(stage, { signal: controller.signal, beforeDispatch: async (receipt, verify) => { await h.fence(receipt, verify); await new Promise<void>(resolve => { release = resolve; }); } });
    await vi.waitFor(() => expect(release).toBeTypeOf("function")); expect(h.calls()).toBe(0); controller.abort(); release();
    await expect(pending).rejects.toThrow("CANCELED"); expect(h.calls()).toBe(0);
    const denied = await ready(); await expect(denied.h.runtime.executeStage(denied.stage, { beforeDispatch: async () => { throw new Error("DENIED"); } })).rejects.toThrow("DENIED"); expect(denied.h.calls()).toBe(0);
  });
  it("does not re-call on provider uncertainty or invalid selected slug", async () => {
    const { h, stage } = await ready(); h.failProvider(); await expect(h.runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toThrow("SYNTHETIC_PROVIDER_UNKNOWN");
    await expect(h.runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toThrow("STAGE_ALREADY_CONSUMED"); expect(h.calls()).toBe(1);
    const invalid = await ready(); invalid.h.setOutput({ slug: "unapproved" }); await expect(invalid.h.runtime.executeStage(invalid.stage, { beforeDispatch: invalid.h.fence })).rejects.toThrow("ROUTE_NOT_ENABLED"); expect(invalid.h.calls()).toBe(1);
  });
  it("pins a selected business Skill as context without dispatching it", async () => {
    const { h, runtimeSnapshot } = await ready(); h.setOutput({ reply: "Synthetic reply", proposedRules: null });
    const stage = await h.runtime.prepareStage({ ...h.input, runtimeSnapshot, stage: "reply", routeResult: { skillSlug: "listing.test" } });
    expect(await h.runtime.executeStage(stage, { beforeDispatch: h.fence })).toMatchObject({ result: { reply: "Synthetic reply", proposedRules: null } });
    expect(h.requests[0].skillSlug).toBe("test.reply"); expect(h.requests[0].context).toContain('"selectedSkillContext":{"manifestSha256"'); expect(h.calls()).toBe(1);
  });
  it("coach and explicit work have one reply stage; work cannot propose rules", async () => {
    const coach = harness(); coach.input.request.mode = "coach";
    const { runtimeSnapshot } = await coach.runtime.prepare(coach.input); expect(runtimeSnapshot.stages.map(row => row.stage)).toEqual(["reply"]);
    coach.setOutput({ reply: "Discussed rules", proposedRules: ["Candidate only"] });
    const stage = await coach.runtime.prepareStage({ ...coach.input, runtimeSnapshot, stage: "reply" });
    expect(await coach.runtime.executeStage(stage, { beforeDispatch: coach.fence })).toMatchObject({ result: { proposedRules: ["Candidate only"] } });
    const work = harness(); work.input.request.selection = { kind: "explicit", skillSlug: "listing.test" }; const value = await work.runtime.prepare(work.input); expect(value.runtimeSnapshot.stages.map(row => row.stage)).toEqual(["reply"]);
    work.setOutput({ reply: "not allowed", proposedRules: ["bad"] }); const next = await work.runtime.prepareStage({ ...work.input, runtimeSnapshot: value.runtimeSnapshot, stage: "reply" });
    await expect(work.runtime.executeStage(next, { beforeDispatch: work.fence })).rejects.toThrow("WORK_RULE_PROPOSAL_FORBIDDEN");
  });
  it("independently validates returned content even if a runner skips validation", async () => {
    const h = harness();
    const runSkill = vi.fn(async () => ({ content: JSON.stringify({ slug: "unapproved" }), parsed: { skillSlug: "listing.test" } })) as unknown as typeof import("./skillRunner").runEmperorSkill;
    const runtime = createAssistantConversationRuntime({ approvalResolver: createFixedAssistantConversationApprovalResolver(h.approvals), runSkill });
    const { runtimeSnapshot } = await runtime.prepare(h.input), stage = await runtime.prepareStage({ ...h.input, runtimeSnapshot, stage: "route" });
    await expect(runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toThrow("ROUTE_NOT_ENABLED");
    expect(runSkill).toHaveBeenCalledTimes(1);
  });
  it("rejects a parsed result inconsistent with otherwise valid output", async () => {
    const h = harness();
    const runSkill = vi.fn(async () => ({ content: JSON.stringify({ slug: "listing.test" }), parsed: { skillSlug: null } })) as unknown as typeof import("./skillRunner").runEmperorSkill;
    const runtime = createAssistantConversationRuntime({ approvalResolver: createFixedAssistantConversationApprovalResolver(h.approvals), runSkill });
    const { runtimeSnapshot } = await runtime.prepare(h.input), stage = await runtime.prepareStage({ ...h.input, runtimeSnapshot, stage: "route" });
    await expect(runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toThrow("RESULT_CONTRACT_MISMATCH");
  });
});

describe("explicit approved fixed-friend input adapters", () => {
  function friend() {
    const h = harness(); h.approvals[0].inputContract = "friend_route_v1"; h.approvals[1].inputContract = "friend_reply_v1";
    return { h, runtime: createAssistantConversationRuntime({ approvalResolver: createFixedAssistantConversationApprovalResolver(h.approvals), runSkill: h.runSkill }) };
  }
  it("matches fixed 383b69e route and coach input fields without executing a business Skill", async () => {
    const { h, runtime } = friend(), file = { name: "facts.txt", base64: Buffer.from("CURRENT_DOCUMENT").toString("base64") };
    const parsed = await parseAssistantConversationAttachment(file); h.input.request.files = [file]; h.input.attachments = [parsed];
    h.input.history = [{ ...identity, operationId: "c7d29fe8-2c53-4c34-bfe7-cbe34c102125", sequence: 1, status: "succeeded", message: "prior request", reply: "a".repeat(1200), imageCount: 1,
      documents: [{ name: "prior.txt", sha256: "b".repeat(64), sizeBytes: 20, mime: "text/plain", extractedText: "HISTORICAL_DOCUMENT", coverage: parsed.coverage, warnings: parsed.warnings }] }];
    const { runtimeSnapshot } = await runtime.prepare(h.input), route = await runtime.prepareStage({ ...h.input, runtimeSnapshot, stage: "route" });
    const routed = await runtime.executeStage(route, { beforeDispatch: h.fence });
    const routeInput = JSON.parse(h.requests[0].context!);
    expect(routeInput).toMatchObject({ inputContract: "friend_route_v1", message: "Synthetic private message", skills: [{ slug: "listing.test", name: "Synthetic listing.test", trigger: "test" }],
      documents: [{ name: "facts.txt", text: "CURRENT_DOCUMENT" }], recentConversation: [{ message: "prior request", reply: "a".repeat(1200), documents: [{ name: "prior.txt", text: "HISTORICAL_DOCUMENT" }], historyImageCount: 1 }] });
    h.setOutput({ reply: "Synthetic answer", proposedRules: null });
    const reply = await runtime.prepareStage({ ...h.input, runtimeSnapshot, stage: "reply", routeResult: routed.result });
    await runtime.executeStage(reply, { beforeDispatch: h.fence });
    const context = JSON.parse(h.requests[1].context!);
    expect(context).toMatchObject({ inputContract: "friend_reply_v1", mode: "work", assistant: { name: h.input.savedConfiguration.config.name, instructions: "Do not invent facts", rules: ["Synthetic only"] },
      selectedSkill: { slug: "listing.test", name: "Synthetic listing.test", version: 2, stage: "Listing文案", systemPrompt: h.registry[2].manifest.implementation.systemPrompt, userPrompt: "{{context}}", instructions: "test", trigger: "test" },
      availableSkills: [{ slug: "listing.test", trigger: "test" }], coverage: { includedHistoryDocuments: 1, omittedHistoryImages: 1 }, executionKind: "conversation_only", businessSkillDispatched: false });
    expect(context.documents[0]).toMatchObject({ coverage: parsed.coverage, warnings: parsed.warnings });
    expect(h.requests.map(row => row.skillSlug)).toEqual(["test.route", "test.reply"]); expect(h.calls()).toBe(2);
    expect(JSON.stringify(runtimeSnapshot)).not.toContain("CURRENT_DOCUMENT"); expect(JSON.stringify(runtimeSnapshot)).not.toContain("HISTORICAL_DOCUMENT");
  });
  it("keeps explicit and coach selection, rules and null selection semantics", async () => {
    const explicit = friend(); explicit.h.input.request.selection = { kind: "explicit", skillSlug: "listing.test" }; explicit.h.setOutput({ reply: "one", proposedRules: null });
    const saved = await explicit.runtime.prepare(explicit.h.input), stage = await explicit.runtime.prepareStage({ ...explicit.h.input, runtimeSnapshot: saved.runtimeSnapshot, stage: "reply" });
    await explicit.runtime.executeStage(stage, { beforeDispatch: explicit.h.fence }); expect(explicit.h.requests).toHaveLength(1); expect(JSON.parse(explicit.h.requests[0].context!).selectedSkill.slug).toBe("listing.test");
    const coach = friend(); coach.h.input.request.mode = "coach"; coach.h.setOutput({ reply: "candidate", proposedRules: ["Candidate only"] });
    const value = await coach.runtime.prepare(coach.h.input), next = await coach.runtime.prepareStage({ ...coach.h.input, runtimeSnapshot: value.runtimeSnapshot, stage: "reply" });
    expect(await coach.runtime.executeStage(next, { beforeDispatch: coach.h.fence })).toMatchObject({ result: { proposedRules: ["Candidate only"] } });
    expect(JSON.parse(coach.h.requests[0].context!)).toMatchObject({ mode: "coach", selectedSkill: null, assistant: { rules: ["Synthetic only"] } }); expect(coach.h.requests).toHaveLength(1);
  });
  it("requires an explicit compatible input contract and binds it into the frozen runtime", async () => {
    const invalid = friend(); invalid.h.approvals[0].inputContract = "friend_reply_v1";
    expect(() => createFixedAssistantConversationApprovalResolver(invalid.h.approvals)).toThrow();
    const h = harness(); let contract: AssistantConversationSourceApproval["inputContract"] = "private_context_v1";
    const resolver = createFixedAssistantConversationApprovalResolver(h.approvals), runtime = createAssistantConversationRuntime({ runSkill: h.runSkill, approvalResolver: async input => {
      const value = await resolver(input); return value && input.purpose === "route" ? { ...value, inputContract: contract } : value;
    } });
    const { runtimeSnapshot } = await runtime.prepare(h.input); contract = "friend_route_v1";
    await expect(runtime.prepareStage({ ...h.input, runtimeSnapshot, stage: "route" })).rejects.toThrow("RUNTIME_SOURCE_CHANGED"); expect(h.calls()).toBe(0);
  });
});

describe("actual strict runner bridge with in-memory DB and HTTP seams", () => {
  function actual() {
    const h = harness();
    mocks.getDb.mockResolvedValue({ execute: mocks.execute });
    mocks.execute.mockImplementation(async statement => {
      const query = dialect.sqlToQuery(statement);
      if (query.sql.startsWith("SELECT * FROM emperor_skills")) return [clone(h.registry.filter(row => row.slug === query.params[0]))];
      if (query.sql.includes("FROM emperor_model_providers")) return [clone(h.models)];
      return [[]];
    });
    mocks.metric.mockResolvedValue({ recorded: true });
    mocks.http.mockResolvedValue({ ok: true, status: 200, json: () => ({ choices: [{ message: { content: JSON.stringify({ slug: "listing.test" }) } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }) });
    const runtime = createAssistantConversationRuntime({ approvalResolver: createFixedAssistantConversationApprovalResolver(h.approvals) });
    return { h, runtime };
  }
  it("executes the pinned strict runner once without public body, fallback or generic evaluation", async () => {
    const { h, runtime } = actual();
    const { runtimeSnapshot } = await runtime.prepare(h.input), stage = await runtime.prepareStage({ ...h.input, runtimeSnapshot, stage: "route" });
    expect(await runtime.executeStage(stage, { beforeDispatch: h.fence })).toMatchObject({ stage: "route", result: { skillSlug: "listing.test" } });
    expect(mocks.http).toHaveBeenCalledTimes(1); expect(mocks.http.mock.calls[0][1]).toMatchObject({ maxRedirects: 0 });
    expect(mocks.invokeLLM).not.toHaveBeenCalled(); expect(mocks.rollout).not.toHaveBeenCalled(); expect(mocks.evaluation).not.toHaveBeenCalled();
    const audits = JSON.stringify(mocks.execute.mock.calls.map(([statement]) => dialect.sqlToQuery(statement)).filter(query => !query.sql.startsWith("SELECT")));
    expect(audits).not.toContain("Synthetic private message"); expect(audits).not.toContain("SYNTHETIC_SECRET_NEVER_REAL"); expect(audits).not.toContain("follow provided data");
    await expect(runtime.executeStage(stage, { beforeDispatch: h.fence })).rejects.toThrow("STAGE_ALREADY_CONSUMED"); expect(mocks.http).toHaveBeenCalledTimes(1);
  });
  it("rechecks before actual HTTP and will not retry a denied fence or unknown HTTP outcome", async () => {
    const denied = actual(), value = await denied.runtime.prepare(denied.h.input);
    const stage = await denied.runtime.prepareStage({ ...denied.h.input, runtimeSnapshot: value.runtimeSnapshot, stage: "route" });
    denied.h.registry[0].version++;
    await expect(denied.runtime.executeStage(stage, { beforeDispatch: denied.h.fence })).rejects.toThrow(); expect(mocks.http).not.toHaveBeenCalled();
    const uncertain = actual(), prepared = await uncertain.runtime.prepare(uncertain.h.input);
    const next = await uncertain.runtime.prepareStage({ ...uncertain.h.input, runtimeSnapshot: prepared.runtimeSnapshot, stage: "route" });
    mocks.http.mockRejectedValueOnce(new Error("private upstream details"));
    await expect(uncertain.runtime.executeStage(next, { beforeDispatch: uncertain.h.fence })).rejects.toThrow();
    await expect(uncertain.runtime.executeStage(next, { beforeDispatch: uncertain.h.fence })).rejects.toThrow("STAGE_ALREADY_CONSUMED"); expect(mocks.http).toHaveBeenCalledTimes(1);
  });
});
