import { describe, expect, it } from "vitest";
import { monitorAgentDag } from "./monitorAgent";
import { assertValidAgentDag } from "../ai_os/services/agentRunner/runtimeCore";

describe("Amazon monitor Agent DAG", () => {
  it.each(["competitor", "keyword"] as const)("models %s monitoring as an auditable automatic Tool node", kind => {
    const dag = monitorAgentDag(kind);
    expect(dag.workflowType).toBe("tool_job");
    expect(dag.nodes).toHaveLength(1);
    expect(dag.nodes[0]).toMatchObject({
      id: "provider_snapshot",
      nodeType: "http_node",
      toolSlug: "internal.amazon.monitor.provider",
      humanGate: false,
      autoConfirm: true,
      required: true,
      scheduler: "auto",
      executionOwner: "amazon.monitoring",
    });
    expect(dag.description).toContain("不回退旧爬虫");
    expect(() => assertValidAgentDag(dag, "monitor-agent-test")).not.toThrow();
  });
});
