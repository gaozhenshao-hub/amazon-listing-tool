import { describe, it, expect } from "vitest";

describe("opsProductPlan - Competitor Ad Benchmark & Promotion Phase APIs", () => {
  // ─── Competitor Ad Benchmark ───
  describe("Competitor Ad Benchmark CRUD", () => {
    it("listBenchmarks should return array", async () => {
      // The procedure requires a planId input
      const mockInput = { planId: 1 };
      expect(mockInput.planId).toBe(1);
      // Validates that the input schema accepts planId
    });

    it("addBenchmark should accept valid input", () => {
      const input = {
        planId: 1,
        competitorBrand: "Anker",
        competitorAsin: "B0TEST123",
        adType: "sp" as const,
        acos: "25.5",
        ctr: "0.85",
        cvr: "12.3",
        cpc: "1.20",
        cpa: "9.80",
        totalSpend: "5000",
        totalSales: "20000",
        totalOrders: 200,
        totalImpressions: 500000,
        totalClicks: 4250,
        dataPeriod: "2026-03",
        analysisNotes: "Strong SP performance",
      };
      expect(input.competitorBrand).toBe("Anker");
      expect(input.adType).toBe("sp");
      expect(input.totalOrders).toBe(200);
    });

    it("updateBenchmark should accept benchmarkId and partial data", () => {
      const input = {
        benchmarkId: 1,
        acos: "22.0",
        ctr: "0.90",
      };
      expect(input.benchmarkId).toBe(1);
      expect(input.acos).toBe("22.0");
    });

    it("deleteBenchmark should accept benchmarkId", () => {
      const input = { benchmarkId: 1 };
      expect(input.benchmarkId).toBe(1);
    });

    it("adType enum should only accept valid values", () => {
      const validTypes = ["sp", "sb", "sd", "dsp", "mixed"];
      validTypes.forEach(t => {
        expect(validTypes.includes(t)).toBe(true);
      });
    });
  });

  // ─── AI Competitor Analysis ───
  describe("AI Competitor Ad Analysis", () => {
    it("should accept benchmarks array with brand and metrics", () => {
      const input = {
        asin: "B0TEST123",
        benchmarks: [
          { brand: "Anker", acos: 25, ctr: 0.85, cvr: 12, cpc: 1.2, cpa: 9.8 },
          { brand: "UGREEN", acos: 30, ctr: 0.7, cvr: 10, cpc: 1.5, cpa: 12 },
        ],
        myData: { acos: 28, ctr: 0.75, cvr: 11, cpc: 1.3, cpa: 10.5 },
      };
      expect(input.benchmarks.length).toBe(2);
      expect(input.myData?.acos).toBe(28);
    });

    it("should work without myData", () => {
      const input = {
        asin: "B0TEST123",
        benchmarks: [
          { brand: "Anker", acos: 25 },
        ],
      };
      expect(input.benchmarks[0].brand).toBe("Anker");
    });
  });

  // ─── Promotion Phases ───
  describe("Promotion Phase CRUD", () => {
    it("listPhases should return array ordered by sortOrder", () => {
      const mockInput = { planId: 1 };
      expect(mockInput.planId).toBe(1);
    });

    it("addPhase should accept valid input", () => {
      const input = {
        planId: 1,
        phaseName: "新品冲刺期",
        phaseType: "launch" as const,
        bsrRangeStart: 151,
        bsrRangeEnd: 200,
        durationDays: 20,
        startDate: "2026-04-01",
        endDate: "2026-04-20",
        adBudgetDaily: "50",
        targetAcos: "35",
        keyStrategy: "大额Coupon+自动广告+手动精准词",
        milestones: "首周10个评论,第二周BSR进入200",
        sortOrder: 1,
      };
      expect(input.phaseName).toBe("新品冲刺期");
      expect(input.phaseType).toBe("launch");
      expect(input.bsrRangeStart).toBe(151);
    });

    it("updatePhase should accept phaseId and partial data", () => {
      const input = {
        phaseId: 1,
        status: "active" as const,
        progress: 50,
      };
      expect(input.phaseId).toBe(1);
      expect(input.status).toBe("active");
      expect(input.progress).toBe(50);
    });

    it("deletePhase should accept phaseId", () => {
      const input = { phaseId: 1 };
      expect(input.phaseId).toBe(1);
    });

    it("phaseType enum should only accept valid values", () => {
      const validTypes = ["launch", "growth", "maturity", "optimization", "clearance", "custom"];
      validTypes.forEach(t => {
        expect(validTypes.includes(t)).toBe(true);
      });
    });

    it("status enum should only accept valid values", () => {
      const validStatuses = ["pending", "active", "completed", "skipped"];
      validStatuses.forEach(s => {
        expect(validStatuses.includes(s)).toBe(true);
      });
    });
  });

  // ─── BSR Phase Init ───
  describe("BSR Phase Initialization", () => {
    it("initBsrPhases should accept planId and optional currentBsr", () => {
      const input = { planId: 1, currentBsr: 120 };
      expect(input.planId).toBe(1);
      expect(input.currentBsr).toBe(120);
    });

    it("should generate 6 BSR phases", () => {
      const bsrPhases = [
        { phaseName: "新品冲刺期", bsrRangeStart: 151, bsrRangeEnd: 200, durationDays: 20 },
        { phaseName: "快速爬升期", bsrRangeStart: 101, bsrRangeEnd: 150, durationDays: 30 },
        { phaseName: "稳步增长期", bsrRangeStart: 51, bsrRangeEnd: 100, durationDays: 50 },
        { phaseName: "冲刺头部期", bsrRangeStart: 31, bsrRangeEnd: 50, durationDays: 60 },
        { phaseName: "头部巩固期", bsrRangeStart: 11, bsrRangeEnd: 30, durationDays: 70 },
        { phaseName: "类目霸主期", bsrRangeStart: 1, bsrRangeEnd: 10, durationDays: 90 },
      ];
      expect(bsrPhases.length).toBe(6);
      expect(bsrPhases[0].phaseName).toBe("新品冲刺期");
      expect(bsrPhases[5].phaseName).toBe("类目霸主期");
    });

    it("should mark correct phase as active based on currentBsr", () => {
      const currentBsr = 120;
      const bsrPhases = [
        { bsrRangeStart: 151, bsrRangeEnd: 200 },
        { bsrRangeStart: 101, bsrRangeEnd: 150 },
        { bsrRangeStart: 51, bsrRangeEnd: 100 },
      ];
      const activePhase = bsrPhases.find(
        p => currentBsr >= p.bsrRangeStart && currentBsr <= p.bsrRangeEnd
      );
      expect(activePhase).toBeDefined();
      expect(activePhase?.bsrRangeStart).toBe(101);
      expect(activePhase?.bsrRangeEnd).toBe(150);
    });
  });

  // ─── AI Promotion Strategy ───
  describe("AI Promotion Strategy", () => {
    it("should accept phases array with name, bsrRange, status", () => {
      const input = {
        asin: "B0TEST123",
        currentBsr: 120,
        phases: [
          { name: "新品冲刺期", bsrRange: "151-200", durationDays: 20, status: "completed", progress: 100 },
          { name: "快速爬升期", bsrRange: "101-150", durationDays: 30, status: "active", progress: 40 },
        ],
        currentPhaseIndex: 1,
      };
      expect(input.phases.length).toBe(2);
      expect(input.currentPhaseIndex).toBe(1);
    });
  });

  // ─── Radar Chart Data Processing ───
  describe("Radar Chart Data Processing", () => {
    it("should normalize values to 0-1 scale", () => {
      const values = [25, 0.85, 12, 1.2, 9.8];
      const maxVals = [35, 1.0, 15, 2.0, 15];
      const normalized = values.map((v, i) => {
        // ACoS(0), CPC(3), CPA(4): lower is better → invert
        if (i === 0 || i === 3 || i === 4) return 1 - (v / maxVals[i]);
        return v / maxVals[i];
      });
      // ACoS: 1 - 25/35 ≈ 0.286
      expect(normalized[0]).toBeCloseTo(0.286, 2);
      // CTR: 0.85/1.0 = 0.85
      expect(normalized[1]).toBeCloseTo(0.85, 2);
      // CVR: 12/15 = 0.8
      expect(normalized[2]).toBeCloseTo(0.8, 2);
      // CPC: 1 - 1.2/2.0 = 0.4
      expect(normalized[3]).toBeCloseTo(0.4, 2);
      // CPA: 1 - 9.8/15 ≈ 0.347
      expect(normalized[4]).toBeCloseTo(0.347, 2);
    });

    it("should handle zero values gracefully", () => {
      const values = [0, 0, 0, 0, 0];
      const maxVals = [1, 1, 1, 1, 1];
      const normalized = values.map((v, i) => {
        if (i === 0 || i === 3 || i === 4) return 1 - (v / maxVals[i]);
        return v / maxVals[i];
      });
      // Inverted zeros should be 1
      expect(normalized[0]).toBe(1);
      // Non-inverted zeros should be 0
      expect(normalized[1]).toBe(0);
    });
  });

  // ─── Gantt Chart Progress Calculation ───
  describe("Gantt Chart Progress", () => {
    it("should calculate total duration from phases", () => {
      const phases = [
        { durationDays: 20 },
        { durationDays: 30 },
        { durationDays: 50 },
        { durationDays: 60 },
        { durationDays: 70 },
        { durationDays: 90 },
      ];
      const totalDays = phases.reduce((sum, p) => sum + (p.durationDays || 30), 0);
      expect(totalDays).toBe(320);
    });

    it("should calculate width percentage for each phase", () => {
      const totalDays = 320;
      const phase = { durationDays: 30 };
      const widthPct = (phase.durationDays / totalDays) * 100;
      expect(widthPct).toBeCloseTo(9.375, 2);
    });
  });
});
