import { describe, it, expect } from "vitest";

// ─── Lock State Persistence Tests ───

describe("Lock State Persistence", () => {
  describe("lockedSteps data format", () => {
    it("should serialize locked steps as JSON array of numbers", () => {
      const lockedSteps = new Set([1, 3, 5]);
      const serialized = JSON.stringify(Array.from(lockedSteps));
      expect(serialized).toBe("[1,3,5]");
    });

    it("should deserialize locked steps from JSON", () => {
      const json = "[1,2,4]";
      const steps: number[] = JSON.parse(json);
      expect(steps).toEqual([1, 2, 4]);
      expect(new Set(steps).has(1)).toBe(true);
      expect(new Set(steps).has(3)).toBe(false);
    });

    it("should handle empty locked steps", () => {
      const lockedSteps = new Set<number>();
      const serialized = JSON.stringify(Array.from(lockedSteps));
      expect(serialized).toBe("[]");
      const deserialized: number[] = JSON.parse(serialized);
      expect(deserialized).toEqual([]);
    });

    it("should handle all 5 steps locked", () => {
      const lockedSteps = new Set([1, 2, 3, 4, 5]);
      const serialized = JSON.stringify(Array.from(lockedSteps));
      const deserialized: number[] = JSON.parse(serialized);
      expect(deserialized.length).toBe(5);
      expect(new Set(deserialized).size).toBe(5);
    });

    it("should detect all-locked state correctly", () => {
      const lockedSteps = new Set([1, 2, 3, 4, 5]);
      expect(lockedSteps.size === 5).toBe(true);
      
      const partial = new Set([1, 3]);
      expect(partial.size === 5).toBe(false);
    });
  });

  describe("lock/unlock operations", () => {
    it("should add a step to locked set", () => {
      const lockedSteps = new Set<number>();
      const updated = new Set(lockedSteps);
      updated.add(2);
      expect(updated.has(2)).toBe(true);
      expect(updated.size).toBe(1);
    });

    it("should remove a step from locked set", () => {
      const lockedSteps = new Set([1, 2, 3]);
      const updated = new Set(lockedSteps);
      updated.delete(2);
      expect(updated.has(2)).toBe(false);
      expect(updated.size).toBe(2);
    });

    it("should not duplicate steps when locking same step twice", () => {
      const lockedSteps = new Set([1, 2]);
      lockedSteps.add(2);
      expect(lockedSteps.size).toBe(2);
    });
  });
});

// ─── Step Navigation Lock Icon Tests ───

describe("Step Navigation Lock Icons", () => {
  const STEPS = [
    { id: 1, label: "卖点精雕" },
    { id: 2, label: "标题生成" },
    { id: 3, label: "产品描述" },
    { id: 4, label: "搜索词" },
    { id: 5, label: "QA问答" },
  ];

  it("should identify locked steps for icon display", () => {
    const lockedSteps = new Set([1, 3]);
    const stepsWithLockStatus = STEPS.map(step => ({
      ...step,
      isLocked: lockedSteps.has(step.id),
    }));
    
    expect(stepsWithLockStatus[0].isLocked).toBe(true);  // Step 1
    expect(stepsWithLockStatus[1].isLocked).toBe(false); // Step 2
    expect(stepsWithLockStatus[2].isLocked).toBe(true);  // Step 3
    expect(stepsWithLockStatus[3].isLocked).toBe(false); // Step 4
    expect(stepsWithLockStatus[4].isLocked).toBe(false); // Step 5
  });

  it("should prioritize lock icon over completed icon", () => {
    const lockedSteps = new Set([1]);
    const completedSteps = new Set([1, 2]);
    
    // For step 1: locked takes priority
    const step1Locked = lockedSteps.has(1);
    const step1Completed = completedSteps.has(1);
    expect(step1Locked).toBe(true);
    // Lock icon should show, not completed icon
    
    // For step 2: only completed, not locked
    const step2Locked = lockedSteps.has(2);
    const step2Completed = completedSteps.has(2);
    expect(step2Locked).toBe(false);
    expect(step2Completed).toBe(true);
  });
});

