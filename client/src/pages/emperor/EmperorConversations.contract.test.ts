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

  it("仅为失败的低风险Skill提供恢复至待运行入口，并传递服务端状态版本", () => {
    expect(conversationsSource).toContain("recoverStep.useMutation");
    expect(conversationsSource).toContain('step.status === "failed" && step.capabilityType === "skill"');
    expect(conversationsSource).toContain('step.riskLevel === "L0" || step.riskLevel === "L1"');
    expect(conversationsSource).toContain("expectedStateVersion: Number(step.stateVersion || 0)");
    expect(conversationsSource).toContain("恢复至待运行");
  });

  it("为已完成Skill步骤提供只读Trace入口，并按URL runId自动选中运行详情", () => {
    expect(conversationsSource).toContain("step.skillRunId &&");
    expect(conversationsSource).toContain("/emperor/trace?runId=${encodeURIComponent(step.skillRunId)}");
    expect(traceSource).toContain('URLSearchParams(window.location.search).get("runId")');
    expect(traceSource).toContain("setSelectedRunId(requestedRunId)");
  });

  it("运行历史只对唯一可验证Trace读取Ledger投影，并将失效来源保持为人工重新确认提示", () => {
    expect(traceSource).toContain("detail as any)?.traceId");
    expect(traceSource).toContain("emperor.observability.runProjection.useQuery");
    expect(traceSource).toContain("enabled: Boolean(isGovernanceAdmin && verifiedTraceId)");
    expect(traceSource).toContain("10 秒轮询一次");
    expect(traceSource).toContain("系统不会自动恢复；请重新编译上下文并再次人工确认");
  });

  it("SLO卡片只读取管理员受保护的真实汇总，不制造评分或自动动作", () => {
    expect(traceSource).toContain("emperor.observability.slo.useQuery");
    expect(traceSource).toContain("暂无样本");
    expect(traceSource).toContain("受控运行投影与真实评测 SLO");
  });
});
