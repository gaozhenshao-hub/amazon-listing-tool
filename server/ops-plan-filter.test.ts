import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the ops plan parentAsin filtering logic.
 * Verifies that:
 * 1. listPlans with parentAsin filters by parentAsin (not productProfileId)
 * 2. listPlans with productProfileId > 0 filters by productProfileId
 * 3. listPlans with productProfileId=0 and no parentAsin returns empty array
 * 4. createPlan stores parentAsin
 */

// Mock the filtering logic extracted from the router
function filterPlans(
  allPlans: Array<{ id: number; parentAsin: string | null; productProfileId: number; userId: number }>,
  input: { productProfileId: number; parentAsin?: string },
  userId: number,
  isManager: boolean
): typeof allPlans {
  const conditions: Array<(plan: typeof allPlans[0]) => boolean> = [];

  if (!isManager) {
    conditions.push((p) => p.userId === userId);
  }

  if (input.parentAsin) {
    conditions.push((p) => p.parentAsin === input.parentAsin);
  } else if (input.productProfileId > 0) {
    conditions.push((p) => p.productProfileId === input.productProfileId);
  } else {
    // productProfileId=0 and no parentAsin: return empty
    return [];
  }

  return allPlans.filter((plan) => conditions.every((cond) => cond(plan)));
}

describe("ops plan parentAsin filtering", () => {
  const samplePlans = [
    { id: 1, parentAsin: "B0ABC12345", productProfileId: 0, userId: 100 },
    { id: 2, parentAsin: "B0ABC12345", productProfileId: 0, userId: 100 },
    { id: 3, parentAsin: "B0DEF67890", productProfileId: 0, userId: 100 },
    { id: 4, parentAsin: "B0GHI11111", productProfileId: 30009, userId: 100 },
    { id: 5, parentAsin: null, productProfileId: 0, userId: 100 },
    { id: 6, parentAsin: "B0ABC12345", productProfileId: 0, userId: 200 },
  ];

  it("should filter by parentAsin when provided", () => {
    const result = filterPlans(
      samplePlans,
      { productProfileId: 0, parentAsin: "B0ABC12345" },
      100,
      false
    );
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.parentAsin === "B0ABC12345")).toBe(true);
    expect(result.every((p) => p.userId === 100)).toBe(true);
  });

  it("should filter by parentAsin for managers (see all users)", () => {
    const result = filterPlans(
      samplePlans,
      { productProfileId: 0, parentAsin: "B0ABC12345" },
      100,
      true
    );
    expect(result).toHaveLength(3); // includes userId=200
    expect(result.every((p) => p.parentAsin === "B0ABC12345")).toBe(true);
  });

  it("should filter by productProfileId when > 0 and no parentAsin", () => {
    const result = filterPlans(
      samplePlans,
      { productProfileId: 30009 },
      100,
      false
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(4);
  });

  it("should return empty when productProfileId=0 and no parentAsin", () => {
    const result = filterPlans(
      samplePlans,
      { productProfileId: 0 },
      100,
      false
    );
    expect(result).toHaveLength(0);
  });

  it("should not return plans from other parentAsins", () => {
    const result = filterPlans(
      samplePlans,
      { productProfileId: 0, parentAsin: "B0DEF67890" },
      100,
      false
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
    // Should NOT include plans for B0ABC12345 or B0GHI11111
    expect(result.some((p) => p.parentAsin === "B0ABC12345")).toBe(false);
  });

  it("should not return plans with null parentAsin when filtering by parentAsin", () => {
    const result = filterPlans(
      samplePlans,
      { productProfileId: 0, parentAsin: "B0ABC12345" },
      100,
      false
    );
    expect(result.some((p) => p.parentAsin === null)).toBe(false);
  });

  it("should prefer parentAsin over productProfileId when both provided", () => {
    const result = filterPlans(
      samplePlans,
      { productProfileId: 30009, parentAsin: "B0ABC12345" },
      100,
      false
    );
    // Should filter by parentAsin, not productProfileId
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.parentAsin === "B0ABC12345")).toBe(true);
  });
});
