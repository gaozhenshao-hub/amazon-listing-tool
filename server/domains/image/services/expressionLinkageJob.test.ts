import { describe, expect, it } from "vitest";
import { expressionAnalysisJobInput, synthesisJobInput } from "./expressionLinkageJob";

describe("expression linkage job contracts", () => {
  it("表达分析Job必须绑定项目、会话、表达组、确认Selection和Agent节点", () => {
    expect(expressionAnalysisJobInput.parse({ projectId: 7, sessionId: 5, groupId: 11, selectionVersionId: 91, agentRunId: "run-1", agentNodeId: "node-0" })).toMatchObject({ selectionVersionId: 91 });
    expect(() => expressionAnalysisJobInput.parse({ projectId: 7, sessionId: 5, groupId: 11 })).toThrow();
  });

  it("综合Job必须绑定项目、会话和Agent节点", () => {
    expect(synthesisJobInput.parse({ projectId: 7, sessionId: 5, agentRunId: "run-1", agentNodeId: "node-0" })).toMatchObject({ sessionId: 5 });
  });
});
