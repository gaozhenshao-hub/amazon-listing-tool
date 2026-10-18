import { z } from "zod";
import {
  SaihuReportCoverageSchema,
  SaihuReportDailyRowSchema,
  SaihuReportScopeSchema,
  SAIHU_DAILY_FIELDS,
  saihuReportDailyKey,
  saihuReportHash,
  saihuReportWeek,
  type SaihuReportDailyRow,
  type SaihuReportIdentity,
} from "../../../shared/saihuReportSync";
import { saihuReportFail } from "./saihuReportContract";
import type { SaihuReportProjectedProduct } from "../../../shared/saihuReportProjection";
import {
  readSaihuReportPublication,
  readSaihuReportRun,
  readSaihuReportStartReceipt,
} from "./saihuReportProtocol";
import {
  saihuReportJson,
  saihuReportRows,
  type SaihuReportExecutor,
} from "./saihuReportStore";

export type SaihuDailyBatch = {
  id: number;
  userId: number;
  operationId: string;
  runId: string;
  status: "previewing" | "completed" | "revoked";
  sourceHash: string;
  previewHash: string;
  scope: z.infer<typeof SaihuReportScopeSchema>;
  coverage: z.infer<typeof SaihuReportCoverageSchema>;
  facts: SaihuReportDailyRow[];
};
export async function readSaihuDailyBatches(
  tx: SaihuReportExecutor,
  workspaceId: number,
  window?: { start: string; end: string }
): Promise<SaihuDailyBatch[]> {
  // Complete metadata keyset, not a lifetime 200-batch ceiling. Only bodies
  // belonging to the requested window consume its retained-byte budget.
  // The caller holds the workspace write fence for the whole transaction.
  const found: Record<string, unknown>[] = [];
  let retainedBytes = 0;
  let cursor: number | null = null;
  for (;;) {
    const page = await saihuReportRows(
      tx,
      `SELECT id,workspace_id AS workspaceId,user_id AS userId,run_id AS runId,operation_id AS operationId,status,source_hash AS sourceHash,preview_hash AS previewHash,IF(OCTET_LENGTH(CAST(scope AS CHAR CHARACTER SET utf8mb4))<=4096,CAST(scope AS CHAR CHARACTER SET utf8mb4),NULL) AS scope FROM ops_saihu_daily_report_batches WHERE workspace_id=?${cursor === null ? "" : " AND id<?"} ORDER BY id DESC LIMIT 128 FOR UPDATE`,
      [workspaceId, ...(cursor === null ? [] : [cursor])],
      128
    );
    for (const hint of page) {
      if (
        typeof hint.id !== "number" ||
        !Number.isSafeInteger(hint.id) ||
        hint.id < 1 ||
        (cursor !== null && hint.id >= cursor) ||
        hint.workspaceId !== workspaceId ||
        typeof hint.userId !== "number" ||
        typeof hint.operationId !== "string" ||
        typeof hint.runId !== "string" ||
        !["previewing", "completed", "revoked"].includes(String(hint.status))
      )
        return saihuReportFail("DAILY_BATCH_INVALID");
      cursor = hint.id;
      const scope = SaihuReportScopeSchema.parse(
        saihuReportJson(hint.scope, 4096)
      );
      if (scope.kind !== "daily") return saihuReportFail("DAILY_BATCH_INVALID");
      const run = await readSaihuReportRun(
        tx,
        { workspaceId, userId: hint.userId },
        hint.operationId
      );
      if (
        !run ||
        run.runId !== hint.runId ||
        run.output.batchId !== hint.id ||
        run.output.sourceHash !== hint.sourceHash ||
        run.output.previewHash !== hint.previewHash ||
        saihuReportHash(run.input.request.scope) !== saihuReportHash(scope)
      )
        return saihuReportFail("DAILY_REPLAY_MISMATCH");
      await readSaihuReportStartReceipt(tx, run);
      if (window && (scope.start > window.end || scope.end < window.start))
        continue;
      const body = await saihuReportRows(
        tx,
        "SELECT id,workspace_id AS workspaceId,user_id AS userId,run_id AS runId,operation_id AS operationId,status,source_hash AS sourceHash,preview_hash AS previewHash,IF(OCTET_LENGTH(CAST(scope AS CHAR CHARACTER SET utf8mb4))<=4096,CAST(scope AS CHAR CHARACTER SET utf8mb4),NULL) AS scope,IF(OCTET_LENGTH(CAST(coverage AS CHAR CHARACTER SET utf8mb4))<=1048576,CAST(coverage AS CHAR CHARACTER SET utf8mb4),NULL) AS coverage,IF(OCTET_LENGTH(CAST(facts AS CHAR CHARACTER SET utf8mb4))<=16777216,CAST(facts AS CHAR CHARACTER SET utf8mb4),NULL) AS facts FROM ops_saihu_daily_report_batches WHERE workspace_id=? AND id=? LIMIT 2 FOR UPDATE",
        [workspaceId, hint.id],
        2
      );
      if (
        body.length !== 1 ||
        body[0].id !== hint.id ||
        body[0].status !== hint.status ||
        saihuReportHash(saihuReportJson(body[0].scope, 4096)) !==
          saihuReportHash(scope)
      )
        return saihuReportFail("DAILY_BATCH_CHANGED");
      retainedBytes +=
        Buffer.byteLength(String(body[0].facts)) +
        Buffer.byteLength(String(body[0].coverage));
      if (retainedBytes > 32 * 1024 * 1024)
        return saihuReportFail("HISTORY_BUDGET");
      found.push(body[0]);
    }
    if (page.length < 128) break;
  }
  let bytes = 0,
    previous = Infinity;
  const result: SaihuDailyBatch[] = [];
  for (const row of found) {
    if (
      typeof row.id !== "number" ||
      row.id < 1 ||
      row.id >= previous ||
      row.workspaceId !== workspaceId ||
      typeof row.userId !== "number" ||
      row.userId < 1 ||
      typeof row.operationId !== "string" ||
      typeof row.runId !== "string" ||
      !["previewing", "completed", "revoked"].includes(String(row.status))
    )
      return saihuReportFail("DAILY_BATCH_INVALID");
    previous = row.id;
    bytes +=
      Buffer.byteLength(String(row.facts)) +
      Buffer.byteLength(String(row.coverage));
    if (bytes > 32 * 1024 * 1024) return saihuReportFail("HISTORY_BUDGET");
    const scope = SaihuReportScopeSchema.parse(
        saihuReportJson(row.scope, 4096)
      ),
      coverage = SaihuReportCoverageSchema.parse(
        saihuReportJson(row.coverage, 1048576)
      ),
      facts = z
        .array(SaihuReportDailyRowSchema)
        .max(10000)
        .parse(saihuReportJson(row.facts, 16777216)),
      proof = await readSaihuReportPublication(
        tx,
        { workspaceId, userId: row.userId },
        row.operationId
      );
    if (
      scope.kind !== "daily" ||
      row.runId !== proof.run.runId ||
      row.sourceHash !== proof.preview.sourceHash ||
      row.previewHash !== proof.preview.previewHash ||
      saihuReportHash(scope) !== saihuReportHash(proof.preview.scope) ||
      saihuReportHash(coverage) !== saihuReportHash(proof.preview.coverage) ||
      saihuReportHash(facts) !== saihuReportHash(proof.preview.dailyRows)
    )
      return saihuReportFail("DAILY_REPLAY_MISMATCH");
    result.push({
      id: row.id,
      userId: row.userId,
      operationId: row.operationId,
      runId: row.runId,
      status: row.status as SaihuDailyBatch["status"],
      sourceHash: String(row.sourceHash),
      previewHash: String(row.previewHash),
      scope,
      coverage,
      facts,
    });
  }
  return result;
}
const shopDay = (period: string, shop: SaihuReportDailyRow["shop"]) =>
  JSON.stringify([shop.shopId, shop.storeName, shop.country, period]);
