import { getTableColumns } from "drizzle-orm";
import { saihuProductWeekly } from "../../../drizzle/schema/ops";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import {
  saihuReportHash,
  type SaihuReportIdentity,
} from "../../../shared/saihuReportSync";
import {
  saihuReportRows,
  saihuReportJson,
  authorizeSaihuReport,
} from "./saihuReportStore";
import {
  assertSaihuLegacyWriterAllowed,
  buildSaihuDailyOverview,
  readSaihuDailyBatches,
  selectSaihuDailyVersions,
} from "./saihuReportDaily";
import { saihuReportFail } from "./saihuReportContract";
import { assertResourceAction } from "../../services/securityGovernance";
import { splitExternalOperatorNames } from "./operatorNameResolution";
import type {
  SaihuReportProjectedProduct,
  SaihuReportProjectedWeek,
} from "../../../shared/saihuReportProjection";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export async function withSaihuLegacyWrite<T>(
  db: Database,
  identity: SaihuReportIdentity,
  body: (tx: DbExecutor) => Promise<T>
) {
  return db.transaction(async tx => {
    await authorizeSaihuReport(tx, identity, "update");
    if (process.env.ENABLE_SAIHU_REPORT_WRITES === "true")
      return saihuReportFail("USE_CONTROLLED_SAIHU_REPORT_LANE");
    await assertSaihuLegacyWriterAllowed(tx, identity.workspaceId);
    return body(tx);
  });
}
/** Complete legacy row fingerprints participate in the new source/history CAS.
 * Exact workspace only: NULL-workspace rows are not silently adopted. */
export async function readSaihuLegacyRows(tx: DbExecutor, workspaceId: number) {
  const cols = Object.entries(getTableColumns(saihuProductWeekly)),
    actual = await saihuReportRows(
      tx,
      "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='saihu_product_weekly' ORDER BY ORDINAL_POSITION",
      [],
      300
    );
  if (
    actual.length !== cols.length ||
    new Set(actual.map(row => row.name)).size !== cols.length ||
    actual.some(row => !cols.some(([, column]) => column.name === row.name))
  )
    return saihuReportFail("LEGACY_SOURCE_SCHEMA_UNVERIFIED");
  const entries = cols
      .map(([key, column]) => {
        if (
          !/^[A-Za-z][A-Za-z0-9_]*$/u.test(key) ||
          !/^[A-Za-z][A-Za-z0-9_]*$/u.test(column.name)
        )
          return saihuReportFail("LEGACY_SOURCE_SCHEMA_UNVERIFIED");
        return `'${key}',\`${column.name}\``;
      })
      .join(","),
    found = await saihuReportRows(
      tx,
      `SELECT id,IF(OCTET_LENGTH(CAST(JSON_OBJECT(${entries}) AS CHAR CHARACTER SET utf8mb4))<=1048576,CAST(JSON_OBJECT(${entries}) AS CHAR CHARACTER SET utf8mb4),NULL) AS content FROM saihu_product_weekly WHERE workspaceId=? ORDER BY id DESC LIMIT 10001 FOR SHARE`,
      [workspaceId],
      10001
    );
  if (found.length > 10000) return saihuReportFail("LEGACY_SOURCE_BUDGET");
  let total = 0;
  return found.map(row => {
    total += Buffer.byteLength(String(row.content));
    if (total > 16 * 1024 * 1024)
      return saihuReportFail("LEGACY_SOURCE_BUDGET");
    const value = saihuReportJson(row.content, 1048576);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      (value as Record<string, unknown>).id !== row.id ||
      (value as Record<string, unknown>).workspaceId !== workspaceId
    )
      return saihuReportFail("LEGACY_SOURCE_INVALID");
    return value as Record<string, unknown>;
  });
}
export async function saihuLegacyHistoryHash(
  tx: DbExecutor,
  workspaceId: number
) {
  return saihuReportHash(await readSaihuLegacyRows(tx, workspaceId));
}
const number = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" &&
    !(typeof value === "string" && /^-?\d+(?:\.\d+)?$/u.test(value))
  )
    return saihuReportFail("LEGACY_METRIC_INVALID");
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER)
    return saihuReportFail("LEGACY_METRIC_INVALID");
  return n;
};
const ratio = (a: number | null, b: number | null, scale = 100) =>
  a === null || b === null || b <= 0 ? null : (a / b) * scale;
