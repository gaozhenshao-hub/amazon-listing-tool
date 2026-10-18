import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { ProductBoardReadInputSchema, ProductBoardReadResultSchema, type ProductBoardReadInput, type ProductBoardReadResult } from "@shared/productBoardRead";

type Owner = { userId: number; workspaceId: number; role: string };
type Section = "highReturns" | "highProfit" | "losing" | "all";
type Product = ProductBoardReadResult["products"][number];
const SECTIONS: Section[] = ["highReturns", "highProfit", "losing", "all"];
const LABELS: Record<Section, string> = { highReturns: "高退货率产品", highProfit: "高利润产品", losing: "亏损产品", all: "全部产品" };
const PAGE_SIZE = 10, LOCAL_SIZE = 20;
const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";
const cellClass = "max-w-72 whitespace-pre-wrap break-words border-b p-3 align-top";
const tableHeadClass = "sticky top-0 z-10 bg-muted";
const negativeClass = (value: number | null) => value !== null && value < 0 ? "font-semibold text-red-700" : "";
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const numberText = (value: number | null) => value === null ? "未知" : value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
const amount = (value: number | null, currency: string | null) => value === null ? "未知" : `${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${currency ?? "币种未知（原值）"}`;
const percent = (value: number | null) => value === null ? "未知 / 分母不可用" : `${numberText(value * 100)}%`;
function Shell({ children }: { children: ReactNode }) {
  return <section aria-label="产品看板只读查看" className="manus-no-record min-w-0 max-w-full space-y-5 overflow-hidden rounded-xl border bg-card p-4 md:p-5">
    <header className="space-y-2"><h2 className="text-lg font-semibold">产品看板 · 已保存财务来源只读研究</h2>
      <p className="text-sm text-muted-foreground">高退货率、高利润、亏损及全部产品；当月、近三个月和全部可见已保存历史，父体与全部子体可钻取。</p>
      <p className="text-xs text-muted-foreground">按已保存批次选择，尚未核验店铺 / 月度完整覆盖。不同币种和汇总依据不合并；不补零、不汇率换算、不自动同步或调用模型。</p>
      <p className="text-xs text-muted-foreground">这是当前授权来源的只读计算，不是已冻结归档。运营 / 搭档筛选、实际归档、任务编辑与附件操作尚未接入本区域。</p>
    </header>{children}
  </section>;
}
function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return <div role="region" aria-label={label} tabIndex={0} className="max-h-[560px] min-w-0 max-w-full overflow-x-auto overflow-y-auto rounded border focus-visible:outline focus-visible:outline-2">{children}</div>;
}
function Raw({ value, label }: { value: unknown; label: string }) {
  return <details><summary className="cursor-pointer">{label}</summary><pre className="max-w-3xl whitespace-pre-wrap break-all text-xs">{JSON.stringify(value, null, 2)}</pre></details>;
}
function LocalPager({ label, offset, total, onPage }: { label: string; offset: number; total: number; onPage: (offset: number) => void }) {
  return <nav aria-label={`${label}分页`} className="flex flex-wrap items-center gap-3 text-sm"><span>{total ? `${offset + 1}–${Math.min(offset + LOCAL_SIZE, total)} / ${total}` : "0 / 0"}，全部可逐页查看</span>
    <button type="button" className={buttonClass} disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - LOCAL_SIZE))}>{label}上一页</button>
    <button type="button" className={buttonClass} disabled={offset + LOCAL_SIZE >= total} onClick={() => onPage(offset + LOCAL_SIZE)}>{label}下一页</button>
  </nav>;
}
const PERIODS = ["month", "quarter", "total"] as const;
const PERIOD_LABELS = { month: "当月", quarter: "近三个日历月", total: "全部可见已保存历史" };
const BASIS_LABELS = { child_rows: "子体原行汇总", reported_parent_row: "原报表父体合计（独立）", unallocated_rows: "未分配 / 歧义原行（独立）" };
const STATUS_LABELS = { observed: "有保存观测", partial: "部分覆盖 / 指标未知", missing: "缺原行", ambiguous: "原行有歧义", unknown_currency: "币种未知" };
function Rates({ rates, currency, label }: { rates: Product["rates"]; currency: string | null; label: string }) {
  return <ScrollTable label={label}><table className="w-full min-w-[1400px] text-left text-xs"><thead className={tableHeadClass}><tr>{["统计窗口 / 覆盖", "退货量", "退货率", "退款量", "退款率", "同期销量", "销售额", "财务利润", "分子分母 / 完整依据"].map(value => <th className="p-3" key={value}>{value}</th>)}</tr></thead><tbody>{PERIODS.map(period => {
    const value = rates[period], coverage = value.coverage;
    return <tr key={period}><th scope="row" className={cellClass}>{PERIOD_LABELS[period]}<br />{coverage.start} 至 {coverage.end}<br />{STATUS_LABELS[value.status]}<br />有原行 {coverage.observedMonths.length} / {coverage.expectedMonths} 个月 · {coverage.complete ? "原行月份齐全" : "覆盖不完整"}<p>{value.missingReason}</p></th>
      <td className={cellClass}>{numberText(value.returns)}</td><td className={cellClass}>{percent(value.returnRate.value)}</td><td className={cellClass}>{numberText(value.refunds)}</td><td className={cellClass}>{percent(value.refundRate.value)}</td><td className={cellClass}>{numberText(value.salesQty)}</td><td className={cellClass}>{amount(value.salesAmount, currency)}</td><td className={`${cellClass} ${negativeClass(value.profit)}`}>{amount(value.profit, currency)}</td>
      <td className={cellClass}><p>退货率 = {numberText(value.returnRate.numerator)} / {numberText(value.returnRate.denominator)}</p><p>退款率 = {numberText(value.refundRate.numerator)} / {numberText(value.refundRate.denominator)}</p><p>合计分子 ÷ 同期合计分母，不平均各行百分比。</p><Raw label={`${PERIOD_LABELS[period]} 完整月份 / 分母 / 来源`} value={value} /></td>
    </tr>;
  })}</tbody></table></ScrollTable>;
}
function Financial({ value, currency, label }: { value: Product["financial"]; currency: string | null; label: string }) {
  return <div className="space-y-2"><p className="text-sm">{STATUS_LABELS[value.status]} · {value.missingReason}</p><ScrollTable label={label}><table className="w-full min-w-[1100px] text-left text-xs"><thead className={tableHeadClass}><tr>{["销量", "销售额", "财务利润", "利润率", "采购成本", "头程", "派生额（非实际回款）"].map(value => <th className="p-3" key={value}>{value}</th>)}</tr></thead><tbody><tr>
    <td className={cellClass}>{numberText(value.qty)}</td><td className={cellClass}>{amount(value.sales, currency)}</td><td className={`${cellClass} ${negativeClass(value.profit)}`}>{amount(value.profit, currency)}</td><td className={cellClass}>{percent(value.margin.value)}<br />{numberText(value.margin.numerator)} / {numberText(value.margin.denominator)}</td><td className={cellClass}>{amount(value.purchase, currency)}</td><td className={cellClass}>{amount(value.freight, currency)}</td><td className={`${cellClass} ${negativeClass(value.cashProxy.value)}`}>{amount(value.cashProxy.value, currency)}<br />利润 {numberText(value.cashProxy.components.profit)} + 采购 {numberText(value.cashProxy.components.purchase)} + 头程 {numberText(value.cashProxy.components.freight)}</td>
  </tr></tbody></table></ScrollTable><p className="text-xs">派生额仅为“财务利润 + 采购成本 + 头程费用”的代数值，不是回款、到账或现金流；不改动原费用正负号。{value.cashProxy.missingReason}</p><Raw label={`${label} 完整原值和计算依据`} value={value} /></div>;
}
function ProductDetail({ product, rows }: { product: Product; rows: ProductBoardReadResult["pageRows"] }) {
  const [childOffset, setChildOffset] = useState(0), [sourceOffset, setSourceOffset] = useState(0);
  const keys = new Set(product.sourceRows.map(ref => `${ref.batchId}:${ref.rowIndex}`)), originals = rows.filter(row => keys.has(`${row.batchId}:${row.rowIndex}`));
  return <section aria-label="产品完整钻取" className="min-w-0 space-y-4 rounded border p-3"><h3 className="font-semibold">{product.parentAsin ?? "未分配原行"} · {product.title || "名称未提供"}</h3><p>{product.currency ?? "币种未知"} · {BASIS_LABELS[product.basis]}。保留原行当时的父子关系，不套最新产品归属。</p>
    <Financial label="父体当月完整财务" value={product.financial} currency={product.currency} /><Rates label="父体三窗口完整指标" rates={product.rates} currency={product.currency} />
    <h4 className="font-semibold">全部子体（{product.children.length} 个）</h4>{!product.children.length ? <p>没有可核验子体明细；不从父体合计或未分配原行捏造子体。</p> : <><LocalPager label="产品子体" offset={childOffset} total={product.children.length} onPage={setChildOffset} />{product.children.slice(childOffset, childOffset + LOCAL_SIZE).map(child => <details key={child.id} className={`min-w-0 rounded border p-3 ${child.financial.cashProxy.value !== null && child.financial.cashProxy.value < 0 ? "bg-red-50" : ""}`}><summary className="cursor-pointer break-words">{child.asin} · {child.title || "名称未提供"} · <span className={negativeClass(child.financial.profit)}>当月利润 {amount(child.financial.profit, product.currency)}</span></summary><p className="my-2 break-words">SKU：{child.skus.join("、") || "未提供"}</p><Financial label={`${child.asin} 当月完整财务`} value={child.financial} currency={product.currency} /><Rates label={`${child.asin} 三窗口完整指标`} rates={child.rates} currency={product.currency} /></details>)}</>}
    <h4 className="font-semibold">全部来源原行（{originals.length} 行）</h4><p className="text-xs">保留19项指标、费用、原始 raw、币种依据、批次 ID 和原行索引；仅文本展示，不执行链接、不下载。</p><LocalPager label="产品来源原行" offset={sourceOffset} total={originals.length} onPage={setSourceOffset} />
    {originals.slice(sourceOffset, sourceOffset + LOCAL_SIZE).map(row => <article key={`${row.batchId}:${row.rowIndex}`} className="min-w-0 rounded border p-3 text-sm"><p>{row.yearMonth} · 批次 {row.batchId} / 原行 {row.rowIndex} · {row.storeName} / {row.country}</p><p className="break-words">父体 {row.parentAsin || "未分配"} · ASIN {row.asin || "未提供"} · SKU {row.sku || "未提供"} · {row.title}</p><p>币种：{row.currency ?? "未知"} · {row.currencyEvidence.note}</p><Raw label={`批次 ${row.batchId} 原行 ${row.rowIndex} 完整费用 / 原文`} value={row} /></article>)}
  </section>;
}
function SourceHistory({ result }: { result: ProductBoardReadResult }) {
  const [offset, setOffset] = useState(0);
  return <section aria-label="产品看板完整历史来源" className="min-w-0 space-y-3"><h3 className="font-semibold">全部可见已保存历史与来源</h3><p className="text-sm">已完成有界历史选择检查；{result.history?.scannedCount === null ? "只展示当前授权范围，不披露跨范围扫描数量。" : `检查 ${result.history?.scannedCount} 个已保存候选批次。`}最早可见原行月份：{result.history?.firstVisibleMonth ?? "没有可见原行（不能解释为零）"}。</p><p className="text-xs">扫描完整不等于店铺月度覆盖完整。当前来源不是归档快照；上限或未知历史会明确拒绝，不用近三月冒充总计。</p>
    <div className="grid gap-3 md:grid-cols-3">{PERIODS.map(period => <div className="rounded border p-3 text-sm" key={period}><strong>{PERIOD_LABELS[period]}</strong><p>{result.periods?.[period].start} 至 {result.periods?.[period].end} · {result.periods?.[period].months.length} 个日历月</p><p>每个产品实际原行覆盖另列，不用全工作区月份数冒充。</p></div>)}</div>
    <LocalPager label="历史月份来源" offset={offset} total={result.sources.length} onPage={setOffset} />{result.sources.slice(offset, offset + LOCAL_SIZE).map(source => <details key={source.month} className="min-w-0 rounded border p-3 text-sm"><summary className="cursor-pointer">{source.month} · {source.status === "selected" ? `来源批次 ${source.selectedBatchId}` : source.status === "not_visible" ? "无当前可见来源" : "缺月度来源"}</summary>
      {source.batch ? <><p>已确认导入，不证明整店 / 整月覆盖完整。当前可见原行 {source.visibleRows}。</p><p>创建 {source.batch.createdAt} · 确认 {source.batch.confirmedAt ?? "未提供"}；数据库原文时间，时区未声明。</p>{source.batch.visibility === "full" ? <><p className="break-words">来源名称：{source.batch.fileName}</p><p className="break-all">文件 / 来源哈希：{source.batch.fileHash}</p><p>来源类型：{source.batch.origin.kind} · 运行 ID：{source.batch.origin.sourceRunId ?? "未提供"} · 哈希依据：{source.batch.origin.hashBasis}</p><p>整批 {source.batch.totalRows} 行 · 上传者 ID {source.batch.userId}。来源引用不是下载 URL。</p></> : <p>仅授权范围必要元信息；未返回整批名称、哈希及跨范围数量。</p>}</> : <p>{source.missingReason}；不填零，不借旧批次补齐。</p>}
    </details>)}
  </section>;
}
const RETURN_METRICS = ["退货量", "退货率", "退款量", "退款率", "销量", "销售额", "利润", "原行覆盖"];
const FINANCIAL_METRICS = ["销量", "销售额", "财务利润", "利润率", "采购成本", "头程", "派生额（非实际回款）"];
function RankedProductRow({ section, product, position, rows }: { section: Section; product: Product; position: number; rows: ProductBoardReadResult["pageRows"] }) {
  const [expanded, setExpanded] = useState(false), detailId = useId(), name = product.parentAsin ?? product.title;
  const toggle = () => setExpanded(value => !value);
  const metrics = section === "highReturns" ? PERIODS.flatMap(period => {
    const value = product.rates[period];
    return [numberText(value.returns), percent(value.returnRate.value), numberText(value.refunds), percent(value.refundRate.value), numberText(value.salesQty), amount(value.salesAmount, product.currency), amount(value.profit, product.currency), `${value.coverage.observedMonths.length}/${value.coverage.expectedMonths} 个月 · ${value.coverage.complete ? "月份齐全" : "不完整"}`].map((text, index) => ({ label: `${PERIOD_LABELS[period]} ${RETURN_METRICS[index]}`, text, emphasis: index === 6 ? negativeClass(value.profit) : "" }));
  }) : [numberText(product.financial.qty), amount(product.financial.sales, product.currency), amount(product.financial.profit, product.currency), percent(product.financial.margin.value), amount(product.financial.purchase, product.currency), amount(product.financial.freight, product.currency), amount(product.financial.cashProxy.value, product.currency)].map((text, index) => ({ label: FINANCIAL_METRICS[index], text, emphasis: index === 2 ? negativeClass(product.financial.profit) : index === 6 ? negativeClass(product.financial.cashProxy.value) : "" }));
  const negativeProxy = product.financial.cashProxy.value !== null && product.financial.cashProxy.value < 0;
  return <Fragment><tr className={negativeProxy ? "bg-red-50" : "hover:bg-muted/20"}>
    <th scope="row" className={cellClass}>{position + 1} · {product.title || "名称未提供"}<br />{product.parentAsin ?? "未分配"}<br /><button type="button" className={buttonClass} aria-expanded={expanded} aria-controls={detailId} onClick={toggle}>{expanded ? "收起" : "展开"} {name} 全部子体与原行</button><p className="mt-1 text-xs font-normal">{product.children.length} 个子体；也可点击指标展开 / 收起。</p></th>
    <td className={cellClass}>{product.currency ?? "币种未知"}<br />{BASIS_LABELS[product.basis]}<br />{STATUS_LABELS[product.financial.status]}</td>
    {metrics.map(metric => <td key={metric.label} className={`${cellClass} ${metric.emphasis}`}><button type="button" className="text-left underline decoration-dotted underline-offset-4 hover:text-primary" aria-label={`${name} ${metric.label} ${expanded ? "收起" : "展开"}子体与原行`} aria-expanded={expanded} aria-controls={detailId} onClick={toggle}>{metric.text}</button></td>)}
  </tr>{expanded && <tr><td colSpan={metrics.length + 2} className="border-b bg-muted/20 p-3"><div id={detailId}><ProductDetail product={product} rows={rows} /></div></td></tr>}</Fragment>;
}
/** Pure presentation: the server supplies full-scope ranking, all arithmetic
 * and original rows. No saved owner IDs or source text grants access here. */