export function selectSaihuDailyVersions(batches: SaihuDailyBatch[]) {
  const winners = new Map<string, SaihuDailyBatch>();
  for (const batch of [...batches].sort((a, b) => b.id - a.id))
    if (batch.status === "completed") {
      if (!batch.coverage.complete || batch.coverage.blockingReasons.length)
        return saihuReportFail("INCOMPLETE_COMPLETED_BATCH");
      for (const expected of batch.coverage.expected) {
        const key = shopDay(expected.period, expected.shop);
        if (!winners.has(key)) winners.set(key, batch);
      }
    }
  const rows = batches.flatMap(batch =>
    batch.status === "completed"
      ? batch.facts
          .filter(
            row => winners.get(shopDay(row.period, row.shop))?.id === batch.id
          )
          .map(row => ({
            ...row,
            batchId: batch.id,
            sourceHash: batch.sourceHash,
          }))
      : []
  );
  if (new Set(rows.map(saihuReportDailyKey)).size !== rows.length)
    return saihuReportFail("DUPLICATE_ACTIVE_FACT");
  return { winners, rows };
}
/** Missing historical nonzero identities are not silently treated as zeros.
 * A documented explicit-empty shop response is the only empty-scope exception. */
export function assertSaihuDailyReplacement(
  batches: SaihuDailyBatch[],
  incoming: SaihuDailyBatch
) {
  if (!incoming.coverage.complete || incoming.coverage.blockingReasons.length)
    return saihuReportFail("COVERAGE_INCOMPLETE");
  const existing = selectSaihuDailyVersions(batches).rows,
    incomingKeys = new Set(incoming.facts.map(saihuReportDailyKey)),
    scopes = new Set(
      incoming.coverage.expected.map(value => shopDay(value.period, value.shop))
    ),
    empties = new Set(
      incoming.coverage.observed
        .filter(value => value.explicitEmpty)
        .map(value => shopDay(value.period, value.shop))
    );
  for (const row of existing)
    if (
      scopes.has(shopDay(row.period, row.shop)) &&
      !incomingKeys.has(saihuReportDailyKey(row)) &&
      !empties.has(shopDay(row.period, row.shop)) &&
      Object.values(row.metrics).some(value => value !== null && value !== 0)
    )
      return saihuReportFail("MISSING_PREVIOUS_NONZERO_IDENTITY");
  for (const batch of batches)
    if (
      batch.id > incoming.id &&
      batch.status === "completed" &&
      batch.coverage.expected.some(value =>
        scopes.has(shopDay(value.period, value.shop))
      )
    )
      return saihuReportFail("NEWER_BATCH_ALREADY_EFFECTIVE");
}
const sum = (
  rows: SaihuReportDailyRow[],
  key: (typeof SAIHU_DAILY_FIELDS)[number]
) =>
  rows.some(row => row.metrics[key] === null)
    ? null
    : rows.reduce((total, row) => total + row.metrics[key]!, 0);
