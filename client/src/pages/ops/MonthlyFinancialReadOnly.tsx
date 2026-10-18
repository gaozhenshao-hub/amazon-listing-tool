import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { subscribeMonthlyFinancialChanges } from "./monthlyFinancialWriteEvents";
import {
  MONTHLY_FINANCIAL_METRICS, MonthlyFinancialHistoryInputSchema, MonthlyFinancialHistoryResultSchema,
  MonthlyFinancialBatchInputSchema, MonthlyFinancialBatchResultSchema, MonthlyFinancialSnapshotInputSchema, MonthlyFinancialSnapshotResultSchema,
  type MonthlyFinancialHistoryResult, type MonthlyFinancialBatchResult, type MonthlyFinancialSnapshotResult,
  type MonthlyFinancialHistoryInput, type MonthlyFinancialBatchInput, type MonthlyFinancialSnapshotInput,
  type MonthlyFinancialVisibleBatchMetadata, type MonthlyFinancialReadRow, type MonthlyFinancialAggregate, type MonthlyFinancialDetails,
} from "@shared/monthlyFinancialRead";

type Owner = { userId: number; workspaceId: number; role: string };
type ReadState<T> = { status: "idle" | "loading" | "error" | "invalid" } | { status: "ready"; value: T };
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";
const cellClass = "max-w-80 whitespace-pre-wrap break-words border-b p-3 align-top";
const shown = (value: string | number | boolean | null | undefined) => value === null || value === undefined ? "未知 / 未提供" : String(value);
const metricLabels: Record<string, string> = {
  financialProfit: "财务毛利润", salesQty: "销量", salesAmount: "销售额", otherIncome: "其他收入", discount: "促销折扣",
  purchaseCost: "采购成本", freight: "头程费用", fbaFee: "FBA 配送费", commission: "销售佣金", advertising: "广告费",
  promotion: "推广费", storage: "仓储费", otherFees: "其他费用", refundAmount: "退款金额", refundQty: "退款量", returnQty: "退货量",
  ld: "LD / 秒杀", coupon: "优惠券", vine: "Vine", adOrders: "广告订单量", adSales: "广告销售额",
  profitMargin: "毛利率", refundRate: "退款率", returnRate: "退货率", adOrderCost: "广告订单成本", acos: "ACOS", aAcos: "广告费 / 销售额", perUnitAdCost: "单件广告成本", adSalesRatio: "广告销售占比",
};

function Shell({ children }: { children: ReactNode }) {
  return <section aria-label="完整月报只读查看" className="manus-no-record min-w-0 max-w-full space-y-5 overflow-hidden rounded-xl border bg-card p-4 md:p-5">
    <header className="space-y-2"><h2 className="text-lg font-semibold">完整月报 · 只读</h2>
      <p className="text-sm text-muted-foreground">分别读取批次历史、已选批次原始明细和指定范围的有效快照。不上传、保存、撤销或执行模型；与本地文件预览互不替代。</p>
      <p className="text-xs text-muted-foreground">原值、缺失值、负数和真实零分开保留。来源引用不是下载地址；数据库时间按原文显示，不推断时区。翻页只读取指定页，不把一页称为全部记录。</p>
    </header>{children}
  </section>;
}

/** Each action owns its abort/sequence and result. Transport may ignore abort;
 * invalidation still prevents an earlier scope or request from rendering. */
function useReadLane<T>() {
  const [state, setState] = useState<ReadState<T>>({ status: "idle" });
  const sequence = useRef(0), pending = useRef<AbortController | null>(null), active = useRef(false);
  useEffect(() => () => { sequence.current++; pending.current?.abort(); }, []);
  function clear(preserveActive = false) { sequence.current++; pending.current?.abort(); pending.current = null; setState({ status: "idle" }); if (!preserveActive) active.current = false; }
  function invalid() { clear(); setState({ status: "invalid" }); }
  async function run(read: (signal: AbortSignal) => Promise<unknown>, accept: (value: unknown) => T) {
    clear(true); active.current = true; const ticket = ++sequence.current, controller = new AbortController(); pending.current = controller;
    const current = () => ticket === sequence.current && !controller.signal.aborted;
    setState({ status: "loading" });
    try {
      const value = await read(controller.signal);
      if (!current()) return;
      const accepted = accept(value);
      if (current()) setState({ status: "ready", value: accepted });
    } catch { if (current()) setState({ status: "error" }); }
    finally { if (current()) pending.current = null; }
  }
  return { state, clear, invalid, run, active };
}

