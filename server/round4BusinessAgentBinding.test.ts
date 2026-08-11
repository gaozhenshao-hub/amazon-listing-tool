import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("round 4 business Agent binding", () => {
  it("binds major competitor analysis and seven-stage queue state to product development Agent", () => {
    const agent = read("server/domains/product_development/analysis/productAnalysisAgent.ts");
    const marketInsight = read("server/domains/product_development/panorama/marketInsightService.ts");
    const service = read("server/domains/product_development/service.ts");
    const page = read("client/src/pages/dev/DevAnalysisFlow.tsx");

    expect(agent).toContain('"major_competitors"');
    expect(agent).toContain("syncMajorCompetitorQueued");
    expect(agent).toContain("syncMajorCompetitorWaitingHuman");
    expect(marketInsight).toContain("agentRunId: agentRun.runId");
    expect(marketInsight).toContain("syncMajorCompetitorFailure");
    expect(service).toContain("runtimeStatus: job?.status");
    expect(page).toContain('queued: { text: "排队中"');
    expect(page).toContain("runtimeAttempt");
  });

  it("runs all keyword capabilities as recoverable Emperor Skill jobs", () => {
    const job = read("server/domains/keyword/keywordGenerationJob.ts");
    const bridge = read("server/domains/keyword/keywordAgentBridge.ts");
    const router = read("server/routers/keywordAi.ts");
    const worker = read("server/_core/aiWorker.ts");

    for (const slug of [
      "keyword.traffic.classify",
      "keyword.semantic.filter",
      "keyword.scene.tag",
      "keyword.root.classify",
      "keyword.strategy.matrix",
      "keyword.listing.layout",
    ]) expect(job).toContain(slug);
    expect(job).toContain("runEmperorSkill<Record<string, any>>");
    expect(job).toContain("syncKeywordNodeQueued");
    expect(job).toContain("syncKeywordNodeWaitingHuman");
    expect(job).toContain("ensureCurrentJob");
    expect(bridge).toContain('businessJobStatus: "queued"');
    expect(router).toContain("listGenerationRuns");
    expect(router).toContain("confirmGenerationResult");
    expect(worker).toContain('domains/keyword/keywordGenerationJob');
  });

  it("binds ad advice and replenishment jobs to scoped Agent runs and final artifacts", () => {
    const router = read("server/routers/aiJobs.ts");
    const bridge = read("server/domains/ai_os/services/scopedBusinessAgent.ts");
    const adPage = read("client/src/pages/ops/ads/SearchTermClassification.tsx");
    const opsPage = read("client/src/pages/ops/OpsInventory.tsx");
    const embeddedPanel = read("client/src/components/workflow/EmbeddedAgentRunPanel.tsx");

    expect(bridge).toContain('agentSlug: "ads.search-term.workflow"');
    expect(bridge).toContain('agentSlug: "ops.replenishment.workflow"');
    expect(router).toContain("syncScopedBusinessAgentQueued");
    expect(router).toContain("syncScopedBusinessAgentWaitingHuman");
    expect(router).toContain("confirmBusinessOutput");
    expect(adPage).toContain('module: "adAnalysis"');
    expect(adPage).toContain("confirmBusinessOutput");
    expect(opsPage).toContain('agentSlug="ops.replenishment.workflow"');
    expect(opsPage).toContain("restoredReplenishmentJob");
    expect(embeddedPanel).toContain("trpc.emperor.agents.listRuns.useQuery");
  });
});
