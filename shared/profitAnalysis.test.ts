import { describe, expect, it } from "vitest";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialMetrics, type MonthlyFinancialBatchRecord } from "./monthlyFinancialRead";
import { ProfitAnalysisSourceSchema, ProfitAnalysisPreviewInputSchema, ProfitAnalysisPreviewResultSchema, ProfitAnalysisReplySchema,
  ProfitAnalysisResultSchema, ProfitAnalysisEvidenceSchema, buildProfitAnalysisEvidence, finishProfitAnalysis,
  buildProfitAnalysisPreviewResult, buildProfitAnalysisPreviewUnavailable, validateProfitAnalysisResultAgainstEvidence,
  priorProfitAnalysisMonth, type ProfitAnalysisSource } from "./profitAnalysis";

const scope = { storeName: "Store A", country: "US", parentAsin: "PARENT", currency: "USD", basis: "child_rows" as const };
const identity = { userId: 7, workspaceId: 11 };
const metrics = (values: Partial<MonthlyFinancialMetrics> = {}): MonthlyFinancialMetrics => ({ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])), salesQty: 10, salesAmount: 100, financialProfit: 20, purchaseCost: 30, ...values } as MonthlyFinancialMetrics);
function rows(period: string, batchId: number, overrides: Array<Record<string, unknown>> = [{}]) {
  const payload = overrides.map(value => ({ yearMonth: period, parentAsin: scope.parentAsin, asin: "CHILD", sku: "SKU", title: "Original title", storeName: scope.storeName, site: "美国", operator: null,
    ...metrics(), raw: { currency: "USD" }, ...value }));
  const record: MonthlyFinancialBatchRecord = { id: batchId, workspaceId: identity.workspaceId, userId: identity.userId, fileName: "synthetic.xlsx", fileHash: "f".repeat(64), status: "completed",
    totalRows: payload.length, skippedRows: 0, unallocatedRows: 0, months: [period], payload,
    createdAt: "2026-10-01 00:00:00.000000", confirmedAt: "2026-10-01 00:00:00.000000", fileReferenceKind: "storage", sourceRunId: null };
  return parseMonthlyFinancialBatch(record).rows;
}
function source(previous = rows("2026-08", 8), current = rows("2026-09", 9, [{ financialProfit: 30, salesAmount: 150 }])): ProfitAnalysisSource {
  return { version: 1, identity, scope, month: "2026-09", previousMonth: "2026-08", sourceHash: "a".repeat(64), selectionHash: "b".repeat(64), authorizationHash: "c".repeat(64),
    periods: [previous, current].map((items, i) => ({ month: i ? "2026-09" : "2026-08", rows: items, selection: { complete: true, rule: "latest_completed_batch_per_month_store_site", selectedBatchId: i ? 9 : 8, recordHash: String(i ? "9" : "8").repeat(64), scopeRowCount: items.length, authorizedRowCount: items.length } })) };
}
const clone = <T>(value: T): T => structuredClone(value);
const input = { expectedWorkspaceId: 11, scope, month: "2026-09" };

