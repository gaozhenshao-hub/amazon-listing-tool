import { describe, expect, it } from "vitest";
import type { SkillWorkbenchDraft } from "../shared/skillWorkbench";
import {
  assertWorkbenchRevision,
  assertWorkbenchPublishable,
  candidateManifest,
  workbenchHash,
} from "./domains/ai_os/services/skillWorkbenchRules";

function draft(): SkillWorkbenchDraft {
  const content = {
    systemPrompt: "引用原文并说明样本分母",
    userPromptTemplate: "{{context}}",
  };
  return {
    id: "one",
    revision: 3,
    baseHash: "current",
    baseVersion: 2,
    skillSlug: "review",
    name: "评论分析",
    content,
    input: { context: "评论样本", productId: null },
    status: "draft",
    feedback: [],
    tests: [
      {
        id: "test",
        name: "样本",
        input: { context: "评论样本", productId: null },
        output: "结果",
        runId: "run",
        promptHash: workbenchHash(content),
        inputHash: "source",
        approved: true,
        durationMs: 1,
        costCents: 1,
        createdAt: "2026-10-24",
        baseline: false,
      },
    ],
  };
}
describe("skill workbench publication rules", () => {
  it("does not publish a new method using an older approved result", () => {
    const value = draft();
    expect(() => assertWorkbenchPublishable(value, "current")).not.toThrow();
    value.content.systemPrompt += "新的分类规则";
    expect(() => assertWorkbenchPublishable(value, "current")).toThrow(
      "测试当前草稿"
    );
  });
  it("requires an approved candidate result, not a baseline result or an AI self-rating", () => {
    const value = draft();
    value.tests[0].approved = false;
    expect(() => assertWorkbenchPublishable(value, "current")).toThrow();
    value.tests[0].approved = true;
    value.tests[0].baseline = true;
    expect(() => assertWorkbenchPublishable(value, "current")).toThrow();
  });
  it("refuses stale, already-running and already-published writes", () => {
    const value = draft();
    expect(() => assertWorkbenchRevision(value, 2)).toThrow("其他窗口");
    value.status = "running";
    expect(() => assertWorkbenchRevision(value, 3)).toThrow("尚未完成");
    value.status = "published";
    expect(() => assertWorkbenchRevision(value, 3)).toThrow("已经发布");
    expect(() => assertWorkbenchPublishable(value, "new")).toThrow(
      "正式技能已更新"
    );
  });
  it("keeps tools, contracts and model routing intact when editing instructions", () => {
    const manifest = {
      implementation: {
        systemPrompt: "旧",
        modelPolicy: "registered",
        maxTokens: 3000,
      },
      contract: { outputMode: "json" },
      tools: ["approved"],
    };
    const changed = candidateManifest(manifest, draft().content);
    expect(changed).toMatchObject({
      implementation: {
        modelPolicy: "registered",
        maxTokens: 3000,
        systemPrompt: draft().content.systemPrompt,
      },
      contract: manifest.contract,
      tools: manifest.tools,
    });
    expect(manifest.implementation.systemPrompt).toBe("旧");
  });
});
