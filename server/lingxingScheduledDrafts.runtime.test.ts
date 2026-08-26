import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock, createCallerMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  createCallerMock: vi.fn(),
}));

vi.mock("./repositories/dbClient", () => ({ getDb: getDbMock }));
vi.mock("./routers/lingxingSync", () => ({
  lingxingSyncRouter: { createCaller: createCallerMock },
}));

import { runLingxingScheduledDraft, validateDailyAutoApplyIntegrity } from "./domains/ops/lingxingScheduledDrafts";

type ScheduleRow = {
  id: number;
  workspaceId: number;
  ownerUserId: number;
  dataDomain: "product_performance_daily" | "parent_asin_weekly_rollup";
  autoApply?: number;
  lastRunKey: string | null;
  lastStatus: string | null;
};

function createMockDb(scheduleRows: ScheduleRow[], ownerRows: Array<Record<string, unknown>> = [], batchRows: Array<Record<string, unknown>> = [], draftRows: Array<Record<string, unknown>> = []) {
  const selectResults = [scheduleRows, ownerRows, batchRows, draftRows];
  let selectIndex = 0;
  const updates: Array<Record<string, unknown>> = [];
  const queryResult = (rows: Array<Record<string, unknown>>) => ({
    then: (resolve: (value: Array<Record<string, unknown>>) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    limit: async (count: number) => rows.slice(0, count),
  });
  const db = {
    select: () => ({
      from: () => ({
        where: () => queryResult(selectResults[selectIndex++] ?? []),
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

  it("每日自动应用只在完整性校验通过后确认并追加日快照", async () => {
    const autoSchedule = { ...dailySchedule, autoApply: 1 };
    const readyBatch = { id: 42, status: "ready_for_review", summary: { capped: false, pageTruncations: 0, datesRead: 1, storesExpected: 9, storesRead: 9, storeDateWindowsExpected: 9, storeDateWindowsRead: 9 }, scope: {} };
    const readyRows = [{ id: 101, entityKey: "7392|US|B0AUTO|2026-08-24", validationErrors: [], normalizedData: { storeId: "7392", country: "US", asin: "B0AUTO", parentAsin: "PARENTAUTO", reportDate: "2026-08-24", salesQty: 3, adSpend: 1.2 }, sourceData: {} }];
    const { db, updates } = createMockDb([autoSchedule], [{ id: 1, role: "super_admin", organizationId: null, defaultWorkspaceId: 1 }], [readyBatch], readyRows);
    getDbMock.mockResolvedValue(db);
    const createPreview = vi.fn().mockResolvedValue({ batchId: 42, status: "ready_for_review" });
    const confirm = vi.fn().mockResolvedValue({ success: true });
    const applyConfirmedProductInventory = vi.fn().mockResolvedValue({ importId: 660002, importedRows: 1, skippedRows: 0 });
    createCallerMock.mockReturnValue({ createPreview, confirm, applyConfirmedProductInventory });

    const result = await runLingxingScheduledDraft("daily-task", new Date("2026-08-25T09:00:00.000Z"));

    expect(result).toMatchObject({ ok: true, batchId: 42, writePolicy: "validated_daily_auto_apply" });
    expect(confirm).toHaveBeenCalledWith({ batchId: 42, selectedRowIds: [101], note: "系统每日校验通过自动确认" });
    expect(applyConfirmedProductInventory).toHaveBeenCalledWith({ batchId: 42, note: "系统每日校验通过自动追加日快照" });
    expect(updates.some((value) => value.lastStatus === "succeeded" && value.lastBatchId === 42)).toBe(true);
  });

  it("每日草稿出现分页截断时转人工失败，不确认也不应用", async () => {
    const autoSchedule = { ...dailySchedule, autoApply: 1 };
    const cappedBatch = { id: 42, status: "ready_for_review", summary: { capped: true, pageTruncations: 1, datesRead: 1, storesExpected: 9, storesRead: 9, storeDateWindowsExpected: 9, storeDateWindowsRead: 9 }, scope: {} };
    const { db, updates } = createMockDb([autoSchedule], [{ id: 1, role: "super_admin", organizationId: null, defaultWorkspaceId: 1 }], [cappedBatch], []);
    getDbMock.mockResolvedValue(db);
    const createPreview = vi.fn().mockResolvedValue({ batchId: 42, status: "ready_for_review" });
    const confirm = vi.fn();
    const applyConfirmedProductInventory = vi.fn();
    createCallerMock.mockReturnValue({ createPreview, confirm, applyConfirmedProductInventory });

    await expect(runLingxingScheduledDraft("daily-task", new Date("2026-08-25T09:00:00.000Z"))).rejects.toThrow("自动应用校验未通过");
    expect(confirm).not.toHaveBeenCalled();
    expect(applyConfirmedProductInventory).not.toHaveBeenCalled();
    expect(updates.some((value) => value.lastStatus === "failed")).toBe(true);
  });

  it("每日草稿相较前一日出现异常跃升时转人工，不进入自动确认", () => {
    const batch = { id: 42, status: "ready_for_review", summary: { capped: false, pageTruncations: 0, datesRead: 1, storesExpected: 1, storesRead: 1, storeDateWindowsExpected: 1, storeDateWindowsRead: 1 }, scope: {} };
    const rows = [{ id: 101, entityKey: "7392|US|B0AUTO|2026-08-24", validationErrors: [], normalizedData: { storeId: "7392", country: "US", asin: "B0AUTO", parentAsin: "PARENTAUTO", reportDate: "2026-08-24", salesQty: 20_000 }, sourceData: {} }];
    const previous = [{ sourceStoreId: "7392", country: "US", asin: "B0AUTO", reportDate: "2026-08-23", salesQty: 1, orderQty: 0, salesAmount: 0, adSpend: 0, sessionsTotal: 0 }];

    expect(() => validateDailyAutoApplyIntegrity(batch, rows, { startDate: "2026-08-24", endDate: "2026-08-24" }, previous as any)).toThrow("异常跃升");
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