describe("profit analysis source admission", () => {
  it("strict calendar preserves January rollover and rejects unsupported previous month", () => {
    expect(priorProfitAnalysisMonth("2026-01")).toBe("2025-12");
    expect(priorProfitAnalysisMonth("1000-02")).toBe("1000-01");
    expect(priorProfitAnalysisMonth("9999-12")).toBe("9999-11");
    for (const month of ["1000-01", "0999-12", "2026-00", "2026-13", "2026-1", "10000-01"]) expect(ProfitAnalysisPreviewInputSchema.safeParse({ ...input, month }).success).toBe(false);
  });
  it("keeps canonical country aliases without inferring currency", () => {
    expect(ProfitAnalysisPreviewInputSchema.parse({ ...input, scope: { ...scope, country: "美国", currency: null } }).scope).toMatchObject({ country: "US", currency: null });
  });
  it("preserves raw original precision and full server source bindings", () => {
    const s = source(rows("2026-08", 8, [{ financialProfit: 1.001 }]), rows("2026-09", 9, [{ financialProfit: 1.002 }]));
    s.periods[0].rows[0].raw.unusedOriginal = "untouched";
    const parsed = ProfitAnalysisSourceSchema.parse(s), e = buildProfitAnalysisEvidence(s);
    expect(parsed.periods[0].rows[0].raw.unusedOriginal).toBe("untouched");
    expect(e.parentBefore).toBe(1.001); expect(e.parentAfter).toBe(1.002); expect(e.delta).toBe(1.002 - 1.001);
    expect(e.sourceHash).toBe(s.sourceHash);
  });
  it.each(["storeName", "country", "parentAsin", "currency", "yearMonth", "batchId", "allocation"])("rejects row outside %s", key => {
    const s = source(), row = s.periods[0].rows[0] as unknown as Record<string, unknown>;
    row[key] = key === "batchId" ? 99 : key === "allocation" ? "parent_only" : key === "currency" ? "EUR" : key === "yearMonth" ? "2026-07" : "OTHER";
    expect(ProfitAnalysisSourceSchema.safeParse(s).success).toBe(false);
  });
  it.each(["complete", "selectedBatchId", "recordHash", "scopeRowCount", "authorizedRowCount", "rule"])("rejects inconsistent selection %s", key => {
    const s = source(), proof = s.periods[0].selection as unknown as Record<string, unknown>;
    proof[key] = key === "complete" ? false : key === "selectedBatchId" ? null : key === "recordHash" ? null : key.endsWith("Count") ? 2 : "latest_parent";
    expect(ProfitAnalysisSourceSchema.safeParse(s).success).toBe(false);
  });
  it("rejects duplicate original row refs rather than counting twice", () => {
    const s = source(); s.periods[0].rows.push(clone(s.periods[0].rows[0])); s.periods[0].selection.scopeRowCount++; s.periods[0].selection.authorizedRowCount++;
    expect(ProfitAnalysisSourceSchema.safeParse(s).success).toBe(false);
  });
  it("same batch across two months is legal when original indexes are distinct", () => {
    const s = source(); const r = s.periods[1].rows[0]; r.batchId = 8; r.rowIndex = 1; s.periods[1].selection.selectedBatchId = 8; s.periods[1].selection.recordHash = "8".repeat(64);
    expect(buildProfitAnalysisEvidence(s).status).toBe("ready");
  });
  it.each([NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects nonfinite/out-of-range stored number %s", n => {
    const s = source(); s.periods[0].rows[0].metrics.salesAmount = n;
    expect(ProfitAnalysisSourceSchema.safeParse(s).success).toBe(false);
  });
  it("rejects overflowing full group sum instead of making it unknown", () => {
    const s = source(rows("2026-08", 8, [{ sku: "A", salesAmount: Number.MAX_SAFE_INTEGER / 2 }, { sku: "B", salesAmount: Number.MAX_SAFE_INTEGER / 2 + 1 }]));
    expect(() => buildProfitAnalysisEvidence(s)).toThrow();
  });
  it("rejects forged weighted averages and original field projections", () => {
    const s = source(); s.periods[0].rows[0].details.averages.purchaseCost.numerator = 999;
    expect(ProfitAnalysisSourceSchema.safeParse(s).success).toBe(false);
    const t = source(); t.periods[0].rows[0].details.fields.financialProfit.reportedValue = 999;
    expect(ProfitAnalysisSourceSchema.safeParse(t).success).toBe(false);
  });
  it("pre-admission rejects getters without invoking them, sparse arrays, cycles and Date", () => {
    const s = source(); let called = 0; Object.defineProperty(s, "sourceHash", { enumerable: true, get() { called++; return "a".repeat(64); } });
    expect(ProfitAnalysisSourceSchema.safeParse(s).success).toBe(false); expect(called).toBe(0);
    const t = source(); (t.periods[0].rows[0].raw as Record<string, unknown>).date = new Date(); expect(ProfitAnalysisSourceSchema.safeParse(t).success).toBe(false);
    const c = source(); c.periods[0].rows[0].raw.cycle = c.periods[0].rows[0].raw; expect(ProfitAnalysisSourceSchema.safeParse(c).success).toBe(false);
    const a = source(); delete a.periods[0].rows[0]; expect(ProfitAnalysisSourceSchema.safeParse(a).success).toBe(false);
  });
  it("rejects unknown keys, overlong raw strings and invalid order", () => {
    expect(ProfitAnalysisSourceSchema.safeParse({ ...source(), external: true }).success).toBe(false);
    const s = source(); s.periods.reverse(); expect(ProfitAnalysisSourceSchema.safeParse(s).success).toBe(false);
    const t = source(); t.periods[0].rows[0].raw.large = "x".repeat(32769); expect(ProfitAnalysisSourceSchema.safeParse(t).success).toBe(false);
  });
  it.each(["1000-01", "2026-13", "invalid"])("source and evidence safeParse do not throw for invalid calendar %s", month => {
    const s = source(), e = buildProfitAnalysisEvidence(s), p = buildProfitAnalysisPreviewResult({ identity, input, source: s });
    s.month = month; e.month = month; p.request.month = month;
    for (const [schema, value] of [[ProfitAnalysisSourceSchema, s], [ProfitAnalysisEvidenceSchema, e], [ProfitAnalysisPreviewResultSchema, p]] as const) {
      expect(() => schema.safeParse(value)).not.toThrow(); expect(schema.safeParse(value).success).toBe(false);
    }
  });
});

