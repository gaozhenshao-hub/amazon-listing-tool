import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/AnalysisPage.tsx"), "utf8");

describe("SellerSprite batch failure feedback contract", () => {
  it("shows structured per-ASIN failure details instead of only a total count", () => {
    expect(source).toContain("data-testid=\"sellersprite-batch-failures\"");
    expect(source).toContain("ssBatchFailures.map((failure)");
    expect(source).toContain("failure.message");
    expect(source).toContain("可人工重试");
  });

  it("keeps only failed rows selected and does not auto-retry them", () => {
    expect(source).toContain("const failedAsins = new Set(failures.map((item) => item.asin));");
    expect(source).toContain("selected: failedAsins.has(product.asin)");
    expect(source).toContain("系统不会自动重试");
  });
});
