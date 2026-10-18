import { describe, expect, it } from "vitest";
import {
  ASSISTANT_CONVERSATION_STATES, AssistantConversationCreateThreadInputSchema,
  AssistantConversationSubmitInputSchema, assistantConversationLeaseRecovery,
  canTransitionAssistantConversation, planAssistantConversation,
  validateAssistantConversationReply, validateAssistantConversationRoute,
} from "./assistantConversation";

const uuid = "a7d29fe8-2c53-4c34-bfe7-cbe34c102125";
const request = {
  expectedWorkspaceId: 3, agentKey: "listing", threadId: uuid, operationId: uuid,
  expectedThreadVersion: 1, expectedConfiguration: { revision: 7, hash: "a".repeat(64) },
  mode: "work", selection: { kind: "automatic" }, message: "帮我比较", files: [],
};

describe("private assistant conversation request protocol", () => {
  it("accepts the supported request but never trusts caller identity/runtime/configuration bodies", () => {
    expect(AssistantConversationSubmitInputSchema.parse(request)).toEqual(request);
    for (const extra of [{ userId: 7 }, { workspaceId: 4 }, { runtime: {} }, { configuration: {} }, { modelOverride: "other" }]) {
      expect(AssistantConversationSubmitInputSchema.safeParse({ ...request, ...extra }).success).toBe(false);
    }
  });
  it("canonicalizes UUIDs without accepting arbitrary thread labels as IDs", () => {
    expect(AssistantConversationSubmitInputSchema.parse({ ...request, operationId: uuid.toUpperCase() }).operationId).toBe(uuid);
    expect(AssistantConversationSubmitInputSchema.safeParse({ ...request, threadId: "我的聊天" }).success).toBe(false);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER])("rejects invalid revision %s", expectedThreadVersion => {
    expect(AssistantConversationSubmitInputSchema.safeParse({ ...request, expectedThreadVersion }).success).toBe(false);
  });
  it("retains the source message, title and file limits", () => {
    const file = { name: "input.txt", base64: "aGV5" };
    expect(AssistantConversationSubmitInputSchema.safeParse({ ...request, message: "x".repeat(8000), files: [file, file, file] }).success).toBe(true);
    expect(AssistantConversationSubmitInputSchema.safeParse({ ...request, message: "x".repeat(8001) }).success).toBe(false);
    expect(AssistantConversationSubmitInputSchema.safeParse({ ...request, files: [file, file, file, file] }).success).toBe(false);
    expect(AssistantConversationCreateThreadInputSchema.safeParse({ expectedWorkspaceId: 3, agentKey: "listing", threadId: uuid, title: "x".repeat(80) }).success).toBe(true);
    expect(AssistantConversationCreateThreadInputSchema.safeParse({ expectedWorkspaceId: 3, agentKey: "listing", threadId: uuid, title: "x".repeat(81) }).success).toBe(false);
  });
});

describe("source-faithful conversation execution planning", () => {
  it("retains the two paid stages for automatic work selection", () => {
    const plan = planAssistantConversation("work", { kind: "automatic" }, ["listing.first", "listing.second"]);
    expect(plan).toMatchObject({ stages: ["route", "reply"], maxProviderCalls: 2, selectedSkillSlug: null, businessSkillDispatched: false });
    expect(plan.automaticCandidates).toEqual(["listing.first", "listing.second"]);
    expect(Object.isFrozen(plan.automaticCandidates)).toBe(true);
  });
  it.each(["work", "coach"] as const)("explicit %s uses only the reply stage", mode => {
    expect(planAssistantConversation(mode, { kind: "explicit", skillSlug: "listing.first" }, ["listing.first"]))
      .toMatchObject({ stages: ["reply"], maxProviderCalls: 1, selectedSkillSlug: "listing.first", automaticCandidates: [] });
  });
  it("does not fabricate route calls for coach or empty enabled bindings", () => {
    expect(planAssistantConversation("coach", { kind: "automatic" }, ["listing.first"]).stages).toEqual(["reply"]);
    expect(planAssistantConversation("work", { kind: "automatic" }, []).stages).toEqual(["reply"]);
  });
  it("rejects disabled/foreign/duplicate Skill selection and invalid route output", () => {
    expect(() => planAssistantConversation("work", { kind: "explicit", skillSlug: "not-enabled" }, ["enabled"]))
      .toThrow("ASSISTANT_CONVERSATION_SKILL_NOT_ENABLED");
    expect(() => planAssistantConversation("work", { kind: "automatic" }, ["duplicate", "duplicate"])).toThrow("DUPLICATE_SKILL");
    expect(validateAssistantConversationRoute({ skillSlug: null }, ["enabled"])).toBeNull();
    expect(validateAssistantConversationRoute({ skillSlug: "enabled" }, ["enabled"])).toBe("enabled");
    expect(() => validateAssistantConversationRoute({ skillSlug: "foreign" }, ["enabled"])).toThrow("ROUTE_NOT_ENABLED");
    expect(() => validateAssistantConversationRoute({ skillSlug: "enabled", execute: true }, ["enabled"])).toThrow();
  });
  it("rules remain a coach-only explicit candidate, including an intentional empty rule list", () => {
    expect(validateAssistantConversationReply("coach", { reply: "建议清空，请确认", proposedRules: [] }).proposedRules).toEqual([]);
    expect(validateAssistantConversationReply("work", { reply: "分析完成", proposedRules: null }).proposedRules).toBeNull();
    expect(() => validateAssistantConversationReply("work", { reply: "覆盖", proposedRules: [] })).toThrow("WORK_RULE_PROPOSAL_FORBIDDEN");
    expect(() => validateAssistantConversationReply("coach", { reply: "覆盖", proposedRules: ["x".repeat(501)] })).toThrow();
  });
});

describe("durable stage transition fencing", () => {
  it("allows either approved plan, but no jump past a missing dispatch/result", () => {
    for (const [from, to] of [["queued", "route_dispatched"], ["route_dispatched", "route_ready"], ["route_ready", "reply_dispatched"], ["queued", "reply_dispatched"], ["reply_dispatched", "reply_ready"], ["reply_ready", "succeeded"]] as const) {
      expect(canTransitionAssistantConversation(from, to)).toBe(true);
    }
    expect(canTransitionAssistantConversation("queued", "succeeded")).toBe(false);
    expect(canTransitionAssistantConversation("queued", "route_ready")).toBe(false);
    expect(canTransitionAssistantConversation("route_ready", "reply_ready")).toBe(false);
    expect(canTransitionAssistantConversation("reply_ready", "reply_dispatched")).toBe(false);
  });
  it("never reclaims a dispatched/unknown stage for another model attempt", () => {
    for (const state of ["route_dispatched", "reply_dispatched"] as const) expect(assistantConversationLeaseRecovery(state)).toBe("mark_unknown");
    for (const state of ["queued", "route_ready", "reply_ready"] as const) expect(assistantConversationLeaseRecovery(state)).toBe("claim");
    for (const state of ["unknown", "succeeded", "failed", "canceled"] as const) expect(assistantConversationLeaseRecovery(state)).toBe("none");
  });
  it.each(["succeeded", "failed", "canceled"] as const)("%s is terminal", state => {
    for (const target of ASSISTANT_CONVERSATION_STATES) expect(canTransitionAssistantConversation(state, target)).toBe(false);
  });
  it("unknown permits only explicit cancellation, never fresh execution or presumed success", () => {
    for (const target of ASSISTANT_CONVERSATION_STATES) expect(canTransitionAssistantConversation("unknown", target)).toBe(target === "canceled");
  });
});