export function combineSaihuLegacyOverview(
  daily: ReturnType<typeof buildSaihuDailyOverview>,
  legacy: Record<string, unknown>[],
  covered: Array<{ period: string; storeName: string; country: string }>,
  userId: number,
  marketplace: string,
  weeks: number
) {
  const excluded: Array<{
      storeName: string;
      country: string;
      weekStartDate: string;
      weekEndDate: string;
      coveredDates: string[];
      missingDates: string[];
      reason: string;
    }> = [],
    groups = new Map<string, Record<string, unknown>[]>();
  for (const row of legacy) {
    if (row.userId !== userId) continue;
    const country = normalizeMarketplaceCode(String(row.site ?? "")),
      storeName = String(row.storeName ?? ""),
      start = String(row.weekStartDate),
      end = String(row.weekEndDate);
    if (marketplace !== "ALL" && country !== marketplace) continue;
    const dates = covered
      .filter(
        value =>
          value.storeName === storeName &&
          value.country === country &&
          value.period >= start &&
          value.period <= end
      )
      .map(value => value.period);
    if (dates.length) {
      const missingDates: string[] = [];
      for (
        let time = Date.parse(start), i = 0;
        time <= Date.parse(end) && i < 31;
        time += 86400000, i++
      ) {
        const day = new Date(time).toISOString().slice(0, 10);
        if (!dates.includes(day)) missingDates.push(day);
      }
      excluded.push({
        storeName,
        country,
        weekStartDate: start,
        weekEndDate: end,
        coveredDates: [...new Set(dates)].sort(),
        missingDates,
        reason: "LEGACY_TOTAL_CANNOT_BE_SPLIT_OVER_CONTROLLED_DAYS",
      });
      continue;
    }
    const key = JSON.stringify([
      storeName,
      country,
      row.parentAsin || row.asin,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const result: SaihuReportProjectedProduct[] = [...daily];
  const optionalText = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string")
      return saihuReportFail("LEGACY_IDENTITY_INVALID");
    return value;
  };
  for (const [identityKey, rows] of groups) {
    const first = rows[0],
      byWeek = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const key = String(row.weekStartDate);
      byWeek.set(key, [...(byWeek.get(key) ?? []), row]);
    }
    const summaries = [...byWeek]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, weeks)
      .map(([weekStartDate, rows]): SaihuReportProjectedWeek => {
        const sum = (key: string) =>
            rows.some(row => number(row[key]) === null)
              ? null
              : rows.reduce((n, row) => n + number(row[key])!, 0),
          salesQty = sum("salesQty"),
          salesAmount = sum("salesAmount"),
          profit = sum("grossProfit"),
          sessions = sum("sessionsTotal"),
          orders = sum("orderQty"),
          clicks = sum("adClicks"),
          spend = sum("adSpend"),
          adSales = sum("adSalesAmount"),
          impressions = sum("adImpressions");
        return {
          id: 0,
          weekStartDate,
          weekEndDate: String(rows[0].weekEndDate),
          sourceKind: "saihu_legacy_weekly",
          reportingCalendar: "original_legacy_period",
          complete: false,
          coverageReason: "LEGACY_DAILY_COVERAGE_UNKNOWN",
          currency: rows.every(row => row.currency === "USD") ? "USD" : null,
          salesTrend: null,
          salesQty,
          orderQty: orders,
          salesAmount,
          orderProfit: profit,
          profitMargin: ratio(profit, salesAmount),
          sessionTotal: sessions,
          totalCvr: ratio(orders, sessions),
          adOrders: sum("adOrders"),
          organicOrders: sum("organicOrders"),
          adClicks: clicks,
          adCvr: ratio(sum("adOrders"), clicks),
          organicCvr: ratio(sum("organicOrders"), sum("organicClicks")),
          ctr: ratio(clicks, impressions),
          adImpressions: impressions,
          cpc: ratio(spend, clicks, 1),
          adSpend: spend,
          adSales,
          acos: ratio(spend, adSales),
          rating: null,
          reviewCount: sum("ratingCount"),
          returnRate: ratio(sum("returnQty"), salesQty),
          wow: null,
        };
      });
    const country = normalizeMarketplaceCode(String(first.site)),
      existing = result.find(
        product =>
          product.parentAsin === (first.parentAsin || first.asin) &&
          product.storeName === first.storeName &&
          product.marketplace === country
      );
    if (existing)
      existing.weeks = [...existing.weeks, ...summaries]
        .sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate))
        .slice(0, weeks);
    else
      result.push({
        id: 0,
        identityKey,
        parentAsin:
          optionalText(first.parentAsin) ||
          optionalText(first.asin) ||
          saihuReportFail("LEGACY_IDENTITY_INVALID"),
        title: optionalText(first.title) ?? "",
        chineseName: optionalText(first.productName),
        brand: optionalText(first.brand),
        category: optionalText(first.category),
        marketplace: country,
        imageUrl: optionalText(first.imageUrl),
        status: "active",
        operator: optionalText(first.operator),
        storeName:
          optionalText(first.storeName) ??
          saihuReportFail("LEGACY_IDENTITY_INVALID"),
        shopId: null,
        variantCount: new Set(rows.map(row => row.asin)).size,
        skus: [
          ...new Set(
            rows
              .map(row => optionalText(row.sku))
              .filter((value): value is string => !!value)
          ),
        ],
        basicInfo: null,
        weeks: summaries,
        monthlySummaries: [],
        sourceKind: "saihu_legacy_weekly",
        originalParentAttribution: true,
        variants: rows.map(row => ({
          id: 0,
          childAsin: optionalText(row.asin) ?? "",
          sku: optionalText(row.sku),
          title: optionalText(row.title),
          price: null,
          status: "active" as const,
        })),
      });
  }
  return {
    products: result,
    legacyOverlaps: [
      ...new Map(excluded.map(row => [JSON.stringify(row), row])).values(),
    ],
  };
}
/** Exact-workspace fresh-authorized read used by the existing Saihu overview.
 * Returns null only when the dedicated table truly does not exist, or no
 * controlled version has ever been applied. Other failures never fake old data. */
