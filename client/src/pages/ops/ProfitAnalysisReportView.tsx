import { useState, type ReactNode } from "react";
import { MONTHLY_FINANCIAL_METRICS } from "@shared/monthlyFinancialReadDetails";
import { type ProfitAnalysisAggregate, type ProfitAnalysisMetric, type ProfitAnalysisResult, type ProfitEvidence } from "@shared/profitAnalysis";
import { ProfitAnalysisPublicRunSchema, type ProfitAnalysisPublicRun } from "@shared/profitAnalysisWorkflowRead";

const metricLabels: Record<ProfitAnalysisMetric, string> = {
  financialProfit: "财务利润", salesQty: "销量", salesAmount: "销售额", otherIncome: "其他收入", discount: "促销折扣",
  purchaseCost: "采购成本总额", freight: "头程费用总额", fbaFee: "FBA费用", commission: "销售佣金", advertising: "广告支出",
  promotion: "推广费", storage: "仓储费", otherFees: "其他费用", refundAmount: "退款金额", refundQty: "退款量", returnQty: "退货量",
  ld: "LD费用", coupon: "优惠券费用", vine: "Vine费用", avgPrice: "平均售价（受子体销售结构影响）", profitMargin: "利润率",
  unit_purchaseCost: "单件采购成本", unit_freight: "单件头程费用", unit_fbaFee: "单件FBA费用", unit_commission: "单件销售佣金",
};
const statuses: Record<ProfitAnalysisPublicRun["state"], string> = {
  queued: "后台排队中", dispatched: "已派发，等待结果", result_ready: "已收到结果，等待本地完成", succeeded: "生成完成",
  failed: "生成未完成", canceled: "已取消", unknown: "结果未知；请检查同一任务，不要自动重新生成",
};
const errorLabels: Record<string, string> = {
  SOURCE_CHANGED: "财务来源已变化，需要重新核对。", ACCESS_DENIED: "当前权限已变化。", CONFIGURATION_UNAVAILABLE: "批准的运行配置当前不可用。",
  SOURCE_UNAVAILABLE: "完整来源或批准配置当前不可用。", LEASE_LOST: "任务租约已失效，请检查同一任务。",
  MODEL_RESULT_UNKNOWN: "模型执行结果尚未确认；不要自动重新生成。", WRITES_DISABLED: "生成写入当前未启用。",
};
// Preserve the server's numbers, signs and precision. No browser-side financial calculation or rounding.
const numberText = (value: number | null) => value === null ? "未知 / 未提供" : String(value);
const percentage = (value: number | null) => value === null ? "不可计算（上期非正或数值未知）" : `${numberText(value)}%`;
const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";
function unitText(unit: ProfitEvidence["unit"], currency: string | null) {
  return unit === "quantity" ? "数量" : unit === "fraction" ? "比例原值（1 = 100%）" : unit === "currency_per_unit" ? `${currency ?? "币种未知"} / 件` : currency ?? "币种未知";
}
function JsonText({ value }: { value: unknown }) {
  return <pre className="min-w-0 max-w-full whitespace-pre-wrap break-all rounded bg-muted/40 p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}
/** Lazy presentation only: all records remain reachable, but closed details do
 * not mount thousands of financial cells or original references at once. */
function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className="min-w-0 max-w-full" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer py-2 text-sm">{title}</summary>{open && children}
  </details>;
}
function Provenance({ item, aggregates }: { item: ProfitEvidence; aggregates: Map<string, ProfitAnalysisAggregate> }) {
  return <Disclosure title="查看此原因的前后原行、分子分母与口径">
    {(["before", "after"] as const).map(side => {
      const provenance = item.provenance[side], aggregate = aggregates.get(provenance.aggregateId)!;
      return <div key={side} className="space-y-2 border-t py-2">
        <h6 className="font-medium">{side === "before" ? "上月" : "本月"}依据 · {aggregate.month}</h6>
        <p>聚合编号：{provenance.aggregateId}；指标：{metricLabels[provenance.metric]}</p>
        <p>分子：{numberText(provenance.numerator)}；分母：{numberText(provenance.denominator)}；口径：{provenance.basis}</p>
        <JsonText value={{ sourceRows: aggregate.sourceRows, titles: aggregate.titles, skus: aggregate.skus, rawPaths: aggregate.rawPaths }} />
      </div>;
    })}
  </Disclosure>;
}
function AggregateCard({ aggregate, currency }: { aggregate: ProfitAnalysisAggregate; currency: string }) {
  return <article data-testid="profit-aggregate" data-aggregate-id={aggregate.id} className="min-w-0 rounded border p-3">
    <h6 className="font-medium">{aggregate.month} · {aggregate.level === "parent" ? "父体汇总" : `子体 ${aggregate.asin}`}</h6>
    <p className="text-xs">聚合编号：{aggregate.id}；原行数：{aggregate.rowCount}</p>
    <Disclosure title="展开完整指标与原行依据">
      <dl className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
        {MONTHLY_FINANCIAL_METRICS.map(metric => <div key={metric} className="min-w-0 rounded bg-muted/30 p-2">
          <dt>{metricLabels[metric]}</dt><dd>{numberText(aggregate.metrics[metric])} {metric === "salesQty" || metric === "refundQty" || metric === "returnQty" ? "数量" : currency}</dd>
        </div>)}
      </dl>
      <h6 className="mt-3 font-medium">完整加权均值与比率（不平均相加）</h6>
      <dl className="space-y-2 text-sm">
        {Object.entries(aggregate.averages).map(([metric, average]) => <div key={metric} className="rounded border p-2">
          <dt>{metricLabels[`unit_${metric}` as ProfitAnalysisMetric]}</dt>
          <dd>值：{numberText(average.value)} {currency} / 件；分子：{numberText(average.numerator)}；分母：{numberText(average.denominator)}</dd>
          <dd>原报表均值行：{average.reportedRows}；由总额计算行：{average.calculatedRows}；口径：{average.basis}</dd>
          <dd>缺失说明：{average.missingReason ?? "无"}</dd>
        </div>)}
        {(["avgPrice", "profitMargin"] as const).map(metric => <div key={metric} className="rounded border p-2">
          <dt>{metricLabels[metric]}</dt><dd>值：{numberText(aggregate[metric].value)} {aggregate[metric].unit === "fraction" ? "比例原值（1 = 100%）" : `${currency} / 件`}；分子：{numberText(aggregate[metric].numerator)}；分母：{numberText(aggregate[metric].denominator)}</dd>
          <dd>口径：{aggregate[metric].basis}；缺失说明：{aggregate[metric].missingReason ?? "无"}</dd>
        </div>)}
      </dl>
      <h6 className="mt-3 font-medium">完整标题、SKU、原行编号与原字段路径</h6>
      <JsonText value={{ titles: aggregate.titles, skus: aggregate.skus, sourceRows: aggregate.sourceRows, rawPaths: aggregate.rawPaths }} />
    </Disclosure>
  </article>;
}
function RunMetadata({ run }: { run: ProfitAnalysisPublicRun }) {
  return <dl className="min-w-0 space-y-1 text-xs">
    <div><dt className="inline">生成编号：</dt><dd className="inline">{run.operationId}</dd></div>
    <div><dt className="inline">来源哈希：</dt><dd className="inline break-all">{run.sourceHash ?? "未形成"}</dd></div>
    <div><dt className="inline">结果哈希：</dt><dd className="inline break-all">{run.resultHash ?? "未形成"}</dd></div>
    <div><dt className="inline">创建时间：</dt><dd className="inline">{run.createdAt}</dd></div>
    <div><dt className="inline">更新时间：</dt><dd className="inline">{run.updatedAt}</dd></div>
    <div><dt className="inline">完成时间：</dt><dd className="inline">{run.completedAt ?? "未完成"}</dd></div>
    <p>时间为数据库原始时间，未推断时区。</p>
  </dl>;
}
function SuccessfulReport({ run, result, label }: { run: ProfitAnalysisPublicRun; result: ProfitAnalysisResult; label?: string }) {
  const [offset, setOffset] = useState(0), size = 25, aggregates = new Map(result.aggregates.map(row => [row.id, row]));
  return <section aria-label={label ?? "利润分析报告"} className="manus-no-record min-w-0 max-w-full space-y-4 [overflow-wrap:anywhere]">
    <h4 className="text-lg font-semibold">{label ?? "利润分析报告"}</h4>
    {run.stale === true ? <p role="alert" className="rounded border border-amber-600 bg-amber-50 p-3 font-semibold text-amber-950">历史结果已过期，或当前来源无法核验。以下为生成时快照，不代表当前财务数据，不能作为最新分析。</p>
      : <p className="text-sm">{run.stale === null ? "当前新鲜度未知；以下仅为生成时快照。" : "来源在最近一次服务端读取时一致；这不是实时数据，来源变化后需重新核对。"}</p>}
    <p className="text-sm">{result.scope.storeName} / {result.scope.country} / {result.scope.parentAsin} / {result.scope.currency} / {result.scope.basis === "child_rows" ? "子体原行汇总" : "原报表父体合计"}</p>
    <div className="rounded border p-3">
      <h5 className="font-semibold">本月利润{result.delta > 0 ? "上涨" : result.delta < 0 ? "下滑" : "持平"}{result.severity === null ? "" : ` · ${result.severity}`}</h5>
      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt>上月 {result.previousMonth}</dt><dd>{numberText(result.before)} {result.scope.currency}</dd></div>
        <div><dt>本月 {result.month}</dt><dd>{numberText(result.after)} {result.scope.currency}</dd></div>
        <div><dt>差额</dt><dd>{numberText(result.delta)} {result.scope.currency}</dd></div>
        <div><dt>变化百分比</dt><dd>{percentage(result.changePercent)}</dd></div>
      </dl>
    </div>
    {result.modelCalled ? <p>模型从系统计算的证据中选择说明；数字与顺序沿用已保存结果，变化不等于已证明因果。</p>
      : <p role="status" className="rounded border p-3">系统确定性结果：没有可比较的已知指标变化；未调用 AI，也不是 AI 判断业务正常。缺失指标或覆盖变化仍需查看。</p>}
    <p className="whitespace-pre-wrap text-sm">{result.note}</p>
    <h5 className="font-semibold">原因说明（{result.reasons.length} 条，按已保存顺序）</h5>
    <ol className="space-y-3">{result.reasons.map((item, index) => <li key={item.id} data-testid="profit-reason" className="min-w-0 rounded border p-3">
      <h6 className="font-medium">{index + 1}. {item.title}</h6><p className="text-xs">{item.level === "parent" ? "父体" : `子体 ${item.asin}`} · {metricLabels[item.metric]} · 证据 {item.id}</p>
      <p>上月 {numberText(item.before)} → 本月 {numberText(item.after)}；差额 {numberText(item.delta)}；变化 {percentage(item.changePercent)}；单位：{unitText(item.unit, item.currency)}</p>
      <p className="whitespace-pre-wrap">{item.explanation}</p><Provenance item={item} aggregates={aggregates} />
    </li>)}</ol>
    <section aria-label="覆盖与缺失说明" className="min-w-0 space-y-2 rounded border p-3">
      <h5 className="font-semibold">覆盖与缺失说明</h5>
      {!result.coverage.sameChildCoverage && <p role="alert">两月子体覆盖不同，缺失子体不补零；父体变化可能包含销售结构变化。</p>}
      <p>上月原行 {result.coverage.previousRows} 条；本月原行 {result.coverage.currentRows} 条；可比较子体 {result.coverage.comparableAsins.length} 个；未知指标 {result.coverage.missingValues.length} 项。</p>
      <p>{result.coverage.note}</p>
      <Disclosure title="查看全部覆盖子体与缺失指标（无截断）"><JsonText value={result.coverage} /></Disclosure>
    </section>
    <section aria-label="全部聚合依据" className="min-w-0 space-y-3">
      <h5 className="font-semibold">全部聚合依据（{result.aggregates.length} 项）</h5>
      <nav aria-label="聚合依据分页" className="flex flex-wrap items-center gap-2 text-sm">
        <span aria-live="polite">{offset + 1}–{Math.min(offset + size, result.aggregates.length)} / {result.aggregates.length}；每页 25 项，全部可查看</span>
        <button type="button" className={buttonClass} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - size))}>聚合上一页</button>
        <button type="button" className={buttonClass} disabled={offset + size >= result.aggregates.length} onClick={() => setOffset(offset + size)}>聚合下一页</button>
      </nav>
      {result.aggregates.slice(offset, offset + size).map(aggregate => <AggregateCard key={aggregate.id} aggregate={aggregate} currency={result.scope.currency!} />)}
    </section>
    <section aria-label="结果来源与时间" className="min-w-0 space-y-2 rounded border p-3">
      <h5 className="font-semibold">结果来源与时间</h5><RunMetadata run={run} />
      <p className="break-all text-xs">选源证明哈希：{result.selectionHash}</p><p className="break-all text-xs">授权证明哈希：{result.authorizationHash}</p>
    </section>
  </section>;
}

