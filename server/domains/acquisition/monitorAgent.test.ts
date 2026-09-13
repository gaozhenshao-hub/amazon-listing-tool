import { describe, expect, it } from "vitest";
import { monitorAgentDag } from "./monitorAgent";

describe("Amazon monitor Agent DAG", () => {
  it.each(["competitor", "keyword"] as const)("models %s monitoring as an auditable automatic Tool node", kind => {
    const dag = monitorAgentDag(kind);
    expect(dag.workflowType).toBe("tool_job");
    expect(dag.nodes).toHaveLength(1);
    expect(dag.nodes[0]).toMatchObject({
      id: "provider_snapshot",
      nodeType: "operation_node",
      humanGate: false,
      autoConfirm: true,
      required: true,
      scheduler: "auto",
      executionOwner: "amazon.monitoring",
    });
    expect(dag.description).toContain("不回退旧爬虫");
  });
});