function ReadNotice({ state, name }: { state: ReadState<unknown>; name: string }) {
  if (state.status === "loading") return <p role="status">正在读取{name}…</p>;
  if (state.status === "error") return <p role="alert">{name}读取失败，或身份、权限、范围及回包完整性已变化。旧结果已清除；未回退缓存或补零。请核对后显式重读。</p>;
  if (state.status === "invalid") return <p role="alert">{name}范围不完整或不合法，未发送请求。</p>;
  return null;
}

function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return <div role="region" aria-label={label} tabIndex={0} className="min-w-0 max-w-full overflow-x-auto rounded border focus-visible:outline focus-visible:outline-2">{children}</div>;
}

function RawValue({ value, label = "查看完整原始字段" }: { value: unknown; label?: string }) {
  return <details><summary className="cursor-pointer">{label}</summary><pre className="max-w-3xl whitespace-pre-wrap break-all text-xs">{JSON.stringify(value, null, 2)}</pre></details>;
}

type ScopeFieldsValue = { yearMonth: string; storeName: string; country: string; parentAsin: string };
const emptyScope: ScopeFieldsValue = { yearMonth: "", storeName: "", country: "", parentAsin: "" };
function ScopeFields({ value, onChange, prefix, parentOptional = false }: {
  value: ScopeFieldsValue; onChange: (field: keyof ScopeFieldsValue, value: string) => void; prefix: string; parentOptional?: boolean;
}) {
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">{([
    ["yearMonth", "月份（YYYY-MM）"], ["storeName", "店铺"], ["country", "站点 / 国家代码"], ["parentAsin", parentOptional ? "父 ASIN（可留空读取全范围）" : "父 ASIN"],
  ] as const).map(([field, label]) => <label className="min-w-0 text-sm" key={field}>{label}<input aria-label={`${prefix}${label}`} autoComplete="off"
    className="mt-1 w-full min-w-0 rounded border bg-background p-2" value={value[field]} onChange={event => onChange(field, event.currentTarget.value)} /></label>)}</div>;
}

function assertIdentity(value: { identity: { userId: number; workspaceId: number } }, owner: Owner) {
  if (value.identity.userId !== owner.userId || value.identity.workspaceId !== owner.workspaceId) throw new Error("MONTHLY_READ_SCOPE_CHANGED");
}

