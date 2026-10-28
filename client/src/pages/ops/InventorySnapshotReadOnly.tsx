import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import InventorySnapshotRefresh, { subscribeInventorySnapshotChanges } from "./InventorySnapshotRefresh";
import {
  InventorySnapshotReadInputSchema, InventorySnapshotReadResultSchema, inventoryAgeQuantity,
  type InventorySnapshotReadInput, type InventorySnapshotReadResult,
} from "@shared/inventorySnapshotRead";

type Owner = { userId: number; workspaceId: number; role: string };
type ReadState = { status: "idle" | "loading" | "error" | "invalid" } | { status: "ready"; result: InventorySnapshotReadResult };
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
const isManager = (owner: Owner) => ["super_admin", "admin", "ops_manager"].includes(owner.role);
const buttonClass = "rounded-lg border bg-background px-4 py-2 text-sm transition hover:bg-muted disabled:opacity-40";
const cellClass = "max-w-64 whitespace-pre-wrap break-words border-b border-border/60 px-4 py-5 align-top";
const shown = (value: string | number | null | undefined) => value === null || value === undefined || value === "" ? "—" : String(value);
const quantityText = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
const moneyText = (value: number) => value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const nullableQuantity = (value: number | null | undefined) => value === null || value === undefined ? "未知" : quantityText(value);
function capturedTime(value: number) {
  if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) return "时间不可核验";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function Shell({ children }: { children: ReactNode }) {
  return <section aria-label="完整库存快照只读查看" className="manus-no-record min-w-0 max-w-full space-y-5 overflow-hidden rounded-xl border bg-card p-4 md:p-5">
    <header className="space-y-2"><h2 className="text-2xl font-semibold tracking-tight">库存情况</h2>
      <p className="text-sm text-muted-foreground">查看国内仓、采购在途、FBA 在途及仓内库存，掌握库存与货值。</p>
    </header>{children}
  </section>;
}
function ScrollTable({ children, label }: { children: ReactNode; label: string }) {
  return <div role="region" aria-label={label} tabIndex={0} className="min-w-0 max-w-full overflow-x-auto rounded border focus-visible:outline focus-visible:outline-2">{children}</div>;
}

