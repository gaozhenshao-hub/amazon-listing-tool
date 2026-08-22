import { describe, expect, it } from "vitest";
import { resolveRecoveryLedgerEntity, resolveSkillRecoveryEligibility, resolveToolRecoveryEligibility } from "./directRunRecovery";

describe("direct Tool recovery eligibility", () => {
  it("only accepts failed low-risk explicit read idempotent runs", () => {
    expect(resolveToolRecoveryEligibility({ status: "failed", riskLevel: "low", retryable: 1 }, { config: { retry: { idempotent: true }, sideEffect: "read" } }).eligible).toBe(true);
    expect(resolveToolRecoveryEligibility({ status: "failed", riskLevel: "low", retryable: 1 }, { config: { retry: { idempotent: true }, sideEffect: "write" } }).eligible).toBe(false);
    expect(resolveToolRecoveryEligibility({ status: "failed", riskLevel: "high", retryable: 1 }, { config: { retry: { idempotent: true }, sideEffect: "read" } }).eligible).toBe(false);
  });
});

describe("direct Skill recovery eligibility", () => {
  it("requires explicit L0/L1 read idempotency", () => {
    expect(resolveSkillRecoveryEligibility({ status: "failed" }, { riskTier: "L1", manifest: { implementation: { sideEffect: "read", recovery: { idempotent: true } } } }).eligible).toBe(true);
    expect(resolveSkillRecoveryEligibility({ status: "failed" }, { riskTier: "L2", manifest: { implementation: { sideEffect: "read", recovery: { idempotent: true } } } }).eligible).toBe(false);
    expect(resolveSkillRecoveryEligibility({ status: "failed" }, { riskTier: "L1", manifest: { implementation: { sideEffect: "write", recovery: { idempotent: true } } } }).eligible).toBe(false);
  });
});

describe("direct recovery ledger identity", () => {
  it("keeps Skill and Tool recovery audit entities distinct", () => {
    expect(resolveRecoveryLedgerEntity("skill_run", "skill-run-1")).toEqual({ entityType: "skill_run", entityId: "skill-run-1" });
    expect(resolveRecoveryLedgerEntity("tool_run", "tool-run-1")).toEqual({ entityType: "tool_run", entityId: "tool-run-1" });
  });
});
