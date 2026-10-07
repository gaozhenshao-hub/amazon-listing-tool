import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  eq: vi.fn((column: unknown, workspaceId: unknown) => ({ column, workspaceId })),
  count: vi.fn(() => "count"),
  sql: vi.fn(() => "aggregate"),
}));

vi.mock("../../repositories/dbClient", () => ({ getDb: mocks.getDb }));
vi.mock("drizzle-orm", () => ({
  count: mocks.count,
  eq: mocks.eq,
  sql: mocks.sql,
}));

import {
  AMERICAN_ENGLISH_INSUFFICIENT_SAMPLE_MESSAGE,
  readQualityDashboard,
} from "./qualityDashboardService";

function mockedDatabase(rows: Array<Record<string, number>[]>) {
  const where = vi.fn(() => Promise.resolve(rows.shift() ?? []));
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where })),
    })),
    where,
  };
}

describe("quality dashboard aggregate service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes every aggregate to the authenticated workspace and returns counts/ratios only", async () => {
    const database = mockedDatabase([
      [{ totalCount: 12, humanConfirmedCount: 8 }],
      [{ totalCount: 3, humanConfirmedCount: 2 }],
      [{ totalCount: 5 }],
      [{ humanReviewedCandidateCount: 4, recordedDecisionCount: 5 }],
      [{ totalCount: 4, humanReviewedCount: 3 }],
      [{ totalCount: 2, humanReviewedCount: 2 }],
      [{ totalRunCount: 10, succeededRunCount: 6, failedRunCount: 2, activeRunCount: 1, canceledRunCount: 1, completedRunCount: 9 }],
    ]);

    const result = await readQualityDashboard({ workspaceId: 41, database });

    expect(mocks.eq).toHaveBeenCalledTimes(7);
    expect(mocks.eq.mock.calls.map(([, workspaceId]) => workspaceId)).toEqual([41, 41, 41, 41, 41, 41, 41]);
    expect(result).toEqual({
      listing: {
        factHumanConfirmation: { numeratorCount: 8, denominatorCount: 12, ratio: 8 / 12 },
        coreHumanConfirmation: { numeratorCount: 2, denominatorCount: 3, ratio: 2 / 3 },
        candidateHumanReview: { numeratorCount: 4, denominatorCount: 5, ratio: 4 / 5, recordedDecisionCount: 5 },
      },
      image: {
        policyHumanReview: { numeratorCount: 3, denominatorCount: 4, ratio: 3 / 4 },
        licenseEvidenceHumanReview: { numeratorCount: 2, denominatorCount: 2, ratio: 1 },
      },
      operations: {
        totalRunCount: 10,
        succeededRunCount: 6,
        failedRunCount: 2,
        activeRunCount: 1,
        canceledRunCount: 1,
        completedRunSuccessRatio: 6 / 9,
      },
      americanEnglishHumanReview: {
        sampleCount: 0,
        message: AMERICAN_ENGLISH_INSUFFICIENT_SAMPLE_MESSAGE,
      },
    });

    const serialized = JSON.stringify(result);
    for (const forbiddenValue of ["ASIN", "fullText", "storageKey", "storageUri", "url", "userId", "confirmedBy"]) {
      expect(serialized).not.toContain(forbiddenValue);
    }
  });

  it("does not turn an empty denominator or a gate/run record into American-English human review", async () => {
    const database = mockedDatabase(Array.from({ length: 7 }, () => [{ totalCount: 0, completedRunCount: 0 }]));

    const result = await readQualityDashboard({ workspaceId: 5, database });

    expect(result.listing.factHumanConfirmation.ratio).toBe(0);
    expect(result.operations.completedRunSuccessRatio).toBe(0);
    expect(result.americanEnglishHumanReview).toEqual({
      sampleCount: 0,
      message: "样本不足，不能判断美语质量",
    });
  });

  it("rejects a missing workspace before querying and reports an unavailable database explicitly", async () => {
    await expect(readQualityDashboard({ workspaceId: 0, database: mockedDatabase([]) })).rejects.toMatchObject({ code: "FORBIDDEN" });

    mocks.getDb.mockResolvedValue(null);
    await expect(readQualityDashboard({ workspaceId: 7 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "质量仪表盘暂不可用",
    });
  });
});