describe("full dual-month evidence", () => {
  it("builds all nineteen metrics and actual delta/provenance without model numbers", () => {
    const e = buildProfitAnalysisEvidence(source());
    expect(e).toMatchObject({ status: "ready", parentBefore: 20, parentAfter: 30, delta: 10, changePercent: 50 });
    expect(Object.keys(e.aggregates[0].metrics)).toEqual([...MONTHLY_FINANCIAL_METRICS]);
    const reason = e.evidence.find(row => row.level === "parent" && row.metric === "financialProfit")!;
    expect(reason).toMatchObject({ before: 20, after: 30, unit: "currency", currency: "USD" });
    expect(reason.provenance.before).toMatchObject({ aggregateId: e.aggregates[0].id, numerator: 20, denominator: null });
  });
  it("aggregates every duplicate ASIN SKU and weights original averages by quantity", () => {
    const a = rows("2026-08", 8, [{ sku: "A", salesQty: 2, purchaseCost: 10, raw: { currency: "USD", "8:采购成本/平均采购成本": 5 } }, { sku: "B", salesQty: 8, purchaseCost: 72, raw: { currency: "USD", "8:采购成本/平均采购成本": 9 } }]);
    const e = buildProfitAnalysisEvidence(source(a)); const child = e.aggregates.find(row => row.month === "2026-08" && row.level === "child")!;
    expect(child.rowCount).toBe(2); expect(child.skus).toEqual(["A", "B"]); expect(child.metrics.financialProfit).toBe(40);
    expect(child.averages.purchaseCost).toMatchObject({ numerator: 82, denominator: 10, value: 8.2, reportedRows: 2 });
  });
  it("never fills missing children as zero or invents child changes", () => {
    const e = buildProfitAnalysisEvidence(source(rows("2026-08", 8, [{ asin: "BEFORE" }]), rows("2026-09", 9, [{ asin: "AFTER", financialProfit: 25 }])));
    expect(e.coverage).toMatchObject({ comparableAsins: [], onlyPreviousAsins: ["BEFORE"], onlyCurrentAsins: ["AFTER"], sameChildCoverage: false });
    expect(e.evidence.every(row => row.level === "parent")).toBe(true);
  });
  it("keeps unknown optional metrics null instead of zero while retaining known evidence", () => {
    const e = buildProfitAnalysisEvidence(source(rows("2026-08", 8, [{ advertising: null }])));
    expect(e.aggregates[0].metrics.advertising).toBeNull(); expect(e.evidence.some(row => row.metric === "advertising")).toBe(false);
    expect(e.coverage.missingValues.some(row => row.metric === "advertising")).toBe(true);
  });
  it.each([0, -10])("does not report misleading percentage with previous profit %s", before => {
    const e = buildProfitAnalysisEvidence(source(rows("2026-08", 8, [{ financialProfit: before }])));
    expect(e.changePercent).toBeNull(); expect(e.evidence.find(row => row.metric === "financialProfit")!.changePercent).toBeNull();
  });
  it("blocks a missing month without older fallback", () => {
    const s = source([]); s.periods[0].selection.selectedBatchId = null; s.periods[0].selection.recordHash = null;
    const e = buildProfitAnalysisEvidence(s); expect(e.status).toBe("blocked"); expect(e.blockingReasons).toContain("previous_month_missing"); expect(e.evidence).toEqual([]);
  });
  it.each([0, 1])("blocks unknown authoritative profit in period %s", i => {
    const a = rows("2026-08", 8, [{ financialProfit: i ? 20 : null }]), b = rows("2026-09", 9, [{ financialProfit: i ? null : 30 }]);
    const e = buildProfitAnalysisEvidence(source(a, b)); expect(e.status).toBe("blocked"); expect(e.evidence).toEqual([]);
  });
  it("unknown currency blocks and never publishes cross-row money sums", () => {
    const s = source(rows("2026-08", 8, [{ sku: "A", raw: {} }, { sku: "B", raw: {} }]), rows("2026-09", 9, [{ raw: {} }])); s.scope = { ...scope, currency: null };
    const e = buildProfitAnalysisEvidence(s); expect(e.status).toBe("blocked"); expect(e.blockingReasons).toContain("currency_unknown"); expect(e.parentBefore).toBeNull(); expect(e.aggregates[0].metrics.purchaseCost).toBeNull();
  });
  it("preserves independent reported-parent basis, never synthesizing children", () => {
    const s = source(rows("2026-08", 8, [{ asin: "" }]), rows("2026-09", 9, [{ asin: "", financialProfit: 25 }])); s.scope = { ...scope, basis: "reported_parent_row" };
    const e = buildProfitAnalysisEvidence(s); expect(e.aggregates).toHaveLength(2); expect(e.coverage.currentAsins).toEqual([]); expect(e.evidence.every(row => row.level === "parent")).toBe(true);
  });
  it("rejects two parent totals rather than silently merging", () => {
    const s = source(rows("2026-08", 8, [{ asin: "" }, { asin: "" }]), rows("2026-09", 9, [{ asin: "" }])); s.scope = { ...scope, basis: "reported_parent_row" };
    expect(ProfitAnalysisSourceSchema.safeParse(s).success).toBe(false);
  });
  it("validates exact computed evidence and coverage, not model supplied arithmetic", () => {
    const e = buildProfitAnalysisEvidence(source()); e.evidence[0].delta = 999; expect(ProfitAnalysisEvidenceSchema.safeParse(e).success).toBe(false);
    const f = buildProfitAnalysisEvidence(source()); f.coverage.currentAsins = []; expect(ProfitAnalysisEvidenceSchema.safeParse(f).success).toBe(false);
  });
  it.each(["average", "denominator", "coverage", "refs", "batch", "path", "blockers", "missing_child"])("rejects forged aggregate %s", field => {
    const e = buildProfitAnalysisEvidence(source());
    const child = e.aggregates.find(row => row.level === "child")!;
    if (field === "average") child.averages.purchaseCost.value = 999;
    if (field === "denominator") child.averages.purchaseCost.denominator = 999;
    if (field === "coverage") child.averages.purchaseCost.reportedRows++;
    if (field === "refs") child.sourceRows[0].rowIndex = 99;
    if (field === "batch") child.sourceRows[0].batchId = 99;
    if (field === "path") child.rawPaths.purchaseCost = ["999:0:8:采购成本/合计"];
    if (field === "blockers") { e.status = "blocked"; e.blockingReasons = ["invented"]; e.evidence = []; }
    if (field === "missing_child") e.aggregates = e.aggregates.filter(row => row !== child);
    expect(ProfitAnalysisEvidenceSchema.safeParse(e).success).toBe(false);
  });
  it("keeps negative and zero original quantity without inventing a unit value", () => {
    const e = buildProfitAnalysisEvidence(source(rows("2026-08", 8, [{ salesQty: -2 }]), rows("2026-09", 9, [{ salesQty: 0 }])));
    expect(e.aggregates[0].metrics.salesQty).toBe(-2);
    expect(e.aggregates[0].averages.purchaseCost.value).toBeNull();
    expect(e.aggregates[0].avgPrice.value).toBeNull();
  });
  it("retains full raw component paths in system aggregate evidence", () => {
    const e = buildProfitAnalysisEvidence(source(rows("2026-08", 8, [{ raw: { currency: "USD", "8:商品成本支出-采购成本/合计": -30 } }])));
    expect(e.aggregates[0].rawPaths.purchaseCost).toEqual(["8:0:8:商品成本支出-采购成本/合计"]);
  });
});