type Group = InventorySnapshotReadResult["groups"][number];
type Stock = Group["rows"][number]["domestic"];
const STOCK_KEYS = ["domestic", "purchase", "shipping", "fba", "total"] as const;
const STOCK_LABELS = { domestic: "国内仓", purchase: "采购在途", shipping: "FBA 在途", fba: "FBA 仓", total: "商品总库存" };
function StockQuantity({ stock }: { stock: Stock }) {
  const quotient = stock.quantity === 0 ? 0 : stock.quantity > 0 && stock.value !== null && stock.value > 0 ? stock.value / stock.quantity : null;
  const unit = quotient !== null && Number.isFinite(quotient) ? quotient : null;
  return <div className="space-y-1.5 text-right tabular-nums"><p className="text-xl font-semibold tracking-tight"><span className="sr-only">数量 </span>{quantityText(stock.quantity)}</p><p className="whitespace-nowrap text-xs text-muted-foreground">货值 {stock.value === null ? "待核对" : `¥${moneyText(stock.value)}`}</p><p className={`whitespace-nowrap text-xs ${unit === null ? "text-amber-700" : "text-muted-foreground"}`}>单价 {unit === null ? "待核对" : `¥${quantityText(unit)}`}</p></div>;
}
function Totals({ totals, title }: { totals: NonNullable<InventorySnapshotReadResult["totals"]>; title: string }) {
  return <section aria-label={title} className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-medium">{title}</h4><p className="text-xs text-muted-foreground">人民币 · 当前筛选全部产品</p></div>
    <div className="grid min-w-0 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {STOCK_KEYS.map(key => <div className={`min-w-0 rounded-xl border p-4 ${key === "total" ? "border-primary/20 bg-primary/5" : "bg-muted/20"}`} key={key}><h5 className="mb-3 text-sm text-muted-foreground">{STOCK_LABELS[key]}</h5><StockQuantity stock={totals[key]} /></div>)}
      <div className="min-w-0 rounded-xl border bg-muted/20 p-4"><h5 className="mb-3 text-sm text-muted-foreground">辅料</h5><StockQuantity stock={totals.aux} /></div>
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground"><p>计划数量：{quantityText(totals.plan)}</p><p>FBA 待发货计划：{nullableQuantity(totals.inboundWorking)}</p><p>计划与辅料不计入商品总库存；采购在途按订单总货值计算。</p></div>
  </section>;
}
function GroupsTable({ groups, label, aged, threshold }: { groups: Group[]; label: string; aged: boolean; threshold: 180 | 365 }) {
  return <ScrollTable label={label}><table className="w-full min-w-[1500px] text-left text-sm"><caption className="sr-only">同一父体的子体集中展示</caption>
    <thead className="bg-slate-100/80 text-slate-600"><tr>{["父体名称 / ASIN", "子体 ASIN / 名称", "MSKU", "本地 SKU", aged ? "超龄数量" : "计划数量", ...STOCK_KEYS.map(key => STOCK_LABELS[key]), "辅料"].map(label => <th className="whitespace-nowrap px-4 py-3 text-xs font-medium" key={label}>{label}</th>)}</tr></thead>
    {groups.map(group => <tbody key={group.id} data-group-id={group.id} className="border-b-2 border-border/70">{group.rows.map((row, index) => <tr key={row.id} className="transition-colors hover:bg-muted/20">
      {index === 0 && <td rowSpan={group.rows.length} className={`${cellClass} min-w-48 border-r bg-muted/20`}><p className="mb-2 font-semibold leading-6">{shown(group.name)}</p><p className="text-xs text-muted-foreground">{shown(group.parentAsin)}</p><p className="mt-2 text-xs text-muted-foreground">{shown(group.operator)}</p>{aged && <p className="mt-3 text-xs font-medium text-amber-700">超龄合计：{nullableQuantity(group.aged)}</p>}</td>}
      <td className={cellClass}><p className="font-mono">{shown(row.asin)}</p><p>{shown(row.name)}</p></td>
      <td className={cellClass}>{shown(row.msku)}</td><td className={cellClass}>{shown(row.localSku)}</td>
      <td className={cellClass}>{aged ? row.ageStatus === "not_applicable" ? <p>不适用（非 FBA），不是已测库龄为零</p> : <><p>{threshold === 365 ? "超过 365 天" : "181 天及以上"}：{nullableQuantity(inventoryAgeQuantity(row, threshold))}</p><p>库龄日期：{row.age.dates.length ? row.age.dates.join(" / ") : "未保存"}</p><p>181–270：{nullableQuantity(row.age.days181To270)}<br />271–365：{nullableQuantity(row.age.days271To365)}<br />365+：{nullableQuantity(row.age.days365Plus)}</p>{row.notes.filter(note => note.includes("库龄")).map((note, i) => <p className="text-amber-700" key={i}>{note}</p>)}</> : <><p>{quantityText(row.plan)}</p><p>不计入库存或货值</p></>}</td>
      {STOCK_KEYS.map(key => <td className={cellClass} key={key}><StockQuantity stock={row[key]} /></td>)}
      <td className={cellClass}>{!row.aux.length ? <span className="text-muted-foreground">—</span> : <details><summary className="cursor-pointer whitespace-nowrap text-primary">{row.aux.length} 种辅料明细</summary><p className="my-2 text-xs text-muted-foreground">共享辅料在合计中只计算一次。</p>{row.aux.map(aux => <div key={aux.id} className="mt-3 space-y-1 border-t pt-2"><p>{aux.name}</p><p className="text-xs text-muted-foreground">{aux.sku}</p><StockQuantity stock={aux.stock} /></div>)}</details>}</td>

    </tr>)}</tbody>)}
  </table></ScrollTable>;
}
function Pagination({ page, label, onChange }: { page: InventorySnapshotReadResult["page"]; label: string; onChange?: (offset: number) => void }) {
  return <nav aria-label={`${label}分页`} className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><p>共 {page.totalGroups} 个产品 · {page.totalRows} 条明细 · 第 {Math.floor(page.offset / page.limit) + 1} 页</p><div className="flex gap-2">
    <button type="button" className={buttonClass} disabled={!onChange || page.offset === 0} onClick={() => onChange?.(Math.max(0, page.offset - page.limit))}>{label}上一页</button>
    <button type="button" className={buttonClass} disabled={!onChange || !page.hasMore || page.nextOffset === null} onClick={() => { if (page.nextOffset !== null) onChange?.(page.nextOffset); }}>{label}下一页</button>
  </div></nav>;
}

/** Presentation of an already validated result. No RPC, source fetching, saved
 * owner authorization, or cross-scope inference. All source text is escaped. */
