import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprint, validateStructureContract } from "../scripts/database/freshBootstrapPlan.mjs";

// Offline regression only: do not load the runner, source projection or driver.
// The new schema barrel export changes source admission, not the historical
// 303-table approval. An unchanged plan alone cannot authorize rebinding it.
const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "drizzle/bootstrap/manifest.json"), "utf8"));
const contractBytes = readFileSync(resolve(root, "drizzle/bootstrap/structure-contract.json"));
const contract = JSON.parse(contractBytes.toString("utf8"));
const originalContractSha256 = "9323498df4ba3c0619a439f1bcf5fba5369cfe9651b1cd657e3ac2de21b2cd8c";
const unchangedPlanSha256 = "a9ef4347a1ad1dfe99b90bfa9a04b10ceb479a1e0a220dbd05634241685fa2f0";
const currentSourcesSha256 = "fb537531cb839f0da61f86050deeea4ea4af89c45395debc10a463ee8b0c282f";
const approvedHistoricalSourcesSha256 = "2be14b13add4cf878e10956d764080866362a1cf5b7afe6fab6ee40e6af30f7f";

describe("assistant migration keeps the prior fresh contract source-binding refusal", () => {
  it("preserves the independently approved original contract bytes and unchanged plan", () => {
    expect(createHash("sha256").update(contractBytes).digest("hex")).toBe(originalContractSha256);
    expect(manifest.structureContract).toEqual({
      path: "drizzle/bootstrap/structure-contract.json", sha256: originalContractSha256,
    });
    expect(manifest.planSha256).toBe(unchangedPlanSha256);
    expect(contract.planSha256).toBe(unchangedPlanSha256);
  });

  it("refuses the current source vector instead of silently rebinding the old 303-table approval", () => {
    const sourcesSha256 = fingerprint(manifest.sources);
    expect(sourcesSha256).toBe(currentSourcesSha256);
    expect(contract.sourcesSha256).toBe(approvedHistoricalSourcesSha256);
    expect(sourcesSha256).not.toBe(contract.sourcesSha256);
    expect(() => validateStructureContract(contract, {
      planSha256: manifest.planSha256, sourcesSha256, manifest,
    })).toThrowError(expect.objectContaining({ code: "STRUCTURE_CONTRACT_BINDING_MISMATCH" }));
  });
});
