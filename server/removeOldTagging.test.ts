import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ═══════════════════════════════════════════════════════════════
// Verify runAttributeTagging and related code removed from devAnalysis.ts
// ═══════════════════════════════════════════════════════════════
describe("runAttributeTagging removal from devAnalysis.ts", () => {
  const routerPath = path.join(__dirname, "routers/devAnalysis.ts");
  const routerSrc = fs.readFileSync(routerPath, "utf-8");

  it("should NOT contain runAttributeTagging procedure", () => {
    expect(routerSrc).not.toContain("runAttributeTagging:");
  });

  it("should NOT contain confirmAllTags procedure", () => {
    expect(routerSrc).not.toContain("confirmAllTags:");
  });

  it("should NOT contain getProductTags procedure (moved to devTagging)", () => {
    expect(routerSrc).not.toContain("getProductTags:");
  });

  it("should NOT contain updateProductTag procedure (moved to devTagging)", () => {
    expect(routerSrc).not.toContain("updateProductTag:");
  });

  it("should NOT import ATTRIBUTE_TAGGING_PROMPT", () => {
    expect(routerSrc).not.toContain("ATTRIBUTE_TAGGING_PROMPT");
  });

  it("should still contain runMarketOverview", () => {
    expect(routerSrc).toContain("runMarketOverview:");
  });

  it("should still contain runAttributeCross", () => {
    expect(routerSrc).toContain("runAttributeCross:");
  });

  it("should still contain runPriceAnalysis", () => {
    expect(routerSrc).toContain("runPriceAnalysis:");
  });

  it("should still contain runBrandCompetition", () => {
    expect(routerSrc).toContain("runBrandCompetition:");
  });

  it("should still contain runDecisionDashboard", () => {
    expect(routerSrc).toContain("runDecisionDashboard:");
  });

  it("should have a migration note pointing to devTagging router", () => {
    expect(routerSrc).toContain("devTagging");
    expect(routerSrc).toContain("Attribute tagging");
  });

  it("should use areProductTagsConfirmed for gating (not attribute_tagging stage)", () => {
    expect(routerSrc).toContain("areProductTagsConfirmed");
  });
});

describe("No frontend references to removed procedures", () => {
  const clientDir = path.join(__dirname, "../client/src");

  function searchInDir(dir: string, pattern: string): boolean {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
      const fullPath = path.join(dir, f.name);
      if (f.isDirectory()) {
        if (searchInDir(fullPath, pattern)) return true;
      } else if (f.name.endsWith(".tsx") || f.name.endsWith(".ts")) {
        const content = fs.readFileSync(fullPath, "utf-8");
        if (content.includes(pattern)) return true;
      }
    }
    return false;
  }

  it("should NOT reference devAnalysis.runAttributeTagging in frontend", () => {
    expect(searchInDir(clientDir, "devAnalysis.runAttributeTagging")).toBe(false);
  });

  it("should NOT reference devAnalysis.confirmAllTags in frontend", () => {
    expect(searchInDir(clientDir, "devAnalysis.confirmAllTags")).toBe(false);
  });

  it("should NOT reference devAnalysis.getProductTags in frontend", () => {
    expect(searchInDir(clientDir, "devAnalysis.getProductTags")).toBe(false);
  });

  it("should NOT reference devAnalysis.updateProductTag in frontend", () => {
    expect(searchInDir(clientDir, "devAnalysis.updateProductTag")).toBe(false);
  });
});