const isManager = (owner: Owner) => ["super_admin", "admin", "ops_manager"].includes(owner.role);
const statusLabel = (value: MonthlyFinancialVisibleBatchMetadata["status"]) => ({ completed: "已确认", previewing: "待确认", deleted: "已撤销" })[value];
type Scope = { yearMonth: string; storeName: string; country: string; parentAsin?: string };
const sameScope = (a: Scope | null, b: Scope | null) => a === null || b === null ? a === b : a.yearMonth === b.yearMonth && a.storeName === b.storeName && a.country === b.country && a.parentAsin === b.parentAsin;
function failResponse(): never { throw new Error("MONTHLY_READ_RESPONSE_INVALID"); }
function checkMetadata(batch: MonthlyFinancialVisibleBatchMetadata, owner: Owner) {
  if (batch.visibility === "full" && (batch.workspaceId !== owner.workspaceId || !isManager(owner) && batch.userId !== owner.userId)) failResponse();
}
function checkRows(value: MonthlyFinancialBatchResult | MonthlyFinancialSnapshotResult, request: { rowOffset: number; pageSize: number }, scope: Scope | null, batchId: number | null) {
  const page = value.page;
  if (page.rowOffset !== request.rowOffset || page.pageSize !== request.pageSize) failResponse();
  if (value.status !== "ready") {
    if (value.rows.length || value.aggregates.length || value.batch !== null || page.hasMore || page.nextOffset !== null) failResponse();
    return;
  }
  if (!value.batch || value.batch.id !== batchId || value.rows.length !== Math.min(page.pageSize, Math.max(0, page.matchedRows - page.rowOffset))) failResponse();
  const next = page.rowOffset + value.rows.length;
  if (page.hasMore !== (next < page.matchedRows) || page.nextOffset !== (page.hasMore ? next : null)) failResponse();
  if (value.batch.visibility === "scoped" ? page.totalRows !== null || scope === null : page.totalRows !== value.batch.totalRows || page.matchedRows > value.batch.totalRows) failResponse();
  const inScope = (row: { yearMonth: string; storeName: string; country: string; parentAsin?: string | null }) => !scope || row.yearMonth === scope.yearMonth && row.storeName === scope.storeName && row.country === scope.country && (scope.parentAsin === undefined || row.parentAsin === scope.parentAsin);
  if (new Set(value.rows.map(row => row.rowIndex)).size !== value.rows.length) failResponse();
  for (const row of value.rows) if (row.batchId !== batchId || !inScope(row) || scope?.parentAsin && row.allocation === "ambiguous") failResponse();
  for (const group of value.aggregates) {
    if (!inScope({ ...group.scope, parentAsin: group.parentAsin }) || group.rowCount !== group.sourceRows.length
      || new Set(group.sourceRows.map(row => row.rowIndex)).size !== group.sourceRows.length || group.sourceRows.some(row => row.batchId !== batchId)) failResponse();
  }
}
function acceptHistory(raw: unknown, input: MonthlyFinancialHistoryInput, owner: Owner) {
  const value = MonthlyFinancialHistoryResultSchema.parse(raw); assertIdentity(value, owner);
  if (value.page.cursor !== input.cursor || value.page.limit !== input.limit || value.batches.length > input.limit) failResponse();
  if (value.status !== "ready" && (value.batches.length || value.page.hasMore || value.page.nextCursor !== null)) failResponse();
  value.batches.forEach((batch, index) => {
    checkMetadata(batch, owner);
    if (input.cursor !== null && batch.id >= input.cursor || index > 0 && batch.id >= value.batches[index - 1].id) failResponse();
  });
  if (value.page.hasMore ? value.batches.length !== input.limit || value.page.nextCursor !== value.batches.at(-1)?.id : value.page.nextCursor !== null) failResponse();
  return value;
}
function acceptBatch(raw: unknown, input: MonthlyFinancialBatchInput, owner: Owner) {
  const value = MonthlyFinancialBatchResultSchema.parse(raw); assertIdentity(value, owner);
  if (!sameScope(value.scope, input.scope ?? null)) failResponse();
  if (value.batch) checkMetadata(value.batch, owner);
  checkRows(value, input, input.scope ?? null, input.batchId); return value;
}
function acceptSnapshot(raw: unknown, input: MonthlyFinancialSnapshotInput, owner: Owner) {
  const value = MonthlyFinancialSnapshotResultSchema.parse(raw); assertIdentity(value, owner);
  if (!sameScope(value.scope, input)) failResponse();
  if (value.batch) checkMetadata(value.batch, owner);
  if (value.status === "ready" && (!value.selection.complete || value.batch?.status !== "completed" || value.winningScopes.length !== 1
    || value.winningScopes[0].batchId !== value.selectedBatchId || !sameScope(value.winningScopes[0], { yearMonth: input.yearMonth, storeName: input.storeName, country: input.country }))) failResponse();
  if (value.status !== "ready" && (value.selectedBatchId !== null || value.winningScopes.length)) failResponse();
  checkRows(value, input, input, value.selectedBatchId); return value;
}

function SourceMetadata({ batch }: { batch: MonthlyFinancialVisibleBatchMetadata }) {
  return <div className="space-y-1 break-words text-sm">
    <p>批次 ID：{batch.id} · 状态：{statusLabel(batch.status)}（{batch.status}）</p>
    <p>创建：{batch.createdAt} · 确认：{shown(batch.confirmedAt)} · 数据库原文时间，时区未声明</p>
    {batch.visibility === "scoped" ? <p>仅当前授权业务范围的必要元数据；整批文件名、哈希、月份及数量未授权展示。</p> : <>
      <p>文件名 / 来源名称：{batch.fileName}</p><p className="break-all">来源 SHA-256：{batch.fileHash}</p>
      <p>来源类型：{batch.origin.kind} · 哈希依据：{batch.origin.hashBasis} · 来源运行 ID：{shown(batch.origin.sourceRunId)}</p>
      <p>上传者 ID：{batch.userId} · 整批 {batch.totalRows} 行 · 跳过 {batch.skippedRows} 行 · 未分配 {batch.unallocatedRows} 行 · 月份：{batch.months.join("、") || "未提供"}</p>
      <p>仅来源引用，不提供下载链接；同步映射 JSON 的哈希不等同原始上传文件哈希。</p>
    </>}
  </div>;
}
function ResultNotice({ result }: { result: { status: string; missingReason: string | null; reasonCode: string | null } }) {
  if (result.status === "ready") return null;
  const title = result.status === "missing" ? "完整月报表尚未接通，不表示零条数据" : result.status === "not_found" ? "未找到可读取的指定批次或范围，不表示金额为零" : "来源不完整、损坏或超出限额；整批拒绝，不截断或回退旧批次";
  return <div role={result.status === "invalid" ? "alert" : "status"} className="space-y-1"><p>{title}</p><p>{result.missingReason}</p><p className="text-xs">状态依据：{result.reasonCode}</p></div>;
}

