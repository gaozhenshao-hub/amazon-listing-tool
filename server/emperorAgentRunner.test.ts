import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import {
  canTransitionNodeStatus,
  canTransitionRunStatus,
  getListingAgentDag,
  LISTING_AGENT_SLUG,
  normalizeAgentDag,
  validateAgentDag,
} from "./services/emperorAgentRunner";
import {
  getBuiltinToolDefinitions,
  invokeEmperorTool,
} from "./services/emperorToolGateway";

describe("Emperor Agent workflow kernel", () => {
  it("should expose Agent workflow schema tables", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.emperorAgents).toBeDefined();
    expect(schema.emperorAgents.scope).toBeDefined();
    expect(schema.emperorAgents.triggerType).toBeDefined();
    expect(schema.emperorAgents.maxExecutionSeconds).toBeDefined();
    expect(schema.emperorAgentRuns).toBeDefined();
    expect(schema.emperorAgentCheckpoints).toBeDefined();
    expect(schema.emperorAgentEvents).toBeDefined();
    expect(schema.emperorAgentArtifacts).toBeDefined();
    expect(schema.emperorTools).toBeDefined();
    expect(schema.emperorToolRuns).toBeDefined();
  });

  it("should define Listing as a human-in-the-loop DAG", () => {
    const dag = getListingAgentDag();
    const nodeIds = new Set(dag.nodes.map((node) => node.id));
    expect(dag.workflowType).toBe("human_in_loop_dag");
    expect(dag.nodes.length).toBeGreaterThanOrEqual(15);
    expect(dag.edges.length).toBeGreaterThanOrEqual(25);
    ["N0", "N1", "N2", "N3", "N4", "N5", "G1", "G2", "G3", "G4", "G5", "O1", "E1"].forEach((id) => {
      expect(nodeIds.has(id)).toBe(true);
    });
    expect(dag.nodes.find((node) => node.id === "G1")?.skillSlug).toBe("listing.sellingpoints.generate");
    expect(dag.nodes.find((node) => node.id === "G2")?.skillSlug).toBe("listing.title.generate");
    expect(dag.nodes.find((node) => node.id === "N0")?.toolSlug).toBe("internal.agent.capture_input");
    expect(dag.nodes.find((node) => node.id === "O1")?.toolSlug).toBe("internal.listing.compose_preview");
    expect(dag.nodes.every((node) => node.humanGate !== false)).toBe(true);
  });

  it("should normalize malformed DAG definitions safely", () => {
    expect(normalizeAgentDag(null).nodes).toEqual([]);
    expect(normalizeAgentDag('{"nodes":[{"id":"A"}],"edges":[{"source":"A","target":"B"}]}').edges).toHaveLength(1);
  });

  it("should validate Agent DAG contracts before execution", () => {
    const valid = validateAgentDag(getListingAgentDag());
    expect(valid.valid).toBe(true);
    expect(valid.errors).toHaveLength(0);
    expect(valid.rootNodeIds).toContain("N0");

    const invalid = validateAgentDag({
      nodes: [
        { id: "A", nodeType: "skill_node", label: "A" },
        { id: "A", nodeType: "output_node", label: "Duplicate" },
        { id: "B", nodeType: "output_node", label: "B" },
      ],
      edges: [
        { source: "A", target: "B" },
        { source: "B", target: "A" },
        { source: "A", target: "MISSING" },
      ],
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.map((issue) => issue.code)).toContain("node.id_duplicate");
    expect(invalid.errors.map((issue) => issue.code)).toContain("node.skill_missing");
    expect(invalid.errors.map((issue) => issue.code)).toContain("edge.target_missing");
    expect(invalid.errors.map((issue) => issue.code)).toContain("dag.cycle_detected");
  });

  it("should enforce explicit Agent status transitions", () => {
    expect(canTransitionNodeStatus("pending", "ready")).toBe(true);
    expect(canTransitionNodeStatus("ready", "running")).toBe(true);
    expect(canTransitionNodeStatus("running", "waiting_human")).toBe(true);
    expect(canTransitionNodeStatus("waiting_human", "confirmed")).toBe(true);
    expect(canTransitionNodeStatus("pending", "confirmed")).toBe(false);
    expect(canTransitionNodeStatus("confirmed", "running")).toBe(false);

    expect(canTransitionRunStatus("waiting_human", "running")).toBe(true);
    expect(canTransitionRunStatus("running", "canceled")).toBe(true);
    expect(canTransitionRunStatus("failed", "running")).toBe(true);
    expect(canTransitionRunStatus("completed", "running")).toBe(false);
    expect(canTransitionRunStatus("canceled", "waiting_human")).toBe(false);
  });

  it("should register Agent runner routes", () => {
    const procedures = (appRouter as any)._def.procedures;
    expect(procedures["emperor.agents.run"]).toBeDefined();
    expect(procedures["emperor.agents.getRun"]).toBeDefined();
    expect(procedures["emperor.agents.validateDag"]).toBeDefined();
    expect(procedures["emperor.agents.listArtifacts"]).toBeDefined();
    expect(procedures["emperor.agents.executeNode"]).toBeDefined();
    expect(procedures["emperor.agents.scheduleRun"]).toBeDefined();
    expect(procedures["emperor.agents.cancelRun"]).toBeDefined();
    expect(procedures["emperor.agents.rerunNode"]).toBeDefined();
    expect(procedures["emperor.agents.updateNodeDraft"]).toBeDefined();
    expect(procedures["emperor.agents.confirmNode"]).toBeDefined();
    expect(procedures["emperor.agents.installListingTemplate"]).toBeDefined();
    expect(procedures["emperor.agents.getAvailableTools"]).toBeDefined();
    expect(procedures["emperor.tools.list"]).toBeDefined();
    expect(procedures["emperor.tools.listRuns"]).toBeDefined();
    expect(procedures["emperor.tools.invoke"]).toBeDefined();
    expect(procedures["emperor.tools.upsert"]).toBeDefined();
    expect(LISTING_AGENT_SLUG).toBe("listing.full.workflow");
  });

  it("should expose safe built-in Tool Gateway tools", async () => {
    const tools = getBuiltinToolDefinitions();
    expect(tools.map((tool) => tool.slug)).toContain("internal.listing.compose_preview");
    expect(tools.map((tool) => tool.slug)).toContain("internal.agent.capture_input");

    const result = await invokeEmperorTool({
      toolSlug: "internal.listing.compose_preview",
      userId: 1,
      params: {
        nodeInput: {
          runInputs: { project: { productName: "Water Filter" } },
          parentOutputs: {
            title: { parsed: { title: "Water Filter Replacement" } },
            sellingPoints: { parsed: { bulletPoints: ["Fast install"] } },
            description: { parsed: { description: "Long description" } },
            searchTerms: { parsed: { searchTerms: "water filter" } },
            qaContent: { parsed: { qaPairs: [{ question: "Fit?", answer: "Yes" }] } },
          },
        },
      },
    });

    expect(result.success).toBe(true);
    expect((result.output as any).title).toBe("Water Filter Replacement");
    expect((result.output as any).bulletPoints).toEqual(["Fast install"]);
    expect(result.metadata.riskLevel).toBe("low");
    expect(result.metadata.toolRunId).toMatch(/^tool_\d+_[a-z0-9]+$/);
  });

  it("should block HTTP tools from private network targets by default", async () => {
    await expect(invokeEmperorTool({
      toolSlug: "internal.http.request",
      userId: 1,
      params: {
        url: "http://localhost:3000/private",
        method: "GET",
      },
    })).rejects.toThrow(/private or local network/);
  });
});
