import { createHash } from "node:crypto";
import {
  MONTHLY_FINANCIAL_METRICS,
  MonthlyFinancialMetricsSchema,
  MonthlyFinancialRawSchema,
} from "../../../shared/monthlyFinancialReadDetails";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import {
  SAIHU_REPORT_LIMITS,
  SAIHU_DAILY_FIELDS,
  SaihuReportSourceSchema,
  SaihuReportDailyRowSchema,
  SaihuReportMonthlyRowSchema,
  SaihuReportCapturePreviewSchema,
  saihuReportHash,
  saihuReportCanonical,
  saihuReportPeriods,
  type SaihuReportSource,
  type SaihuReportCapturePreview,
} from "../../../shared/saihuReportSync";
import {
  SaihuReportContractSchema,
  saihuReportAt,
  saihuReportFail,
  type SaihuReportContract,
} from "./saihuReportContract";
import type { SaihuReportRead } from "./saihuReportTransport";
import { saihuReportDecimalSum } from "./saihuReportDecimal";

const count = (value: unknown) => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 10000
  )
    return saihuReportFail("PAGINATION_INVALID");
  return value;
};
const one = (value: unknown) => {
  if (Array.isArray(value)) {
    if (value.length !== 1) return saihuReportFail("AMBIGUOUS_IDENTITY");
    return value[0];
  }
  return value;
};
const string = (value: unknown, allowEmpty = false) => {
  value = one(value);
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  )
    return saihuReportFail("IDENTITY_INVALID");
  const result = String(value);
  if (
    (!allowEmpty && !result) ||
    result !== result.trim() ||
    /[\u0000-\u001f\u007f]/u.test(result)
  )
    return saihuReportFail("IDENTITY_INVALID");
  return result;
};
/** No token/secret-bearing response can become a raw business artifact. */
function noSecrets(value: unknown) {
  const stack = [value];
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop();
    if (++nodes > 200000) saihuReportFail("SOURCE_BUDGET");
    if (item && typeof item === "object")
      for (const [key, child] of Object.entries(item)) {
        if (
          /^(?:access_?token|refresh_?token|client_?secret|secret_?cipher|password|authorization)$/iu.test(
            key
          )
        )
          saihuReportFail("SOURCE_SECRET_REJECTED");
        stack.push(child);
      }
  }
}
export function validateSaihuReportSource(
  raw: SaihuReportSource,
  rawContract: SaihuReportContract
): SaihuReportCapturePreview {
  const source = SaihuReportSourceSchema.parse(raw),
    contract = SaihuReportContractSchema.parse(rawContract),
    periods = saihuReportPeriods(source.scope),
    seen = new Set<string>(),
    dailyRows: SaihuReportCapturePreview["dailyRows"] = [],
    monthlyRows: SaihuReportCapturePreview["monthlyRows"] = [],
    observed: SaihuReportCapturePreview["coverage"]["observed"] = [];
  if (
    source.contractHash !== saihuReportHash(contract) ||
    contract.workspaceId !== source.identity.workspaceId ||
    contract.kind !== source.scope.kind ||
    saihuReportCanonical(source.shops) !==
      saihuReportCanonical(contract.shops) ||
    Buffer.byteLength(saihuReportCanonical(source)) >
      SAIHU_REPORT_LIMITS.sourceBytes
  )
    saihuReportFail("SOURCE_BINDING_INVALID");
  for (const period of periods) {
    const pages = source.pages.filter(page => page.period === period);
    if (!pages.length || pages.some((page, i) => page.pageNo !== i + 1))
      saihuReportFail("PAGINATION_INCOMPLETE");
    let expectedTotal: number | null = null,
      expectedPages: number | null = null,
      received = 0;
    const counts = new Map<string, number>(),
      empty = new Set<string>();
    for (const page of pages) {
      noSecrets(page.body);
      if (
        page.byteLength !== Buffer.byteLength(page.originalUtf8) ||
        createHash("sha256").update(page.originalUtf8).digest("hex") !==
          page.bytesHash ||
        saihuReportCanonical(JSON.parse(page.originalUtf8)) !==
          saihuReportCanonical(page.body) ||
        page.body.code !== 0
      )
        saihuReportFail("SOURCE_BYTES_INVALID");
      const pageRows = saihuReportAt(page.body, contract.response.rows),
        total = count(saihuReportAt(page.body, contract.response.total)),
        pageCount = count(
          saihuReportAt(page.body, contract.response.pageCount)
        );
      if (
        !Array.isArray(pageRows) ||
        pageRows.length > 100 ||
        saihuReportAt(page.body, contract.response.pageNo) !== page.pageNo ||
        pageCount !== Math.max(1, Math.ceil(total / 100)) ||
        (expectedTotal !== null && total !== expectedTotal) ||
        (expectedPages !== null && pageCount !== expectedPages) ||
        (page.pageNo < pageCount && pageRows.length !== 100)
      )
        saihuReportFail("PAGINATION_CHANGED");
      expectedTotal = total;
      expectedPages = pageCount;
      received += pageRows.length;
      if (contract.response.emptyShopIds) {
        const values = saihuReportAt(page.body, contract.response.emptyShopIds);
        if (!Array.isArray(values) || values.length > 100)
          saihuReportFail("EMPTY_SCOPE_PROOF_INVALID");
        for (const value of values) {
          const shopId = string(value);
          if (!source.shops.some(shop => shop.shopId === shopId))
            saihuReportFail("UNEXPECTED_SHOP");
          empty.add(shopId);
        }
      }
      for (const rawRow of pageRows) {
        if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow))
          saihuReportFail("ROW_INVALID");
        const m = contract.mapping,
          field = (path: Array<string | number>) => saihuReportAt(rawRow, path),
          reportedPeriod = string(field(m.period)),
          expectedPeriod =
            contract.periodFormat === "YYYYMM"
              ? period.replace("-", "")
              : period;
        if (
          reportedPeriod !== expectedPeriod ||
          field(m.currency) !== "USD" ||
          (m.caliber && field(m.caliber.path) !== m.caliber.expectedValue)
        )
          saihuReportFail("SOURCE_PERIOD_OR_CURRENCY_INVALID");
        const shopId = string(field(m.shopId)),
          storeName = string(field(m.storeName)),
          country = normalizeMarketplaceCode(string(field(m.country))),
          shop = source.shops.find(shop => shop.shopId === shopId);
        if (!shop || shop.storeName !== storeName || shop.country !== country)
          saihuReportFail("UNEXPECTED_SHOP");
        const asin = string(field(m.asin)),
          parentAsin = string(field(m.parentAsin));
        const key = JSON.stringify([period, shopId, asin]);
        if (seen.has(key)) saihuReportFail("DUPLICATE_IDENTITY");
        seen.add(key);
        counts.set(shopId, (counts.get(shopId) ?? 0) + 1);
        const metrics: Record<string, number | null> = {};
        for (const key of contract.kind === "daily"
          ? SAIHU_DAILY_FIELDS
          : MONTHLY_FINANCIAL_METRICS) {
          const terms = m.metrics[key];
          if (terms === null) {
            metrics[key] = null;
            continue;
          }
          const amounts: Array<{
            value: number;
            multiplier: 1 | -1;
            divisor: 1 | 100;
          }> = [];
          for (const term of terms) {
            const value = field(term.path);
            if (
              typeof value !== "number" ||
              !Number.isFinite(value) ||
              Math.abs(value) > Number.MAX_SAFE_INTEGER
            )
              saihuReportFail("METRIC_INVALID");
            amounts.push({
              value,
              multiplier: term.multiplier,
              divisor: term.divisor,
            });
          }
          const sum = saihuReportDecimalSum(amounts);
          if (
            !Number.isFinite(sum) ||
            Math.abs(sum) > Number.MAX_SAFE_INTEGER ||
            ([
              "salesQty",
              "orderQty",
              "refundQty",
              "returnQty",
              "sessionsTotal",
              "adOrders",
              "organicOrders",
              "adClicks",
              "adImpressions",
              "organicClicks",
              "ratingCount",
            ].includes(key) &&
              !Number.isSafeInteger(sum))
          )
            saihuReportFail("METRIC_INVALID");
          metrics[key] = Object.is(sum, -0) ? 0 : sum;
        }
        const base = {
          period,
          shop,
          asin,
          parentAsin,
          title: m.title ? string(field(m.title), true) : "",
          sku: m.sku ? string(field(m.sku), true) : "",
          operator: m.operator ? string(field(m.operator), true) : null,
          currency: "USD" as const,
          raw: rawRow,
        };
        if (contract.kind === "daily") {
          if (
            [
              "salesQty",
              "orderQty",
              "salesAmount",
              "grossProfit",
              "adSpend",
            ].some(key => metrics[key] === null)
          )
            saihuReportFail("CRITICAL_METRIC_UNAVAILABLE");
          dailyRows.push(
            SaihuReportDailyRowSchema.parse({
              ...base,
              metrics,
              reportLevel: "asin",
            })
          );
        } else {
          if (
            metrics.financialProfit === null ||
            metrics.salesQty === null ||
            metrics.salesAmount === null
          )
            saihuReportFail("CRITICAL_METRIC_UNAVAILABLE");
          monthlyRows.push(
            SaihuReportMonthlyRowSchema.parse({
              ...base,
              metrics: MonthlyFinancialMetricsSchema.parse(metrics),
            })
          );
        }
      }
    }
    if (pages.length !== expectedPages || received !== expectedTotal)
      saihuReportFail("PAGINATION_INCOMPLETE");
    for (const shop of source.shops) {
      const rowCount = counts.get(shop.shopId) ?? 0;
      if (rowCount && empty.has(shop.shopId))
        saihuReportFail("EMPTY_SCOPE_PROOF_CONFLICT");
      observed.push({
        period,
        shop,
        rowCount,
        explicitEmpty: empty.has(shop.shopId),
      });
    }
  }
  if (
    source.pages.some(page => !periods.includes(page.period)) ||
    seen.size > 10000
  )
    saihuReportFail("SOURCE_BUDGET");
  const blockingReasons = observed.some(
      value => !value.rowCount && !value.explicitEmpty
    )
      ? ["EXPECTED_SHOP_PERIOD_MISSING"]
      : [],
    coverage = {
      complete: blockingReasons.length === 0,
      expected: periods.flatMap(period =>
        source.shops.map(shop => ({ period, shop }))
      ),
      observed,
      blockingReasons,
    };
  const body = {
    version: 1 as const,
    sourceHash: saihuReportHash(source),
    scope: source.scope,
    contractHash: source.contractHash,
    coverage,
    dailyRows,
    monthlyRows,
  };
  return SaihuReportCapturePreviewSchema.parse({
    ...body,
    previewHash: saihuReportHash(body),
  });
}
export async function collectSaihuReport(
  context: Omit<SaihuReportSource, "pages">,
  contract: SaihuReportContract,
  read: SaihuReportRead,
  signal: AbortSignal
): Promise<{ source: SaihuReportSource; preview: SaihuReportCapturePreview }> {
  const pages: SaihuReportSource["pages"] = [];
  for (const period of saihuReportPeriods(context.scope)) {
    let totalPages = 1;
    for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
      if (signal.aborted) saihuReportFail("CANCELLED");
      if (pages.length >= 500) saihuReportFail("PAGE_BUDGET");
      const value = await read(period, pageNo);
      totalPages = count(
        saihuReportAt(value.body, contract.response.pageCount)
      );
      if (totalPages < 1 || totalPages > 500) saihuReportFail("PAGE_BUDGET");
      pages.push({
        period,
        pageNo,
        ...value,
        body: MonthlyFinancialRawSchema.parse(value.body),
      });
      if (
        Buffer.byteLength(saihuReportCanonical(pages)) >
        SAIHU_REPORT_LIMITS.sourceBytes
      )
        saihuReportFail("SOURCE_BUDGET");
    }
  }
  const source = SaihuReportSourceSchema.parse({ ...context, pages });
  return { source, preview: validateSaihuReportSource(source, contract) };
}