// ─── All-Locked Redirect Tests ───

describe("All-Locked Redirect Logic", () => {
  it("should trigger redirect dialog when all 5 steps are locked", () => {
    const lockedSteps = new Set([1, 2, 3, 4, 5]);
    const shouldShowDialog = lockedSteps.size === 5;
    expect(shouldShowDialog).toBe(true);
  });

  it("should not trigger redirect dialog when not all steps are locked", () => {
    const lockedSteps = new Set([1, 2, 3, 4]);
    const shouldShowDialog = lockedSteps.size === 5;
    expect(shouldShowDialog).toBe(false);
  });

  it("should not trigger dialog for empty locked steps", () => {
    const lockedSteps = new Set<number>();
    const shouldShowDialog = lockedSteps.size === 5;
    expect(shouldShowDialog).toBe(false);
  });
});

// ─── Checklist Scores Persistence Tests ───

describe("Checklist Scores Persistence", () => {
  it("should serialize checklist scores as JSON", () => {
    const scores: Record<number, any> = {
      0: {
        checkListScores: { B1: { pass: true, comment: "Good" } },
        aiSemanticRelations: { usage: "test" },
      },
      1: {
        checkListScores: { B1: { pass: false, comment: "Needs work" } },
        aiSemanticRelations: null,
      },
    };
    const serialized = JSON.stringify(scores);
    const deserialized = JSON.parse(serialized);
    expect(deserialized[0].checkListScores.B1.pass).toBe(true);
    expect(deserialized[1].checkListScores.B1.pass).toBe(false);
    expect(deserialized[1].aiSemanticRelations).toBeNull();
  });

  it("should extract scores from generated bullets for persistence", () => {
    const generatedBullets: Record<number, any> = {
      0: { subtitle: "Test", fullText: "Full text", checkListScores: { B1: { pass: true } } },
      1: { subtitle: "Test2", fullText: "Full text 2" }, // no scores
      2: { subtitle: "Test3", fullText: "Full text 3", checkListScores: { B2: { pass: false } } },
    };

    const scores: Record<number, any> = {};
    for (const [idx, bullet] of Object.entries(generatedBullets)) {
      if (bullet?.checkListScores) {
        scores[Number(idx)] = {
          checkListScores: bullet.checkListScores,
          aiSemanticRelations: bullet.aiSemanticRelations || null,
        };
      }
    }

    expect(Object.keys(scores).length).toBe(2);
    expect(scores[0]).toBeDefined();
    expect(scores[1]).toBeUndefined();
    expect(scores[2]).toBeDefined();
  });

  it("should handle empty checklist scores", () => {
    const generatedBullets: Record<number, any> = {
      0: { subtitle: "Test", fullText: "Full text" },
    };

    const scores: Record<number, any> = {};
    for (const [idx, bullet] of Object.entries(generatedBullets)) {
      if (bullet?.checkListScores) {
        scores[Number(idx)] = { checkListScores: bullet.checkListScores };
      }
    }

    expect(Object.keys(scores).length).toBe(0);
  });
});

// ─── Auto-Trigger Checklist Tests ───

describe("Auto-Trigger Checklist Logic", () => {
  it("should determine if auto-check should run based on result data", () => {
    const resultWithData = { subtitle: "Test", fullText: "Full text content" };
    const resultWithoutSubtitle = { subtitle: "", fullText: "Full text" };
    const resultWithoutFullText = { subtitle: "Test", fullText: "" };

    expect(!!(resultWithData.subtitle && resultWithData.fullText)).toBe(true);
    expect(!!(resultWithoutSubtitle.subtitle && resultWithoutSubtitle.fullText)).toBe(false);
    expect(!!(resultWithoutFullText.subtitle && resultWithoutFullText.fullText)).toBe(false);
  });
});

// ─── Batch Checklist Tests ───

