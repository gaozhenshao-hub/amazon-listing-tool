import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { repoPath } from "./testPaths";
import {
  getProductAnalysisAgentDag,
  PRODUCT_ANALYSIS_AGENT_SLUG,
  PRODUCT_ANALYSIS_NODE_IDS,
} from "./domains/product_development/analysis/productAnalysisAgent";

describe("product-development analysis Agent workflow", () => {
  it("defines the seven visible business stages as versioned Emperor Skill nodes", () => {
    const dag = getProductAnalysisAgentDag();
    expect(PRODUCT_ANALYSIS_AGENT_SLUG).toBe("product-development.analysis.workflow");
    expect(dag.version).toBe("1.0.0");
    expect(dag.executionOwner).toBe("product_development.analysis_page");
    expect(dag.nodes.map((node) => node.id)).toEqual(PRODUCT_ANALYSIS_NODE_IDS);
    expect(dag.nodes).toHaveLength(7);
    expect(dag.nodes.every((node) => (
      node.nodeType === "skill_node"
      && String(node.skillSlug).startsWith("dev.analysis.")
      && node.humanGate === true
      && node.executionOwner === "product_development.analysis_page"
    ))).toBe(true);
  });

  it("requires all confirmed evidence before information summary and decision", () => {
    const dag = getProductAnalysisAgentDag();
    const informationParents = dag.edges
      .filter((edge) => edge.target === "information_summary")
      .map((edge) => edge.source)
      .sort();
    expect(informationParents).toEqual([
      "attribute_cross",
      "brand_competition",
      "market_overview",
      "price_analysis",
      "review_kano",
    ]);
    expect(dag.edges).toContainEqual(expect.objectContaining({
      source: "information_summary",
      target: "decision_dashboard",
      required: true,
    }));
  });

  it("registers a released migration-backed template", () => {
    const sql = fs.readFileSync(repoPath("drizzle/0127_product_development_analysis_agent.sql"), "utf8");
    expect(sql).toContain(PRODUCT_ANALYSIS_AGENT_SLUG);
    expect(sql).toContain("emperor_agent_template_versions");
    expect(sql).toContain("product_development.analysis_page");
    for (const nodeId of PRODUCT_ANALYSIS_NODE_IDS) expect(sql).toContain(`\"id\":\"${nodeId}\"`);
  });

  it("binds every queued stage Job and every human action to Agent checkpoints", () => {
    const stageJobs = fs.readFileSync(
      repoPath("server/domains/product_development/analysis/analysisStageJobService.ts"),
      "utf8",
    );
    const summaryJobs = fs.readFileSync(
      repoPath("server/domains/product_development/analysis/informationSummaryService.ts"),
      "utf8",
    );
    const service = fs.readFileSync(repoPath("server/domains/product_development/service.ts"), "utf8");
    for (const source of [stageJobs, summaryJobs]) {
      expect(source).toContain("agentRunId");
      expect(source).toContain("syncProductAnalysisNodeRunning");
      expect(source).toContain("syncProductAnalysisNodeCompleted");
      expect(source).toContain("syncProductAnalysisNodeFailure");
    }
    expect(service).toContain("syncProductAnalysisConfirmation");
    expect(service).toContain("syncProductAnalysisDraft");
  });

  it("auto-links the business UI and keeps managed Agent execution read-only", () => {
    const page = fs.readFileSync(repoPath("client/src/pages/dev/DevAnalysisFlow.tsx"), "utf8");
    const panel = fs.readFileSync(repoPath("client/src/components/workflow/EmbeddedAgentRunPanel.tsx"), "utf8");
    const agentRouter = fs.readFileSync(repoPath("server/domains/ai_os/routers/agents.ts"), "utf8");
    expect(page).toContain("agentSlug={PRODUCT_ANALYSIS_AGENT_SLUG}");
    expect(page).toContain("managedByBusinessPage");
    expect(panel).toContain("首次启动业务流程后");
    expect(panel).toContain("agentSlug ? (");
    expect(agentRouter).toContain("assertAgentRuntimeOwnsExecution");
    expect(agentRouter).toContain("由业务页面托管");
  });
});
