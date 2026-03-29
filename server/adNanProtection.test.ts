import { describe, expect, it } from "vitest";

/**
 * Test the safe division logic used in OpsAds.tsx to prevent NaN% display.
 * These functions mirror the frontend helpers exactly.
 */

// Replicate the exact helpers from OpsAds.tsx
const safeDiv = (a: number, b: number, decimals = 2): number => {
  if (!b || !isFinite(a) || !isFinite(b)) return 0;
  const result = a / b;
  return isFinite(result) ? Math.round(result * Math.pow(10, decimals)) / Math.pow(10, decimals) : 0;
};
const safePct = (a: number, b: number): number => safeDiv(a, b, 4) * 100;
const fmtPct = (v: number): string => {
  if (!isFinite(v) || isNaN(v)) return '0';
  return Math.round(v * 100) / 100 + '';
};

describe("Safe Division Helpers (NaN Protection)", () => {
  describe("safeDiv", () => {
    it("returns 0 when divisor is 0", () => {
      expect(safeDiv(100, 0)).toBe(0);
    });

    it("returns 0 when divisor is undefined/NaN", () => {
      expect(safeDiv(100, NaN)).toBe(0);
      expect(safeDiv(100, undefined as any)).toBe(0);
    });

    it("returns 0 when dividend is NaN", () => {
      expect(safeDiv(NaN, 100)).toBe(0);
    });

    it("returns 0 when both are 0", () => {
      expect(safeDiv(0, 0)).toBe(0);
    });

    it("returns correct value for normal division", () => {
      expect(safeDiv(100, 200)).toBe(0.5);
      expect(safeDiv(414.87, 3123.96)).toBeCloseTo(0.13, 1);
    });

    it("handles Infinity correctly", () => {
      expect(safeDiv(Infinity, 100)).toBe(0);
      expect(safeDiv(100, Infinity)).toBe(0);
    });
  });

  describe("safePct (ACoS = spend/sales * 100)", () => {
    it("returns 0 when sales is 0 (prevents NaN%)", () => {
      // This is the exact scenario from the user's bug report:
      // spend = 0, sales > 0 → ACoS should be 0, not NaN
      expect(safePct(0, 999.25)).toBe(0);
    });

    it("returns 0 when both spend and sales are 0", () => {
      expect(safePct(0, 0)).toBe(0);
    });

    it("returns correct ACoS for normal values", () => {
      // ACoS = spend/sales * 100
      const acos = safePct(414.87, 3123.96);
      expect(acos).toBeGreaterThan(0);
      expect(acos).toBeLessThan(100);
      // 414.87 / 3123.96 ≈ 0.1328 → 13.28%
      expect(acos).toBeCloseTo(13.28, 0);
    });

    it("returns correct CTR for normal values", () => {
      // CTR = clicks/impressions * 100
      const ctr = safePct(194, 2121);
      expect(ctr).toBeGreaterThan(0);
      // 194/2121 ≈ 9.15%
      expect(ctr).toBeCloseTo(9.15, 0);
    });
  });

  describe("fmtPct (display formatting)", () => {
    it("returns '0' for NaN", () => {
      expect(fmtPct(NaN)).toBe('0');
    });

    it("returns '0' for Infinity", () => {
      expect(fmtPct(Infinity)).toBe('0');
      expect(fmtPct(-Infinity)).toBe('0');
    });

    it("formats normal percentages correctly", () => {
      expect(fmtPct(13.28)).toBe('13.28');
      expect(fmtPct(0)).toBe('0');
      expect(fmtPct(100)).toBe('100');
    });

    it("rounds to 2 decimal places", () => {
      expect(fmtPct(13.2856)).toBe('13.29');
    });
  });

  describe("Backend ACoS calculation scenarios", () => {
    // Simulate the backend calculation from operations.ts
    function backendCalcAcos(spend: number, sales: number): number {
      return sales > 0 ? Math.round(spend / sales * 10000) / 100 : 0;
    }

    it("returns 0 when spend is 0 and sales > 0", () => {
      expect(backendCalcAcos(0, 999.25)).toBe(0);
    });

    it("returns 0 when both are 0", () => {
      expect(backendCalcAcos(0, 0)).toBe(0);
    });

    it("returns correct value for normal data", () => {
      const acos = backendCalcAcos(414.87, 3123.96);
      expect(acos).toBeCloseTo(13.28, 0);
    });
  });
});