/** Synthetic/browser presentation entry. History includes all supplied statuses;
 * no page count or inferred global total is invented from a keyset page. */
export function MonthlyFinancialHistoryContent({ result, onSelect }: { result: MonthlyFinancialHistoryResult; onSelect?: (id: number) => void }) {
  return <div className="min-w-0 space-y-3"><ResultNotice result={result} />{result.status === "ready" && <>
    <p>本页 {result.batches.length} 个批次 · 按 ID 降序分页 · 包含待确认、已确认和已撤销状态；不是仅最近 100 条。</p>
    {!result.batches.length ? <p>当前授权历史页没有批次；不表示全站无月报。</p> : <ScrollTable label="月报批次历史横向表"><table className="min-w-[900px] w-full text-left text-xs"><thead><tr><th className="p-3">批次 / 状态</th><th className="p-3">完整来源元信息</th><th className="p-3">选择明细</th></tr></thead><tbody>{result.batches.map(batch => <tr key={batch.id}>
      <td className={cellClass}>{batch.id}<br />{statusLabel(batch.status)}</td><td className={cellClass}><SourceMetadata batch={batch} /></td>
      <td className={cellClass}>{onSelect ? <button className={buttonClass} type="button" onClick={() => onSelect(batch.id)}>选择批次 {batch.id}</button> : "只读来源展示"}</td>
    </tr>)}</tbody></table></ScrollTable>}
  </>}</div>;
}