export function ProductBoardReadOnlyContent({ result, onPage }: { result: ProductBoardReadResult; onPage?: (section: Section, offset: number) => void }) {
  if (result.status !== "ready") return <div role={result.status === "invalid" ? "alert" : "status"}><p>{result.status === "missing" ? "产品看板财务来源表尚未接通，不是零记录。" : result.status === "not_found" ? "没有当前可读取产品来源，不是零销量或利润。" : "来源不完整、损坏或超出限额；不返回部分榜单或回退旧来源。"}</p><p>{result.missingReason}</p><p className="text-xs">状态依据：{result.reasonCode}</p></div>;
  return <div className="min-w-0 space-y-5"><p className="text-sm break-words">范围：{result.request.storeName} / {result.request.country} / {result.request.parentAsin ?? "全部当前授权父体"} · 基准月 {result.request.month} · 搜索：{result.request.search || "无"}</p>
    <SourceHistory result={result} /><p className="text-sm">全筛选 {result.sections.all.page.totalProducts} 个父组 / 独立原行，{result.matchedRows} 个来源行；四页并集返回 {result.products.length} 组、{result.pageRows.length} 行，不是只取榜首来源。不同币种及汇总依据不可相加。</p>
    {SECTIONS.map(section => { const data = result.sections[section]; return <section key={section} aria-label={LABELS[section]} className="min-w-0 space-y-3 rounded border p-3"><h3 className="font-semibold">{LABELS[section]} · 全筛选 {data.page.totalProducts} 组</h3><p className="text-xs">{data.rule}；榜单基于全部授权搜索匹配组，不是当前页。</p>
      <nav aria-label={`${LABELS[section]}分页`} className="flex flex-wrap items-center gap-3"><button type="button" className={buttonClass} disabled={!onPage || data.page.offset === 0} onClick={() => onPage?.(section, Math.max(0, data.page.offset - data.page.limit))}>{LABELS[section]}上一页</button><span className="text-sm">本页 {data.entries.length} / {data.page.totalProducts} · 偏移 {data.page.offset}</span><button type="button" className={buttonClass} disabled={!onPage || !data.page.hasMore} onClick={() => data.page.nextOffset !== null && onPage?.(section, data.page.nextOffset)}>{LABELS[section]}下一页</button></nav>
      {!data.entries.length ? <p>没有符合本页条件的可见产品，不解释为零销量 / 零利润。</p> : <ScrollTable label={`${LABELS[section]}横向表`}><table className={`w-full text-left text-xs ${section === "highReturns" ? "min-w-[2400px]" : "min-w-[1200px]"}`}><thead className={tableHeadClass}><tr>{["位置 / 产品 / 钻取", "币种 / 依据", ...(section === "highReturns" ? PERIODS.flatMap(period => RETURN_METRICS.map(metric => `${PERIOD_LABELS[period]} ${metric}`)) : FINANCIAL_METRICS)].map(value => <th className="p-3" key={value}>{value}</th>)}</tr></thead><tbody>{data.entries.map(entry => {
        const product = result.products.find(product => product.id === entry.productId)!;
        return <RankedProductRow key={entry.productId} section={section} product={product} position={entry.position} rows={result.pageRows} />;
      })}</tbody></table></ScrollTable>}
    </section>; })}
    <p className="text-xs">负利润和负派生额以红字提示，负派生额产品行以浅红底提示。派生额 = 财务利润 + 采购成本 + 头程，不是实际回款。库存滞销判断、负责人 / 搭档筛选、任务和冻结归档不由本看板推断或伪造。</p>
  </div>;
}
type ReadState = { status: "idle" | "loading" | "error" | "invalid" } | { status: "ready"; result: ProductBoardReadResult };
const pageBinding = (result: ProductBoardReadResult) => JSON.stringify({ history: result.history, periods: result.periods, sources: result.sources, matchedRows: result.matchedRows, sections: SECTIONS.map(key => ({ key, total: result.sections[key].page.totalProducts, rule: result.sections[key].rule, basis: result.sections[key].analysisBasis })) });
function OwnedProductBoard({ owner }: { owner: Owner }) {
  const client = trpc.useUtils().client;
  const [scope, setScope] = useState({ month: "", storeName: "", country: "", parentAsin: "", search: "" }), [state, setState] = useState<ReadState>({ status: "idle" });
  const sequence = useRef(0), pending = useRef<AbortController | null>(null);
  useEffect(() => () => { sequence.current++; pending.current?.abort(); }, []);
  function clear() { sequence.current++; pending.current?.abort(); pending.current = null; setState({ status: "idle" }); }
  async function read(section?: Section, offset?: number, previous?: ProductBoardReadResult) {
    clear(); const { parentAsin, ...rest } = scope;
    const parsed = ProductBoardReadInputSchema.safeParse({ ...rest, ...(parentAsin.trim() ? { parentAsin: parentAsin.trim() } : {}), expectedWorkspaceId: owner.workspaceId, highReturnsOffset: previous?.request.highReturnsOffset ?? 0, highProfitOffset: previous?.request.highProfitOffset ?? 0, losingOffset: previous?.request.losingOffset ?? 0, allOffset: previous?.request.allOffset ?? 0, pageSize: PAGE_SIZE, ...(section ? { [`${section}Offset`]: offset } : {}) });
    if (!parsed.success) { setState({ status: "invalid" }); return; }
    const request: ProductBoardReadInput = parsed.data, ticket = ++sequence.current, controller = new AbortController(); pending.current = controller;
    const current = () => sequence.current === ticket && !controller.signal.aborted;
    setState({ status: "loading" });
    try {
      const raw = await client.productBoardRead.get.query(request, { signal: controller.signal });
      if (!current()) return;
      const result = ProductBoardReadResultSchema.parse(raw);
      if (result.identity.userId !== owner.userId || result.identity.workspaceId !== owner.workspaceId || JSON.stringify(result.request) !== JSON.stringify(request)) throw new Error("PRODUCT_SCOPE_CHANGED");
      if (!["super_admin", "admin", "ops_manager"].includes(owner.role) && (result.history?.visibility === "full" || result.sources.some(source => source.batch?.visibility === "full"))) throw new Error("PRODUCT_METADATA_DENIED");
      if (previous && (result.status !== "ready" || pageBinding(previous) !== pageBinding(result))) throw new Error("PRODUCT_SOURCES_CHANGED");
      if (current()) setState({ status: "ready", result });
    } catch { if (current()) setState({ status: "error" }); } finally { if (current()) pending.current = null; }
  }
  return <Shell><form aria-label="产品看板读取范围" className="space-y-3" onSubmit={event => { event.preventDefault(); void read(); }}><div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{([["month", "基准月份（YYYY-MM）"], ["storeName", "店铺"], ["country", "站点 / 国家代码"], ["parentAsin", "父 ASIN（可选）"], ["search", "产品搜索（保留完整父组）"]] as const).map(([key, label]) => <label key={key} className="min-w-0 text-sm">{label}<input aria-label={`产品看板${label}`} autoComplete="off" className="mt-1 w-full min-w-0 rounded border bg-background p-2" value={scope[key]} onChange={event => { const value = event.currentTarget.value; clear(); setScope(old => ({ ...old, [key]: value })); }} /></label>)}</div><p className="text-xs">父 ASIN 留空只请求当前授权范围；店铺 / 国家及搜索不是授权，不使用姓名或保存的 ownerIds 扩权。</p><div className="flex flex-wrap gap-3"><button type="submit" className={buttonClass}>读取已有产品看板</button><button type="button" className={buttonClass} onClick={clear}>取消并清除产品看板</button></div></form>
    {state.status === "loading" && <p role="status">正在核验全部已保存历史与产品榜单…</p>}{state.status === "invalid" && <p role="alert">产品看板范围不完整或不合法，未发送请求。</p>}{state.status === "error" && <p role="alert">产品看板读取失败，或身份、权限、范围、历史来源及回包完整性已变化。旧数据已清除，不回退缓存；请显式从首页重新读取。</p>}{state.status === "ready" && <ProductBoardReadOnlyContent key={sequence.current} result={state.result} onPage={(section, offset) => { void read(section, offset, state.result); }} />}
  </Shell>;
}
export default function ProductBoardReadOnly() {
  const auth = useAuth(), permissions = usePermissions();
  if (auth.loading) return <Shell><p role="status">正在确认产品看板读取身份…</p></Shell>;
  if (auth.error) return <Shell><p role="alert">身份读取失败，产品看板已隐藏。</p></Shell>;
  const user = auth.user;
  if (!user || !positiveId(user.id) || !positiveId(user.defaultWorkspaceId) || typeof user.role !== "string" || !user.role.trim()) return <Shell><p role="alert">需要有效用户及明确工作区才能读取产品看板；未回退全局或旧范围。</p></Shell>;
  if (permissions.isLoading) return <Shell><p role="status">正在确认产品看板读取权限…</p></Shell>;
  if (!permissions.canRead("ops", "ops_data_import")) return <Shell><p role="alert">没有产品看板读取权限，旧数据已隐藏。</p></Shell>;
  const owner = { userId: user.id, workspaceId: user.defaultWorkspaceId, role: user.role };
  return <OwnedProductBoard key={JSON.stringify([owner.userId, owner.workspaceId, owner.role])} owner={owner} />;
}
