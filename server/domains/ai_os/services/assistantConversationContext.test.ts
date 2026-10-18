import { describe, expect, it } from "vitest";
import { buildAssistantConversationContext, type AssistantConversationHistoryContext } from "./assistantConversationContext";
import { parseAssistantConversationAttachment } from "./assistantConversationAttachments";
import { configurationHash, skillManifestHash } from "./assistantConfigurations";

const identity = { workspaceId: 3, userId: 5, agentKey: "listing" as const, threadId: "a7d29fe8-2c53-4c34-bfe7-cbe34c102125" };
const operationId = "b7d29fe8-2c53-4c34-bfe7-cbe34c102125";
const manifest = { implementation: { systemPrompt: "合成测试固定内容", userPromptTemplate: "{{context}}" } };
const config = {
  name: "合成助手", description: "仅测试", enabled: true, modelSlug: "synthetic-model", instructions: "按事实回答", rules: ["不编造"],
  skills: [{ slug: "listing.sample", enabled: true, trigger: "listing", instructions: "测试约束", version: 3, manifestSha256: skillManifestHash(manifest) }],
};
const savedConfiguration = { workspaceId: 3, agentKey: "listing" as const, revision: 2, hash: configurationHash(config), config };
const selectedSkill = { workspaceId: 3, scope: "workspace", slug: "listing.sample", name: "合成业务内容", version: 3, status: "Released", manifest };
function input() {
  return {
    identity, request: {
      expectedWorkspaceId: 3, agentKey: "listing" as const, threadId: identity.threadId, operationId,
      expectedThreadVersion: 1, expectedConfiguration: { revision: 2, hash: savedConfiguration.hash },
      mode: "work" as const, selection: { kind: "automatic" as const }, message: "比较这些数据", files: [] as { name: string; base64: string }[],
    },
    savedConfiguration, stage: "route" as "route" | "reply", history: [] as AssistantConversationHistoryContext[], hasOlderHistory: false,
    attachments: [] as Awaited<ReturnType<typeof parseAssistantConversationAttachment>>[],
  };
}
function history(sequence: number): AssistantConversationHistoryContext {
  return { ...identity, operationId: `c7d29fe8-2c53-4c34-bfe7-${sequence.toString().padStart(12, "0")}`, sequence, status: "succeeded", message: `私有问题 ${sequence}`, reply: `私有回复 ${sequence}`, imageCount: 0, documents: [] };
}

