import { useState, type ReactNode } from "react";
import type { OperationsBoardEditionReadResult, OperationsBoardEditionSource } from "@shared/operationsBoardEdition";

type SourceHeader = Pick<OperationsBoardEditionReadResult, "sources" | "visibility" | "coverage">;
const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";
const originLabels = { uploaded_file: "上传文件", saihu_sync: "ERP 同步", unknown: "来源类型未知" };

/** An archived source is not a live upload record. Never synthesize filenames,
 * uploader identities, upload times or whole-batch row counts for this header. */
export function EditionSourceProof({ source, month }: { source?: OperationsBoardEditionSource; month: string }) {
  return <section aria-label={`${month} 归档来源证据`} className="min-w-0 space-y-2 rounded border p-3 text-sm">
    <h4 className="font-medium">{month} · 版本内来源</h4>
    {source ? <><p>批次 ID {source.batchId} · 本次授权范围 {source.rowCount} 个原行（不是整批／整店行数）</p>
      <p>来源类型：{originLabels[source.origin.kind]} · 来源运行 ID：{source.origin.sourceRunId ?? "未保存"}</p>
      <p className="break-all">归档记录哈希：{source.recordHash}</p><p>原始哈希依据：{source.origin.hashBasis}</p>
      <p>未保存完整上传元信息；不推测文件名、上传者或上传时间。</p></> : <p>该版本在当前授权范围内没有此月原行；不补零、不从实时批次或更早版本补齐。</p>}
  </section>;
}

export function EditionSourceHistory({ header }: { header: SourceHeader }) {
  const [offset, setOffset] = useState(0), size = 20;
  return <section aria-label="归档完整历史来源" className="min-w-0 space-y-3">
    <h3 className="font-semibold">此版本全部可见历史来源</h3>
    <p className="text-sm">已返回此版本当前授权范围的全部 {header.coverage.rowCount} 个原行、{header.sources.length} 个来源月份；不是全店月报覆盖保证。历史来源运营原文不等于当前数字负责人授权。</p>
    <nav aria-label="归档历史来源分页" className="flex flex-wrap items-center gap-3 text-sm">
      <button type="button" className={buttonClass} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - size))}>归档来源上一页</button>
      <span>{header.sources.length ? `${offset + 1}–${Math.min(offset + size, header.sources.length)} / ${header.sources.length}` : "0 / 0"}</span>
      <button type="button" className={buttonClass} disabled={offset + size >= header.sources.length} onClick={() => setOffset(offset + size)}>归档来源下一页</button>
    </nav>
    {header.sources.slice(offset, offset + size).map(source => <details key={source.month} className="min-w-0 rounded border p-3"><summary className="cursor-pointer text-sm">{source.month} · 来源批次 {source.batchId} · {source.rowCount} 行</summary><EditionSourceProof source={source} month={source.month} /></details>)}
  </section>;
}

export function EditionMonthSources({ months, sources }: { months: string[]; sources: OperationsBoardEditionSource[] }) {
  const [month, setMonth] = useState(months.at(-1) ?? "");
  return <section aria-label="六个月数据入口" className="space-y-3"><h3 className="font-semibold">版本内六个月数据与来源</h3>
    <p className="text-xs">始终以选中版本月份为基准。选择月份只查看该版本内的来源，不会切换到实时数据或改写归档。</p>
    <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{months.map(value => <button type="button" className={`${buttonClass} text-left`} key={value} aria-pressed={month === value} onClick={() => setMonth(value)}>{value}<span className="mt-1 block text-xs">{sources.some(source => source.month === value) ? `来源批次 ${sources.find(source => source.month === value)!.batchId}` : "无版本内可见来源"}</span></button>)}</div>
    <EditionSourceProof month={month} source={sources.find(source => source.month === month)} />
  </section>;
}

export function EditionCurrentProductTools({ children }: { children: ReactNode }) {
  return <section aria-label="当前授权产品工具" className="my-4 min-w-0 space-y-3 rounded border border-amber-300 p-3"><h4 className="font-semibold">当前授权产品工具</h4><p className="text-sm">以下任务、成本和 AI 分析使用产品的当前授权与实时已保存来源，不是此归档版本的历史权限或快照分析；所有操作仍需各自独立授权和明确发起。</p>{children}</section>;
}