function FinancialDetails({ details }: { details: MonthlyFinancialDetails }) {
  return <details><summary className="cursor-pointer">全部费用原始明细、分子与分母</summary><div className="mt-3 space-y-4">
    <ScrollTable label="全部费用构成明细"><table className="min-w-[950px] w-full text-left text-xs"><thead><tr>{["项目", "保存标准化值", "可识别原字段合计", "差额", "全部原始构成 / 符号", "缺失说明"].map(text => <th className="p-2" key={text}>{text}</th>)}</tr></thead><tbody>{MONTHLY_FINANCIAL_METRICS.map(key => {
      const field = details.fields[key]; return <tr key={key}><th className={cellClass} scope="row">{metricLabels[key]}</th><td className={cellClass}>{shown(field.reportedValue)}</td><td className={cellClass}>{shown(field.componentTotal)}</td><td className={cellClass}>{shown(field.remainder)}</td>
        <td className={cellClass}>{field.components.length ? field.components.map((part, index) => <p className="mb-2" key={index}>{part.label} · 原值 {shown(part.rawValue)} × {part.multiplier} ＝ {shown(part.value)}<br />来源路径：{part.rawPath}</p>) : "未提供原字段构成，不能补零"}</td><td className={cellClass}>取值依据：{field.aggregationBasis}<br />{field.missingReason ?? "无已报告缺失"}</td></tr>;
    })}</tbody></table></ScrollTable>
    <p>广告订单量：{shown(details.adOrders.value)} · {details.adOrders.missingReason ?? "来源已返回"}<br />取值依据：{details.adOrders.aggregationBasis}<br />路径：{details.adOrders.rawPaths.join("、") || "未提供"}</p>
    <p>广告销售额：{shown(details.adSales.value)} · 自然销售额：{shown(details.organicSales)} · {details.adSales.missingReason ?? "来源已返回"}<br />取值依据：{details.adSales.aggregationBasis}<br />路径：{details.adSales.rawPaths.join("、") || "未提供"}</p>
    <ScrollTable label="月报比例和分母"><table className="min-w-[900px] w-full text-left text-xs"><thead><tr>{["比例 / 单价", "分子", "分母", "值与单位", "口径 / 未计算原因"].map(text => <th className="p-2" key={text}>{text}</th>)}</tr></thead><tbody>{Object.entries(details.ratios).map(([key, ratio]) => <tr key={key}><th className={cellClass}>{metricLabels[key] ?? key}</th><td className={cellClass}>{shown(ratio.numerator)}</td><td className={cellClass}>{shown(ratio.denominator)}</td><td className={cellClass}>{shown(ratio.value)} · {ratio.unit === "fraction" ? "比例小数（1 = 100%）" : "每单位金额"}</td><td className={cellClass}>{ratio.basis}<br />{ratio.missingReason}</td></tr>)}</tbody></table></ScrollTable>
    <h5 className="font-medium">平均费用：保留加权分子 / 分母，不平均各行比例</h5>
    {Object.entries(details.averages).map(([key, average]) => <p key={key}>{metricLabels[key]}：{shown(average.value)} · 分子 {shown(average.numerator)} / 分母 {shown(average.denominator)} · 原表报告 {average.reportedRows} 行 / 计算 {average.calculatedRows} 行<br />{average.basis}<br />{average.missingReason}</p>)}
  </div></details>;
}
function RowTable({ rows }: { rows: MonthlyFinancialReadRow[] }) {
  return <ScrollTable label="月报完整行横向表"><table className="min-w-[3200px] w-full text-left text-xs"><thead><tr>{["来源行 / 身份", "币种 / 分配", ...MONTHLY_FINANCIAL_METRICS.map(key => metricLabels[key]), "费用、比例与完整原文"].map(text => <th className="whitespace-nowrap p-3" key={text}>{text}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={`${row.batchId}:${row.rowIndex}`}><td className={cellClass}>批次 {row.batchId} · 原行索引 {row.rowIndex}<br />{row.yearMonth} · {row.storeName} · {row.site}（{row.country}）<br />父 ASIN：{row.parentAsin || "未分配"}<br />ASIN：{row.asin || "未提供"}<br />SKU：{row.sku || "未提供"}<br /><span>{row.title || "品名未提供"}</span><br />运营人：{shown(row.operator)}</td>
      <td className={cellClass}>币种：{shown(row.currency)}<br />证据：{row.currencyEvidence.status}<br />{row.currencyEvidence.note}<br />原字段：{row.currencyEvidence.rawPaths.join("、") || "无"}<br />原币种：{row.currencyEvidence.values.join("、") || "未提供"}<br />分配：{row.allocation}<br />{row.amountConvention}</td>
      {MONTHLY_FINANCIAL_METRICS.map(key => <td key={key} className={cellClass}>{shown(row.metrics[key])}</td>)}
      <td className={cellClass}><FinancialDetails details={row.details} /><RawValue value={row.raw} /></td>
    </tr>)}</tbody></table></ScrollTable>;
}
function AggregateTable({ groups }: { groups: MonthlyFinancialAggregate[] }) {
  const [page, setPage] = useState(0), size = 10;
  useEffect(() => { setPage(0); }, [groups]);
  const pages = Math.max(1, Math.ceil(groups.length / size)), current = Math.min(page, pages - 1);
  return <section aria-label="月报父子与未分配完整汇总" className="min-w-0 space-y-3"><h4 className="font-medium">父体、子体及未分配汇总</h4>
    <p className="text-xs">覆盖当前授权筛选后的全部行，不是只汇总当前原始行页。各维度是不同视图，不能把父体、子体、父体原报表行及未分配项目重复相加。未知币种不跨来源行求和。</p>
    <p>共 {groups.length} 组 · 第 {current + 1} / {pages} 页</p>
    {groups.slice(current * size, (current + 1) * size).map((group, index) => <details key={current * size + index} className="rounded border p-3"><summary className="cursor-pointer break-words">{group.dimension} · 父 {shown(group.parentAsin)} / 子 {shown(group.asin)} · {group.scope.yearMonth} / {group.scope.storeName} / {group.scope.country} / {shown(group.scope.currency)} · {group.rowCount} 行</summary>
      <p>汇总依据：{({ child_rows: "子体原始行派生汇总", reported_parent_row: "原报表父体单行（不能与子体派生合计相加）", unallocated_rows: "未分配或歧义行独立汇总" })[group.basis]}</p>
      <p>{group.missingReason}</p><p className="break-all">全部来源行：{group.sourceRows.map(row => `${row.batchId}:${row.rowIndex}`).join("、") || "无"}</p>
      <dl className="my-3 grid gap-2 sm:grid-cols-3">{MONTHLY_FINANCIAL_METRICS.map(key => <div key={key}><dt>{metricLabels[key]}</dt><dd>{shown(group.metrics[key])}</dd></div>)}</dl>
      <FinancialDetails details={group.details} /><RawValue value={group} label="查看完整汇总依据（含来源与分组规则）" />
    </details>)}
    {pages > 1 && <nav className="flex gap-3" aria-label="汇总分页"><button className={buttonClass} disabled={current === 0} onClick={() => setPage(current - 1)}>上一页汇总</button><button className={buttonClass} disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页汇总</button></nav>}
  </section>;
}
function FinancialPage({ result }: { result: MonthlyFinancialBatchResult | MonthlyFinancialSnapshotResult }) {
  return <><p>整批原始总行数：{shown(result.page.totalRows)} · 当前筛选 {result.page.matchedRows} 行 · 本页 {result.rows.length} 行 · 偏移 {result.page.rowOffset} / 每页上限 {result.page.pageSize}</p>
    {result.page.totalRows === null && <p>整批总数未授权或未知；不是零行。</p>}
    <p className="text-xs">各金额保持存量标准化值，原始费用正负号另列；不转换币种或用零替代缺失。超限/不完整时拒绝整批，不静默截断。</p>
    {result.rows.length ? <RowTable rows={result.rows} /> : <p>当前筛选或当前页没有行；不补旧批次缺项，也不代表金额为零。</p>}
    <AggregateTable groups={result.aggregates} />
  </>;
}
export function MonthlyFinancialBatchContent({ result }: { result: MonthlyFinancialBatchResult }) {
  return <section aria-label="已选月报批次明细" className="min-w-0 space-y-3"><ResultNotice result={result} />{result.status === "ready" && <>
    {result.batch && <SourceMetadata batch={result.batch} />}<p>读取范围：{result.scope ? `${result.scope.yearMonth} / ${result.scope.storeName} / ${result.scope.country} / ${result.scope.parentAsin}` : "管理员整批（包含未分配及歧义行）"}</p><FinancialPage result={result} />
  </>}</section>;
}
export function MonthlyFinancialSnapshotContent({ result }: { result: MonthlyFinancialSnapshotResult }) {
  return <section aria-label="当前有效月报快照" className="min-w-0 space-y-3"><ResultNotice result={result} />
    <p>范围：{result.scope.yearMonth} / {result.scope.storeName} / {result.scope.country} / {result.scope.parentAsin ?? "全范围，含未分配"}</p>
    <p>规则：每个完整月份 / 店铺 / 站点使用最新已确认批次，先决定整份范围的替换，再筛父 ASIN。新版缺少的行不会从旧版补回。</p>
    <p>按已保存批次选择；尚未核验店铺/月度完整覆盖。“已确认”仅代表历史导入确认，不代表已完成财务全量对账。</p>
    {result.status === "ready" && <><p>有效批次 {result.selectedBatchId} · 选择完整性：{result.selection.complete ? "已返回完整选择证明" : "未完成"} · 已扫描批次数：{shown(result.selection.scannedCount)}</p>
      <p className="break-all">生效范围：{result.winningScopes.map(scope => `${scope.yearMonth}/${scope.storeName}/${scope.country} → ${scope.batchId}`).join("；")}</p>
      {result.batch && <SourceMetadata batch={result.batch} />}<FinancialPage result={result} />
    </>}
  </section>;
}

