import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import {
  ProfitBoardReadInputSchema, ProfitBoardReadResultSchema,
  type ProfitBoardReadInput, type ProfitBoardReadResult, type ProfitBoardPoint,
  type ProfitBoardProduct, type ProfitBoardPartition, type ProfitBoardBasis,
} from "@shared/profitBoardRead";

type Owner = { userId: number; workspaceId: number; role: string };
type ReadState = { status: "idle" | "loading" | "error" | "invalid" } | { status: "ready"; result: ProfitBoardReadResult; selectedId?: string };
type Metric = "profit" | "qty" | "sales" | "margin";
const METRICS: Metric[] = ["profit", "qty", "sales", "margin"];
const METRIC_LABELS = { profit: "财务利润", qty: "销量", sales: "销售额", margin: "利润率" };
const BASIS_LABELS: Record<ProfitBoardBasis, string> = { child_rows: "子体原行汇总", reported_parent_row: "原报表父体合计（独立）", unallocated_rows: "未分配 / 父体歧义（独立）" };
const STATUS_LABELS: Record<ProfitBoardPoint["status"], string> = { observed: "有保存观测", partial: "部分组有观测", missing_month: "缺月度来源", missing_product: "该期缺产品原行", not_visible: "无当前可见来源", unknown_currency: "币种未知", ambiguous: "来源有歧义" };
const GROUP_LIMIT = 12, LOCAL_LIMIT = 20, PARTITION_LIMIT = 4;
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";
const cellClass = "max-w-72 whitespace-pre-wrap break-words border-b p-3 align-top";
const numberText = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
function metricText(value: number | null, metric: Metric, currency: string | null) {
  if (value === null) return "未知 / 不可比较";
  if (metric === "margin") return `${numberText(value * 100)}%`;
  if (metric === "qty") return numberText(value);
  return `${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${currency ?? "币种未知（原值）"}`;
}
function Shell({ children }: { children: ReactNode }) {
  return <section aria-label="利润看板只读查看" className="manus-no-record min-w-0 max-w-full space-y-5 overflow-hidden rounded-xl border bg-card p-4 md:p-5">
    <header className="space-y-2"><h2 className="text-lg font-semibold">利润看板 · 已保存批次只读对比</h2>
      <p className="text-sm text-muted-foreground">六个月趋势、当月与上月四项指标、增长 / 下降前五名及完整父子明细。只读取已保存批次，不同步、保存备注、归档或调用模型。</p>
      <p className="text-xs text-muted-foreground">按已保存批次选择；尚未核验店铺 / 月度完整覆盖。榜单只是可见来源的变化，不代表完整财务对账或因果解释。币种与汇总依据分区，不合并美国、加拿大、墨西哥。</p>
    </header>{children}
  </section>;
}
function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return <div role="region" aria-label={label} tabIndex={0} className="min-w-0 max-w-full overflow-x-auto rounded border focus-visible:outline focus-visible:outline-2">{children}</div>;
}
function Raw({ value, label }: { value: unknown; label: string }) {
  return <details><summary className="cursor-pointer">{label}</summary><pre className="max-w-3xl whitespace-pre-wrap break-all text-xs">{JSON.stringify(value, null, 2)}</pre></details>;
}
function LocalPager({ label, offset, total, size, onPage }: { label: string; offset: number; total: number; size: number; onPage: (offset: number) => void }) {
  return <nav aria-label={`${label}分页`} className="flex flex-wrap items-center gap-3 text-sm"><span>{total ? `${offset + 1}–${Math.min(offset + size, total)} / ${total}` : "0 / 0"}，全部可逐页查看</span>
    <button type="button" className={buttonClass} disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - size))}>{label}上一页</button>
    <button type="button" className={buttonClass} disabled={offset + size >= total} onClick={() => onPage(offset + size)}>{label}下一页</button>
  </nav>;
}
function PointTable({ points, currency, label }: { points: ProfitBoardPoint[]; currency: string | null; label: string }) {
  return <ScrollTable label={label}><table className="w-full min-w-[980px] text-left text-xs"><thead><tr>{["月份 / 观测状态", ...METRICS.map(key => METRIC_LABELS[key]), "利润率分子 / 分母与来源"].map(text => <th className="p-3" key={text}>{text}</th>)}</tr></thead><tbody>{points.map(point => <tr key={point.month}>
    <th scope="row" className={cellClass}>{point.month}<br />{STATUS_LABELS[point.status]}<br />实际有观测 {point.observedProducts} 组 / 缺原行 {point.missingProducts} 组<br />{point.missingReason}</th>
    {METRICS.map(key => <td className={cellClass} key={key}>{metricText(point[key], key, currency)}</td>)}
    <td className={cellClass}>利润率 = {point.marginBasis.numerator === null ? "未知" : numberText(point.marginBasis.numerator)} / {point.marginBasis.denominator === null ? "未知" : numberText(point.marginBasis.denominator)}（要求正销售额）<br />比例原值为小数，1 = 100%；不平均各行比例。<Raw value={point} label={`${point.month} 指标完整原值与来源引用`} /></td>
  </tr>)}</tbody></table></ScrollTable>;
}
/** Scaling is visual only. Financial values and comparisons are supplied by the
 * shared contract; missing points never become zero or bridge a line gap. */
