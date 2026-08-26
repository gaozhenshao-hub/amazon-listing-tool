import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock, createCallerMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  createCallerMock: vi.fn(),
}));

vi.mock("./repositories/dbClient", () => ({ getDb: getDbMock }));
vi.mock("./routers/lingxingSync", () => ({
  lingxingSyncRouter: { createCaller: createCallerMock },
}));

import { runLingxingScheduledDraft } from "./domains/ops/lingxingScheduledDrafts";

type ScheduleRow = {
  id: number;
  workspaceId: number;
  ownerUserId: number;
  dataDomain: "product_performance_daily" | "parent_asin_weekly_rollup";
  lastRunKey: string | null;
  lastStatus: string | null;
};

function createMockDb(scheduleRows: ScheduleRow[], ownerRows: Array<Record<string, unknown>> = []) {
  const selectResults = [scheduleRows, ownerRows];
  let selectIndex = 0;
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectResults[selectIndex++] ?? [],
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: async () => undefined };
      },
    }),
    inserts: vi.fn(),
  };
  return { db, updates };
}

const dailySchedule: ScheduleRow = {
  id: 7,
  workspaceId: 1,
  ownerUserId: 1,
  dataDomain: "product_performance_daily",
  lastRunKey: null,
  lastStatus: null,
};

describe("领星Heartbeat草稿运行", () => {
  beforeEach(() => {
    getDbMock.mockReset();
    createCallerMock.mockReset();
  });

  it("每日回调只调用既有草稿预览入口并记录待审核批次，不应用日快照", async () => {
    const { db, updates } = createMockDb([dailySchedule], [{ id: 1, role: "super_admin", organizationId: null, defaultWorkspaceId: 1 }]);
    getDbMock.mockResolvedValue(db);
    const createPreview = vi.fn().mockResolvedValue({ batchId: 42, status: "ready_for_review" });
    createCallerMock.mockReturnValue({ createPreview });

    const result = await runLingxingScheduledDraft("daily-task", new Date("2026-08-25T09:00:00.000Z"));

    expect(result).toMatchObject({ ok: true, batchId: 42, runKey: "daily:2026-08-24", writePolicy: "draft_only" });
    expect(createPreview).toHaveBeenCalledWith({
      dataDomain: "product_performance_daily",
      scope: { storeId: "ALL_US", marketplace: "US", startDate: "2026-08-24", endDate: "2026-08-24" },
    });
    expect(db.inserts).not.toHaveBeenCalled();
    expect(updates.some((value) => value.lastStatus === "succeeded" && value.lastBatchId === 42)).toBe(true);
  });

  it("相同运行键成功后跳过重复运行，不再读取MCP或创建草稿", async () => {
    const { db } = createMockDb([{ ...dailySchedule, lastRunKey: "daily:2026-08-24", lastStatus: "succeeded" }]);
    getDbMock.mockResolvedValue(db);

    const result = await runLingxingScheduledDraft("daily-task", new Date("2026-08-25T09:00:00.000Z"));

    expect(result).toEqual({ ok: true, skipped: "idempotent", runKey: "daily:2026-08-24" });
    expect(createCallerMock).not.toHaveBeenCalled();
  });

  it("创建者缺失时回写失败摘要且不会调用草稿预览", async () => {
    const { db, updates } = createMockDb([dailySchedule], []);
    getDbMock.mockResolvedValue(db);

    await expect(runLingxingScheduledDraft("daily-task", new Date("2026-08-25T09:00:00.000Z"))).rejects.toThrow("计划创建者不存在或已删除");

    expect(createCallerMock).not.toHaveBeenCalled();
    expect(updates.some((value) => value.lastStatus === "failed" && String(value.lastError).includes("计划创建者不存在"))).toBe(true);
  });
});