export function InventorySnapshotReadOnlyContent({ result, onPage }: { result: InventorySnapshotReadResult; onPage?: (groupOffset: number, agedGroupOffset: number) => void }) {
  const snapshot = result.snapshot;
  if (result.status !== "ready" || !snapshot || !result.totals || !result.agedTotals) return <div className="space-y-2" role={result.status === "invalid" ? "alert" : "status"}>
    <p>{result.status === "missing" ? "库存快照表尚未连接，不代表零库存。" : result.status === "not_found" ? "没有可读取的已保存库存快照，不代表零库存。" : result.status === "scope_unverifiable" ? "无法核验该范围的来源或授权；不展示工作区总量或猜测归属。" : "库存快照损坏、不完整或不兼容；未截断、补零或回退旧结果。"}</p>
  </div>;
  return <div className="min-w-0 max-w-full space-y-5">
    <section aria-label="已保存库存快照来源" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
      <p>赛狐库存 · 人民币</p><p>上次更新：{capturedTime(snapshot.capturedAt)}（北京时间）</p>
    </section>
    <Totals totals={result.totals} title="全筛选库存与货值合计" />
    <section aria-label="完整库存明细" className="min-w-0 space-y-3"><h3 className="font-semibold">库存明细表</h3>
      <p className="text-xs text-muted-foreground">同一父体集中展示，货值和单价位于数量下方。有辅料的产品可在辅料列展开查看。</p>
      {result.groups.length ? <GroupsTable groups={result.groups} label="库存明细横向表" aged={false} threshold={result.request.ageThreshold} /> : <p>当前筛选或当前页没有库存组；未据此断言没有历史库存或库龄。</p>}
      <Pagination page={result.page} label="库存父组" onChange={onPage ? offset => onPage(offset, result.agedPage.offset) : undefined} />
    </section>
    <section aria-label="完整库龄明细" className="min-w-0 space-y-3"><h3 className="font-semibold">超龄库存一览：{result.request.ageThreshold === 365 ? "超过 365 天" : "181 天及以上"}</h3>
      <p className="text-xs text-muted-foreground">按父体超龄数量从多到少排列。货值为这些产品的全部库存货值。</p>
      <p className="text-xs text-muted-foreground">已知超龄父组 {result.agedPage.knownGroupCount} 个；库龄未知父组 {result.agedPage.unknownGroupCount} 个。缺少库龄的产品单独展示。</p>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">查看超龄产品库存合计</summary><div className="mt-4 space-y-5"><Totals totals={result.agedTotals} title="全部已知超龄父组的完整库存合计（不含未知组）" />
      {result.unknownAgeTotals && <Totals totals={result.unknownAgeTotals} title="全部库龄未知父组的完整库存独立合计" />}</div></details>
      {result.agedGroups.length ? <GroupsTable groups={result.agedGroups} label="已知超龄库存横向表" aged threshold={result.request.ageThreshold} /> : <p>当前页无已知正超龄组；未知库龄不等于无超龄库存。</p>}
      {result.unknownAgeGroups.length > 0 && <section aria-label="库龄未知组" className="min-w-0 space-y-3"><h4 className="font-medium">库龄未完整返回：独立保留</h4><GroupsTable groups={result.unknownAgeGroups} label="库龄未知库存横向表" aged threshold={result.request.ageThreshold} /></section>}
      <Pagination page={result.agedPage} label="库龄父组" onChange={onPage ? offset => onPage(result.page.offset, offset) : undefined} />
    </section>
  </div>;
}

function acceptResult(raw: unknown, input: InventorySnapshotReadInput, owner: Owner) {
  const result = InventorySnapshotReadResultSchema.parse(raw);
  if (result.identity.userId !== owner.userId || result.identity.workspaceId !== owner.workspaceId || JSON.stringify(result.request) !== JSON.stringify(input)) throw new Error("INVENTORY_READ_SCOPE_CHANGED");
  if (!isManager(owner) && result.snapshot?.visibility === "full") throw new Error("INVENTORY_READ_SCOPE_CHANGED");
  return result;
}

