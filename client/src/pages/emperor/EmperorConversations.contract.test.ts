import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const conversationsSource = readFileSync(fileURLToPath(new URL("./EmperorConversations.tsx", import.meta.url)), "utf8");
const traceSource = readFileSync(fileURLToPath(new URL("./EmperorTrace.tsx", import.meta.url)), "utf8");

describe("皇帝对话任务前端治理契约", () => {
  it("保留受控附件上传入口和模型暂不可用时的手动重试，不会生成旧候选步骤", () => {
    expect(conversationsSource).toContain('type="file"');
    expect(conversationsSource).toContain('accept="image/*,.txt,.md,.csv,.json,.pdf,.doc,.docx,.xlsx"');
    expect(conversationsSource).toContain("模型服务暂时不可用。你的消息、附件和知识引用已保留；未生成、提交或运行任何计划步骤。");
    expect(conversationsSource).toContain("重试规划");
    expect(conversationsSource).toContain("setDraftSteps([])");
  });

  it("保留计划批准、单步确认与仅ready步骤可运行的服务端调用入口", () => {
    expect(conversationsSource).toContain("approvePlan.mutate");
    expect(conversationsSource).toContain("approveStep.mutate");
    expect(conversationsSource).toContain('step.approvalState === "pending"');
    expect(conversationsSource).toContain('step.status === "ready"');
    expect(conversationsSource).toContain("runStep.mutate");
  });

  it("为已完成Skill步骤提供只读Trace入口，并按URL runId自动选中运行详情", () => {
    expect(conversationsSource).toContain("step.skillRunId &&");
    expect(conversationsSource).toContain("/emperor/trace?runId=${encodeURIComponent(step.skillRunId)}");
    expect(traceSource).toContain('URLSearchParams(window.location.search).get("runId")');
    expect(traceSource).toContain("setSelectedRunId(requestedRunId)");
  });
});
