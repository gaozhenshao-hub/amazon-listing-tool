import { Fragment, useState } from "react";
import type { MonthlyFinancialAggregate, MonthlyFinancialReadRow } from "@shared/monthlyFinancialRead";
import type { ProfitBoardPoint } from "@shared/profitBoardRead";
import { FinancialDetailsContent } from "./MonthlyFinancialReadOnly";

// The friend's month + 19-column view. Amounts, ratios and weighted averages
// come from the existing monthly-financial aggregation contract, not a second
// client-side financial formula or a model input assembled from this page.
const COLUMNS = [
  ["financialProfit", "财务毛利润"], ["profitMargin", "利润率"], ["salesQty", "销量"],
  ["salesAmount", "销售额"], ["otherIncome", "其他收入"], ["discount", "促销折扣"],
  ["purchaseCost", "采购成本"], ["freight", "头程费用"], ["fbaFee", "FBA 配送费"],
  ["commission", "销售佣金"], ["advertising", "广告费"], ["promotion", "推广费"],
  ["storage", "仓储费"], ["otherFees", "其他费用"], ["refundAmount", "退款金额"],
  ["refundQty", "退款量"], ["refundRate", "退款率"], ["returnQty", "退货量"], ["returnRate", "退货率"],
] as const;
type Column = typeof COLUMNS[number][0];
const EXPANDABLE = new Set<Column>(["salesAmount", "otherIncome", "discount", "purchaseCost", "freight", "fbaFee", "commission", "advertising", "promotion"]);
const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";
const ROW_LIMIT = 20;
const refKey = (row: { batchId: number; rowIndex: number }) => `${row.batchId}:${row.rowIndex}`;
const groupKey = (group: MonthlyFinancialAggregate) => JSON.stringify([group.scope, group.dimension, group.basis, group.parentAsin, group.asin, group.sourceRows]);
function valueFor(group: MonthlyFinancialAggregate, key: Column) {
  return key === "profitMargin" || key === "refundRate" || key === "returnRate" ? group.details.ratios[key].value : group.metrics[key];
}
function displayValue(group: MonthlyFinancialAggregate | null, key: Column) {
  const value = group ? valueFor(group, key) : null;
  if (value === null) return "未知 / 未提供";
  if (key === "profitMargin" || key === "refundRate" || key === "returnRate") return `${(value * 100).toLocaleString("zh-CN", { maximumFractionDigits: 4 })}%`;
  if (key === "salesQty" || key === "refundQty" || key === "returnQty") return value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
function MonthlySources({ group, rows }: { group: MonthlyFinancialAggregate; rows: MonthlyFinancialReadRow[] }) {
  const [offset, setOffset] = useState(0);
  const refs = new Set(group.sourceRows.map(refKey)), sources = rows.filter(row => refs.has(refKey(row)));
  return <section aria-label={`${group.scope.yearMonth} 月表完整来源`} className="min-w-0 space-y-3">
    <h6 className="font-medium">本月全部来源原行（{sources.length} 行）</h6>
    <p>店铺 {group.scope.storeName} / {group.scope.country} / {group.scope.currency ?? "币种未知（仅原值）"}。批次和原行仅作证据，不是下载链接。</p>
    {sources.length !== refs.size ? <p role="alert">本月来源引用与已返回原行不一致，不能将部分原行称为完整月报。</p> : <>
      <nav aria-label="月表来源分页" className="flex flex-wrap items-center gap-3">
        <span>{offset + 1}–{Math.min(offset + ROW_LIMIT, sources.length)} / {sources.length}，全部可逐页查看</span>
        <button type="button" className={buttonClass} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - ROW_LIMIT))}>月表来源上一页</button>
        <button type="button" className={buttonClass} disabled={offset + ROW_LIMIT >= sources.length} onClick={() => setOffset(offset + ROW_LIMIT)}>月表来源下一页</button>
      </nav>
      {sources.slice(offset, offset + ROW_LIMIT).map(row => <article key={refKey(row)} className="min-w-0 space-y-1 rounded border p-3">
        <p>批次 {row.batchId} / 原行索引 {row.rowIndex} · {row.yearMonth} · {row.storeName} / {row.site}（{row.country}）</p>
        <p>父体 {row.parentAsin || "未分配"} · 子体 {row.asin || "未提供"} · SKU {row.sku || "未提供"} · {row.title || "名称未提供"}</p>
        <p>来源运营人（非授权依据）：{row.operator ?? "未提供"} · 币种 {row.currency ?? "未知"} · {row.currencyEvidence.note}</p>
        <details><summary className="cursor-pointer">批次 {row.batchId} 原行 {row.rowIndex} 的全部原文与口径</summary><pre className="max-w-full whitespace-pre-wrap break-all text-xs">{JSON.stringify(row, null, 2)}</pre></details>
      </article>)}
    </>}
  </section>;
}

