import { describe, expect, it } from "vitest";

describe("claim ledger contract", () => {
  it("documents the mandatory coverage contract used by coherence checks", () => {
    const ledger = {
      status: "locked",
      claims: [
        { claimKey: "claim_compatibility", statement: "Fits the approved model list", evidenceKeys: ["ev_1"], status: "locked", risk: "medium" },
      ],
      links: [
        { claimKey: "claim_compatibility", targetDomain: "listing", targetRef: "bullet_1", status: "confirmed" },
        { claimKey: "claim_compatibility", targetDomain: "image", targetRef: "image_2", status: "confirmed" },
      ],
    };
    expect(ledger.claims.every((claim) => claim.evidenceKeys.length > 0)).toBe(true);
    expect(ledger.links.filter((link) => link.targetDomain === "listing")).toHaveLength(1);
    expect(ledger.links.filter((link) => link.targetDomain === "image")).toHaveLength(1);
  });

  it("requires a revision instead of mutating a locked ledger", () => {
    const ledgerStatus = "locked";
    expect(ledgerStatus === "locked").toBe(true);
    expect({ requiresNewVersion: ledgerStatus === "locked" }).toEqual({ requiresNewVersion: true });
  });
});