export async function readControlledSaihuOverview(
  db: Database,
  identity: SaihuReportIdentity,
  marketplace: string,
  weeks: number,
  legacyDataOwnerId = identity.userId
) {
  return db.transaction(async tx => {
    const tables = await saihuReportRows(
      tx,
      "SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ops_saihu_daily_report_batches'",
      [],
      1
    );
    if (!tables.length) return null;
    if (tables[0].engine !== "InnoDB")
      return saihuReportFail("SCHEMA_UNAVAILABLE");
    const current = await authorizeSaihuReport(
        tx,
        identity,
        "read",
        assertResourceAction,
        true
      ),
      batches = await readSaihuDailyBatches(tx, identity.workspaceId);
    if (!batches.some(batch => ["completed", "revoked"].includes(batch.status)))
      return null;
    const active = selectSaihuDailyVersions(batches),
      covered = [...active.winners].map(([key]) => {
        const [, storeName, country, period] = JSON.parse(key) as string[];
        return { storeName, country, period };
      });
    const manager = ["super_admin", "admin", "ops_manager"].includes(
      current.role
    );
    let authorizedBatches = batches,
      legacy = await readSaihuLegacyRows(tx, identity.workspaceId);
    if (!manager) {
      const assignments = await saihuReportRows(
          tx,
          "SELECT id,workspaceId,parent_asin AS parentAsin,store_name AS storeName,country,assignee_user_id AS assigneeUserId,is_active AS isActive FROM ops_inventory_owner_assignments WHERE workspaceId=? AND is_active=1 ORDER BY id LIMIT 10001 FOR SHARE",
          [identity.workspaceId],
          10001
        ),
        mappings = await saihuReportRows(
          tx,
          "SELECT id,workspaceId,external_name AS externalName,source_type AS sourceType,system_user_id AS systemUserId,is_confirmed AS isConfirmed FROM operator_name_mappings WHERE workspaceId=? AND is_confirmed=1 AND source_type IN ('saihu','all') ORDER BY id LIMIT 10001 FOR SHARE",
          [identity.workspaceId],
          10001
        );
      if (
        assignments.length > 10000 ||
        mappings.length > 10000 ||
        assignments.some(
          row =>
            typeof row.id !== "number" ||
            row.workspaceId !== identity.workspaceId ||
            row.isActive !== 1 ||
            typeof row.assigneeUserId !== "number" ||
            typeof row.parentAsin !== "string" ||
            typeof row.storeName !== "string" ||
            typeof row.country !== "string"
        ) ||
        mappings.some(
          row =>
            typeof row.id !== "number" ||
            row.workspaceId !== identity.workspaceId ||
            row.isConfirmed !== 1 ||
            typeof row.systemUserId !== "number" ||
            !["saihu", "all"].includes(String(row.sourceType)) ||
            typeof row.externalName !== "string"
        )
      )
        return saihuReportFail("OWNER_EVIDENCE_INVALID");
      const allowed = (
        parent: string,
        storeName: string,
        country: string,
        operator: string | null
      ) => {
        const manual = assignments.filter(
          row =>
            row.parentAsin === parent &&
            row.storeName === storeName &&
            normalizeMarketplaceCode(String(row.country)) === country
        );
        if (manual.length > 1) return false;
        if (manual.length === 1)
          return manual[0].assigneeUserId === identity.userId;
        const names = splitExternalOperatorNames(operator);
        if (!names.length) return false;
        const owners = names.map(name => [
          ...new Set(
            mappings
              .filter(row => row.externalName === name)
              .map(row => row.systemUserId)
          ),
        ]);
        return (
          owners.every(ids => ids.length === 1) &&
          [...new Set(owners.flat())].includes(identity.userId)
        );
      };
      authorizedBatches = batches.map(batch => ({
        ...batch,
        facts: batch.facts.filter(row =>
          allowed(
            row.parentAsin,
            row.shop.storeName,
            row.shop.country,
            row.operator
          )
        ),
      }));
      legacy = legacy.filter(row =>
        allowed(
          String(row.parentAsin || row.asin || ""),
          String(row.storeName ?? ""),
          normalizeMarketplaceCode(String(row.site ?? "")),
          typeof row.operator === "string" ? row.operator : null
        )
      );
    }
    return {
      ...combineSaihuLegacyOverview(
        buildSaihuDailyOverview(authorizedBatches, marketplace, weeks),
        legacy,
        covered,
        legacyDataOwnerId,
        marketplace,
        weeks
      ),
      identity: current.identity,
    };
  });
}
