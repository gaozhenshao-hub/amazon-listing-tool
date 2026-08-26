import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  batch: null as any,
  rows: [] as any[],
  snapshots: [] as any[],
  weekly: [] as any[],
  imports: [] as any[],
  confirmations: [] as any[],
  schedules: [] as any[],
  heartbeatCreates: [] as any[],
  heartbeatUpdates: [] as any[],
  selectCount: 0,
  toolCallCount: 0,
  largePageMode: false,
};

function tableName(table: any) {
  return table?.[Symbol.for("drizzle:Name")];
}

function queryResult(rows: any[]) {
  return {
    then: (resolve: (value: any[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    limit: async (count: number) => rows.slice(0, count),
  };
}

const db = {
  select: () => ({
    from: (table: any) => ({
      where: () => {
        if (tableName(table) === "ops_lingxing_sync_schedules") return queryResult(state.schedules);
        state.selectCount += 1;
        if (state.selectCount === 1) return queryResult([]); // existing day snapshots during preview
        if (state.selectCount === 2) return queryResult(state.batch ? [state.batch] : []); // confirm batch
        if (state.selectCount === 3) return queryResult(state.batch ? [state.batch] : []); // apply batch
        return queryResult(state.rows.filter((row) => row.selected === 1)); // apply selected rows
      },
    }),
  }),
  insert: (table: any) => ({
    values: (input: any) => {
      const name = tableName(table);
      if (name === "ops_external_sync_batches") {
        state.batch = { id: 9901, ...input };
        const result: any = Promise.resolve(undefined);
        result.$returningId = async () => [{ id: 9901 }];
        return result;
      }
      if (name === "ops_external_sync_rows") state.rows.push(...(Array.isArray(input) ? input.map((row) => ({ id: state.rows.length + 1, ...row })) : [{ id: state.rows.length + 1, ...input }]));
      if (name === "data_imports") {
        state.imports.push({ id: 7701, ...input });
        const result: any = Promise.resolve(undefined);
        result.$returningId = async () => [{ id: 7701 }];
        return result;
      }
      if (name === "ops_asin_daily_snapshots") state.snapshots.push(input);
      if (name === "lingxing_product_weekly") state.weekly.push(input);
      if (name === "ops_external_sync_confirmations") state.confirmations.push(input);
      if (name === "ops_lingxing_sync_schedules") state.schedules.push({ id: state.schedules.length + 1, ...input });
      return Promise.resolve(undefined);
    },
  }),
  update: (table: any) => ({
    set: (patch: any) => ({
      where: async () => {
        const name = tableName(table);
        if (name === "ops_external_sync_batches" && state.batch) Object.assign(state.batch, patch);
        if (name === "ops_external_sync_rows" && patch.selected === 0) state.rows.forEach((row) => { row.selected = 0; row.rowStatus = "skipped"; });
        if (name === "ops_external_sync_rows" && patch.selected === 1) state.rows.forEach((row) => { row.selected = 1; });
        if (name === "ops_external_sync_rows" && patch.rowStatus === "applied") state.rows.forEach((row) => { row.rowStatus = "applied"; });
        if (name === "ops_lingxing_sync_schedules" && state.schedules[0]) Object.assign(state.schedules[0], patch);
      },
    }),
  }),
};

vi.mock("./repositories/dbClient", () => ({ getDb: async () => db }));
vi.mock("./domains/ops/workspaceProcedure", async () => {
  const base = await import("./_core/trpc");
  return { protectedProcedure: base.protectedProcedure };
});
vi.mock("./domains/ops/workspaceContext", () => ({ currentOpsWorkspaceId: () => 1, runWithOpsWorkspace: async (_scope: unknown, operation: () => unknown) => operation() }));
vi.mock("./domains/ops/services/securityGovernance", () => ({
  actorFromContext: () => ({}), workspaceIdFromContext: (ctx: any) => ctx.user.defaultWorkspaceId,
  assertResourceAction: async () => undefined, recordSecurityAuditLog: async () => undefined,
}));
vi.mock("./domains/ai_os/services/runLedger", () => ({ ensureAgentRunTrace: async () => undefined }));
vi.mock("./domains/ai_os/services/artifactLifecycle", () => ({ registerUnifiedArtifact: async () => ({ ref: "artifact://ops/lingxing-raw", storageUri: "s3://ops/lingxing-raw.json" }) }));
vi.mock("./domains/ai_os/services/toolGateway/executors", () => ({
  invokeEmperorTool: async () => {
    state.toolCallCount += 1;
    const list = state.largePageMode
      ? Array.from({ length: 200 }, (_, index) => ({ asin: `B0PAGE${state.toolCallCount.toString().padStart(2, "0")}${index.toString().padStart(3, "0")}`, parent_asins: [{ parent_asin: `PARENT${state.toolCallCount}` }], volume: 1 }))
      : [
          { asin: "-", rdate: "2026-08-10" },
          { asin: "B0DAY001", parent_asins: [{ parent_asin: "PARENT01" }], rdate: "2026-08-10", volume: 3, order_items: 2, amount: "58.20", gross_profit: "12.10", spend: "4.20", ad_sales_amount: "20.10", ad_order_quantity: 1, nature_order_items: 1, sessions_total: 20, clicks: 4, impressions: 100, return_count: 1 },
        ];
    return { output: { content: [{ type: "text", text: JSON.stringify({ list }) }] }, metadata: { toolRunId: `tool_daily_${state.toolCallCount}` } };
  },
}));
vi.mock("./_core/heartbeat", () => ({
  createHeartbeatJob: async (input: any) => {
    state.heartbeatCreates.push(input);
    return { taskUid: "heartbeat_daily_1", nextExecutionAt: "2026-08-26T09:00:00.000Z" };
  },
  updateHeartbeatJob: async (taskUid: string, input: any) => {
    state.heartbeatUpdates.push({ taskUid, input });
    return { nextExecutionAt: "2026-08-27T09:00:00.000Z" };
  },
}));

const { lingxingSyncRouter } = await import("./routers/lingxingSync");

describe("领星ASIN日数据同步路由", () => {
  beforeEach(() => {
    state.batch = null; state.rows = []; state.snapshots = []; state.weekly = []; state.imports = []; state.confirmations = []; state.schedules = []; state.heartbeatCreates = []; state.heartbeatUpdates = []; state.selectCount = 0; state.toolCallCount = 0; state.largePageMode = false;
  });

  it("预览、确认和应用仅追加可追溯日快照，过滤占位ASIN且不写周度产品表", async () => {
    const caller = lingxingSyncRouter.createCaller({ user: { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } } as any);
    const preview = await caller.createPreview({ dataDomain: "product_performance_daily", scope: { storeId: "7392", startDate: "2026-08-10", endDate: "2026-08-10", marketplace: "US" } });
    expect(preview.totalRows).toBe(1);
    expect(state.batch.summary).toMatchObject({ totalRead: 1, placeholderRows: 1, datesRead: 1 });
    expect(state.rows[0].normalizedData).toMatchObject({ asin: "B0DAY001", parentAsin: "PARENT01", reportDate: "2026-08-10" });

    await caller.confirm({ batchId: preview.batchId, selectedRowIds: [state.rows[0].id] });
    const applied = await caller.applyConfirmedProductInventory({ batchId: preview.batchId });
    expect(applied.importedRows).toBe(1);
    expect(state.weekly).toEqual([]);
    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0]).toMatchObject({ sourceStoreId: "7392", sourceBatchHash: state.batch.rawResponseHash, sourceRowHash: expect.any(String), importId: 7701, reportDate: "2026-08-10", asin: "B0DAY001" });
    expect(state.batch).toMatchObject({ rawResponseHash: state.snapshots[0].sourceBatchHash, toolRunId: expect.stringMatching(/^tool_daily_/), traceId: expect.stringMatching(/^ops_lingxing_sync_/) });
    expect(state.confirmations.map((item) => item.action)).toEqual(["confirm", "apply"]);
  });

  it("多页预览累积有效ASIN并在5000行上限触发时记录分页摘要", async () => {
    state.largePageMode = true;
    const caller = lingxingSyncRouter.createCaller({ user: { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } } as any);
    const preview = await caller.createPreview({ dataDomain: "product_performance_daily", scope: { storeId: "7392", startDate: "2026-08-10", endDate: "2026-08-12", marketplace: "US" } });
    expect(preview.totalRows).toBe(5000);
    expect(state.rows).toHaveLength(5000);
    expect(state.batch.summary).toMatchObject({ totalRead: 5000, placeholderRows: 0, capped: true, pageTruncations: 2, datesRead: 3 });
  });

  it("计划管理创建、暂停和恢复同一Heartbeat任务，并固定为只生成草稿", async () => {
    const caller = lingxingSyncRouter.createCaller({ user: { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null }, req: { headers: { cookie: "session=operator" } } } as any);
    const enabled = await caller.setScheduleEnabled({ dataDomain: "product_performance_daily", enabled: true });
    expect(enabled).toMatchObject({ enabled: true, taskUid: "heartbeat_daily_1", writePolicy: "draft_only" });
    expect(state.heartbeatCreates[0]).toMatchObject({ cron: "0 0 9 * * *", path: "/api/scheduled/lingxing-sync-draft" });
    expect(state.schedules[0]).toMatchObject({ dataDomain: "product_performance_daily", enabled: 1, scheduleCronTaskUid: "heartbeat_daily_1" });

    await caller.setScheduleEnabled({ dataDomain: "product_performance_daily", enabled: false });
    await caller.setScheduleEnabled({ dataDomain: "product_performance_daily", enabled: true });
    expect(state.heartbeatCreates).toHaveLength(1);
    expect(state.heartbeatUpdates.map((item) => item.input.enable)).toEqual([false, true]);
  });
});
