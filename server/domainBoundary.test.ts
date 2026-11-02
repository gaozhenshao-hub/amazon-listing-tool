import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  DOMAIN_BOUNDARIES,
  getDomainBoundary,
  listBusinessDomains,
} from "./domains/domainManifest";
import {
  emperorAgentsRouter,
  emperorDiagnosticsRouter,
  emperorKnowledgeRouter,
  emperorMcpRouter,
  emperorModelsRouter,
  emperorObservabilityRouter,
  emperorRunRouter,
  emperorScheduledRouter,
  emperorSkillsRouter,
  emperorToolsRouter,
} from "./domains/ai_os/router";

const root = process.cwd();

function readRepoFile(repoPath: string) {
  return fs.readFileSync(path.join(root, repoPath), "utf8");
}

describe("domain boundary v1", () => {
  it("declares domain boundaries with router, service, repository, schema, and types", () => {
    expect(DOMAIN_BOUNDARIES.map((domain) => domain.slug)).toEqual([
      "ai_os",
      "listing",
      "image",
      "ops",
      "ads",
      "product_development",
    ]);
    for (const domain of DOMAIN_BOUNDARIES) {
      expect(fs.existsSync(path.join(root, domain.router))).toBe(true);
      expect(fs.existsSync(path.join(root, domain.repository))).toBe(true);
      expect(fs.existsSync(path.join(root, domain.schema))).toBe(true);
      expect(fs.existsSync(path.join(root, domain.types))).toBe(true);
    }
    expect(getDomainBoundary("ai_os")?.layer).toBe("platform");
    expect(listBusinessDomains().map((domain) => domain.slug)).toEqual([
      "listing",
      "image",
      "ops",
      "ads",
      "product_development",
    ]);
  });

  it("keeps legacy router and service entrypoints as thin compatibility wrappers", () => {
    const wrapperFiles = [
      "server/routers/emperor.ts",
      "server/routers/productOps.ts",
      "server/routers/listing.ts",
      "server/routers/imageWorkflow.ts",
      "server/services/emperorAgentRunner.ts",
      "server/services/emperorToolGateway.ts",
      "server/services/emperorSkillRunner.ts",
      "server/services/aiJobRunner.ts",
    ];

    for (const file of wrapperFiles) {
      const lines = readRepoFile(file).trim().split("\n");
      expect(lines.length).toBeLessThanOrEqual(3);
      expect(lines[0]).toMatch(/^export \* from/);
    }
  });

  it("splits the AI OS emperor router into stable subrouters", () => {
    expect(emperorSkillsRouter).toBeDefined();
    expect(emperorRunRouter).toBeDefined();
    expect(emperorModelsRouter).toBeDefined();
    expect(emperorMcpRouter).toBeDefined();
    expect(emperorAgentsRouter).toBeDefined();
    expect(emperorScheduledRouter).toBeDefined();
    expect(emperorToolsRouter).toBeDefined();
    expect(emperorDiagnosticsRouter).toBeDefined();
    expect(emperorKnowledgeRouter).toBeDefined();
    expect(emperorObservabilityRouter).toBeDefined();
  });

  it("keeps business domains behind local repository and service facades", () => {
    const listingContext = readRepoFile("server/domains/listing/routerContext.ts");
    const imageContext = readRepoFile("server/domains/image/routerContext.ts");
    const opsContext = readRepoFile("server/domains/ops/routerContext.ts");

    expect(listingContext).toContain('import * as db from "./repository"');
    expect(listingContext).toContain('from "./service"');
    expect(imageContext).toContain('import * as db from "./repository"');
    expect(imageContext).toContain('from "./service"');
    expect(opsContext).toContain('from "./repository"');
    expect(opsContext).toContain('from "./service"');
  });

  it("keeps business domain routers as thin procedure composition layers", () => {
    const expectedProcedureFiles = [
      "server/domains/listing/routers/read.ts",
      "server/domains/listing/routers/generation.ts",
      "server/domains/listing/routers/editing.ts",
      "server/domains/listing/routers/abTesting.ts",
      "server/domains/listing/routers/evaluation.ts",
      "server/domains/listing/routers/versions.ts",
      "server/domains/image/routers/sessions.ts",
      "server/domains/image/routers/competitors.ts",
      "server/domains/image/routers/expressionGroups.ts",
      "server/domains/image/routers/workflowSteps.ts",
      "server/domains/image/routers/step5.ts",
      "server/domains/image/routers/references.ts",
      "server/domains/image/routers/knowledgeExport.ts",
      "server/domains/ops/routers/products.ts",
      "server/domains/ops/routers/todosLogs.ts",
      "server/domains/ops/routers/keywordMonitors.ts",
      "server/domains/ops/routers/marketplaceSummaries.ts",
      "server/domains/ops/routers/plans.ts",
      "server/domains/ops/routers/conversion.ts",
      "server/domains/ops/routers/executionReviews.ts",
      "server/domains/ops/routers/teamTasks.ts",
      "server/domains/ops/routers/sync.ts",
      "server/domains/ops/routers/weeklyOps.ts",
      "server/domains/ops/routers/imports.ts",
    ];

    for (const file of expectedProcedureFiles) {
      expect(fs.existsSync(path.join(root, file))).toBe(true);
      expect(readRepoFile(file)).toContain("export const ");
    }

    for (const file of [
      "server/domains/listing/router.ts",
      "server/domains/image/router.ts",
      "server/domains/ops/router.ts",
    ]) {
      const content = readRepoFile(file);
      const lines = content.trim().split("\n");
      expect(lines.length).toBeLessThanOrEqual(30);
      expect(content).toContain("router({");
      expect(content).toContain("...");
    }
  });
});
