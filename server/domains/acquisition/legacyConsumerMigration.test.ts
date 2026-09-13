import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("A7 legacy Amazon consumer migration guard", () => {
  it.each([
    "server/routers/kbListings.ts",
    "server/routers/kbProducts.ts",
    "server/routers/analysis.ts",
    "server/routers/conversionDataCollector.ts",
  ])("removes direct old scraper runtime calls from %s", path => {
    const source = read(path);
    expect(source).not.toContain("scrapeAmazonProduct(");
    expect(source).not.toMatch(/from ["'][^"']*scraper["']/);
  });

  it("routes every migrated consumer through the unified acquisition job", () => {
    expect(read("server/routers/kbListings.ts")).toContain('consumerType: "kb_listing"');
    expect(read("server/routers/kbProducts.ts")).toContain('consumerType: "kb_product"');
    expect(read("server/routers/analysis.ts")).toContain('consumerType: "project_competitor"');
    expect(read("server/domains/ops/routers/conversion.ts")).toContain('consumerType: "conversion_collector"');
  });

  it("makes conversion scoring consume workspace-scoped confirmed snapshots", () => {
    const collector = read("server/routers/conversionDataCollector.ts");
    const route = read("server/domains/ops/routers/conversion.ts");
    expect(collector).toContain("findFreshConfirmedSnapshot");
    expect(collector).toContain("confirmed Amazon snapshot required");
    expect(route).toContain("reviewRequired: true");
    expect(route).toContain("workspaceId });");
  });
});
