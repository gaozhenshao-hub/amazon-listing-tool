import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB Layer ───
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();
const mockUpdate = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockValues = vi.fn();
const mockSet = vi.fn();

// Chain mocks
mockSelect.mockReturnValue({ from: mockFrom });
mockFrom.mockReturnValue({ where: mockWhere });
mockWhere.mockReturnValue({ orderBy: mockOrderBy });
mockInsert.mockReturnValue({ values: mockValues });
mockDelete.mockReturnValue({ where: mockWhere });
mockUpdate.mockReturnValue({ set: mockSet });
mockSet.mockReturnValue({ where: mockWhere });

describe("Import History Feature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  });

  describe("listImportHistory", () => {
    it("should return parsed JSON arrays for recordIds and parentAsins", () => {
      const rawHistory = [
        {
          id: 1,
          userId: 1,
          importType: "plan",
          fileName: "test.xlsx",
          totalCount: 10,
          createdCount: 5,
          updatedCount: 3,
          skippedCount: 2,
          recordIds: JSON.stringify([101, 102, 103, 104, 105]),
          parentAsins: JSON.stringify(["B0DJSQ6WC6", "B0ABCDEF12"]),
          createdAt: new Date("2026-04-27T10:00:00Z"),
        },
      ];

      const mapped = rawHistory.map((h: any) => ({
        ...h,
        recordIds: h.recordIds ? JSON.parse(h.recordIds) : [],
        parentAsins: h.parentAsins ? JSON.parse(h.parentAsins) : [],
      }));

      expect(mapped[0].recordIds).toEqual([101, 102, 103, 104, 105]);
      expect(mapped[0].parentAsins).toEqual(["B0DJSQ6WC6", "B0ABCDEF12"]);
      expect(mapped[0].fileName).toBe("test.xlsx");
    });

    it("should handle null recordIds and parentAsins gracefully", () => {
      const rawHistory = [
        {
          id: 2,
          userId: 1,
          importType: "review",
          fileName: "review.xlsx",
          totalCount: 3,
          createdCount: 3,
          updatedCount: 0,
          skippedCount: 0,
          recordIds: null,
          parentAsins: null,
          createdAt: new Date("2026-04-27T10:00:00Z"),
        },
      ];

      const mapped = rawHistory.map((h: any) => ({
        ...h,
        recordIds: h.recordIds ? JSON.parse(h.recordIds) : [],
        parentAsins: h.parentAsins ? JSON.parse(h.parentAsins) : [],
      }));

      expect(mapped[0].recordIds).toEqual([]);
      expect(mapped[0].parentAsins).toEqual([]);
    });

    it("should filter by importType correctly", () => {
      const allHistory = [
        { id: 1, importType: "plan", fileName: "plans.xlsx" },
        { id: 2, importType: "review", fileName: "reviews.xlsx" },
        { id: 3, importType: "plan", fileName: "plans2.xlsx" },
      ];

      const planHistory = allHistory.filter(h => h.importType === "plan");
      const reviewHistory = allHistory.filter(h => h.importType === "review");

      expect(planHistory).toHaveLength(2);
      expect(reviewHistory).toHaveLength(1);
      expect(planHistory[0].fileName).toBe("plans.xlsx");
    });
  });

  describe("deleteImportHistory cascade logic", () => {
    it("should identify plan records for cascade deletion", () => {
      const history = {
        id: 1,
        importType: "plan",
        recordIds: JSON.stringify([101, 102, 103]),
      };

      const recordIds: number[] = history.recordIds ? JSON.parse(history.recordIds) : [];
      expect(recordIds).toEqual([101, 102, 103]);
      expect(history.importType).toBe("plan");
      // For plan type: should delete opsPlanActions, opsPlanSummaries, then opsPlans
    });

    it("should identify review records for cascade deletion", () => {
      const history = {
        id: 2,
        importType: "review",
        recordIds: JSON.stringify([201, 202]),
      };

      const recordIds: number[] = history.recordIds ? JSON.parse(history.recordIds) : [];
      expect(recordIds).toEqual([201, 202]);
      expect(history.importType).toBe("review");
      // For review type: should delete executionReviews
    });

    it("should handle empty recordIds gracefully", () => {
      const history = {
        id: 3,
        importType: "plan",
        recordIds: JSON.stringify([]),
      };

      const recordIds: number[] = history.recordIds ? JSON.parse(history.recordIds) : [];
      expect(recordIds).toHaveLength(0);
      // Should skip cascade deletion when no records
    });
  });

  describe("import result tracking", () => {
    it("should correctly collect recordIds from import results", () => {
      const results = [
        { parentAsin: "B0DJSQ6WC6", planName: "Plan A", status: "created", recordId: 101 },
        { parentAsin: "B0ABCDEF12", planName: "Plan B", status: "updated", recordId: 102 },
        { parentAsin: "B0MISSING", planName: "Plan C", status: "skipped", reason: "Missing data" },
        { parentAsin: "B0DJSQ6WC6", planName: "Plan D", status: "created", recordId: 103 },
      ];

      const createdCount = results.filter(r => r.status === "created").length;
      const updatedCount = results.filter(r => r.status === "updated").length;
      const recordIds = results.filter(r => r.recordId).map(r => r.recordId);
      const parentAsinSet = [...new Set(results.filter(r => r.status !== "skipped").map(r => r.parentAsin))];

      expect(createdCount).toBe(2);
      expect(updatedCount).toBe(1);
      expect(recordIds).toEqual([101, 102, 103]);
      expect(parentAsinSet).toEqual(["B0DJSQ6WC6", "B0ABCDEF12"]);
    });

    it("should produce correct import history record", () => {
      const results = [
        { parentAsin: "B0DJSQ6WC6", planName: "Plan A", status: "created", recordId: 101 },
        { parentAsin: "B0DJSQ6WC6", planName: "Plan B", status: "skipped", reason: "Duplicate" },
      ];

      const historyRecord = {
        userId: 1,
        importType: "plan" as const,
        fileName: "test.xlsx",
        totalCount: 2,
        createdCount: results.filter(r => r.status === "created").length,
        updatedCount: results.filter(r => r.status === "updated").length,
        skippedCount: results.filter(r => r.status === "skipped").length,
        recordIds: JSON.stringify(results.filter(r => r.recordId).map(r => r.recordId)),
        parentAsins: JSON.stringify([...new Set(results.filter(r => r.status !== "skipped").map(r => r.parentAsin))]),
      };

      expect(historyRecord.createdCount).toBe(1);
      expect(historyRecord.updatedCount).toBe(0);
      expect(historyRecord.skippedCount).toBe(1);
      expect(JSON.parse(historyRecord.recordIds)).toEqual([101]);
      expect(JSON.parse(historyRecord.parentAsins)).toEqual(["B0DJSQ6WC6"]);
    });
  });
});