const ROW_PAGE_SIZE = 20;
function OwnedMonthly({ owner }: { owner: Owner }) {
  const client = trpc.useUtils().client, manager = isManager(owner);
  const history = useReadLane<MonthlyFinancialHistoryResult>(), batch = useReadLane<MonthlyFinancialBatchResult>(), snapshot = useReadLane<MonthlyFinancialSnapshotResult>();
  const [cursorTrail, setCursorTrail] = useState<Array<number | null>>([null]);
  const [batchId, setBatchId] = useState(""), [batchScope, setBatchScope] = useState(emptyScope), [wholeBatch, setWholeBatch] = useState(manager);
  const [snapshotScope, setSnapshotScope] = useState(emptyScope);
  function selectBatch(value: string) { batch.clear(); setBatchId(value); }
  function readHistory(cursor: number | null, trail: Array<number | null>, preserveSelection = false) {
    if (!preserveSelection) { batch.clear(); setBatchId(""); } setCursorTrail(trail);
    const input = MonthlyFinancialHistoryInputSchema.parse({ expectedWorkspaceId: owner.workspaceId, cursor, limit: 20 });
    void history.run(signal => client.monthlyFinancialRead.listBatches.query(input, { signal }), value => acceptHistory(value, input, owner));
  }
  function readBatch(rowOffset = 0) {
    const parsed = MonthlyFinancialBatchInputSchema.safeParse({ expectedWorkspaceId: owner.workspaceId, batchId: /^[1-9]\d*$/u.test(batchId) ? Number(batchId) : NaN,
      ...(manager && wholeBatch ? {} : { scope: batchScope }), rowOffset, pageSize: ROW_PAGE_SIZE });
    if (!parsed.success) { batch.invalid(); return; }
    void batch.run(signal => client.monthlyFinancialRead.getBatch.query(parsed.data, { signal }), value => acceptBatch(value, parsed.data, owner));
  }
  function readSnapshot(rowOffset = 0) {
    const { parentAsin, ...scope } = snapshotScope;
    const parsed = MonthlyFinancialSnapshotInputSchema.safeParse({ ...scope, ...(manager && parentAsin === "" ? {} : { parentAsin }), expectedWorkspaceId: owner.workspaceId, rowOffset, pageSize: ROW_PAGE_SIZE });
    if (!parsed.success) { snapshot.invalid(); return; }
    void snapshot.run(signal => client.monthlyFinancialRead.getEffectiveSnapshot.query(parsed.data, { signal }), value => acceptSnapshot(value, parsed.data, owner));
  }
  const changeHandler = useRef((notice: { userId: number; workspaceId: number; action: string; batchId: number }) => {});
  changeHandler.current = notice => {
    if (notice.userId !== owner.userId || notice.workspaceId !== owner.workspaceId) return;
    if (history.active.current) readHistory(null, [null], true);
    if (batch.active.current && (notice.action !== "upload" || String(notice.batchId) === batchId)) readBatch(0);
    if (snapshot.active.current && notice.action !== "upload") readSnapshot(0);
  };
  useEffect(() => subscribeMonthlyFinancialChanges(notice => changeHandler.current(notice)), []);
  return <Shell>
    <section aria-label="月报批次历史读取" className="min-w-0 space-y-3 border-b pb-5"><h3 className="font-medium">一、完整批次历史</h3>
      <p className="text-sm">{manager ? "管理员可读取当前工作区批次元数据。" : "历史仅展示本人上传的元数据，不因此授予整批业务内容权限。"}选择批次不会自动读取明细。</p>
      <div className="flex flex-wrap gap-3"><button className={buttonClass} onClick={() => readHistory(null, [null])}>读取批次历史</button><button className={buttonClass} onClick={() => { history.clear(); batch.clear(); setBatchId(""); }}>清除历史与批次明细</button></div>
      <ReadNotice state={history.state} name="批次历史" />
      {history.state.status === "ready" && <><MonthlyFinancialHistoryContent result={history.state.value} onSelect={id => selectBatch(String(id))} />
        {history.state.value.status === "ready" && <nav aria-label="批次历史分页" className="flex gap-3"><button className={buttonClass} disabled={cursorTrail.length <= 1} onClick={() => { const trail = cursorTrail.slice(0, -1); readHistory(trail.at(-1) ?? null, trail); }}>上一页批次</button>
          <button className={buttonClass} disabled={!history.state.value.page.hasMore} onClick={() => { if (history.state.status === "ready" && history.state.value.page.nextCursor !== null) readHistory(history.state.value.page.nextCursor, [...cursorTrail, history.state.value.page.nextCursor]); }}>下一页批次</button></nav>}
      </>}
    </section>
    <section aria-label="月报批次明细读取" className="min-w-0 space-y-3 border-b pb-5"><h3 className="font-medium">二、已选批次的全部原始费用与指标</h3>
      <form aria-label="批次明细查询范围" className="space-y-3" onSubmit={event => { event.preventDefault(); readBatch(); }}>
        <label className="block text-sm">批次 ID（可从历史选择或填写已知 ID）<input className="mt-1 block w-full max-w-sm rounded border bg-background p-2" aria-label="明细批次 ID" value={batchId} onChange={event => selectBatch(event.currentTarget.value)} inputMode="numeric" autoComplete="off" /></label>
        {manager && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wholeBatch} onChange={event => { batch.clear(); setWholeBatch(event.currentTarget.checked); }} />读取整批（管理员，包含未分配行）</label>}
        {!wholeBatch && <ScopeFields value={batchScope} prefix="明细" onChange={(key, value) => { batch.clear(); setBatchScope(old => ({ ...old, [key]: value })); }} />}
        <div className="flex gap-3"><button type="submit" className={buttonClass}>读取所选批次明细</button><button className={buttonClass} type="button" onClick={() => batch.clear()}>取消并清除明细</button></div>
      </form><ReadNotice state={batch.state} name="批次明细" />
      {batch.state.status === "ready" && <><MonthlyFinancialBatchContent result={batch.state.value} />{batch.state.value.status === "ready" && <nav aria-label="批次明细分页" className="flex gap-3">
        <button className={buttonClass} disabled={batch.state.value.page.rowOffset === 0} onClick={() => { if (batch.state.status === "ready") readBatch(Math.max(0, batch.state.value.page.rowOffset - ROW_PAGE_SIZE)); }}>上一页原始行</button>
        <button className={buttonClass} disabled={!batch.state.value.page.hasMore} onClick={() => { if (batch.state.status === "ready" && batch.state.value.page.nextOffset !== null) readBatch(batch.state.value.page.nextOffset); }}>下一页原始行</button>
      </nav>}</>}
    </section>
    <section aria-label="月报有效快照读取" className="min-w-0 space-y-3"><h3 className="font-medium">三、按范围读取有效快照</h3>
      <form aria-label="有效快照查询范围" className="space-y-3" onSubmit={event => { event.preventDefault(); readSnapshot(); }}>
        <ScopeFields value={snapshotScope} prefix="快照" parentOptional={manager} onChange={(key, value) => { snapshot.clear(); setSnapshotScope(old => ({ ...old, [key]: value })); }} />
        <p className="text-xs">{manager ? "父 ASIN 留空时读取该月份 / 店铺 / 站点全范围，含未分配及歧义行。" : "必须指定已授权的真实父 ASIN；不能读取整范围或未分配费用。"}</p>
        <div className="flex gap-3"><button className={buttonClass} type="submit">读取有效快照</button><button className={buttonClass} type="button" onClick={() => snapshot.clear()}>取消并清除快照</button></div>
      </form><ReadNotice state={snapshot.state} name="有效快照" />
      {snapshot.state.status === "ready" && <><MonthlyFinancialSnapshotContent result={snapshot.state.value} />{snapshot.state.value.status === "ready" && <nav aria-label="有效快照分页" className="flex gap-3">
        <button className={buttonClass} disabled={snapshot.state.value.page.rowOffset === 0} onClick={() => { if (snapshot.state.status === "ready") readSnapshot(Math.max(0, snapshot.state.value.page.rowOffset - ROW_PAGE_SIZE)); }}>上一页快照行</button>
        <button className={buttonClass} disabled={!snapshot.state.value.page.hasMore} onClick={() => { if (snapshot.state.status === "ready" && snapshot.state.value.page.nextOffset !== null) readSnapshot(snapshot.state.value.page.nextOffset); }}>下一页快照行</button>
      </nav>}</>}
    </section>
  </Shell>;
}

export default function MonthlyFinancialReadOnly() {
  const auth = useAuth(), permissions = usePermissions();
  if (auth.loading) return <Shell><p role="status">正在确认月报读取身份…</p></Shell>;
  if (auth.error) return <Shell><p role="alert">身份读取失败，月报数据已隐藏。</p></Shell>;
  const user = auth.user;
  if (!user || !positiveId(user.id) || !positiveId(user.defaultWorkspaceId) || typeof user.role !== "string" || !user.role.trim()) {
    return <Shell><p role="alert">需要有效用户及明确工作区才能读取月报；未回退全局或旧工作区。</p></Shell>;
  }
  if (permissions.isLoading) return <Shell><p role="status">正在确认月报读取权限…</p></Shell>;
  if (!permissions.canRead("ops", "ops_data_import")) return <Shell><p role="alert">没有月报读取权限，旧数据已隐藏。</p></Shell>;
  const owner = { userId: user.id, workspaceId: user.defaultWorkspaceId, role: user.role };
  return <OwnedMonthly key={JSON.stringify([owner.userId, owner.workspaceId, owner.role])} owner={owner} />;
}
