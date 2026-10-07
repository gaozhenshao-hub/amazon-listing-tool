import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildRestoredSellingPointCores, hasCurrentConfirmedEvidence } from "./reviewRecovery";

const page = readFileSync(fileURLToPath(new URL("../GeneratePage.tsx", import.meta.url)), "utf8");
const candidatePanel = readFileSync(fileURLToPath(new URL("../../components/listing/CandidateReviewPanel.tsx", import.meta.url)), "utf8");

describe("listing review recovery", () => {
  const confirmedCore = {
    id: 11,
    coreId: "core-project-a",
    sellingPointIndex: 1,
    buyerReason: "Easy setup: Uses the operator-confirmed dimensions",
    factRevisionIdsJson: [21],
    status: "confirmed",
    revision: 3,
    inputHash: "a".repeat(64),
  };

  it("restores only current draft/confirmed cores without turning them into local confirmation", () => {
    const restored = buildRestoredSellingPointCores([
      { ...confirmedCore, status: "stale" },
      confirmedCore,
      { ...confirmedCore, coreId: "rejected-core", sellingPointIndex: 2, status: "rejected" },
    ]);
    expect(restored).toHaveLength(2);
    expect(restored[0]).toBeNull();
    expect(restored[1]).toMatchObject({
      serverCoreId: "core-project-a",
      restoredBuyerReason: confirmedCore.buyerReason,
      isRestored: true,
    });
    expect(JSON.stringify(restored)).not.toContain("confirmed: true");
  });

  it("requires the exact currently confirmed facts before a restored core becomes actionable", () => {
    expect(hasCurrentConfirmedEvidence(confirmedCore, new Set([21]))).toBe(true);
    expect(hasCurrentConfirmedEvidence(confirmedCore, new Set([22]))).toBe(false);
  });

  it("clears prior project state and mounts candidate review independently of transient core cards", () => {
    expect(page).toContain("lastRecoveredCoreSignatureRef.current = null;");
    expect(page).toContain("setSellingPointCores(null);");
    expect(page).toContain('aria-label="已审核卖点候选恢复"');
    expect(page).toContain("currentConfirmedCoreBindings.map((core) => <CandidateReviewPanel");
    expect(page).not.toContain("{selectedProjectId && coreBinding(idx) && <CandidateReviewPanel");
  });

  it("keeps project-wide historical candidates read-only and never assigns them a current core id", () => {
    expect(candidatePanel).toContain("readOnlyHistory?: boolean");
    expect(candidatePanel).toContain("...(coreRevisionId ? { coreRevisionId } : {})");
    expect(candidatePanel).toContain("...(readOnlyHistory ? { includeHistory: true } : {})");
    expect(candidatePanel).toContain("!readOnlyHistory && coreRevisionId && coreInputHash");
    expect(candidatePanel).toContain("已失效、不同核心或不同事实版本绝不会绑定到本面板");
  });
});