describe("strict model reply and system result", () => {
  it("retains selected full values, coverage and immutable server hashes", () => {
    const e = buildProfitAnalysisEvidence(source()), chosen = e.evidence[0];
    const result = finishProfitAnalysis(e, { severity: "需关注", reasons: [{ evidenceId: chosen.id, explanation: "已知指标出现变化，需结合覆盖范围评估。" }] });
    expect(result.reasons[0]).toEqual({ ...chosen, explanation: "已知指标出现变化，需结合覆盖范围评估。" });
    expect(result).toMatchObject({ modelCalled: true, before: 20, after: 30, delta: 10, sourceHash: e.sourceHash });
    expect(result.aggregates).toEqual(e.aggregates);
    expect(validateProfitAnalysisResultAgainstEvidence(result, e)).toEqual(result);
  });
  it.each([{ severity: "正常", reasons: [] }, { severity: "严重", reasons: [{ evidenceId: "x", explanation: "说明" }] },
    { severity: "正常", reasons: [{ evidenceId: "x", explanation: "说明", amount: 10 }] }, { severity: "正常", reasons: [{ evidenceId: "x", explanation: "x".repeat(101) }] },
    { severity: "正常", reasons: Array.from({ length: 6 }, () => ({ evidenceId: "x", explanation: "说明" })) }, { severity: "正常", reasons: [{ evidenceId: "x", explanation: " " }] }])("rejects invalid model shape %j", value => expect(ProfitAnalysisReplySchema.safeParse(value).success).toBe(false));
  it("rejects unknown or repeated model evidence references", () => {
    const e = buildProfitAnalysisEvidence(source()), reason = { evidenceId: e.evidence[0].id, explanation: "说明" };
    expect(() => finishProfitAnalysis(e, { severity: "正常", reasons: [{ ...reason, evidenceId: "unknown" }] })).toThrow();
    expect(() => finishProfitAnalysis(e, { severity: "正常", reasons: [reason, reason] })).toThrow();
    expect(() => finishProfitAnalysis(e, null)).toThrow();
  });
  it("unchanged known values produce deterministic no-call result without an invented normal severity", () => {
    const e = buildProfitAnalysisEvidence(source(rows("2026-08", 8), rows("2026-09", 9)));
    expect(e.evidence).toEqual([]); const result = finishProfitAnalysis(e, null);
    expect(result).toMatchObject({ modelCalled: false, severity: null, reasons: [], mode: "deterministic_no_comparable_change" });
    expect(() => finishProfitAnalysis(e, { severity: "正常", reasons: [{ evidenceId: "x", explanation: "说明" }] })).toThrow();
  });
  it("unchanged known values with unknown metrics remain honestly qualified", () => {
    const e = buildProfitAnalysisEvidence(source(rows("2026-08", 8, [{ advertising: null }]), rows("2026-09", 9, [{ advertising: null }])));
    const result = finishProfitAnalysis(e, null); expect(result.coverage.missingValues.length).toBeGreaterThan(0); expect(result.severity).toBeNull(); expect(result.note).toContain("缺失值");
  });
  it("blocked sources cannot produce a result", () => {
    const e = buildProfitAnalysisEvidence(source(rows("2026-08", 8, [{ financialProfit: null }]))); expect(() => finishProfitAnalysis(e, null)).toThrow();
  });
  it("rejects result tampering and cross-source replay", () => {
    const e = buildProfitAnalysisEvidence(source()), r = finishProfitAnalysis(e, { severity: "正常", reasons: [{ evidenceId: e.evidence[0].id, explanation: "说明" }] });
    expect(ProfitAnalysisResultSchema.safeParse({ ...r, delta: 999 }).success).toBe(false);
    expect(() => validateProfitAnalysisResultAgainstEvidence({ ...r, sourceHash: "d".repeat(64) }, e)).toThrow();
    expect(ProfitAnalysisResultSchema.safeParse({ ...r, modelCalled: false }).success).toBe(false);
  });
  it("rejects a self-consistent invented reason not present in retained aggregates", () => {
    const e = buildProfitAnalysisEvidence(source()), r = finishProfitAnalysis(e, { severity: "正常", reasons: [{ evidenceId: e.evidence[0].id, explanation: "说明" }] });
    r.reasons[0].before = 100; r.reasons[0].after = 200; r.reasons[0].delta = 100; r.reasons[0].changePercent = 100;
    r.reasons[0].provenance.before.numerator = 100; r.reasons[0].provenance.after.numerator = 200;
    expect(ProfitAnalysisResultSchema.safeParse(r).success).toBe(false);
  });
  it("safeParse returns failure rather than throwing on overflowing arithmetic", () => {
    const e = buildProfitAnalysisEvidence(source()), r = finishProfitAnalysis(e, { severity: "正常", reasons: [{ evidenceId: e.evidence[0].id, explanation: "说明" }] });
    r.before = -Number.MAX_SAFE_INTEGER; r.after = Number.MAX_SAFE_INTEGER;
    expect(() => ProfitAnalysisResultSchema.safeParse(r)).not.toThrow();
    expect(ProfitAnalysisResultSchema.safeParse(r).success).toBe(false);
  });
});

