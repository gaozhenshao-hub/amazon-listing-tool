import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { subscribeMonthlyFinancialChanges } from "./monthlyFinancialWriteEvents";
import { ProfitAnalysisPreviewInputSchema, ProfitAnalysisPreviewResultSchema,
  type ProfitAnalysisPreviewInput, type ProfitAnalysisPreviewResult, type ProfitAnalysisScope, type ProfitEvidence } from "@shared/profitAnalysis";

type Identity = { userId: number; workspaceId: number };
type Props = { identity: Identity; scope: ProfitAnalysisScope; months: string[] };
type State = { status: "idle" | "loading" | "error" | "changed" } | { status: "ready"; result: ProfitAnalysisPreviewResult };
const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";
const text = (value: number | null) => value === null ? "未知 / 不可比较" : value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
const reasonLabels: Record<string, string> = {
  current_month_missing: "本月缺少该范围的完整来源", previous_month_missing: "上月缺少该范围的完整来源",
  currency_unknown: "币种未核验，不能进行金额分析", previous_profit_unknown: "上月原报表利润未知", current_profit_unknown: "本月原报表利润未知",
};
function evidenceUnit(item: ProfitEvidence) {
  return item.unit === "quantity" ? "数量" : item.unit === "fraction" ? "比例原值（1 = 100%）"
    : item.unit === "currency_per_unit" ? `${item.currency} / 件` : item.currency;
}

/** The complete evidence list is paged locally, never truncated or submitted as
 * client facts. This is preparation, not generated AI reasons or a saved report. */
export function ProfitAnalysisEvidenceView({ result }: { result: ProfitAnalysisPreviewResult }) {
  const [offset, setOffset] = useState(0), evidence = result.evidence, source = result.source, size = 12;
  if (result.status === "unavailable" || !evidence || !source) return <p role="alert">双月来源当前无法完整核验，未返回部分分析依据。请核对月报、范围和权限后重新读取。状态：{result.reasonCode}</p>;
  return <div className="min-w-0 space-y-3">
    <p>比较范围：{source.scope.storeName} / {source.scope.country} / {source.scope.parentAsin} / {source.scope.currency ?? "币种未知"} / {source.scope.basis === "child_rows" ? "子体原行汇总" : "原报表父体合计"}</p>
    <p>{source.previousMonth}：{text(evidence.parentBefore)} → {source.month}：{text(evidence.parentAfter)} {source.scope.currency ?? "币种未知"}；差额 {text(evidence.delta)}；变化 {evidence.changePercent === null ? "不可计算（缺失、上期为零或负数）" : `${text(evidence.changePercent)}%`}。</p>
    <ul>{source.periods.map(period => <li key={period.month}>{period.month}：{period.selection.scopeRowCount} 条完整授权范围原行；{period.selection.selectedBatchId === null ? "未找到有效批次" : `批次 ${period.selection.selectedBatchId}`}。</li>)}</ul>
    <p className="text-xs">选择同月 / 店铺 / 国家最新已确认批次，再核对本父体范围；最早月份也独立读取其上月，不从六个月图或分页数据拼分析输入。</p>
    {result.status === "blocked" && <p role="alert">暂不能形成可用分析依据：{evidence.blockingReasons.map(code => reasonLabels[code] ?? code).join("；")}。未调用模型。</p>}
    {!evidence.coverage.sameChildCoverage && <p role="alert">两月子体覆盖不同：仅上月 {evidence.coverage.onlyPreviousAsins.join("、") || "无"}；仅本月 {evidence.coverage.onlyCurrentAsins.join("、") || "无"}。缺失子体不补零。</p>}
    <p>{evidence.coverage.note}。尚有 {evidence.coverage.missingValues.length} 项指标缺失；不将未知补成零。</p>
    <h5 className="font-medium">全部可比较变化证据（{evidence.evidence.length} 项）</h5>
    {!evidence.evidence.length ? <p>没有可比较的已知指标变化；这不是 AI 结论，也不表示业务正常或所有指标不变。</p> : <>
      <nav aria-label="利润分析证据分页" className="flex flex-wrap items-center gap-3 text-sm"><span>{offset + 1}–{Math.min(offset + size, evidence.evidence.length)} / {evidence.evidence.length}，全部可逐页查看</span>
        <button type="button" className={buttonClass} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - size))}>证据上一页</button>
        <button type="button" className={buttonClass} disabled={offset + size >= evidence.evidence.length} onClick={() => setOffset(offset + size)}>证据下一页</button>
      </nav>
      <div role="region" aria-label="完整利润变化证据" tabIndex={0} className="min-w-0 max-w-full overflow-auto rounded border"><table className="min-w-[900px] w-full text-left text-xs"><thead><tr>{["证据", source.previousMonth, source.month, "差额", "变化百分比", "单位与来源"].map(title => <th key={title} className="p-2">{title}</th>)}</tr></thead>
        <tbody>{evidence.evidence.slice(offset, offset + size).map(item => <tr key={item.id} className="border-t align-top"><th scope="row" className="max-w-72 break-words p-2 font-normal">{item.title}</th>
          <td className="p-2">{text(item.before)}</td><td className="p-2">{text(item.after)}</td><td className="p-2">{text(item.delta)}</td><td className="p-2">{item.changePercent === null ? "不可计算" : `${text(item.changePercent)}%`}</td>
          <td className="max-w-lg p-2">{evidenceUnit(item)}<details><summary className="cursor-pointer">原行引用、分母与口径</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify({ provenance: item.provenance, aggregates: evidence.aggregates.filter(aggregate => [item.provenance.before.aggregateId, item.provenance.after.aggregateId].includes(aggregate.id)) }, null, 2)}</pre></details></td>
        </tr>)}</tbody></table></div>
    </>}
    <details><summary className="cursor-pointer">完整覆盖与来源快照标识</summary><pre className="max-w-full whitespace-pre-wrap break-all text-xs">{JSON.stringify({ source, coverage: evidence.coverage }, null, 2)}</pre></details>
  </div>;
}

