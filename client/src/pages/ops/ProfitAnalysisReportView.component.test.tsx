// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord, type MonthlyFinancialMetrics } from "@shared/monthlyFinancialRead";
import { buildProfitAnalysisEvidence, finishProfitAnalysis, type ProfitAnalysisSource, type ProfitAnalysisResult } from "@shared/profitAnalysis";
import { ProfitAnalysisPublicRunSchema, type ProfitAnalysisPublicRun } from "@shared/profitAnalysisWorkflowRead";
import DefaultReport, { ProfitAnalysisReportView } from "./ProfitAnalysisReportView";

const identity = { userId: 7, workspaceId: 11 };
const scope = { storeName: "Store A", country: "US", parentAsin: "PARENT", currency: "USD", basis: "child_rows" as const };
const time = "2026-10-18 12:34:56.123456";
function rows(month: string, batchId: number, overrides: Array<Record<string, unknown>>) {
  const metrics = { ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])), salesQty: 10, salesAmount: 100, financialProfit: 20, purchaseCost: 30 } as MonthlyFinancialMetrics;
  const payload = overrides.map(value => ({ yearMonth: month, parentAsin: scope.parentAsin, asin: "CHILD", sku: "SKU", title: "Original title", storeName: scope.storeName, site: "美国", operator: null, ...metrics, raw: { currency: "USD" }, ...value }));
  const record: MonthlyFinancialBatchRecord = { id: batchId, workspaceId: 11, userId: 7, fileName: "synthetic.xlsx", fileHash: "f".repeat(64), status: "completed", totalRows: payload.length, skippedRows: 0, unallocatedRows: 0, months: [month], payload, createdAt: time, confirmedAt: time, fileReferenceKind: "storage", sourceRunId: null };
  return parseMonthlyFinancialBatch(record).rows;
}
function result(previous: Array<Record<string, unknown>> = [{}], current: Array<Record<string, unknown>> = [{ financialProfit: 30, salesAmount: 150 }], order?: number[]): ProfitAnalysisResult {
  const source: ProfitAnalysisSource = { version: 1, identity, scope, month: "2026-09", previousMonth: "2026-08", sourceHash: "a".repeat(64), selectionHash: "b".repeat(64), authorizationHash: "c".repeat(64),
    periods: [rows("2026-08", 8, previous), rows("2026-09", 9, current)].map((items, i) => ({ month: i ? "2026-09" : "2026-08", rows: items, selection: { complete: true, rule: "latest_completed_batch_per_month_store_site", selectedBatchId: i ? 9 : 8, recordHash: (i ? "9" : "8").repeat(64), scopeRowCount: items.length, authorizedRowCount: items.length } })) };
  const evidence = buildProfitAnalysisEvidence(source);
  return finishProfitAnalysis(evidence, evidence.evidence.length ? { severity: "需关注", reasons: (order ?? [0]).map(index => ({ evidenceId: evidence.evidence[index].id, explanation: `解释 ${index}：基于原行变化，不声称因果。` })) } : null);
}
function run(value = result()): ProfitAnalysisPublicRun {
  return ProfitAnalysisPublicRunSchema.parse({ operationId: "11111111-1111-4111-8111-111111111111", state: "succeeded", errorCode: null, sourceHash: value.sourceHash, resultHash: "d".repeat(64), result: value, stale: false, createdAt: time, updatedAt: time, completedAt: time });
}
async function open(summary: HTMLElement) {
  const details = summary.closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle", { bubbles: true }));
  await waitFor(() => expect(details.childElementCount).toBeGreaterThan(1));
  return details;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("ProfitAnalysisReportView", () => {
  it("exports the same named/default pure component and displays summary and exact metadata", () => {
    expect(DefaultReport).toBe(ProfitAnalysisReportView);
    const value = run(); render(<DefaultReport run={value} label="已保存报告" />);
    expect(screen.getByRole("heading", { name: "已保存报告" })).toBeVisible();
    expect(screen.getByText("本月利润上涨 · 需关注")).toBeVisible();
    expect(screen.getByText("20 USD")).toBeVisible(); expect(screen.getByText("30 USD")).toBeVisible();
    expect(screen.getByText("10 USD")).toBeVisible(); expect(screen.getByText("50%")).toBeVisible();
    const metadata = screen.getByRole("region", { name: "结果来源与时间" });
    for (const hash of [value.sourceHash!, value.resultHash!]) expect(within(metadata).getByText(hash)).toBeVisible();
    expect(metadata).toHaveTextContent(value.result!.selectionHash); expect(metadata).toHaveTextContent(value.result!.authorizationHash);
    expect(within(metadata).getAllByText(time)).toHaveLength(3);
  });
  it("retains all five reasons in server order rather than reranking financial changes", () => {
    const value = result([{}], [{ financialProfit: 30, salesAmount: 150, salesQty: 12, advertising: 20, storage: 9 }], [4, 1, 0, 3, 2]);
    render(<DefaultReport run={run(value)} />);
    const reasons = screen.getAllByTestId("profit-reason"); expect(reasons).toHaveLength(5);
    value.reasons.forEach((reason, index) => { expect(reasons[index]).toHaveTextContent(`${index + 1}. ${reason.title}`); expect(reasons[index]).toHaveTextContent(reason.explanation); });
  });
  it("shows reason numerator/denominator, basis and complete original row references", async () => {
    const value = run(); render(<DefaultReport run={value} />);
    const details = await open(screen.getByText("查看此原因的前后原行、分子分母与口径"));
    expect(details).toHaveTextContent("分子：20；分母：未知 / 未提供");
    expect(details).toHaveTextContent('"batchId": 8'); expect(details).toHaveTextContent('"batchId": 9');
    expect(details).toHaveTextContent('"rowIndex": 0'); expect(details).toHaveTextContent("Original title"); expect(details).toHaveTextContent("SKU");
    expect(details).toHaveTextContent(value.result!.reasons[0].provenance.before.basis);
  });
  it("does not round precise positive or negative values", () => {
    const value = result([{ financialProfit: -0.00001 }], [{ financialProfit: -0.00002 }]);
    render(<DefaultReport run={run(value)} />);
    expect(screen.getAllByText("-0.00001 USD")).toHaveLength(2); expect(screen.getByText("-0.00002 USD")).toBeVisible();
    expect(screen.getByText("本月利润下滑 · 需关注")).toBeVisible();
    expect(screen.getByText("不可计算（上期非正或数值未知）")).toBeVisible();
  });
  it("keeps zero, unknown optional values and undefined ratios distinct", async () => {
    render(<DefaultReport run={run(result([{ financialProfit: 0, salesQty: 0, advertising: null }], [{ financialProfit: -10, salesQty: 0, advertising: null }]))} />);
    expect(screen.getByText("0 USD")).toBeVisible();
    const details = await open(screen.getAllByText("展开完整指标与原行依据")[0]);
    const advertising = within(details).getByText("广告支出").closest("div")!;
    expect(advertising).toHaveTextContent("未知 / 未提供 USD"); expect(advertising).not.toHaveTextContent("0 USD");
    expect(details).toHaveTextContent("分母：0"); expect(details).toHaveTextContent("分母非正");
    expect(within(details).getByText("销量").closest("div")).toHaveTextContent("0 数量");
  });
  it("shows all nineteen metrics, four averages, two ratios and all raw paths", async () => {
    const value = result([{ raw: { currency: "USD", "5:订单支出/销售佣金": -12.5, "8:采购成本/平均采购成本": 3 } }]);
    render(<DefaultReport run={run(value)} />);
    const details = await open(screen.getAllByText("展开完整指标与原行依据")[0]);
    for (const label of ["财务利润", "销量", "销售额", "其他收入", "促销折扣", "采购成本总额", "头程费用总额", "FBA费用", "销售佣金", "广告支出", "推广费", "仓储费", "其他费用", "退款金额", "退款量", "退货量", "LD费用", "优惠券费用", "Vine费用", "单件采购成本", "单件头程费用", "单件FBA费用", "单件销售佣金", "平均售价（受子体销售结构影响）", "利润率"]) expect(within(details).getByText(label)).toBeVisible();
    expect(details).toHaveTextContent("5:订单支出/销售佣金");
    expect(details).toHaveTextContent("原报表均值行：1"); expect(details).toHaveTextContent("比例原值（1 = 100%）");
  });
  it("marks stale reports prominently and never labels them current", () => {
    render(<DefaultReport run={{ ...run(), stale: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("历史结果已过期");
    expect(screen.getByRole("alert")).toHaveTextContent("不能作为最新分析");
    expect(screen.queryByText(/来源在最近一次服务端读取时一致/u)).not.toBeInTheDocument();
  });
  it("marks unknown freshness independently of a successful generation", () => {
    render(<DefaultReport run={{ ...run(), stale: null }} />);
    expect(screen.getByText("当前新鲜度未知；以下仅为生成时快照。")).toBeVisible();
  });
  it("labels deterministic no-change as system/no AI and never invents normal severity", () => {
    render(<DefaultReport run={run(result([{}], [{}]))} />);
    expect(screen.getByRole("status")).toHaveTextContent("未调用 AI，也不是 AI 判断业务正常");
    expect(screen.getByText("原因说明（0 条，按已保存顺序）")).toBeVisible();
    expect(screen.queryAllByTestId("profit-reason")).toHaveLength(0); expect(screen.queryByText(/· 正常/u)).not.toBeInTheDocument();
  });
  it("preserves every coverage difference and missing metric without zero-filling", async () => {
    render(<DefaultReport run={run(result([{ asin: "ONLY-BEFORE", advertising: null }], [{ asin: "ONLY-AFTER", financialProfit: 30, advertising: null }]))} />);
    const coverage = screen.getByRole("region", { name: "覆盖与缺失说明" });
    expect(within(coverage).getByRole("alert")).toHaveTextContent("缺失子体不补零");
    const details = await open(within(coverage).getByText("查看全部覆盖子体与缺失指标（无截断）"));
    expect(details).toHaveTextContent("ONLY-BEFORE"); expect(details).toHaveTextContent("ONLY-AFTER"); expect(details).toHaveTextContent('"advertising"');
  });
  it("pages every aggregate in unchanged order with a maximum of25 and resets for a different report", () => {
    const before = Array.from({ length: 30 }, (_, index) => ({ asin: `CHILD-${index}` }));
    const value = run(result(before, before.map(row => ({ ...row, financialProfit: 30 }))));
    const view = render(<DefaultReport run={value} />), seen: string[] = [];
    for (let page = 0; page < 3; page++) {
      const cards = screen.getAllByTestId("profit-aggregate"); expect(cards.length).toBeLessThanOrEqual(25);
      seen.push(...cards.map(card => card.getAttribute("data-aggregate-id")!));
      if (page < 2) fireEvent.click(screen.getByRole("button", { name: "聚合下一页" }));
    }
    expect(seen).toEqual(value.result!.aggregates.map(row => row.id)); expect(seen).toHaveLength(62);
    expect(screen.getByRole("button", { name: "聚合下一页" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "聚合上一页" })); expect(screen.getAllByTestId("profit-aggregate")).toHaveLength(25);
    view.rerender(<DefaultReport run={{ ...run(), operationId: "22222222-2222-4222-8222-222222222222" }} />);
    expect(screen.getByRole("button", { name: "聚合上一页" })).toBeDisabled(); expect(screen.getAllByTestId("profit-aggregate")).toHaveLength(4);
  });
  it("keeps long and XSS-looking original strings as wrapping text with no executable elements", async () => {
    const attack = "<img src=x onerror=alert(1)>", longTitle = attack + "长".repeat(3900);
    const value = run(result([{ title: longTitle, sku: "javascript:alert(1)" }], [{ title: longTitle, financialProfit: 30 }]));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { container } = render(<DefaultReport run={value} label={attack} />);
    const details = await open(screen.getAllByText("展开完整指标与原行依据")[0]);
    expect(details.textContent).toContain(longTitle); expect(details.textContent).toContain("javascript:alert(1)");
    expect(container.querySelector("img,script,a,iframe")).toBeNull(); expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: attack })).toHaveClass("min-w-0", "max-w-full", "[overflow-wrap:anywhere]");
    expect(details.querySelector("pre")).toHaveClass("whitespace-pre-wrap", "break-all");
  });
  it.each(["queued", "dispatched", "result_ready", "failed", "canceled", "unknown"] as const)("shows only fixed status/metadata for %s", state => {
    const value: ProfitAnalysisPublicRun = { ...run(), state, result: null, errorCode: "UNRECOGNIZED_PRIVATE_ERROR", completedAt: null };
    render(<DefaultReport run={value} />);
    expect(screen.getByRole("status")).toBeVisible(); expect(screen.getByRole("alert")).toHaveTextContent("任务未形成可展示的完成结果");
    expect(screen.queryByText("UNRECOGNIZED_PRIVATE_ERROR")).not.toBeInTheDocument();
    expect(screen.queryByText(/本月利润/u)).not.toBeInTheDocument(); expect(screen.queryByRole("region", { name: "全部聚合依据" })).not.toBeInTheDocument();
  });
  it.each(["mismatched-source", "wrong-finance", "incomplete-success", "extra-field"])("rejects malformed public DTO: %s", corruption => {
    const value = structuredClone(run());
    if (corruption === "mismatched-source") value.sourceHash = "e".repeat(64);
    else if (corruption === "wrong-finance") value.result!.delta = 999;
    else if (corruption === "incomplete-success") value.result = null;
    else Object.assign(value, { secret: "never-display" });
    render(<DefaultReport run={value} />);
    expect(screen.getByRole("alert")).toHaveTextContent("报告结构或来源绑定无法核验");
    expect(screen.queryByText(/Store A/u)).not.toBeInTheDocument(); expect(screen.queryByText("never-display")).not.toBeInTheDocument();
  });
});