describe("readonly preview projection", () => {
  it("returns no duplicate raw/source rows and remains execution-disabled", () => {
    const s = source(), result = buildProfitAnalysisPreviewResult({ identity, input, source: s });
    expect(result.status).toBe("ready"); expect(result.canGenerate).toBe(false); expect(result.generationUnavailableReason).toContain("unavailable");
    expect(result.source?.periods[0]).not.toHaveProperty("rows"); expect(JSON.stringify(result)).not.toContain('"raw":');
  });
  it("separates unavailable from blocked and discloses no partial capture on failure", () => {
    const result = buildProfitAnalysisPreviewUnavailable({ identity, input, reasonCode: "table_missing" });
    expect(result).toMatchObject({ status: "unavailable", source: null, evidence: null, canGenerate: false });
    const s = source([]); const blocked = buildProfitAnalysisPreviewResult({ identity, input, source: s }); expect(blocked.status).toBe("blocked");
  });
  it.each(["identity", "month", "scope", "hash", "count", "status", "enabled"])("rejects malformed preview %s", key => {
    const r = buildProfitAnalysisPreviewResult({ identity, input, source: source() });
    if (key === "identity") r.identity.workspaceId = 12;
    if (key === "month") r.source!.month = "2026-10";
    if (key === "scope") r.source!.scope.storeName = "Other";
    if (key === "hash") r.source!.sourceHash = "d".repeat(64);
    if (key === "count") r.source!.periods[0].selection.scopeRowCount = 2;
    if (key === "status") r.status = "unavailable";
    if (key === "enabled") (r as unknown as Record<string, unknown>).canGenerate = true;
    expect(ProfitAnalysisPreviewResultSchema.safeParse(r).success).toBe(false);
  });
});
