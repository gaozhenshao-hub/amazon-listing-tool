import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock, createCallerMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  createCallerMock: vi.fn(),
}));

vi.mock("./repositories/dbClient", () => ({ getDb: getDbMock }));
vi.mock("./routers/lingxingSync", () => ({
  lingxingSyncRouter: { createCaller: createCallerMock },
}));

import { runLingxingScheduledDraft, validateDailyAutoApplyIntegrity, validateHistoricalBackfillIntegrity, validateInventoryAutoApplyIntegrity, validateKeywordAutoApplyIntegrity } from "./domains/ops/lingxingScheduledDrafts";

type ScheduleRow = {
  id: number;
  workspaceId: number;
  ownerUserId: number;
  dataDomain: "product_performance_daily" | "fba_inventory" | "ad_keyword" | "parent_asin_weekly_rollup";
  autoApply?: number;
  lastRunKey: string | null;
  lastStatus: string | null;
};

function createMockDb(scheduleRows: ScheduleRow[], ownerRows: Array<Record<string, unknown>> = [], batchRows: Array<Record<string, unknown>> = [], draftRows: Array<Record<string, unknown>> = []) {
  const emperorTasks = scheduleRows.map((schedule) => ({ id: schedule.id + 1000, externalTaskUid: `${schedule.dataDomain === "fba_inventory" ? "inventory" : schedule.dataDomain === "ad_keyword" ? "keyword" : "daily"}-task`, externalScheduleId: schedule.id, systemManaged: 1, isActive: 1 }));
  const selectResults = [emperorTasks, scheduleRows, ownerRows, batchRows, draftRows, []];
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
    expect(confirm).toHaveBeenCalledWith({ batchId: 42, selectedRowIds: [101], note: "系统product_performance_daily每日校验通过自动确认" });
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

  it("每日库存快照仅在全店覆盖、身份与非负库存指标均有效时自动追加", async () => {
    const schedule = { ...dailySchedule, dataDomain: "fba_inventory" as const, autoApply: 1 };
    const readyBatch = { id: 43, status: "ready_for_review", summary: { capped: false, pageTruncations: 0, storesExpected: 2, storesRead: 2, storeDateWindowsExpected: 2, storeDateWindowsRead: 2, needsReview: 0 }, scope: {} };
    const readyRows = [{ id: 102, entityKey: "7392|fba_inventory|B0INV|SKU-1|2026-08-25", validationErrors: [], normalizedData: { storeId: "7392", country: "US", asin: "B0INV", parentAsin: "PARENTINV", reportDate: "2026-08-25", fbaAvailable: 8, fbaReserved: 1, fbaInTransit: 2 }, sourceData: {} }];
    const { db } = createMockDb([schedule], [{ id: 1, role: "super_admin", organizationId: null, defaultWorkspaceId: 1 }], [readyBatch], readyRows);
    getDbMock.mockResolvedValue(db);
    const createPreview = vi.fn().mockResolvedValue({ batchId: 43 });
    const confirm = vi.fn().mockResolvedValue({ success: true });
    const applyConfirmedProductInventory = vi.fn().mockResolvedValue({ importId: 660003, importedRows: 1 });
    createCallerMock.mockReturnValue({ createPreview, confirm, applyConfirmedProductInventory });

    const result = await runLingxingScheduledDraft("inventory-task", new Date("2026-08-25T09:20:00.000Z"));

    expect(result).toMatchObject({ ok: true, batchId: 43, runKey: "inventory:2026-08-25", writePolicy: "validated_daily_auto_apply" });
    expect(createPreview).toHaveBeenCalledWith({ dataDomain: "fba_inventory", scope: { storeId: "ALL_US", profileId: undefined, marketplace: "US", startDate: "2026-08-25", endDate: "2026-08-25" } });
    expect(confirm).toHaveBeenCalledWith({ batchId: 43, selectedRowIds: [102], note: "系统fba_inventory每日校验通过自动确认" });
    expect(applyConfirmedProductInventory).toHaveBeenCalledWith({ batchId: 43, note: "系统每日库存校验通过自动追加库存快照" });
  });

  it("每日广告关键词仅在全Profile完整读取且字段有效时自动追加历史事实", async () => {
    const schedule = { ...dailySchedule, dataDomain: "ad_keyword" as const, autoApply: 1 };
    const readyBatch = { id: 44, status: "ready_for_review", summary: { capped: false, pageTruncations: 0, storesExpected: 2, storesRead: 2, storeDateWindowsExpected: 2, storeDateWindowsRead: 2, needsReview: 0 }, scope: {} };
    const readyRows = [{ id: 103, entityKey: "P-1|ad_keyword|C-1|power bank|exact|2026-08-24|2026-08-24", validationErrors: [], normalizedData: { profileId: "P-1", campaignName: "SP-Core", campaignId: "C-1", keyword: "power bank", matchType: "exact", periodStart: "2026-08-24", periodEnd: "2026-08-24", adImpressions: 100, adClicks: 4, adSpend: 2.1, adSales: 20, adOrders: 1 }, sourceData: {} }];
    const { db } = createMockDb([schedule], [{ id: 1, role: "super_admin", organizationId: null, defaultWorkspaceId: 1 }], [readyBatch], readyRows);
    getDbMock.mockResolvedValue(db);
    const createPreview = vi.fn().mockResolvedValue({ batchId: 44 });
    const confirm = vi.fn().mockResolvedValue({ success: true });
    const applyConfirmedAds = vi.fn().mockResolvedValue({ importId: 770001, importedRows: 1 });
    createCallerMock.mockReturnValue({ createPreview, confirm, applyConfirmedAds });

    const result = await runLingxingScheduledDraft("keyword-task", new Date("2026-08-25T09:40:00.000Z"));

    expect(result).toMatchObject({ ok: true, batchId: 44, runKey: "keyword:2026-08-24", writePolicy: "validated_daily_auto_apply" });
    expect(createPreview).toHaveBeenCalledWith({ dataDomain: "ad_keyword", scope: { storeId: "ALL_US_AD_PROFILES", profileId: "ALL_US_AD_PROFILES", marketplace: "US", startDate: "2026-08-24", endDate: "2026-08-24" } });
    expect(confirm).toHaveBeenCalledWith({ batchId: 44, selectedRowIds: [103], note: "系统ad_keyword每日校验通过自动确认" });
    expect(applyConfirmedAds).toHaveBeenCalledWith({ batchId: 44, note: "系统每日关键词校验通过自动追加历史事实" });
  });

  it("库存和关键词自动应用对覆盖、负库存及缺失Profile保持阻断", () => {
    const inventoryBatch = { id: 45, status: "ready_for_review", summary: { capped: false, pageTruncations: 0, storesExpected: 2, storesRead: 1, storeDateWindowsExpected: 2, storeDateWindowsRead: 1, needsReview: 0 }, scope: {} };
    const inventoryRow = { id: 104, entityKey: "7392|fba_inventory|B0INV|SKU-1|2026-08-25", validationErrors: [], normalizedData: { storeId: "7392", country: "US", asin: "B0INV", parentAsin: "PARENTINV", reportDate: "2026-08-25", fbaAvailable: 8, fbaReserved: 1, fbaInTransit: 2 }, sourceData: {} };
    expect(() => validateInventoryAutoApplyIntegrity(inventoryBatch, [inventoryRow], { startDate: "2026-08-25", endDate: "2026-08-25" })).toThrow("授权范围覆盖不完整");
    expect(() => validateInventoryAutoApplyIntegrity({ ...inventoryBatch, summary: { ...inventoryBatch.summary, storesRead: 2, storeDateWindowsRead: 2 } }, [{ ...inventoryRow, normalizedData: { ...inventoryRow.normalizedData, fbaAvailable: -1 } }], { startDate: "2026-08-25", endDate: "2026-08-25" })).toThrow("fbaAvailable存在无效或负数指标");
    expect(() => validateInventoryAutoApplyIntegrity({ ...inventoryBatch, summary: { ...inventoryBatch.summary, storesRead: 2, storeDateWindowsRead: 2 } }, [{ ...inventoryRow, normalizedData: { ...inventoryRow.normalizedData, fbaAvailable: 50_000 } }], { startDate: "2026-08-25", endDate: "2026-08-25" }, [{ sourceStoreId: "7392", country: "US", asin: "B0INV", reportDate: "2026-08-24", fbaAvailable: 1, fbaReserved: 1, fbaInTransit: 1 }] as any)).toThrow("fbaAvailable相较前一日异常跃升");
    const keywordBatch = { id: 46, status: "ready_for_review", summary: { capped: false, pageTruncations: 0, storesExpected: 1, storesRead: 1, storeDateWindowsExpected: 1, storeDateWindowsRead: 1, needsReview: 0 }, scope: {} };
    const keywordRow = { id: 105, entityKey: "bad", validationErrors: [], normalizedData: { campaignName: "SP-Core", keyword: "power bank", periodStart: "2026-08-24", periodEnd: "2026-08-24" }, sourceData: {} };
    expect(() => validateKeywordAutoApplyIntegrity(keywordBatch, [keywordRow], { startDate: "2026-08-24", endDate: "2026-08-24" })).toThrow("缺失Profile");
    const validKeyword = { ...keywordRow, normalizedData: { ...keywordRow.normalizedData, profileId: "P-1", adImpressions: 50_000, adClicks: 1, adSpend: 1, adSales: 2, adOrders: 1 } };
    expect(() => validateKeywordAutoApplyIntegrity(keywordBatch, [validKeyword], { startDate: "2026-08-24", endDate: "2026-08-24" }, [{ sourceProfileId: "P-1", campaignName: "SP-Core", keyword: "power bank", matchType: "unknown", impressions: 1, clicks: 1, spend: 1, sales: 2 }])).toThrow("adImpressions相较前一日异常跃升");
  });

  it("每日草稿相较前一日出现异常跃升时转人工，不进入自动确认", () => {
    const batch = { id: 42, status: "ready_for_review", summary: { capped: false, pageTruncations: 0, datesRead: 1, storesExpected: 1, storesRead: 1, storeDateWindowsExpected: 1, storeDateWindowsRead: 1 }, scope: {} };
    const rows = [{ id: 101, entityKey: "7392|US|B0AUTO|2026-08-24", validationErrors: [], normalizedData: { storeId: "7392", country: "US", asin: "B0AUTO", parentAsin: "PARENTAUTO", reportDate: "2026-08-24", salesQty: 20_000 }, sourceData: {} }];
    const previous = [{ sourceStoreId: "7392", country: "US", asin: "B0AUTO", reportDate: "2026-08-23", salesQty: 1, orderQty: 0, salesAmount: 0, adSpend: 0, sessionsTotal: 0 }];

    expect(() => validateDailyAutoApplyIntegrity(batch, rows, { startDate: "2026-08-24", endDate: "2026-08-24" }, previous as any)).toThrow("异常跃升");
  });

  it("每日草稿允许负利润表示真实亏损，但持续拒绝负数业务事实和非有限利润", () => {
    const batch = { id: 42, status: "ready_for_review", summary: { capped: false, pageTruncations: 0, datesRead: 1, storesExpected: 1, storesRead: 1, storeDateWindowsExpected: 1, storeDateWindowsRead: 1 }, scope: {} };
    const base = { id: 101, entityKey: "7392|US|B0LOSS|2026-08-24", validationErrors: [], normalizedData: { storeId: "7392", country: "US", asin: "B0LOSS", parentAsin: "PARENTLOSS", reportDate: "2026-08-24", salesQty: 3, orderProfit: -12.5 }, sourceData: {} };

    expect(() => validateDailyAutoApplyIntegrity(batch, [base], { startDate: "2026-08-24", endDate: "2026-08-24" })).not.toThrow();
    expect(() => validateDailyAutoApplyIntegrity(batch, [{ ...base, normalizedData: { ...base.normalizedData, salesQty: -1 } }], { startDate: "2026-08-24", endDate: "2026-08-24" })).toThrow("salesQty存在无效或负数指标");
    expect(() => validateDailyAutoApplyIntegrity(batch, [{ ...base, normalizedData: { ...base.normalizedData, orderProfit: "NaN" } }], { startDate: "2026-08-24", endDate: "2026-08-24" })).toThrow("orderProfit存在无效指标");
  });

  it("历史回补仅在全店全日期覆盖、身份唯一且字段有效时自动应用", () => {
    const batch = { id: 43, status: "ready_for_review", summary: { capped: false, pageTruncations: 0, datesRead: 2, storesExpected: 1, storesRead: 1, storeDateWindowsExpected: 2, storeDateWindowsRead: 2 }, scope: {} };
    const rows = [
      { id: 1, entityKey: "7392|US|B0HISTORY|2026-08-01", validationErrors: [], normalizedData: { storeId: "7392", country: "US", asin: "B0HISTORY", parentAsin: "PARENTHISTORY", reportDate: "2026-08-01", salesQty: 1, orderProfit: -2 }, sourceData: {} },
      { id: 2, entityKey: "7392|US|B0HISTORY|2026-08-02", validationErrors: [], normalizedData: { storeId: "7392", country: "US", asin: "B0HISTORY", parentAsin: "PARENTHISTORY", reportDate: "2026-08-02", salesQty: 2, orderProfit: 1 }, sourceData: {} },
    ];
    expect(() => validateHistoricalBackfillIntegrity(batch, rows, { startDate: "2026-08-01", endDate: "2026-08-02" })).not.toThrow();
    expect(() => validateHistoricalBackfillIntegrity({ ...batch, summary: { ...batch.summary, storeDateWindowsRead: 1 } }, rows, { startDate: "2026-08-01", endDate: "2026-08-02" })).toThrow("店铺日期窗口覆盖不完整");
    expect(() => validateHistoricalBackfillIntegrity(batch, [{ ...rows[0], entityKey: rows[1].entityKey }, rows[1]], { startDate: "2026-08-01", endDate: "2026-08-02" })).toThrow("重复或缺失");
    expect(() => validateHistoricalBackfillIntegrity({ ...batch, summary: { ...batch.summary, capped: true } }, rows, { startDate: "2026-08-01", endDate: "2026-08-02" })).toThrow("分页或行数截断");
    expect(() => validateHistoricalBackfillIntegrity({ ...batch, summary: { ...batch.summary, pageTruncations: 1 } }, rows, { startDate: "2026-08-01", endDate: "2026-08-02" })).toThrow("分页或行数截断");
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

  it("皇帝任务映射暂停时安全跳过，不读取MCP也不创建批次", async () => {
    const { db } = createMockDb([dailySchedule]);
    const originalSelect = db.select;
    let calls = 0;
    db.select = () => ({ from: () => ({ where: () => ({ then: (resolve: any) => Promise.resolve(calls++ === 0 ? [{ id: 1007, externalTaskUid: "daily-task", externalScheduleId: 7, systemManaged: 1, isActive: 0 }] : []).then(resolve), limit: async () => calls++ === 1 ? [{ id: 1007, externalTaskUid: "daily-task", externalScheduleId: 7, systemManaged: 1, isActive: 0 }] : [] }) }) });
    getDbMock.mockResolvedValue(db);

    await expect(runLingxingScheduledDraft("daily-task", new Date("2026-08-25T09:00:00.000Z"))).resolves.toEqual({ ok: true, skipped: "orphan_or_paused" });
    expect(createCallerMock).not.toHaveBeenCalled();
    db.select = originalSelect;
  });
});
