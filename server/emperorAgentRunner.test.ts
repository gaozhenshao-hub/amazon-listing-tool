import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import {
  buildAgentContextPackage,
  buildStoredAgentRunInputs,
  canTransitionNodeStatus,
  canTransitionRunStatus,
  getListingAgentDag,
  LISTING_AGENT_SLUG,
  normalizeAgentDag,
  parseStoredAgentRunInputs,
  resolveAgentNodeSkillBinding,
  validateAgentDag,
} from "./services/emperorAgentRunner";
import {
  getBuiltinToolDefinitions,
  invokeEmperorTool,
  validateJsonSchemaValue,
} from "./services/emperorToolGateway";
import { AgentStateMachine } from "./services/agentStateMachine";

describe("Emperor Agent workflow kernel", () => {
  it("should expose Agent workflow schema tables", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.emperorAgents).toBeDefined();
    expect(schema.emperorAgents.scope).toBeDefined();
    expect(schema.emperorAgents.triggerType).toBeDefined();
    expect(schema.emperorAgents.maxExecutionSeconds).toBeDefined();
    expect(schema.emperorAgentTemplateVersions).toBeDefined();
    expect(schema.emperorAgentRuns).toBeDefined();
    expect(schema.emperorAgentRuns.templateVersionId).toBeDefined();
    expect(schema.emperorAgentRuns.templateVersion).toBeDefined();
    expect(schema.emperorAgentRuns.dagHash).toBeDefined();
    expect(schema.emperorAgentCheckpoints).toBeDefined();
    expect(schema.emperorAgentCheckpoints.maxAttempts).toBeDefined();
    expect(schema.emperorAgentCheckpoints.lockToken).toBeDefined();
    expect(schema.emperorAgentCheckpoints.lockedAt).toBeDefined();
    expect(schema.emperorAgentCheckpoints.timeoutAt).toBeDefined();
    expect(schema.emperorAgentEvents).toBeDefined();
    expect(schema.emperorAgentArtifacts).toBeDefined();
    expect(schema.emperorTools).toBeDefined();
    expect(schema.emperorToolRuns).toBeDefined();
    expect(schema.emperorAiOsMetrics).toBeDefined();
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

  it("should resolve Skill version policies for Agent nodes", () => {
    expect(resolveAgentNodeSkillBinding({}).policy).toBe("snapshot");
    expect(resolveAgentNodeSkillBinding({ skillVersionRef: "latest" })).toEqual({ policy: "latest", ref: "latest" });
    expect(resolveAgentNodeSkillBinding({ skillVersion: 7 })).toEqual({ policy: "pinned", pinnedVersion: "7", ref: "pinned:7" });
    expect(resolveAgentNodeSkillBinding({ skillVersionRef: "pinned:3" })).toEqual({ policy: "pinned", pinnedVersion: "3", ref: "pinned:3" });
    expect(resolveAgentNodeSkillBinding({ skillVersionRef: "pinned:" })).toEqual({ policy: "pinned", ref: "pinned" });
  });

  it("should freeze Agent run inputs with a DAG snapshot", () => {
    const dag = getListingAgentDag();
    const stored = buildStoredAgentRunInputs({
      inputs: { asin: "B0TEST123", locale: "en-US" },
      agentSlug: LISTING_AGENT_SLUG,
      agentName: "Listing Agent",
      dag,
    });
    const parsed = parseStoredAgentRunInputs(stored);
    expect(parsed.inputs).toEqual({ asin: "B0TEST123", locale: "en-US" });
    expect(parsed.runtime?.agentSlug).toBe(LISTING_AGENT_SLUG);
    expect(parsed.runtime?.templateVersion).toBeNull();
    expect(parsed.runtime?.dagHash).toHaveLength(16);
    expect(parsed.runtime?.dagSnapshot.nodes.length).toBe(dag.nodes.length);
  });

  it("should build context packages from confirmed checkpoints and artifacts", () => {
    const longNotes = "x".repeat(250);
    const dag = {
      nodes: [
        { id: "A", nodeType: "input_node", label: "A", outputKey: "alpha" },
        { id: "B", nodeType: "skill_node", label: "B", outputKey: "beta", skillSlug: "listing.title.generate" },
      ],
      edges: [{ source: "A", target: "B" }],
    };
    const contextPackage = buildAgentContextPackage({
      run: { runId: "agent_1", agentSlug: "demo.agent", projectId: 9, inputs: { locale: "en-US" } },
      dag,
      node: dag.nodes[1],
      checkpoints: [
        { runId: "agent_1", agentSlug: "demo.agent", nodeId: "A", nodeType: "input_node", status: "confirmed", output: { product: "Filter", notes: longNotes } },
        { runId: "agent_1", agentSlug: "demo.agent", nodeId: "B", nodeType: "skill_node", status: "ready" },
      ] as any,
      artifacts: [
        { id: 12, runId: "agent_1", nodeId: "A", artifactKey: "alpha", version: 2, status: "final", content: { product: "Filter", notes: longNotes } },
        { id: 13, runId: "agent_1", nodeId: "A", artifactKey: "alpha", version: 3, status: "draft", content: { product: "Draft" } },
      ],
      options: { maxStringLength: 200, maxArtifactContentLength: 200 },
    });

    expect(contextPackage.version).toBe("1.0");
    expect((contextPackage.parentOutputs.alpha as any).product).toBe("Filter");
    expect((contextPackage.parentOutputs.alpha as any).notes.__truncated).toBe(true);
    expect((contextPackage.confirmedOutputs.alpha as any).product).toBe("Filter");
    expect(contextPackage.artifacts).toHaveLength(1);
    expect(contextPackage.artifacts[0].version).toBe(2);
    expect((contextPackage.artifacts[0].content as any).notes.__truncated).toBe(true);
    expect(contextPackage.provenance.artifactRefs).toContain("artifact://agent_1/A/alpha@2");
  });

  it("should preserve legacy Agent run inputs that contain a payload field", () => {
    const parsed = parseStoredAgentRunInputs({ payload: { userValue: true }, asin: "B0LEGACY" });
    expect(parsed.runtime).toBeNull();
    expect(parsed.inputs).toEqual({ payload: { userValue: true }, asin: "B0LEGACY" });
  });

  it("should enforce explicit Agent status transitions", () => {
    expect(canTransitionNodeStatus("pending", "ready")).toBe(true);
    expect(AgentStateMachine.canTransitionNodeStatus("pending", "ready")).toBe(true);
    expect(canTransitionNodeStatus("ready", "running")).toBe(true);
    expect(canTransitionNodeStatus("running", "waiting_human")).toBe(true);
    expect(canTransitionNodeStatus("waiting_human", "confirmed")).toBe(true);
    expect(canTransitionNodeStatus("pending", "confirmed")).toBe(false);
    expect(canTransitionNodeStatus("confirmed", "running")).toBe(false);

    expect(canTransitionRunStatus("waiting_human", "running")).toBe(true);
    expect(AgentStateMachine.canTransitionRunStatus("waiting_human", "running")).toBe(true);
    expect(canTransitionRunStatus("running", "canceled")).toBe(true);
    expect(canTransitionRunStatus("running", "paused")).toBe(true);
    expect(canTransitionRunStatus("paused", "waiting_human")).toBe(true);
    expect(canTransitionRunStatus("failed", "running")).toBe(true);
    expect(canTransitionRunStatus("completed", "running")).toBe(false);
    expect(canTransitionRunStatus("canceled", "waiting_human")).toBe(false);
    expect(() => AgentStateMachine.assertNodeTransition("pending", "confirmed", "unit test")).toThrow(/Invalid node transition/);
    expect(() => AgentStateMachine.assertRunTransition("completed", "running", "unit test")).toThrow(/Invalid run transition/);
  });

  it("should register Agent runner routes", () => {
    const procedures = (appRouter as any)._def.procedures;
    expect(procedures["emperor.agents.run"]).toBeDefined();
    expect(procedures["emperor.agents.getRun"]).toBeDefined();
    expect(procedures["emperor.agents.validateDag"]).toBeDefined();
    expect(procedures["emperor.agents.listArtifacts"]).toBeDefined();
    expect(procedures["emperor.agents.getArtifactByRef"]).toBeDefined();
    expect(procedures["emperor.agents.selectArtifactVersion"]).toBeDefined();
    expect(procedures["emperor.agents.listTemplateVersions"]).toBeDefined();
    expect(procedures["emperor.agents.executeNode"]).toBeDefined();
    expect(procedures["emperor.agents.scheduleRun"]).toBeDefined();
    expect(procedures["emperor.agents.cancelRun"]).toBeDefined();
    expect(procedures["emperor.agents.pauseRun"]).toBeDefined();
    expect(procedures["emperor.agents.resumeRun"]).toBeDefined();
    expect(procedures["emperor.agents.recoverTimedOutNodes"]).toBeDefined();
    expect(procedures["emperor.agents.rerunNode"]).toBeDefined();
    expect(procedures["emperor.agents.updateNodeDraft"]).toBeDefined();
    expect(procedures["emperor.agents.confirmNode"]).toBeDefined();
    expect(procedures["emperor.agents.installListingTemplate"]).toBeDefined();
    expect(procedures["emperor.agents.getAvailableTools"]).toBeDefined();
    expect(procedures["emperor.tools.list"]).toBeDefined();
    expect(procedures["emperor.tools.listRuns"]).toBeDefined();
    expect(procedures["emperor.tools.invoke"]).toBeDefined();
    expect(procedures["emperor.tools.upsert"]).toBeDefined();
    expect(procedures["emperor.observability.metrics"]).toBeDefined();
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
    expect(result.metadata.attempts).toBe(1);
  });

  it("should validate Tool Gateway JSON schema contracts", () => {
    const schema = {
      type: "object",
      required: ["url", "method"],
      properties: {
        url: { type: "string", minLength: 8 },
        method: { type: "string", enum: ["GET", "POST"] },
        retries: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    };

    expect(validateJsonSchemaValue(schema, { url: "https://example.com", method: "GET", retries: 1 })).toEqual([]);
    const errors = validateJsonSchemaValue(schema, { url: "bad", method: "DELETE", extra: true });
    expect(errors.join("\n")).toMatch(/method/);
    expect(errors.join("\n")).toMatch(/extra/);
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