const GROUP_LIMIT = 12;
function OwnedInventory({ owner, currentProducts, initialAttention }: { owner: Owner; currentProducts: boolean; initialAttention?: InventorySnapshotReadInput["attention"] }) {
  const client = trpc.useUtils().client, manager = isManager(owner);
  const [scope, setScope] = useState({ parentAsin: "", storeName: "", country: "", accountId: "" });
  const [allScopes, setAllScopes] = useState(manager), [search, setSearch] = useState(""), [unpaired, setUnpaired] = useState(false);
  const [threshold, setThreshold] = useState<180 | 365>(180), [state, setState] = useState<ReadState>({ status: "idle" });
  const [attention, setAttention] = useState<InventorySnapshotReadInput["attention"]>(initialAttention);
  const [operatorId, setOperatorId] = useState<number | undefined>();
  const [operators, setOperators] = useState<Array<{ id: number; name: string }>>([]);
  const sequence = useRef(0), pending = useRef<AbortController | null>(null), active = useRef(false);
  const changeHandler = useRef<(notice: { userId: number; workspaceId: number }) => void>(() => {});
  useEffect(() => () => { sequence.current++; pending.current?.abort(); }, []);
  function clear(preserveActive = false) { sequence.current++; pending.current?.abort(); pending.current = null; setState({ status: "idle" }); if (!preserveActive) active.current = false; }
  async function read(groupOffset = 0, agedGroupOffset = 0, expectedSnapshot?: NonNullable<InventorySnapshotReadResult["snapshot"]>) {
    clear(true);
    const parsed = InventorySnapshotReadInputSchema.safeParse({ expectedWorkspaceId: owner.workspaceId, search, unpaired, ageThreshold: threshold,
      ...(attention ? { attention } : {}), groupOffset, groupLimit: GROUP_LIMIT, agedGroupOffset, agedGroupLimit: GROUP_LIMIT, ...(currentProducts ? { ownershipMode: "current_us", ...(operatorId !== undefined ? { operatorId } : {}) } : manager && allScopes ? {} : { exactScope: scope }) });
    if (!parsed.success) { active.current = false; setState({ status: "invalid" }); return; }
    active.current = true;
    const ticket = ++sequence.current, controller = new AbortController(); pending.current = controller;
    const current = () => ticket === sequence.current && !controller.signal.aborted;
    setState({ status: "loading" });
    try {
      const raw = await client.inventorySnapshotRead.get.query(parsed.data, { signal: controller.signal });
      if (!current()) return;
      const result = acceptResult(raw, parsed.data, owner);
      if (expectedSnapshot && (result.snapshot?.id !== expectedSnapshot.id || result.snapshot.runId !== expectedSnapshot.runId
        || result.snapshot.runSource !== expectedSnapshot.runSource || result.snapshot.capturedAt !== expectedSnapshot.capturedAt || result.snapshot.version !== expectedSnapshot.version)) throw new Error("INVENTORY_SNAPSHOT_CHANGED");
      if (current()) { setOperators(result.operators ?? []); setState({ status: "ready", result }); }
    } catch { if (current()) { active.current = false; setState({ status: "error" }); } }
    finally { if (current()) pending.current = null; }
  }
  const initialRead = useRef(read);
  useEffect(() => { if (currentProducts) void initialRead.current(); }, [currentProducts]);
  changeHandler.current = notice => {
    if (notice.userId === owner.userId && notice.workspaceId === owner.workspaceId && active.current) void read();
  };
  useEffect(() => subscribeInventorySnapshotChanges(notice => changeHandler.current(notice)), []);
  return <Shell>
    <nav className="flex flex-wrap gap-3 text-sm"><a href="/ops/inventory-details" className="text-primary">库存明细</a><a href="/ops/inventory" className="text-primary">库存关注</a><a href="/ops/inventory-planning" className="text-muted-foreground">历史补货规划</a></nav>
    <form aria-label="库存只读查询范围" className="grid gap-4 rounded-xl border bg-muted/20 p-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={event => { event.preventDefault(); void read(); }}>
      <label className="block text-sm">关注情况<select className="mt-1 block w-full rounded border bg-background p-2" value={attention ?? "all"} onChange={event => { clear();setAttention(event.target.value === "all" ? undefined : event.target.value as InventorySnapshotReadInput["attention"]); }}><option value="all">全部库存</option><option value="fba_empty">FBA 数量为零、其他环节有库存</option><option value="aged">存在超龄库存</option><option value="valuation_missing">有数量但货值待核对</option></select></label>
      {!currentProducts && manager && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allScopes} onChange={event => { clear(); setAllScopes(event.currentTarget.checked); }} />读取工作区可见的全部已保存范围（管理员）</label>}
      {!currentProducts && !allScopes && <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">{([
        ["parentAsin", "父 ASIN"], ["storeName", "店铺"], ["country", "站点 / 国家代码"], ["accountId", "来源账号 ID"],
      ] as const).map(([key, label]) => <label className="min-w-0 text-sm" key={key}>{label}<input className="mt-1 w-full min-w-0 rounded border bg-background p-2" aria-label={`库存${label}`} autoComplete="off" value={scope[key]} onChange={event => { const value = event.currentTarget.value; clear(); setScope(old => ({ ...old, [key]: value })); }} /></label>)}</div>}
      {!currentProducts && <p className="text-xs text-muted-foreground">{manager ? "旧快照未保存店铺、站点或账号时仅标为未知，不自动补美国来源，也不跨范围猜测归属。" : "必须指定真实授权范围；旧快照来源身份不可核验时不展示其工作区总数。负责人名字和保存的 ownerIds 仅来源备注，不授予权限。"}</p>}
      {currentProducts && <label className="block text-sm">运营负责人<select aria-label="库存运营负责人" className="mt-1 block w-full rounded border bg-background p-2" value={unpaired ? "unpaired" : operatorId ?? "all"} onChange={event => { clear(); const value = event.currentTarget.value; setUnpaired(value === "unpaired"); setOperatorId(value === "all" || value === "unpaired" ? undefined : Number(value)); }}><option value="all">{manager ? "全部运营" : "我和搭档"}</option>{operators.map(operator => <option key={operator.id} value={operator.id}>{operator.name}</option>)}{manager && <option value="unpaired">未配对库存</option>}</select></label>}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 md:col-span-2">
        <label className="min-w-0 text-sm">查找产品<input aria-label="库存搜索" className="mt-1 w-full min-w-0 rounded border bg-background p-2" value={search} autoComplete="off" placeholder="产品名称、父/子 ASIN、MSKU、本地 SKU" onChange={event => { clear(); setSearch(event.currentTarget.value); }} /></label>
        <label className="text-sm">超龄口径<select aria-label="库存超龄口径" className="mt-1 block w-full rounded border bg-background p-2" value={threshold} onChange={event => { clear(); setThreshold(event.currentTarget.value === "365" ? 365 : 180); }}><option value="180">181 天及以上</option><option value="365">超过 365 天</option></select></label>
      </div>
      {!currentProducts && <label className="flex items-center gap-2 text-sm"><input aria-label="仅未配对库存" type="checkbox" checked={unpaired} onChange={event => { clear(); setUnpaired(event.currentTarget.checked); }} />仅未配对 / 未分配库存（筛选不扩大权限）</label>}
      <div className="flex flex-wrap gap-3 md:col-span-2 xl:col-span-4"><button type="submit" aria-label="读取已有库存快照" className={`${buttonClass} bg-primary text-primary-foreground`}>查询库存</button><button type="button" aria-label="取消并清除库存" className={buttonClass} onClick={() => clear()}>清空结果</button></div>
    </form>
    {state.status === "loading" && <p role="status">正在读取已保存库存快照…</p>}
    {state.status === "invalid" && <p role="alert">库存查询范围不完整或不合法，未发送请求。</p>}
    {state.status === "error" && <p role="alert">库存读取失败或数据已更新，请重新查询。若仍无法查看，请联系管理员。</p>}
    {state.status === "ready" && <InventorySnapshotReadOnlyContent result={state.result} onPage={(groupOffset, agedGroupOffset) => { void read(groupOffset, agedGroupOffset, state.result.snapshot ?? undefined); }} />}
  </Shell>;
}