function TrendChart({ partition }: { partition: ProfitBoardPartition }) {
  const values = partition.trend.map(point => partition.currency === null ? null : point.profit);
  const max = Math.max(1, ...values.filter((value): value is number => value !== null).map(Math.abs));
  const x = (index: number) => 60 + index * 100, y = (value: number) => 110 - (value / max) * 85;
  return <div className="min-w-0"><svg role="img" aria-label={`${partition.currency ?? "未知币种"} ${BASIS_LABELS[partition.basis]} 六个月利润趋势`} viewBox="0 0 620 240" className="h-auto w-full max-w-3xl">
    <title>已保存观测利润趋势；缺月断线，不补零</title><line x1="55" y1="110" x2="570" y2="110" stroke="currentColor" opacity="0.3" />
    <text x="4" y="20" fontSize="10">{numberText(max)}</text><text x="20" y="113" fontSize="10">0</text><text x="4" y="205" fontSize="10">{numberText(-max)}</text>
    {values.map((value, index) => <g key={partition.trend[index].month}>
      {value !== null && index > 0 && values[index - 1] !== null && <line data-profit-segment="true" x1={x(index - 1)} y1={y(values[index - 1]!)} x2={x(index)} y2={y(value)} stroke="#7c3aed" strokeWidth="2" />}
      {value !== null && <circle data-profit-point="true" cx={x(index)} cy={y(value)} r="4" fill="#7c3aed"><title>{partition.trend[index].month}：{metricText(value, "profit", partition.currency)}</title></circle>}
      <text x={x(index)} y="228" textAnchor="middle" fontSize="11">{partition.trend[index].month}</text>
    </g>)}
  </svg><p className="text-xs text-muted-foreground">{partition.currency ? `纵轴：${partition.currency}；横轴：月份。缺失处不连线；部分观测详见数值表。` : "币种未知，仅保留原行金额，不绘制金额趋势或进行跨期排名。"}</p></div>;
}
function Ranking({ partition, direction, onSelect }: { partition: ProfitBoardPartition; direction: "rising" | "falling"; onSelect: (id: string, offset: number) => void }) {
  const title = direction === "rising" ? "利润增长前五名" : "利润下降前五名", rows = partition[direction];
  return <section aria-label={`${partition.id} ${title}`} className="space-y-2"><h5 className="font-medium">{title}</h5><p className="text-xs">基于全部匹配授权父组，不是当前页。只有两期同币种可比数据参与；点击读取完整父子来源。</p>
    {!rows.length ? <p className="text-sm">没有符合该方向的两期可比记录；不解释为零变化。</p> : <ScrollTable label={`${title}横向表`}><table className="w-full min-w-[1200px] text-left text-xs"><thead><tr>{["产品 / 读取明细", ...METRICS.flatMap(key => [`${METRIC_LABELS[key]}（当月）`, `${METRIC_LABELS[key]}（上月）`]), "利润变化"].map(text => <th className="p-3" key={text}>{text}</th>)}</tr></thead><tbody>{rows.map(rank => <tr key={rank.productId}>
      <th scope="row" className={cellClass}><p>{rank.title || "名称未提供"}</p><p>{rank.parentAsin ?? "未分配"}</p><button type="button" className={buttonClass} onClick={() => onSelect(rank.productId, rank.productOffset)}>查看 {rank.parentAsin ?? rank.title} 完整父子明细</button><p>{rank.sourceRows.length} 个来源引用（引用本身不等同已返回原文）</p></th>
      {METRICS.flatMap(key => [<td key={`${key}:current`} className={cellClass}>{metricText(rank.current[key], key, rank.currency)}</td>, <td key={`${key}:previous`} className={cellClass}>{metricText(rank.previous[key], key, rank.currency)}</td>])}
      <td className={cellClass}>{metricText(rank.delta, "profit", rank.currency)}</td>
    </tr>)}</tbody></table></ScrollTable>}
  </section>;
}
function Change({ product, metric }: { product: Pick<ProfitBoardProduct, "comparison" | "currency">; metric: Metric }) {
  const change = product.comparison[metric];
  if (change.direction === "unavailable") return <span>{change.missingReason ?? "两期不可比较"}</span>;
  const transition = ({ normal: "", new_profit: "从零变为正值", new_loss: "从零变为负值", loss_to_profit: "负转非负", profit_to_loss: "非负转负", unavailable: "不可比较" })[change.transition];
  return <span>{metric === "margin" ? `变化 ${change.percentagePoints === null ? "未知" : numberText(change.percentagePoints)} 个百分点` : `差额 ${metricText(change.delta, metric, product.currency)}；${change.relativePercent === null ? "上期为零，不计算变化百分比" : `相对上期 ${numberText(change.relativePercent)}%`}`}{transition ? ` · ${transition}` : ""}</span>;
}
function ProductDetail({ product, rows }: { product: ProfitBoardProduct; rows: ProfitBoardReadResult["pageRows"] }) {
  const [childOffset, setChildOffset] = useState(0), [sourceOffset, setSourceOffset] = useState(0);
  const refs = new Set(product.sourceRows.map(ref => `${ref.batchId}:${ref.rowIndex}`)), originals = rows.filter(row => refs.has(`${row.batchId}:${row.rowIndex}`));
  return <section aria-label="选中产品完整钻取" className="min-w-0 space-y-4 rounded border p-3"><h4 className="font-semibold">{product.parentAsin ?? "未分配原行"} · {product.title || "品名未提供"}</h4><p>{BASIS_LABELS[product.basis]} · {product.currency ?? "币种未知"}。保留各月报告时父子关系，不按最新父体重分历史。</p>
    <PointTable label="选中父体六期完整指标" points={product.points} currency={product.currency} />
    <h5 className="font-medium">全部子体（{product.children.length} 个）</h5>
    {!product.children.length ? <p>此组没有可核验的子体明细；原报表父体合计或未分配原行不伪造子体。</p> : <><LocalPager label="子体" offset={childOffset} total={product.children.length} size={LOCAL_LIMIT} onPage={setChildOffset} />
      {product.children.slice(childOffset, childOffset + LOCAL_LIMIT).map(child => <details key={child.id} className="min-w-0 rounded border p-3"><summary className="cursor-pointer break-words">{child.asin} · {child.title || "名称未提供"} · 当月利润 {metricText(child.current.profit, "profit", product.currency)}</summary>
        <p className="my-2 break-words">SKU：{child.skus.join("、") || "未提供"}</p><PointTable label={`${child.asin} 子体六期明细`} points={child.points} currency={product.currency} />
        {METRICS.map(metric => <p className="mt-2 text-xs" key={metric}>{METRIC_LABELS[metric]}：<Change product={{ comparison: child.comparison, currency: product.currency }} metric={metric} /></p>)}
      </details>)}</>}
    <h5 className="font-medium">全部来源原行 / 费用与分母（{originals.length} 行）</h5><p className="text-xs">每条保留批次 ID、原行索引、币种证据、19 项指标、全部费用、分子分母及 raw。原文仅文本展示，不作为下载或跳转地址。</p>
    <LocalPager label="来源原行" offset={sourceOffset} total={originals.length} size={LOCAL_LIMIT} onPage={setSourceOffset} />
    {originals.slice(sourceOffset, sourceOffset + LOCAL_LIMIT).map(row => <article key={`${row.batchId}:${row.rowIndex}`} className="min-w-0 space-y-1 rounded border p-3 text-sm"><p>{row.yearMonth} · 批次 {row.batchId} / 原行索引 {row.rowIndex} · {row.storeName} / {row.site}（{row.country}）</p>
      <p className="break-words">父体 {row.parentAsin || "未分配"} · ASIN {row.asin || "未提供"} · SKU {row.sku || "未提供"} · {row.title}</p><p>币种：{row.currency ?? "未知"} · 分配：{row.allocation} · {row.currencyEvidence.note}</p>
      <Raw value={row} label={`批次 ${row.batchId} 原行 ${row.rowIndex} 全部费用 / 分子分母 / 原文`} />
    </article>)}
  </section>;
}
function MonthSource({ source }: { source: ProfitBoardReadResult["sources"][number] }) {
  const batch = source.batch;
  return <section aria-label="选中月份来源" className="space-y-2 rounded border p-3 text-sm"><h4 className="font-medium">{source.month} 月份来源</h4>
    {!batch ? <p>{source.status === "not_visible" ? "无当前可见授权来源；不推断该月不存在或为零。" : "该月份没有已选择的有效来源；不补零。"}</p> : <><p>批次 ID：{batch.id} · 已确认导入（completed），不等于月度覆盖已核验</p>
      <p>创建：{batch.createdAt} · 确认：{batch.confirmedAt ?? "未提供"} · 数据库原文时间，时区未声明</p>
      {batch.visibility === "full" ? <><p className="break-words">来源名称：{batch.fileName}</p><p className="break-all">来源哈希：{batch.fileHash}</p><p>来源类型：{batch.origin.kind} · 哈希依据：{batch.origin.hashBasis} · 来源运行 ID：{batch.origin.sourceRunId ?? "未提供"}</p><p>上传者 ID：{batch.userId} · 整批 {batch.totalRows} 行；仅来源引用，不提供下载链接。</p></> : <p>仅当前授权范围的必要元信息；不返回整批名称、哈希或跨范围数量。</p>}
    </>}<p>选择规则：同月 / 同店铺 / 同国家的最新已确认批次，不用旧批次补齐父体。{source.missingReason}</p><p>当前授权范围可见原行：{source.visibleRows}；不是全店铺覆盖承诺。</p>
  </section>;
}