describe("immutable private conversation context", () => {
  it("binds exact configuration, rules, scope and source-faithful route plan without claiming business dispatch", () => {
    const result = buildAssistantConversationContext(input()), envelope = JSON.parse(result.context);
    expect(envelope.identity).toEqual(identity);
    expect(envelope.configuration).toMatchObject({ revision: 2, hash: savedConfiguration.hash, rules: ["不编造"], instructions: "按事实回答" });
    expect(envelope).toMatchObject({ stage: "route", mode: "work", executionKind: "conversation_only", businessSkillDispatched: false });
    expect(result.plan.maxProviderCalls).toBe(2);
    expect(result.contextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("separates logical request identity from a stage's moving history/output context", () => {
    const a = input(), b = input(); b.history = [history(1)];
    const first = buildAssistantConversationContext(a), second = buildAssistantConversationContext(b);
    expect(first.requestHash).toBe(second.requestHash);
    expect(first.contextHash).not.toBe(second.contextHash);
    b.request.message = "新的请求";
    expect(buildAssistantConversationContext(b).requestHash).not.toBe(first.requestHash);
  });
  it("hashes a stable canonical snapshot, not mutable references", () => {
    const value = input(), result = buildAssistantConversationContext(value);
    value.request.message = "后续修改";
    expect(JSON.parse(result.context).untrustedInput.message).toBe("比较这些数据");
    expect(buildAssistantConversationContext(value).contextHash).not.toBe(result.contextHash);
  });
  it.each(["workspace", "agent", "thread"])("rejects cross-%s request scope", field => {
    const value = input();
    if (field === "workspace") value.request.expectedWorkspaceId = 4;
    if (field === "agent") Object.assign(value.request, { agentKey: "finance" });
    if (field === "thread") value.request.threadId = operationId;
    expect(() => buildAssistantConversationContext(value)).toThrow("IDENTITY_MISMATCH");
  });
  it("rejects a stale configuration revision/hash or normalized persisted content", () => {
    const revision = input(); revision.request.expectedConfiguration.revision = 1;
    expect(() => buildAssistantConversationContext(revision)).toThrow("CONFIGURATION_STALE");
    const altered = input(); altered.savedConfiguration = { ...savedConfiguration, config: { ...config, instructions: "变更" } };
    expect(() => buildAssistantConversationContext(altered)).toThrow("CONFIGURATION_STALE");
    const whitespace = input(); whitespace.savedConfiguration = { ...savedConfiguration, config: { ...config, name: " 合成助手" } };
    expect(() => buildAssistantConversationContext(whitespace)).toThrow("CONFIGURATION_STALE");
  });
  it.each([{ enabled: false }, { modelSlug: "" }])("rejects non-executable configuration %j", change => {
    const value = input(), next = { ...config, ...change };
    value.savedConfiguration = { ...savedConfiguration, config: next, hash: configurationHash(next) };
    value.request.expectedConfiguration.hash = value.savedConfiguration.hash;
    expect(() => buildAssistantConversationContext(value)).toThrow("CONFIGURATION_NOT_EXECUTABLE");
  });
  it("requires durable route output for the automatic reply context", () => {
    const value = input(); value.stage = "reply";
    expect(() => buildAssistantConversationContext(value)).toThrow();
    expect(buildAssistantConversationContext({ ...value, routeResult: { skillSlug: null } }).selectedSkillSlug).toBeNull();
    const result = buildAssistantConversationContext({ ...value, routeResult: { skillSlug: "listing.sample" }, selectedSkill });
    expect(result.selectedSkillSlug).toBe("listing.sample");
    expect(JSON.parse(result.context).selectedSkillContext).toMatchObject({ version: 3, manifestSha256: skillManifestHash(manifest), systemPrompt: manifest.implementation.systemPrompt });
  });
  it("requires exact Released version/full manifest and authorized scope for contextual business Skill", () => {
    const value = { ...input(), stage: "reply" as const, routeResult: { skillSlug: "listing.sample" } };
    for (const change of [{ version: 4 }, { status: "Draft" }, { workspaceId: 99 }, { manifest: { implementation: { systemPrompt: "changed" } } }, { workspaceId: null, scope: "workspace" }]) {
      expect(() => buildAssistantConversationContext({ ...value, selectedSkill: { ...selectedSkill, ...change } })).toThrow("SKILL_SNAPSHOT_MISMATCH");
    }
    expect(buildAssistantConversationContext({ ...value, selectedSkill: { ...selectedSkill, workspaceId: null, scope: "global" } }).selectedSkillSlug).toBe("listing.sample");
  });
  it("rejects unexpected/unselected Skill context and unplanned routing", () => {
    expect(() => buildAssistantConversationContext({ ...input(), selectedSkill })).toThrow("UNEXPECTED_SKILL_SNAPSHOT");
    const coach = input(); Object.assign(coach.request, { mode: "coach" });
    expect(() => buildAssistantConversationContext(coach)).toThrow("STAGE_NOT_PLANNED");
  });
});

describe("truthful context coverage and private isolation", () => {
  it("includes latest six completed turns in order and reports older history and omitted images", () => {
    const value = input(); value.history = [7, 2, 4, 1, 3, 6, 5].map(history); value.history[0].imageCount = 2;
    const result = buildAssistantConversationContext(value), envelope = JSON.parse(result.context);
    expect(envelope.untrustedInput.history.map((row: { sequence: number }) => row.sequence)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(result.coverage).toMatchObject({ includedTurns: 6, hasOlderTurns: true, historyImages: "reattach_required", omittedHistoryImages: 2, historyDocuments: "stored_extracted_text" });
  });
  it("preserves pagination coverage and does not pretend a small loaded page is full history", () => {
    const value = input(); value.history = [history(8)]; value.hasOlderHistory = true;
    expect(buildAssistantConversationContext(value).coverage.hasOlderTurns).toBe(true);
  });
  it.each([{ userId: 6 }, { workspaceId: 4 }, { agentKey: "finance" }, { threadId: operationId }])("rejects foreign history even if it would be omitted %j", change => {
    const value = input(); value.history = [1, 2, 3, 4, 5, 6, 7].map(history); Object.assign(value.history[0], change);
    expect(() => buildAssistantConversationContext(value)).toThrow("HISTORY_SCOPE_MISMATCH");
  });
  it("rejects unfinished, duplicate or self-referential history", () => {
    const value = input(); value.history = [history(1), history(1)];
    expect(() => buildAssistantConversationContext(value)).toThrow("HISTORY_DUPLICATE");
    value.history = [{ ...history(1), operationId }];
    expect(() => buildAssistantConversationContext(value)).toThrow("HISTORY_SCOPE_MISMATCH");
    Object.assign(value.history[0], { status: "reply_dispatched" });
    expect(() => buildAssistantConversationContext(value)).toThrow();
  });
  it("binds the original attachment, extracted scope and visible truncation warnings", async () => {
    const value = input(), file = { name: "sample.txt", base64: Buffer.from("x".repeat(40_001)).toString("base64") };
    value.request.files = [file]; value.attachments = [await parseAssistantConversationAttachment(file)];
    const result = buildAssistantConversationContext(value), envelope = JSON.parse(result.context), saved = envelope.untrustedInput.attachments[0];
    expect(saved.extractedText.length).toBe(40_000);
    expect(saved.coverage.status).toBe("partial");
    expect(saved.warnings.length).toBeGreaterThan(0);
    expect(result.images).toEqual([]);
    expect(result.context).not.toContain(file.base64);
    value.attachments[0].originalBytes[0] = 99;
    expect(() => buildAssistantConversationContext(value)).toThrow("ATTACHMENTS_MISMATCH");
  });
  it("does not allow a missing or different attachment to enter a request snapshot", async () => {
    const value = input(), file = { name: "a.txt", base64: Buffer.from("原件").toString("base64") };
    value.request.files = [file];
    expect(() => buildAssistantConversationContext(value)).toThrow("ATTACHMENTS_MISMATCH");
    value.attachments = [await parseAssistantConversationAttachment({ ...file, name: "other.txt" })];
    expect(() => buildAssistantConversationContext(value)).toThrow("ATTACHMENTS_MISMATCH");
  });
  it("accepts the parser's 40000-code-point Unicode document boundary", async () => {
    const value = input(), file = { name: "unicode.txt", base64: Buffer.from("😀".repeat(40_000)).toString("base64") };
    value.request.files = [file]; value.attachments = [await parseAssistantConversationAttachment(file)];
    expect(() => buildAssistantConversationContext(value)).not.toThrow();
    expect(JSON.parse(buildAssistantConversationContext(value).context).untrustedInput.attachments[0].extractedText).toBe("😀".repeat(40_000));
  });
  it("preserves prior document extraction for follow-up questions, but never prior image bytes", async () => {
    const value = input(), file = await parseAssistantConversationAttachment({ name: "old.txt", base64: Buffer.from("历史文档独有细节").toString("base64") });
    const turn = history(1); turn.imageCount = 1;
    turn.documents = [{ name: file.name, sha256: file.sha256, sizeBytes: file.sizeBytes, mime: file.mime, extractedText: file.extractedText!, coverage: file.coverage, warnings: file.warnings }];
    value.history = [turn];
    const result = buildAssistantConversationContext(value), envelope = JSON.parse(result.context);
    expect(envelope.untrustedInput.history[0].documents[0]).toMatchObject({ sha256: file.sha256, extractedText: "历史文档独有细节", coverage: { status: "complete" } });
    expect(result.coverage).toMatchObject({ includedHistoryDocuments: 1, omittedHistoryImages: 1 });
    expect(result.images).toEqual([]);
  });
});
