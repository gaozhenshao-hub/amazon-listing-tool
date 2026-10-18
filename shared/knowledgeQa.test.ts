import { describe, expect, it } from "vitest";
import { KnowledgeQaStartInputSchema, KnowledgeQaPreviewInputSchema, KnowledgeQaOperationInputSchema, KnowledgeQaRenameInputSchema, KnowledgeQaDeleteInputSchema, KnowledgeQaFeedbackInputSchema,
  KnowledgeQaHistorySchema, knowledgeQaCanonical, knowledgeQaValidateSelection, knowledgeQaValidateAnswer, type KnowledgeQaItem } from "./knowledgeQa";
const scope = { expectedWorkspaceId: 7, threadId: "22222222-2222-4222-8222-222222222222", operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const start = { ...scope, question: "SYNTHETIC", expectedSourceHash: "a".repeat(64), expectedRuntimeHash: "b".repeat(64), maxCostCents: 300, chargeConfirmed: true };
describe("knowledge QA strict public contracts", () => {
  it.each(["ownerId", "model", "messages", "corpus", "configuration", "force", "workspaceId"])("rejects client authority/body override %s", key => expect(KnowledgeQaStartInputSchema.safeParse({ ...start, [key]: "SYNTHETIC" }).success).toBe(false));
  it("requires an explicit bounded charge confirmation and lowercase UUID", () => {
    expect(KnowledgeQaStartInputSchema.parse(start)).toEqual(start);
    expect(KnowledgeQaStartInputSchema.safeParse({ ...start, chargeConfirmed: false }).success).toBe(false);
    expect(KnowledgeQaStartInputSchema.safeParse({ ...start, maxCostCents: -1 }).success).toBe(false);
    expect(KnowledgeQaStartInputSchema.safeParse({ ...start, operationId: scope.operationId.toUpperCase() }).success).toBe(false);
    expect(KnowledgeQaPreviewInputSchema.parse({ ...scope, question: "  Q  " }).question).toBe("Q");
  });
  it("recovering an original request accepts no changed question or fees", () => {
    expect(KnowledgeQaOperationInputSchema.parse(scope)).toEqual(scope);
    expect(KnowledgeQaOperationInputSchema.safeParse({ ...scope, question: "retry" }).success).toBe(false);
  });
  it("thread changes require a CAS version and feedback requires an exact source key", () => {
    const input = { expectedWorkspaceId: 7, threadId: scope.threadId };
    expect(KnowledgeQaRenameInputSchema.safeParse({ ...input, title: "SYNTHETIC" }).success).toBe(false);
    expect(KnowledgeQaDeleteInputSchema.safeParse({ ...input, expectedVersion: 0 }).success).toBe(false);
    expect(KnowledgeQaFeedbackInputSchema.parse({ ...scope, itemKey: "product:1", rating: "helpful", comment: "" }).comment).toBe("");
    expect(KnowledgeQaFeedbackInputSchema.safeParse({ ...scope, itemKey: "https://private", rating: "helpful", comment: "" }).success).toBe(false);
  });
  it.each([{ selectedIndices: [1, 1] }, { selectedIndices: [0] }, { selectedIndices: [11] }, { selectedIndices: [1], model: "x" }, { selectedIndices: "1" }])("never falls back on invalid model selection %j", value => expect(() => knowledgeQaValidateSelection(value, 10, 5)).toThrow());
  it("allows explicit empty selection and retains index order", () => { expect(knowledgeQaValidateSelection({ selectedIndices: [] }, 0, 10)).toEqual([]); expect(knowledgeQaValidateSelection({ selectedIndices: [3, 1] }, 5, 5)).toEqual([3, 1]); });
  it("preserves real Markdown and requires only actual selected citations", () => {
    const items = [{ id: 1 }] as KnowledgeQaItem[];
    expect(knowledgeQaValidateAnswer("# 回答\n\n**依据**[引用1]", items)).toBe("# 回答\n\n**依据**[引用1]");
    for (const content of ["no citation", "[引用2]", "[引用0]", "[引用1.0]", "中".repeat(22000)]) expect(() => knowledgeQaValidateAnswer(content, items)).toThrow();
    expect(() => knowledgeQaValidateAnswer("[引用1]", [])).toThrow();
  });
  it("stable canonical hashes cannot silently drop unsupported JSON fields", () => { expect(knowledgeQaCanonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}'); expect(() => knowledgeQaCanonical({ a: undefined })).toThrow(); expect(() => knowledgeQaCanonical(NaN)).toThrow(); });
  it("history enforces exact owner/thread even when its nested run parses", () => {
    const view = { identity: { userId: 3, workspaceId: 7 }, scope, state: "not_found", stage: null, sourceHash: null, runtimeHash: null, resultHash: null, question: null, answer: null, configuration: null, reasonCode: "OPERATION_NOT_OBSERVED", createdAt: null, sourceChanged: false };
    const value = { identity: view.identity, request: { expectedWorkspaceId: 7, threadId: scope.threadId, limit: 20 }, thread: { threadId: scope.threadId, title: "SYNTHETIC", version: 1, createdAt: "time", updatedAt: "time" }, items: [view], nextBeforeId: null };
    expect(KnowledgeQaHistorySchema.safeParse(value).success).toBe(true);
    expect(KnowledgeQaHistorySchema.safeParse({ ...value, items: [{ ...view, identity: { userId: 4, workspaceId: 7 } }] }).success).toBe(false);
  });
});
