import { describe, expect, it } from "vitest";
import { buildListingAgentRunPresentation } from "./listingAgentRunPresentation";

describe("Listing Agent run presentation", () => {
  it("uses project, time, status, node, version, and a short id instead of the raw run id", () => {
    const presentation = buildListingAgentRunPresentation({
      runId: "agent_1785830228915_184s",
      agentName: "智能 Listing 全链路 Agent",
      status: "waiting_human",
      currentNodeId: "N4",
      templateVersion: "v3",
      inputs: JSON.stringify({ projectName: "空气套件" }),
      startedAt: "2026-08-05T11:05:00",
    });

    expect(presentation.primary).toContain("空气套件");
    expect(presentation.primary).not.toContain("agent_1785830228915");
    expect(presentation.secondary).toBe("待确认 · 当前 N4 · 模板 v3 · #184s");
    expect(presentation.fullRunId).toBe("agent_1785830228915_184s");
  });

  it("falls back to the selected project name and progress for older runs", () => {
    const presentation = buildListingAgentRunPresentation({
      runId: "agent_123_abc",
      status: "completed",
      progress: 100,
      inputs: null,
    }, "测试项目");

    expect(presentation.primary).toBe("测试项目 · 时间未知");
    expect(presentation.secondary).toBe("已完成 · 进度 100% · #abc");
  });
});
