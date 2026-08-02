import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import {
  getListingAgentDag,
  LISTING_AGENT_SLUG,
  normalizeAgentDag,
} from "./services/emperorAgentRunner";

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
    expect(schema.emperorTools).toBeDefined();
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
    expect(dag.nodes.every((node) => node.humanGate !== false)).toBe(true);
  });

  it("should normalize malformed DAG definitions safely", () => {
    expect(normalizeAgentDag(null).nodes).toEqual([]);
    expect(normalizeAgentDag('{"nodes":[{"id":"A"}],"edges":[{"source":"A","target":"B"}]}').edges).toHaveLength(1);
  });

  it("should register Agent runner routes", () => {
    const procedures = (appRouter as any)._def.procedures;
    expect(procedures["emperor.agents.run"]).toBeDefined();
    expect(procedures["emperor.agents.getRun"]).toBeDefined();
    expect(procedures["emperor.agents.executeNode"]).toBeDefined();
    expect(procedures["emperor.agents.confirmNode"]).toBeDefined();
    expect(procedures["emperor.agents.installListingTemplate"]).toBeDefined();
    expect(LISTING_AGENT_SLUG).toBe("listing.full.workflow");
  });
});