/** Presentation only. It neither reads data nor interprets saved owner IDs as
 * authorization. All financial arithmetic and ranking come from the server DTO. */
export function ProfitBoardReadOnlyContent({ result, onPage, onMonth, initialProductId }: {
  result: ProfitBoardReadResult; onPage?: (offset: number, productId?: string) => void; onMonth?: (month: string) => void; initialProductId?: string;
}) {
  const [month, setMonth] = useState(result.request.month), [selectedId, setSelectedId] = useState(initialProductId ?? ""), [partitionOffset, setPartitionOffset] = useState(0);
  const selected = result.products.find(product => product.id === selectedId), selectedMonth = result.sources.find(source => source.month === month) ?? result.sources.at(-1);
  function select(id: string, offset: number) { if (result.products.some(product => product.id === id)) setSelectedId(id); else onPage?.(Math.floor(offset / result.page.limit) * result.page.limit, id); }
  if (result.status !== "ready") return <div role={result.status === "invalid" ? "alert" : "status"} className="space-y-2"><p>{result.status === "missing" ? "利润月报来源表尚未接通，不表示零记录。" : result.status === "not_found" ? "没有当前可读取来源，不显示为零利润。" : "来源损坏、不完整或超出限额；不返回部分看板或更旧批次。"}</p><p>{result.missingReason}</p><p className="text-xs">状态依据：{result.reasonCode}</p></div>;
  return <div className="min-w-0 space-y-5">
    <p className="break-words text-sm">范围：{result.request.storeName} / {result.request.country} / {result.request.parentAsin ?? "全部当前授权父体"} · 基准月 {result.request.month} 对比 {result.previousMonth} · 搜索：{result.request.search || "无"}</p>
    <section aria-label="六个月数据入口" className="space-y-3"><h3 className="font-semibold">六个月数据与来源</h3><p className="text-xs">这是各期当前已保存来源的对比，不是已冻结归档版本；没有创建归档、备注或财务重述记录。</p><div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{result.sources.map(source => <button key={source.month} type="button" aria-pressed={selectedMonth?.month === source.month} className={`${buttonClass} text-left`} onClick={() => setMonth(source.month)}>{source.month}<span className="mt-1 block text-xs">{source.status === "selected" ? `来源批次 ${source.selectedBatchId}` : source.status === "not_visible" ? "无当前可见来源" : "缺月度来源"}</span></button>)}</div>
      {selectedMonth && <><MonthSource source={selectedMonth} />{onMonth && <button type="button" className={buttonClass} onClick={() => onMonth(selectedMonth.month)}>以 {selectedMonth.month} 为基准重新读取六个月</button>}</>}
    </section>
    <section aria-label="币种与汇总依据分区" className="min-w-0 space-y-4"><h3 className="font-semibold">六个月趋势与全筛选榜单</h3><p className="text-sm">共 {result.partitions.length} 个独立分区、{result.page.totalGroups} 个完整父组 / 独立原行、{result.page.totalRows} 个来源行。统计覆盖全部授权搜索匹配组，非本页；不同币种、父体原报表及子体派生合计不能相加。</p>
      <LocalPager label="利润分区" offset={partitionOffset} total={result.partitions.length} size={PARTITION_LIMIT} onPage={setPartitionOffset} />
      {result.partitions.slice(partitionOffset, partitionOffset + PARTITION_LIMIT).map(partition => <section key={partition.id} className="min-w-0 space-y-4 rounded border p-3"><h4 className="font-medium">{partition.currency ?? "币种未知（每个原行独立）"} · {BASIS_LABELS[partition.basis]} · {partition.productCount} 组</h4><p className="text-xs">{partition.missingReason}</p>
        <TrendChart partition={partition} /><PointTable label={`${partition.id} 六期趋势完整数值`} points={partition.trend} currency={partition.currency} />
        <Ranking partition={partition} direction="rising" onSelect={select} /><Ranking partition={partition} direction="falling" onSelect={select} />
      </section>)}
    </section>
    <section aria-label="完整父体列表" className="min-w-0 space-y-3"><h3 className="font-semibold">完整父组 / 独立原行列表</h3><p className="text-sm">本页 {result.products.length} / 全筛选 {result.page.totalGroups} 组；父组不拆页。页内来源 {result.pageRows.length} 行不等于全筛选 {result.page.totalRows} 行。</p>
      <nav aria-label="父体列表分页" className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={!onPage || result.page.offset === 0} onClick={() => onPage?.(Math.max(0, result.page.offset - result.page.limit))}>父体上一页</button><span className="self-center text-sm">偏移 {result.page.offset} · 每页最多 {result.page.limit} 组</span><button type="button" className={buttonClass} disabled={!onPage || !result.page.hasMore} onClick={() => result.page.nextOffset !== null && onPage?.(result.page.nextOffset)}>父体下一页</button></nav>
      {!result.products.length ? <p>当前筛选页没有可见产品，不补造零值产品。</p> : <ScrollTable label="父体当月上月四指标横向表"><table className="w-full min-w-[1500px] text-left text-xs"><thead><tr>{["父体 / 来源组", ...METRICS.flatMap(key => [`${METRIC_LABELS[key]} ${result.request.month}`, `${METRIC_LABELS[key]} ${result.previousMonth}`, `${METRIC_LABELS[key]} 变化`])].map(text => <th className="p-3" key={text}>{text}</th>)}</tr></thead><tbody>{result.products.map(product => <tr key={product.id}>
        <th scope="row" className={cellClass}><p>{product.parentAsin ?? "未分配 / 歧义原行"}</p><p>{product.title || "名称未提供"}</p><p>{product.currency ?? "币种未知"} · {BASIS_LABELS[product.basis]}</p><button type="button" className={buttonClass} onClick={() => setSelectedId(product.id)}>展开 {product.parentAsin ?? product.title} 全部子体与原行</button></th>
        {METRICS.flatMap(metric => [<td className={cellClass} key={`${metric}:current`}>{metricText(product.current[metric], metric, product.currency)}</td>, <td className={cellClass} key={`${metric}:previous`}>{metricText(product.previous[metric], metric, product.currency)}</td>, <td className={cellClass} key={`${metric}:change`}><Change product={product} metric={metric} /></td>])}
      </tr>)}</tbody></table></ScrollTable>}
      {selected && <><button type="button" className={buttonClass} onClick={() => setSelectedId("")}>收起产品明细</button><ProductDetail key={selected.id} product={selected} rows={result.pageRows} /></>}
    </section>
  </div>;
}

