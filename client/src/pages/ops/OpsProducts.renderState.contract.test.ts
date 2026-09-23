import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "client/src/pages/ops/OpsProducts.tsx"),
  "utf8",
);

describe("OpsProducts financial month render state", () => {
  it("binds the optional legacy month count before rendering the scoped warning", () => {
    expect(source).toContain("legacyFinancialProfitMonths = 0");
    expect(source).toContain("legacyFinancialProfitMonths > 0");
  });
});
