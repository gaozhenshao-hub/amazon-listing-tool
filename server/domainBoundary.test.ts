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
    expect(DOMAIN_BOUNDARIES.map((domain) => domain.slug)).toEqual(["ai_os", "listing", "image", "ops"]);
    for (const domain of DOMAIN_BOUNDARIES) {
      expect(fs.existsSync(path.join(root, domain.router))).toBe(true);
      expect(fs.existsSync(path.join(root, domain.repository))).toBe(true);
      expect(fs.existsSync(path.join(root, domain.schema))).toBe(true);
      expect(fs.existsSync(path.join(root, domain.types))).toBe(true);
    }
    expect(getDomainBoundary("ai_os")?.layer).toBe("platform");
    expect(listBusinessDomains().map((domain) => domain.slug)).toEqual(["listing", "image", "ops"]);
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
    const listingRouter = readRepoFile("server/domains/listing/router.ts");
    const imageRouter = readRepoFile("server/domains/image/router.ts");
    const opsRouter = readRepoFile("server/domains/ops/router.ts");

    expect(listingRouter).toContain('import * as db from "./repository"');
    expect(listingRouter).toContain('from "./service"');
    expect(imageRouter).toContain('import * as db from "./repository"');
    expect(imageRouter).toContain('from "./service"');
    expect(opsRouter).toContain('from "./repository"');
    expect(opsRouter).toContain('from "./service"');
  });
});