const ratio = (a: number | null, b: number | null, scale = 100) =>
  a === null || b === null || b <= 0 ? null : (a / b) * scale;
/** Shop/site are part of the grouping key. Original source parents are never
 * rewritten to a later parent, and point-in-time ratings are not summed daily. */
export function buildSaihuDailyOverview(
  batches: SaihuDailyBatch[],
  marketplace = "ALL",
  weeksToShow = 12
): SaihuReportProjectedProduct[] {
  const active = selectSaihuDailyVersions(batches),
    groups = new Map<string, typeof active.rows>();
  for (const row of active.rows) {
    if (marketplace !== "ALL" && marketplace !== row.shop.country) continue;
    const key = JSON.stringify([
      row.shop.shopId,
      row.shop.storeName,
      row.shop.country,
      row.parentAsin,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([identityKey, rows]) => {
    const info = [...rows].sort((a, b) => b.period.localeCompare(a.period))[0],
      weekGroups = new Map<string, typeof rows>();
    for (const row of rows) {
      const week = saihuReportWeek(row.period).weekStartDate;
      weekGroups.set(week, [...(weekGroups.get(week) ?? []), row]);
    }
    const weeks = [...weekGroups]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, weeksToShow)
      .map(([weekStartDate, rows]) => {
        const { weekEndDate } = saihuReportWeek(weekStartDate),
          days = Array.from({ length: 7 }, (_, i) =>
            new Date(Date.parse(weekStartDate) + i * 86400000)
              .toISOString()
              .slice(0, 10)
          ),
          missingDates = days.filter(
            day => !active.winners.has(shopDay(day, info.shop))
          ),
          metrics = Object.fromEntries(
            SAIHU_DAILY_FIELDS.map(key => [key, sum(rows, key)])
          ) as SaihuReportDailyRow["metrics"];
        const latest = new Map<string, (typeof rows)[number]>();
        for (const row of rows)
          if (
            !latest.has(row.asin) ||
            latest.get(row.asin)!.period < row.period
          )
            latest.set(row.asin, row);
        const snapshots = [...latest.values()],
          reviewCount = sum(snapshots, "ratingCount"),
          rating =
            snapshots.some(
              row =>
                row.metrics.rating === null || row.metrics.ratingCount === null
            ) || !reviewCount
              ? null
              : snapshots.reduce(
                  (total, row) =>
                    total + row.metrics.rating! * row.metrics.ratingCount!,
                  0
                ) / reviewCount;
        return {
          id: 0,
          weekStartDate,
          weekEndDate,
          reportingCalendar: "saturday_friday" as const,
          sourceKind: "saihu_daily_controlled" as const,
          currency: "USD",
          complete: !missingDates.length,
          coveredDays: 7 - missingDates.length,
          missingDates,
          sourceBatchIds: [...new Set(rows.map(row => row.batchId))],
          salesTrend: null,
          salesQty: metrics.salesQty,
          orderQty: metrics.orderQty,
          salesAmount: metrics.salesAmount,
          orderProfit: metrics.grossProfit,
          profitMargin: ratio(metrics.grossProfit, metrics.salesAmount),
          sessionTotal: metrics.sessionsTotal,
          totalCvr: ratio(metrics.orderQty, metrics.sessionsTotal),
          adCvr: ratio(metrics.adOrders, metrics.adClicks),
          organicCvr: ratio(metrics.organicOrders, metrics.organicClicks),
          adOrders: metrics.adOrders,
          organicOrders: metrics.organicOrders,
          adClicks: metrics.adClicks,
          ctr: ratio(metrics.adClicks, metrics.adImpressions),
          adImpressions: metrics.adImpressions,
          cpc: ratio(metrics.adSpend, metrics.adClicks, 1),
          adSpend: metrics.adSpend,
          adSales: metrics.adSalesAmount,
          acos: ratio(metrics.adSpend, metrics.adSalesAmount),
          rating,
          reviewCount,
          returnRate: ratio(metrics.returnQty, metrics.salesQty),
          wow: null,
        };
      });
    return {
      id: 0,
      identityKey,
      parentAsin: info.parentAsin,
      title: info.title,
      chineseName: null,
      brand: null,
      category: null,
      marketplace: info.shop.country,
      imageUrl: null,
      status: "active",
      operator: info.operator,
      storeName: info.shop.storeName,
      shopId: info.shop.shopId,
      variantCount: new Set(rows.map(row => row.asin)).size,
      skus: [...new Set(rows.map(row => row.sku).filter(Boolean))],
      basicInfo: null,
      weeks,
      monthlySummaries: [],
      sourceKind: "saihu_daily_controlled",
      reportingCalendar: "saturday_friday",
      originalParentAttribution: true,
      variants: [
        ...new Map(
          [...rows]
            .sort((a, b) => a.period.localeCompare(b.period))
            .map(row => [row.asin, row])
        ).values(),
      ].map(row => ({
        id: 0,
        childAsin: row.asin,
        sku: row.sku || null,
        title: row.title || null,
        price: null,
        status: "active" as const,
      })),
    };
  });
}
/** Old weekly writers have no durable protocol and can delete success rows.
 * Once a workspace has a controlled daily version, it must use this new lane;
 * the old artifacts/rows remain readable and are never physically deleted. */
export async function assertSaihuLegacyWriterAllowed(
  tx: SaihuReportExecutor,
  workspaceId: number
) {
  const tables = await saihuReportRows(
    tx,
    "SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ops_saihu_daily_report_batches'",
    [],
    1
  );
  if (!tables.length) return;
  if (tables[0].engine !== "InnoDB")
    return saihuReportFail("SCHEMA_UNAVAILABLE");
  if (
    (
      await saihuReportRows(
        tx,
        "SELECT id FROM ops_saihu_daily_report_batches WHERE workspace_id=? AND status IN ('completed','revoked') LIMIT 1 FOR SHARE",
        [workspaceId],
        1
      )
    ).length
  )
    return saihuReportFail("USE_CONTROLLED_SAIHU_REPORT_LANE");
}