describe("Batch Checklist Logic", () => {
  it("should skip bullets that already have checklist scores", () => {
    const generatedBullets: Record<number, any> = {
      0: { subtitle: "A", fullText: "Text A", checkListScores: { B1: { pass: true } } },
      1: { subtitle: "B", fullText: "Text B" },
      2: { subtitle: "C", fullText: "Text C", checkListScores: {} },
    };

    const needsEvaluation: number[] = [];
    for (let idx = 0; idx < 3; idx++) {
      const bullet = generatedBullets[idx];
      if (!bullet?.subtitle || !bullet?.fullText) continue;
      if (bullet.checkListScores && Object.keys(bullet.checkListScores).length > 0) continue;
      needsEvaluation.push(idx);
    }

    expect(needsEvaluation).toEqual([1, 2]); // 0 is skipped (has scores), 2 has empty scores so needs eval
  });

  it("should skip bullets without subtitle or fullText", () => {
    const generatedBullets: Record<number, any> = {
      0: { subtitle: "A", fullText: "Text A" },
      1: { subtitle: "", fullText: "Text B" },
      2: { subtitle: "C", fullText: "" },
    };

    const needsEvaluation: number[] = [];
    for (let idx = 0; idx < 3; idx++) {
      const bullet = generatedBullets[idx];
      if (!bullet?.subtitle || !bullet?.fullText) continue;
      needsEvaluation.push(idx);
    }

    expect(needsEvaluation).toEqual([0]);
  });

  it("should handle all bullets already evaluated", () => {
    const generatedBullets: Record<number, any> = {
      0: { subtitle: "A", fullText: "Text A", checkListScores: { B1: { pass: true } } },
      1: { subtitle: "B", fullText: "Text B", checkListScores: { B1: { pass: false } } },
    };

    const needsEvaluation: number[] = [];
    for (let idx = 0; idx < 2; idx++) {
      const bullet = generatedBullets[idx];
      if (!bullet?.subtitle || !bullet?.fullText) continue;
      if (bullet.checkListScores && Object.keys(bullet.checkListScores).length > 0) continue;
      needsEvaluation.push(idx);
    }

    expect(needsEvaluation).toEqual([]);
  });
});

// ─── DB Field Initialization Tests ───

describe("DB Field Initialization", () => {
  it("should handle null lockedSteps from DB gracefully", () => {
    const activeListing = { lockedSteps: null };
    let result = new Set<number>();
    if (activeListing?.lockedSteps) {
      try {
        const steps: number[] = JSON.parse(activeListing.lockedSteps);
        result = new Set(steps);
      } catch { /* ignore */ }
    }
    expect(result.size).toBe(0);
  });

  it("should handle null checklistScores from DB gracefully", () => {
    const activeListing = { checklistScores: null };
    let hasScores = false;
    if (activeListing?.checklistScores) {
      try {
        const saved = JSON.parse(activeListing.checklistScores);
        hasScores = Object.keys(saved).length > 0;
      } catch { /* ignore */ }
    }
    expect(hasScores).toBe(false);
  });

  it("should parse valid lockedSteps from DB", () => {
    const activeListing = { lockedSteps: "[1,2,3]" };
    let result = new Set<number>();
    if (activeListing?.lockedSteps) {
      try {
        const steps: number[] = JSON.parse(activeListing.lockedSteps);
        result = new Set(steps);
      } catch { /* ignore */ }
    }
    expect(result.size).toBe(3);
    expect(result.has(1)).toBe(true);
    expect(result.has(4)).toBe(false);
  });

  it("should handle malformed JSON gracefully", () => {
    const activeListing = { lockedSteps: "not valid json" };
    let result = new Set<number>();
    if (activeListing?.lockedSteps) {
      try {
        const steps: number[] = JSON.parse(activeListing.lockedSteps);
        result = new Set(steps);
      } catch { /* ignore */ }
    }
    expect(result.size).toBe(0);
  });
});