function InventorySnapshotReader({ currentProducts, initialAttention }: { currentProducts: boolean; initialAttention?: InventorySnapshotReadInput["attention"] }) {
  const auth = useAuth(), permissions = usePermissions();
  if (auth.loading) return <Shell><p role="status">正在确认库存读取身份…</p></Shell>;
  if (auth.error) return <Shell><p role="alert">身份读取失败，库存数据已隐藏。</p></Shell>;
  const user = auth.user;
  if (!user || !positiveId(user.id) || !positiveId(user.defaultWorkspaceId) || typeof user.role !== "string" || !user.role.trim()) return <Shell><p role="alert">需要有效用户及明确工作区才能读取库存；未回退全局或旧工作区。</p></Shell>;
  if (permissions.isLoading) return <Shell><p role="status">正在确认库存读取权限…</p></Shell>;
  if (!permissions.canRead("ops", "ops_data_import")) return <Shell><p role="alert">没有库存读取权限，旧数据已隐藏。</p></Shell>;
  const owner = { userId: user.id, workspaceId: user.defaultWorkspaceId, role: user.role };
  return <OwnedInventory key={JSON.stringify([owner.userId, owner.workspaceId, owner.role, initialAttention])} owner={owner} currentProducts={currentProducts} initialAttention={initialAttention} />;
}

export default function InventorySnapshotReadOnly({ withRefresh = false, currentProducts = false, initialAttention }: { withRefresh?: boolean; currentProducts?: boolean; initialAttention?: InventorySnapshotReadInput["attention"] } = {}) {
  return <>{withRefresh && <InventorySnapshotRefresh />}<InventorySnapshotReader currentProducts={currentProducts} initialAttention={initialAttention} /></>;
}