function OwnedPreview({ identity, scope, months }: Props) {
  const client = trpc.useUtils().client, [month, setMonth] = useState(months.at(-1) ?? ""), [state, setState] = useState<State>({ status: "idle" });
  const sequence = useRef(0), pending = useRef<AbortController | null>(null), opened = useRef(false);
  function clear(status: "idle" | "changed" = "idle") { sequence.current++; pending.current?.abort(); pending.current = null; opened.current = false; setState({ status }); }
  useEffect(() => () => { sequence.current++; pending.current?.abort(); }, []);
  useEffect(() => subscribeMonthlyFinancialChanges(notice => {
    if (notice.workspaceId === identity.workspaceId && notice.action !== "upload" && opened.current) clear("changed");
  }), [identity.workspaceId]);
  async function read() {
    clear();
    const parsed = ProfitAnalysisPreviewInputSchema.safeParse({ expectedWorkspaceId: identity.workspaceId, scope, month });
    if (!parsed.success || !months.includes(month)) { setState({ status: "error" }); return; }
    const input: ProfitAnalysisPreviewInput = parsed.data, ticket = ++sequence.current, controller = new AbortController();
    pending.current = controller; opened.current = true; setState({ status: "loading" });
    const current = () => ticket === sequence.current && !controller.signal.aborted;
    try {
      const raw = await client.profitAnalysis.preview.query(input, { signal: controller.signal });
      if (!current()) return;
      const result = ProfitAnalysisPreviewResultSchema.parse(raw);
      if (result.identity.userId !== identity.userId || result.identity.workspaceId !== identity.workspaceId
        || JSON.stringify(result.request) !== JSON.stringify(input)) throw new Error("PROFIT_ANALYSIS_SCOPE_CHANGED");
      if (current()) setState({ status: "ready", result });
    } catch { if (current()) { opened.current = false; setState({ status: "error" }); } }
    finally { if (current()) pending.current = null; }
  }
  return <section aria-label="利润分析依据预览" className="manus-no-record min-w-0 max-w-full space-y-3 rounded border p-3">
    <h4 className="font-semibold">利润分析 · 双月依据预览</h4>
    <p className="text-sm">只读取已确认月报并计算证据，不调用模型、不生成草稿、不保存财务数据。青岛利润 Skill 与专属持久执行流程尚未启用。</p>
    <p className="text-xs text-muted-foreground">预览是读取时的来源快照，并非实时同步；其他标签页或外部月报更新后，请重新读取。</p>
    <label className="block text-sm">分析月份<select aria-label="利润分析月份" className="ml-3 rounded border bg-background p-2" value={month} onChange={event => { clear(); setMonth(event.currentTarget.value); }}>{months.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    <div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={state.status === "loading"} onClick={() => { void read(); }}>读取双月分析依据</button><button type="button" className={buttonClass} onClick={() => clear()}>清除分析依据</button></div>
    {state.status === "loading" && <p role="status">正在核对两个月完整来源与当前权限…</p>}
    {state.status === "changed" && <p role="status">月报已变化，旧依据已清除；请显式重新读取。</p>}
    {state.status === "error" && <p role="alert">分析依据读取失败，或身份、权限、来源及返回范围已变化。旧依据已清除；没有调用模型、自动重试或保存结果。</p>}
    {state.status === "ready" && <ProfitAnalysisEvidenceView key={sequence.current} result={state.result} />}
  </section>;
}
export default function ProfitAnalysisPreview(props: Props) {
  const auth = useAuth(), permissions = usePermissions(), user = auth.user;
  if (auth.loading || permissions.isLoading) return <p role="status">正在确认分析依据读取权限…</p>;
  if (auth.error || !user || user.id !== props.identity.userId || user.defaultWorkspaceId !== props.identity.workspaceId
    || !permissions.canRead("ops", "ops_dashboard") || !permissions.canRead("ops", "ops_profit")) return <p role="alert">当前没有该产品分析依据读取权限；未保留旧依据。</p>;
  return <OwnedPreview key={JSON.stringify([props.identity, props.scope, props.months, user.role])} {...props} />;
}