function acceptResult(raw: unknown, input: ProfitBoardReadInput, owner: Owner) {
  const result = ProfitBoardReadResultSchema.parse(raw);
  if (result.identity.userId !== owner.userId || result.identity.workspaceId !== owner.workspaceId || JSON.stringify(result.request) !== JSON.stringify(input)) throw new Error("PROFIT_READ_SCOPE_CHANGED");
  if (!["super_admin", "admin", "ops_manager"].includes(owner.role) && result.sources.some(source => source.batch?.visibility === "full" && source.batch.userId !== owner.userId)) throw new Error("PROFIT_READ_METADATA_DENIED");
  return result;
}
const pageBinding = (result: ProfitBoardReadResult) => JSON.stringify({ months: result.months, sources: result.sources, partitions: result.partitions, totalGroups: result.page.totalGroups, totalRows: result.page.totalRows });
function OwnedProfitBoard({ owner }: { owner: Owner }) {
  const client = trpc.useUtils().client;
  const [scope, setScope] = useState({ month: "", storeName: "", country: "", parentAsin: "", search: "" }), [state, setState] = useState<ReadState>({ status: "idle" });
  const sequence = useRef(0), pending = useRef<AbortController | null>(null);
  useEffect(() => () => { sequence.current++; pending.current?.abort(); }, []);
  function clear() { sequence.current++; pending.current?.abort(); pending.current = null; setState({ status: "idle" }); }
  async function read(offset = 0, previous?: ProfitBoardReadResult, selectedId?: string, requestedMonth?: string) {
    clear(); const month = requestedMonth ?? scope.month;
    if (requestedMonth !== undefined) setScope(value => ({ ...value, month: requestedMonth }));
    const { parentAsin, ...otherScope } = scope;
    const parsed = ProfitBoardReadInputSchema.safeParse({ ...otherScope, month, ...(parentAsin.trim() ? { parentAsin: parentAsin.trim() } : {}), expectedWorkspaceId: owner.workspaceId, groupOffset: offset, groupLimit: GROUP_LIMIT });
    if (!parsed.success) { setState({ status: "invalid" }); return; }
    const ticket = ++sequence.current, controller = new AbortController(); pending.current = controller;
    const current = () => ticket === sequence.current && !controller.signal.aborted;
    setState({ status: "loading" });
    try {
      const raw = await client.profitBoardRead.get.query(parsed.data, { signal: controller.signal });
      if (!current()) return;
      const result = acceptResult(raw, parsed.data, owner);
      if (previous && (result.status !== "ready" || pageBinding(previous) !== pageBinding(result)) || selectedId && !result.products.some(product => product.id === selectedId)) throw new Error("PROFIT_READ_SOURCES_CHANGED");
      if (current()) setState({ status: "ready", result, ...(selectedId ? { selectedId } : {}) });
    } catch { if (current()) setState({ status: "error" }); }
    finally { if (current()) pending.current = null; }
  }
  return <Shell><form aria-label="利润看板读取范围" className="space-y-3" onSubmit={event => { event.preventDefault(); void read(); }}>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{([ ["month", "基准月份（YYYY-MM）"], ["storeName", "店铺"], ["country", "站点 / 国家代码"], ["parentAsin", "父 ASIN（可选）"], ["search", "产品搜索（保留完整父组）"] ] as const).map(([key, label]) => <label className="min-w-0 text-sm" key={key}>{label}<input className="mt-1 w-full min-w-0 rounded border bg-background p-2" aria-label={`利润看板${label}`} autoComplete="off" value={scope[key]} onChange={event => { const value = event.currentTarget.value; clear(); setScope(old => ({ ...old, [key]: value })); }} /></label>)}</div>
    <p className="text-xs text-muted-foreground">父 ASIN 留空时只读取服务器当前授权父体；搜索和留空都不是权限。不会按保存的姓名或 ownerIds 授权；不跨店 / 站点合计。</p>
    <div className="flex flex-wrap gap-3"><button type="submit" className={buttonClass}>读取已有利润看板</button><button type="button" className={buttonClass} onClick={clear}>取消并清除利润看板</button></div>
  </form>
    {state.status === "loading" && <p role="status">正在读取六个月已保存利润来源…</p>}
    {state.status === "invalid" && <p role="alert">利润看板范围不完整或不合法，未发送请求。</p>}
    {state.status === "error" && <p role="alert">利润看板读取失败，或身份、权限、范围、来源及回包完整性已变化。旧数据已清除，未回退缓存或补零；请显式从首页重新读取。</p>}
    {state.status === "ready" && <ProfitBoardReadOnlyContent key={sequence.current} result={state.result} initialProductId={state.selectedId} onPage={(offset, productId) => { void read(offset, state.result, productId); }} onMonth={month => { void read(0, undefined, undefined, month); }} />}
  </Shell>;
}
export default function ProfitBoardReadOnly() {
  const auth = useAuth(), permissions = usePermissions();
  if (auth.loading) return <Shell><p role="status">正在确认利润看板读取身份…</p></Shell>;
  if (auth.error) return <Shell><p role="alert">身份读取失败，利润看板已隐藏。</p></Shell>;
  const user = auth.user;
  if (!user || !positiveId(user.id) || !positiveId(user.defaultWorkspaceId) || typeof user.role !== "string" || !user.role.trim()) return <Shell><p role="alert">需要有效用户及明确工作区才能读取利润看板；未回退全局或旧范围。</p></Shell>;
  if (permissions.isLoading) return <Shell><p role="status">正在确认利润看板读取权限…</p></Shell>;
  if (!permissions.canRead("ops", "ops_data_import")) return <Shell><p role="alert">没有利润看板读取权限，旧数据已隐藏。</p></Shell>;
  const owner = { userId: user.id, workspaceId: user.defaultWorkspaceId, role: user.role };
  return <OwnedProfitBoard key={JSON.stringify([owner.userId, owner.workspaceId, owner.role])} owner={owner} />;
}