/** Pure, defensive presentation of the authorized public DTO. The workflow
 * owns identity/scope matching, all requests, freshness rechecks and actions. */
export function ProfitAnalysisReportView({ run, label }: { run: ProfitAnalysisPublicRun; label?: string }) {
  let parsed: ProfitAnalysisPublicRun;
  try { parsed = ProfitAnalysisPublicRunSchema.parse(run); }
  catch { return <p role="alert">报告结构或来源绑定无法核验；未显示财务内容。</p>; }
  if (parsed.state !== "succeeded" || !parsed.result) return <section aria-label={label ?? "利润分析报告"} className="manus-no-record min-w-0 max-w-full space-y-2 [overflow-wrap:anywhere]">
    <h4 className="font-semibold">{label ?? "利润分析报告"}</h4><p role="status">{statuses[parsed.state]}</p>
    {parsed.errorCode && <p role="alert">{errorLabels[parsed.errorCode] ?? "任务未形成可展示的完成结果，请通过同一任务检查状态。"}</p>}
    <p>尚无可展示的完成报告；这里不推断利润或原因。取消不表示撤回已发生的模型调用或删除已保存报告。</p><RunMetadata run={parsed} />
  </section>;
  return <SuccessfulReport key={`${parsed.operationId}:${parsed.resultHash}:${parsed.sourceHash}`} run={parsed} result={parsed.result} label={label} />;
}

export default ProfitAnalysisReportView;
