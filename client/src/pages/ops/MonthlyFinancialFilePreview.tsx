import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MonthlyFinancialReportPreview, MonthlyPreviewRow } from "@shared/monthlyFinancialReportPreview";
import { startMonthlyFinancialPreview } from "./monthlyFinancialPreviewTask";

const PAGE_SIZE = 25;
const display = (value: string | null | undefined) => value ?? "未知";
const rowIdentity = (row: MonthlyPreviewRow) => JSON.stringify([row.sheet, row.rowNumber]);
const metricLabels = {
  financialProfit: "源财务利润", salesQty: "销量", salesAmount: "销售额",
  purchaseCost: "采购成本", freight: "头程费用", fbaFee: "FBA费用", commission: "佣金",
  advertising: "广告费用", refundAmount: "退款金额", refundQty: "退款数", returnQty: "退货数",
} as const;

/** A scope-key change destroys the entire local file state, including any active worker. */
export default function MonthlyFinancialFilePreview({ scopeKey }: { scopeKey: string }) {
  return <LocalMonthlyPreview key={scopeKey} />;
}

function LocalMonthlyPreview() {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<ReturnType<typeof startMonthlyFinancialPreview> | null>(null);
  const generation = useRef(0);
  const [preview, setPreview] = useState<MonthlyFinancialReportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const stop = () => {
    generation.current += 1;
    pending.current?.cancel();
    pending.current = null;
  };
  useEffect(() => () => { generation.current += 1; pending.current?.cancel(); }, []);
  const clear = () => {
    stop(); setPreview(null); setFileName(""); setBusy(false); setError(""); setPage(0); setSelected(null);
    if (input.current) input.current.value = "";
  };
  const choose = async (file: File | undefined) => {
    if (!file) return;
    clear();
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      setError("仅支持非空且不超过5MiB的文件；未读取或上传。"); return;
    }
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    if (extension !== "csv" && extension !== "xlsx") {
      setError("仅支持 .xlsx 和 UTF-8 逗号分隔的 .csv；不支持旧 .xls、宏或加密文件。"); return;
    }
    const current = generation.current;
    setFileName(file.name); setBusy(true);
    const task = startMonthlyFinancialPreview(file, extension);
    pending.current = task;
    try {
      const result = await task.promise;
      if (generation.current === current) setPreview(result);
    } catch (cause) {
      if (generation.current === current && !(cause instanceof Error && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "文件预览失败。");
      }
    } finally {
      if (generation.current === current) { setBusy(false); pending.current = null; }
    }
  };
  const rows = preview?.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? [];
  const selectedRow = rows.find(row => rowIdentity(row) === selected);
  const pageCount = Math.max(1, Math.ceil((preview?.rows.length ?? 0) / PAGE_SIZE));

  return <section aria-label="月报本地内存预览" className="mx-auto mt-6 max-w-[1600px] min-w-0 space-y-4 rounded-xl border bg-card p-5">
    <header><h2 className="text-lg font-semibold">月报文件本地预览</h2><p className="mt-2 text-sm text-muted-foreground">仅解析当前文件，不上传、不保存、不替换手工台账或财务快照。离开页面、切换身份或清空即移除预览；没有导入确认功能。</p></header>
    <p className="text-xs leading-6 text-muted-foreground">支持受限 .xlsx 与 UTF-8 逗号 CSV，最大5MiB；含嵌图、共享 / 数组公式或特殊 ZIP 的 Excel 可能被明确拒绝，可核对原表后另存 CSV。有解压、表格规模与20秒处理预算。未知值不补零，费用沿用源正负号，公式缓存不作已计算金额。不猜父体、店铺、站点、币种或月份；同一文件不代表完整月报。原字段可展开核对。</p>
    <div className="flex flex-wrap items-center gap-3">
      <input ref={input} aria-label="选择本地月报文件" type="file" accept=".xlsx,.csv" className="max-w-full text-sm"
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void choose(file); }} />
      <Button variant="outline" size="sm" onClick={clear}>取消并清空预览</Button>
    </div>
    {fileName && <p className="break-all text-sm">当前本地文件：{fileName}</p>}
    {busy && <p role="status" className="text-sm">正在独立本地进程解析；可随时取消…</p>}
    {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
    {preview && <>
      <p className="text-sm">已解析 {preview.rows.length} 行 · {preview.sheets.length} 张表 · {preview.warnings.length} 条提示。仅为文件内容预览，不证明数据真实、完整或有导入权限。</p>
      <details className="rounded-lg border p-3 text-xs"><summary className="cursor-pointer">查看范围与解析提示</summary>
        {preview.sheets.map(sheet => <p className="mt-2 break-all" key={sheet.name}>{sheet.name} · {sheet.range} · 表头行 {sheet.headerRows.join("、")}</p>)}
        {preview.warnings.slice(0, 100).map((warning, index) => <p className="mt-2 break-words" key={index}>{warning.code} · {warning.sheet ?? "文件"}{warning.row ? ` 第${warning.row}行` : ""}：{warning.message}</p>)}
        {preview.warnings.length > 100 && <p className="mt-2">当前列出前100条提示；完整数据行仍可逐页核对，不能视为无其他警告。</p>}
        <p className="mt-3">有完整月份、店铺、站点、币种的范围汇总：{preview.summaries.length} 组；未纳入范围汇总：{preview.excludedFromSummaries.length} 行。本页不跨范围合计，也不将汇总行分摊至产品。</p>
      </details>
      <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs">
        <thead><tr className="border-b">{["原表 / 行", "月份 / 店铺 / 站点", "父 / 子 ASIN", "币种 / 归属", "源财务利润", "销量 / 销售额", "退款 / 退货分母", "证据"].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr className="border-b align-top" key={rowIdentity(row)}>
          <td className="p-3 break-all">{row.sheet} / {row.rowNumber}<br />{row.kind === "summary" ? "源汇总行（非产品）" : "源数据行"}</td>
          <td className="p-3">{display(row.yearMonth)}<br />{display(row.storeName)}<br />{display(row.site)}</td>
          <td className="p-3 break-all">{display(row.parentAsin)}<br />{display(row.asin)}</td>
          <td className="p-3">{display(row.currency)}<br />{row.allocation}</td>
          <td className="p-3 tabular-nums">{display(row.metrics.financialProfit.value)}</td>
          <td className="p-3 tabular-nums">{display(row.metrics.salesQty.value)} / {display(row.metrics.salesAmount.value)}</td>
          <td className="p-3 tabular-nums">退款 {display(row.ratios.refundRate.numerator)} / {display(row.ratios.refundRate.denominator)}<br />退货 {display(row.ratios.returnRate.numerator)} / {display(row.ratios.returnRate.denominator)}<br />{row.ratios.refundRate.reason || row.ratios.returnRate.reason || "分母为源销量；不是订单退款率"}</td>
          <td className="p-3"><Button variant="outline" size="sm" onClick={() => setSelected(selected === rowIdentity(row) ? null : rowIdentity(row))}>查看原字段</Button></td>
        </tr>)}</tbody>
      </table></div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><p>第 {page + 1} / {pageCount} 页 · 每页最多25行</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => { setPage(page - 1); setSelected(null); }}>上一页文件行</Button><Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => { setPage(page + 1); setSelected(null); }}>下一页文件行</Button></div></div>
      {selectedRow && <section aria-label="所选月报原字段" className="min-w-0 space-y-3 rounded-lg border p-4 text-xs">
        <h3 className="font-semibold">{selectedRow.sheet} 第 {selectedRow.rowNumber} 行 · 原字段与解析依据</h3>
        {Object.entries(metricLabels).map(([key, label]) => {
          const metric = selectedRow.metrics[key as keyof typeof metricLabels];
          return <p className="break-all" key={key}>{label}：{display(metric.value)} · 依据 {metric.sources.join("、") || "无"} · 未知来源 {metric.unknownSources.join("、") || "无"}{metric.absent ? " · 源列缺失" : ""}</p>;
        })}
        <p>源利润率分子 / 分母：{display(selectedRow.ratios.profitMargin.numerator)} / {display(selectedRow.ratios.profitMargin.denominator)}；{selectedRow.ratios.profitMargin.reason || `精确分数 ${selectedRow.ratios.profitMargin.fraction}（非百分比）`}</p>
        <div className="max-h-80 overflow-auto"><table className="w-full table-fixed"><thead><tr><th className="w-20 p-2 text-left">单元格</th><th className="p-2 text-left">源值（含公式缓存）与公式</th></tr></thead><tbody>{selectedRow.cells.map(cell => <tr key={cell.address} className="border-t"><td className="p-2 align-top">{cell.address}</td><td className="break-all whitespace-pre-wrap p-2">{cell.value === null ? "空白" : String(cell.value)}{cell.formula ? `\n公式：${cell.formula}（不采用缓存金额）` : ""}{cell.error ? "\n错误单元格" : ""}</td></tr>)}</tbody></table></div>
      </section>}
    </>}
  </section>;
}