/** Complete six-period monthly presentation. It performs no RPC or AI work. */
export function ProfitMonthlyDetails({ label, groups, points, rows }: {
  label: string; groups: MonthlyFinancialAggregate[]; points: ProfitBoardPoint[]; rows: MonthlyFinancialReadRow[];
}) {
  const [expanded, setExpanded] = useState<{ key: string; field: string } | null>(null), [offset, setOffset] = useState(0);
  const entries = [...points].reverse().flatMap<{ point: ProfitBoardPoint; group: MonthlyFinancialAggregate | null; key: string }>(point => {
    const monthly = groups.filter(group => group.scope.yearMonth === point.month);
    return monthly.length ? monthly.map(group => ({ point, group, key: groupKey(group) })) : [{ point, group: null, key: point.month }];
  });
  function toggle(key: string, field: string) { setExpanded(current => current?.key === key && current.field === field ? null : { key, field }); }
  return <div className="min-w-0 max-w-full space-y-2">
    <p className="text-xs">当前接口仅含以上六个月，非全部历史月份。每行保留同月 / 同店铺 / 同国家 / 同币种及汇总依据；金额未转换币种。点击收入或费用查看完整明细、分母、加权均价和来源。</p>
    {entries.length > ROW_LIMIT && <nav aria-label={`${label}月表分页`} className="flex flex-wrap gap-3 text-sm"><span>{offset + 1}–{Math.min(offset + ROW_LIMIT, entries.length)} / {entries.length}</span><button type="button" className={buttonClass} disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - ROW_LIMIT)); setExpanded(null); }}>月表上一页</button><button type="button" className={buttonClass} disabled={offset + ROW_LIMIT >= entries.length} onClick={() => { setOffset(offset + ROW_LIMIT); setExpanded(null); }}>月表下一页</button></nav>}
    <div role="region" aria-label={label} tabIndex={0} className="min-w-0 max-w-full max-h-[70vh] overflow-auto rounded border focus-visible:outline focus-visible:outline-2">
      <table className="w-full min-w-[2600px] text-right text-xs"><thead className="sticky top-0 z-20 bg-muted"><tr><th scope="col" className="sticky left-0 z-30 min-w-52 bg-muted p-3 text-left">月份 / 来源</th>{COLUMNS.map(([key, title]) => <th scope="col" className="whitespace-nowrap p-3" key={key}>{title}</th>)}</tr></thead>
        <tbody>{entries.slice(offset, offset + ROW_LIMIT).map(({ point, group, key }) => <Fragment key={key}>
          <tr className="border-t align-top hover:bg-muted/20"><th scope="row" className="sticky left-0 z-10 w-56 max-w-56 whitespace-normal break-words bg-background p-3 text-left font-normal"><strong>{point.month}</strong>
            {group ? <><p>{group.scope.currency ?? "币种未知（原值）"} · {group.rowCount} 条原行</p><p>{group.missingReason}</p><button type="button" className="mt-2 rounded text-primary underline underline-offset-4 focus-visible:outline" aria-expanded={expanded?.key === key && expanded.field === "来源"} onClick={() => toggle(key, "来源")}>{point.month} 查看本月全部来源</button></> : <p>{point.missingReason ?? "此月没有当前可见原行，不补零或旧批次。"}</p>}
          </th>{COLUMNS.map(([column, title]) => <td key={column} className={`whitespace-nowrap p-3 tabular-nums ${group && (valueFor(group, column) ?? 0) < 0 ? "text-red-600" : ""}`}>
            {group && EXPANDABLE.has(column) ? <button type="button" aria-label={`${label} ${point.month} ${title}明细`} aria-expanded={expanded?.key === key && expanded.field === title} className="rounded text-primary underline underline-offset-4 focus-visible:outline" onClick={() => toggle(key, title)}>{displayValue(group, column)} {expanded?.key === key && expanded.field === title ? "▴" : "▾"}</button> : displayValue(group, column)}
          </td>)}</tr>
          {group && expanded?.key === key && <tr><td colSpan={20} className="border-t bg-muted/20 text-left"><section aria-label={`${label} ${point.month} ${expanded.field}完整明细`} className="sticky left-0 w-[min(75vw,1100px)] min-w-0 max-w-full space-y-4 whitespace-normal p-3">
            <h5 className="font-semibold">{point.month} · {expanded.field}明细 · {group.scope.currency ?? "币种未知（保留原值）"}</h5>
            <p>财务毛利润采用保存原值，不用不完整费用重算。费用为存量标准化净支出，负数可为退回或冲减，原始符号另列。比例分母缺失或非正时未知，不平均各行比例。</p>
            <FinancialDetailsContent details={group.details} />
            <MonthlySources key={key} group={group} rows={rows} />
          </section></td></tr>}
        </Fragment>)}</tbody>
      </table>
    </div>
  </div>;
}
