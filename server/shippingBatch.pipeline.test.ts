import { describe, it, expect } from "vitest";

// Test the SHIPPING_STEPS constant and DEFAULT_STEP_DAYS
import { SHIPPING_STEPS } from "./routers/shippingBatch";

describe("Shipping Pipeline 10-Step Configuration", () => {
  it("should have exactly 10 shipping steps", () => {
    expect(SHIPPING_STEPS).toHaveLength(10);
  });

  it("should have sequential step numbers from 1 to 10", () => {
    const numbers = SHIPPING_STEPS.map(s => s.number);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("should include '上架可售' as the 10th step", () => {
    const step10 = SHIPPING_STEPS.find(s => s.number === 10);
    expect(step10).toBeDefined();
    expect(step10!.name).toBe("上架可售");
    expect(step10!.key).toBe("availableForSale");
  });

  it("should have unique step keys", () => {
    const keys = SHIPPING_STEPS.map(s => s.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(10);
  });

  it("should have unique step names", () => {
    const names = SHIPPING_STEPS.map(s => s.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(10);
  });

  it("each step should have a name, key, number, and requiredFields", () => {
    for (const step of SHIPPING_STEPS) {
      expect(step).toHaveProperty("number");
      expect(step).toHaveProperty("name");
      expect(step).toHaveProperty("key");
      expect(step).toHaveProperty("requiredFields");
      expect(typeof step.number).toBe("number");
      expect(typeof step.name).toBe("string");
      expect(typeof step.key).toBe("string");
      expect(Array.isArray(step.requiredFields)).toBe(true);
    }
  });
});

// Test the replenishment engine STEP_NAMES and DEFAULT_STEP_DAYS
import { STEP_NAMES, DEFAULT_STEP_DAYS } from "./replenishmentEngine";

describe("Replenishment Engine 10-Step Configuration", () => {
  it("STEP_NAMES should have 11 entries (index 0 unused + 10 steps)", () => {
    // STEP_NAMES is an array with index 0 unused, so length is 11
    expect(STEP_NAMES).toHaveLength(11);
    expect(STEP_NAMES[0]).toBe(""); // index 0 is unused
  });

  it("STEP_NAMES should have valid names for steps 1 through 10", () => {
    for (let i = 1; i <= 10; i++) {
      expect(STEP_NAMES[i]).toBeTruthy();
      expect(typeof STEP_NAMES[i]).toBe("string");
    }
  });

  it("STEP_NAMES[10] should be '上架可售'", () => {
    expect(STEP_NAMES[10]).toBe("上架可售");
  });

  it("DEFAULT_STEP_DAYS should have 11 entries for each shipping method (index 0 unused + 10 steps)", () => {
    for (const [method, days] of Object.entries(DEFAULT_STEP_DAYS)) {
      expect(days).toHaveLength(11);
      expect(days[0]).toBe(0); // index 0 is unused placeholder
      // Steps 1-10 should be positive numbers
      for (let i = 1; i <= 10; i++) {
        expect(days[i]).toBeGreaterThan(0);
      }
    }
  });

  it("DEFAULT_STEP_DAYS should include standard shipping methods", () => {
    expect(DEFAULT_STEP_DAYS).toHaveProperty("sea");
    expect(DEFAULT_STEP_DAYS).toHaveProperty("air");
    expect(DEFAULT_STEP_DAYS).toHaveProperty("express");
    expect(DEFAULT_STEP_DAYS).toHaveProperty("rail");
  });
});
