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
const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";
const cellClass = "max-w-72 whitespace-pre-wrap break-words border-b p-3 align-top";
const shown = (value: string | number | null | undefined) => value === null || value === undefined || value === "" ? "未保存 / 不可核验" : String(value);
const quantityText = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
const moneyText = (value: number) => value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const nullableQuantity = (value: number | null | undefined) => value === null || value === undefined ? "未知" : quantityText(value);
function capturedTime(value: number) {
  if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) return "时间不可核验";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function Shell({ children }: { children: ReactNode }) {
  return <section aria-label="完整库存快照只读查看" className="manus-no-record min-w-0 max-w-full space-y-5 overflow-hidden rounded-xl border bg-card p-4 md:p-5">
    <header className="space-y-2"><h2 className="text-lg font-semibold">完整库存与库龄 · 已保存快照只读</h2>
      <p className="text-sm text-muted-foreground">读取已保存的库存、采购货值、SKU 归属和库龄。不会同步赛狐、更新领星补货规划、上传、写库或执行模型；重新读取不等于重新采集。</p>
      <p className="text-xs text-muted-foreground">计划数量不计入实际库存；采购在途按货值而非付款额。商品和共享辅料分别合计，缺货值或库龄保留未知。库存与库龄可能属于不同时间，不将当前快照称为已完成财务对账。</p>
    </header>{children}
  </section>;
}
function SourceDetails({ value, label }: { value: unknown; label: string }) {
  return <details><summary className="cursor-pointer">{label}</summary><pre className="max-w-3xl whitespace-pre-wrap break-all text-xs">{JSON.stringify(value, null, 2)}</pre></details>;
}
function ScrollTable({ children, label }: { children: ReactNode; label: string }) {
  return <div role="region" aria-label={label} tabIndex={0} className="min-w-0 max-w-full overflow-x-auto rounded border focus-visible:outline focus-visible:outline-2">{children}</div>;
}

type Group = InventorySnapshotReadResult["groups"][number];
type Stock = Group["rows"][number]["domestic"];
const STOCK_KEYS = ["domestic", "purchase", "shipping", "fba", "total"] as const;
const STOCK_LABELS = { domestic: "国内仓", purchase: "采购在途（已下单）", shipping: "FBA 在途（已发出 / 接收中）", fba: "FBA 仓", total: "商品总库存" };
function StockQuantity({ stock }: { stock: Stock }) {
  const quotient = stock.quantity > 0 && stock.value !== null ? stock.value / stock.quantity : null;
  const unit = quotient !== null && Number.isFinite(quotient) ? quotient : null;
  return <div className="space-y-1 text-right"><p>数量 {quantityText(stock.quantity)}</p><p>货值 {stock.value === null ? "未知（未返回完整货值）" : `${moneyText(stock.value)} CNY`}</p><p>单价 {unit === null ? "未知（零数量或缺货值）" : `${quantityText(unit)} CNY / 件`}</p>
    {stock.quantity > 0 && stock.value === 0 && <p className="text-xs text-amber-700">有数量但货值为 0，保留来源零值，需核对</p>}
    <SourceDetails value={{ ...stock, unitValue: unit }} label="数量 / 货值 / 单价完整原值" />
  </div>;
}
function Totals({ totals, title }: { totals: NonNullable<InventorySnapshotReadResult["totals"]>; title: string }) {
  return <section aria-label={title} className="space-y-3 rounded border p-3"><h4 className="font-medium">{title}</h4><p className="text-xs">全筛选范围合计，非当前页；库存分项互斥相加，计划和辅料不并入商品总库存。</p>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><h5>计划数量（不计库存或货值）</h5><p>{quantityText(totals.plan)}</p><SourceDetails value={totals.plan} label="计划数量原值" /></div>
      <div><h5>FBA 待发货计划（inboundWorking，不计库存）</h5><p>{nullableQuantity(totals.inboundWorking)}</p><SourceDetails value={totals.inboundWorking} label="FBA 待发货计划原值" /></div>
      {STOCK_KEYS.map(key => <div className="min-w-0 rounded border p-2" key={key}><h5 className="mb-2 font-medium">{STOCK_LABELS[key]}</h5><StockQuantity stock={totals[key]} /></div>)}
      <div className="min-w-0 rounded border p-2"><h5 className="mb-2 font-medium">共享辅料（独立去重）</h5><StockQuantity stock={totals.aux} /></div>
    </div>
  </section>;
}
function FbaDetails({ row }: { row: Group["rows"][number] }) {
  return <details><summary className="cursor-pointer">FBA 原始分项与北美共享去重（{row.fbaComponents.length} 个物理库存）</summary>
    {!row.fbaComponents.length ? <p>{row.ageStatus === "not_applicable" ? "不适用（非 FBA 行），没有 FBA 分项或 FBA 库龄。" : "未保存 FBA 原始分项，不能据此核验共享库存或补造美国来源；没有分项不等于 FBA 库存为零。"}</p> : <><p>相同物理库存只计一次；来源市场与原引用全部保留。待发货计划不计入仓内或在途，库龄数量不替换实时库存。</p>{row.fbaComponents.map(component => <div key={component.physicalStockId} className="mt-3 space-y-2 border-t pt-2">
      <p>物理库存 ID：{component.physicalStockId}</p><p>来源市场 ID：{component.marketplaceIds.join(" / ")}</p>
      <dl>{([
        ["available", "可用库存"], ["reservedTransfer", "转仓预留"], ["reservedProcessing", "处理中预留"], ["reservedCustomerorders", "客户订单预留"],
        ["unfulfillable", "不可售"], ["research", "调查中"], ["inboundShipped", "已发出在途"], ["inboundReceiving", "接收中在途"],
        ["inTransit", "在途合计"], ["inboundWorking", "待发货计划（不计库存）"], ["totalInventory", "来源总库存"],
      ] as const).map(([key, label]) => <div key={key}><dt className="inline">{label}（{key}）：</dt><dd className="inline">{nullableQuantity(component[key])}</dd></div>)}</dl>
      <p>采购货值：{component.purchaseCosts === null ? "未知" : `${moneyText(component.purchaseCosts)} CNY`}</p>
      <p>原库龄 181–270 / 271–365 / 365+：{nullableQuantity(component.age.days181To270)} / {nullableQuantity(component.age.days271To365)} / {nullableQuantity(component.age.days365Plus)}</p><p>原库龄日期：{component.age.dates.join(" / ") || "未保存"}</p>
      <SourceDetails value={component} label="该物理库存完整原值与来源引用" />
    </div>)}</>}
  </details>;
}
function GroupsTable({ groups, label, aged, threshold }: { groups: Group[]; label: string; aged: boolean; threshold: 180 | 365 }) {
  return <ScrollTable label={label}><table className="w-full min-w-[2200px] text-left text-xs"><caption className="sr-only">完整父组不拆页，来源原文仅纯文本展示</caption>
    <thead><tr>{["父体 / 原范围", "子 ASIN / 商品", "MSKU", "本地 SKU", aged ? "超龄数量 / 快照日期" : "计划数量", ...STOCK_KEYS.map(key => STOCK_LABELS[key]), "辅料（共享独立）", "来源、分项和分配证据"].map(label => <th className="whitespace-nowrap p-3" key={label}>{label}</th>)}</tr></thead>
    {groups.map(group => <tbody key={group.id} data-group-id={group.id}>{group.rows.map((row, index) => <tr key={row.id}>
      {index === 0 && <td rowSpan={group.rows.length} className={`${cellClass} min-w-48 border-r bg-muted/30`}><p className="font-medium">{shown(group.name)}</p><p>父 ASIN：{shown(group.parentAsin)}</p><p>来源负责人：{shown(group.operator)}</p><p>范围核验：{group.scopeStatus === "verified" ? "已核验来源字段映射（非用户授权证明）" : "未保存完整范围 / 不可核验"}</p>{aged && <p>父组超龄合计：{nullableQuantity(group.aged)}</p>}<SourceDetails value={group.scopes} label="全部原范围（不猜店铺 / 国家 / 账号）" /><SourceDetails value={group.totals} label="本完整父组数量与货值" /></td>}
      <td className={cellClass}><p className="font-mono">{shown(row.asin)}</p><p>{shown(row.name)}</p><p>本地商品 ID：{shown(row.commodityId)}</p></td>
      <td className={cellClass}>{shown(row.msku)}</td><td className={cellClass}>{shown(row.localSku)}</td>
      <td className={cellClass}>{aged ? row.ageStatus === "not_applicable" ? <p>不适用（非 FBA），不是已测库龄为零</p> : <><p>{threshold === 365 ? "超过 365 天" : "181 天及以上"}：{nullableQuantity(inventoryAgeQuantity(row, threshold))}</p><p>库龄日期：{row.age.dates.length ? row.age.dates.join(" / ") : "未保存"}</p><p>181–270：{nullableQuantity(row.age.days181To270)}<br />271–365：{nullableQuantity(row.age.days271To365)}<br />365+：{nullableQuantity(row.age.days365Plus)}</p></> : <><p>{quantityText(row.plan)}</p><p>不计入库存或货值</p></>}</td>
      {STOCK_KEYS.map(key => <td className={cellClass} key={key}><StockQuantity stock={row[key]} /></td>)}
      <td className={cellClass}>{!row.aux.length ? "无已保存关联辅料" : <details><summary className="cursor-pointer">查看 {row.aux.length} 种辅料明细</summary><p className="my-2">同一辅料可能出现在多个产品；全筛选合计按共享身份只计一次，不将各产品辅料列相加。</p>{row.aux.map(aux => <div key={aux.id} className="mt-3 space-y-1 border-t pt-2"><p>{aux.name}</p><p>SKU：{aux.sku} · 来源 ID：{aux.id}</p><StockQuantity stock={aux.stock} /><p>共享：{aux.shared ? "是" : "否"}</p><p>{aux.note}</p></div>)}</details>}</td>
      <td className={cellClass}><p>{row.unpaired ? "未配对 / 未分配" : "已保存配对（非授权证明）"}</p><p>分配说明：{shown(row.allocation)}</p><p>最近发货原值：{shown(row.lastShipment)}</p><p>来源负责人：{shown(row.operator)}；保存 ownerIds：{row.ownerIds.join("、") || "无"}（均不授予权限）</p>{row.notes.map((note, index) => <p className="mt-1" key={index}>{note}</p>)}<FbaDetails row={row} /><SourceDetails value={row} label="完整原行 / 范围 / FBA 分项 / 分配依据" /></td>
    </tr>)}</tbody>)}
  </table></ScrollTable>;
}
function Pagination({ page, label, onChange }: { page: InventorySnapshotReadResult["page"]; label: string; onChange?: (offset: number) => void }) {
  return <nav aria-label={`${label}分页`} className="flex flex-wrap items-center justify-between gap-3 text-sm"><p>全部 {page.totalGroups} 组 / {page.totalRows} 行 · 偏移 {page.offset} · 每页最多 {page.limit} 个完整父组</p><div className="flex gap-2">
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
    <p>{result.missingReason}</p><p className="text-xs">状态依据：{result.reasonCode}</p>
  </div>;
  return <div className="min-w-0 max-w-full space-y-5">
    <section aria-label="已保存库存快照来源" className="space-y-2 break-words text-sm">
      <p>快照 ID：{snapshot.id} · 来源任务：{snapshot.runId} · 版本：{snapshot.version} · 货值币种：{snapshot.currency}</p>
      <p>任务来源：{snapshot.runSource === "manual_collection" ? "显式库存采集" : "已有赛狐同步"}（同编号不跨来源混用）</p>
      <p>采集开始：{capturedTime(snapshot.startedAt)} · 完成：{capturedTime(snapshot.capturedAt)}（Asia/Shanghai 时区）</p>
      <p>采集开始原值：{snapshot.startedAt} · 采集完成原值：{snapshot.capturedAt}（Unix 毫秒）</p>
      <p>可见范围：{snapshot.visibility === "full" ? "工作区管理可见范围" : "当前已授权精确业务范围（不含工作区总计）"} · 库存源的采集时间不等于库龄快照日期，也不代表本次重新同步。</p>
      <p>旧版未保存的范围、共享库存分项及分配证据保持“未保存 / 不可核验”，不从 ASIN、名字或页面推断美国、店铺或账号。</p>
      <SourceDetails value={snapshot.provenance} label="快照来源与验证边界" />
      <SourceDetails value={snapshot.sourceCounts} label="原始来源记录数（缺失为未知）" />
      {snapshot.warnings.length > 0 && <details><summary className="cursor-pointer">快照需核对事项（{snapshot.warnings.length}）</summary><ul className="list-inside list-disc space-y-1">{snapshot.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    </section>
    <Totals totals={result.totals} title="全筛选库存与货值合计" />
    <section aria-label="完整库存明细" className="min-w-0 space-y-3"><h3 className="font-semibold">库存明细表</h3>
      <p className="text-xs">国内仓、采购在途、FBA 在途、FBA 仓分列；不把计划重复算进库存。当前筛选的父体整组显示，所有子体保留。</p>
      {result.groups.length ? <GroupsTable groups={result.groups} label="库存明细横向表" aged={false} threshold={result.request.ageThreshold} /> : <p>当前筛选或当前页没有库存组；未据此断言没有历史库存或库龄。</p>}
      <Pagination page={result.page} label="库存父组" onChange={onPage ? offset => onPage(offset, result.agedPage.offset) : undefined} />
    </section>
    <section aria-label="完整库龄明细" className="min-w-0 space-y-3"><h3 className="font-semibold">超龄库存一览：{result.request.ageThreshold === 365 ? "超过 365 天" : "181 天及以上"}</h3>
      <p className="text-xs">按完整父组已知超龄数量降序；库龄日期与实时库存分别保留。实时库存为零但旧库龄非零仍展示，不据此改库存。超龄表的库存与货值是这些父组的完整库存，不是超龄部分的估值。</p>
      <p>已知超龄父组 {result.agedPage.knownGroupCount} 个；库龄未知父组 {result.agedPage.unknownGroupCount} 个。未知项独立展示，不按零参与排名。</p>
      <Totals totals={result.agedTotals} title="全部已知超龄父组的完整库存合计（不含未知组）" />
      {result.unknownAgeTotals && <Totals totals={result.unknownAgeTotals} title="全部库龄未知父组的完整库存独立合计" />}
      {result.agedGroups.length ? <GroupsTable groups={result.agedGroups} label="已知超龄库存横向表" aged threshold={result.request.ageThreshold} /> : <p>当前页无已知正超龄组；未知库龄不等于无超龄库存。</p>}
      {result.unknownAgeGroups.length > 0 && <section aria-label="库龄未知组" className="min-w-0 space-y-3"><h4 className="font-medium">库龄未完整返回：独立保留</h4><GroupsTable groups={result.unknownAgeGroups} label="库龄未知库存横向表" aged threshold={result.request.ageThreshold} /></section>}
      <p className="text-xs">以下分页覆盖已知超龄组与未知库龄组，未知组不会因单独分类被遗漏。</p>
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
function OwnedInventory({ owner }: { owner: Owner }) {
  const client = trpc.useUtils().client, manager = isManager(owner);
  const [scope, setScope] = useState({ parentAsin: "", storeName: "", country: "", accountId: "" });
  const [allScopes, setAllScopes] = useState(manager), [search, setSearch] = useState(""), [unpaired, setUnpaired] = useState(false);
  const [threshold, setThreshold] = useState<180 | 365>(180), [state, setState] = useState<ReadState>({ status: "idle" });
  const sequence = useRef(0), pending = useRef<AbortController | null>(null), active = useRef(false);
  const changeHandler = useRef<(notice: { userId: number; workspaceId: number }) => void>(() => {});
  useEffect(() => () => { sequence.current++; pending.current?.abort(); }, []);
  function clear(preserveActive = false) { sequence.current++; pending.current?.abort(); pending.current = null; setState({ status: "idle" }); if (!preserveActive) active.current = false; }
  async function read(groupOffset = 0, agedGroupOffset = 0, expectedSnapshot?: NonNullable<InventorySnapshotReadResult["snapshot"]>) {
    clear(true);
    const parsed = InventorySnapshotReadInputSchema.safeParse({ expectedWorkspaceId: owner.workspaceId, search, unpaired, ageThreshold: threshold,
      groupOffset, groupLimit: GROUP_LIMIT, agedGroupOffset, agedGroupLimit: GROUP_LIMIT, ...(manager && allScopes ? {} : { exactScope: scope }) });
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
      if (current()) setState({ status: "ready", result });
    } catch { if (current()) { active.current = false; setState({ status: "error" }); } }
    finally { if (current()) pending.current = null; }
  }
  changeHandler.current = notice => {
    if (notice.userId === owner.userId && notice.workspaceId === owner.workspaceId && active.current) void read();
  };
  useEffect(() => subscribeInventorySnapshotChanges(notice => changeHandler.current(notice)), []);
  return <Shell>
    <form aria-label="库存只读查询范围" className="space-y-3" onSubmit={event => { event.preventDefault(); void read(); }}>
      {manager && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allScopes} onChange={event => { clear(); setAllScopes(event.currentTarget.checked); }} />读取工作区可见的全部已保存范围（管理员）</label>}
      {!allScopes && <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">{([
        ["parentAsin", "父 ASIN"], ["storeName", "店铺"], ["country", "站点 / 国家代码"], ["accountId", "来源账号 ID"],
      ] as const).map(([key, label]) => <label className="min-w-0 text-sm" key={key}>{label}<input className="mt-1 w-full min-w-0 rounded border bg-background p-2" aria-label={`库存${label}`} autoComplete="off" value={scope[key]} onChange={event => { const value = event.currentTarget.value; clear(); setScope(old => ({ ...old, [key]: value })); }} /></label>)}</div>}
      <p className="text-xs text-muted-foreground">{manager ? "旧快照未保存店铺、站点或账号时仅标为未知，不自动补美国来源，也不跨范围猜测归属。" : "必须指定真实授权范围；旧快照来源身份不可核验时不展示其工作区总数。负责人名字和保存的 ownerIds 仅来源备注，不授予权限。"}</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm">查找产品<input aria-label="库存搜索" className="mt-1 w-full min-w-0 rounded border bg-background p-2" value={search} autoComplete="off" placeholder="产品名称、父/子 ASIN、MSKU、本地 SKU" onChange={event => { clear(); setSearch(event.currentTarget.value); }} /></label>
        <label className="text-sm">超龄口径<select aria-label="库存超龄口径" className="mt-1 block w-full rounded border bg-background p-2" value={threshold} onChange={event => { clear(); setThreshold(event.currentTarget.value === "365" ? 365 : 180); }}><option value="180">181 天及以上</option><option value="365">超过 365 天</option></select></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input aria-label="仅未配对库存" type="checkbox" checked={unpaired} onChange={event => { clear(); setUnpaired(event.currentTarget.checked); }} />仅未配对 / 未分配库存（筛选不扩大权限）</label>
      <div className="flex flex-wrap gap-3"><button type="submit" className={buttonClass}>读取已有库存快照</button><button type="button" className={buttonClass} onClick={() => clear()}>取消并清除库存</button></div>
    </form>
    {state.status === "loading" && <p role="status">正在读取已保存库存快照…</p>}
    {state.status === "invalid" && <p role="alert">库存查询范围不完整或不合法，未发送请求。</p>}
    {state.status === "error" && <p role="alert">库存读取失败，或身份、权限、范围、快照及回包完整性已变化。旧数据已清除；未使用缓存、零值或猜测归属替代。请显式从首页重新读取。</p>}
    {state.status === "ready" && <InventorySnapshotReadOnlyContent result={state.result} onPage={(groupOffset, agedGroupOffset) => { void read(groupOffset, agedGroupOffset, state.result.snapshot ?? undefined); }} />}
  </Shell>;
}

function InventorySnapshotReader() {
  const auth = useAuth(), permissions = usePermissions();
  if (auth.loading) return <Shell><p role="status">正在确认库存读取身份…</p></Shell>;
  if (auth.error) return <Shell><p role="alert">身份读取失败，库存数据已隐藏。</p></Shell>;
  const user = auth.user;
  if (!user || !positiveId(user.id) || !positiveId(user.defaultWorkspaceId) || typeof user.role !== "string" || !user.role.trim()) return <Shell><p role="alert">需要有效用户及明确工作区才能读取库存；未回退全局或旧工作区。</p></Shell>;
  if (permissions.isLoading) return <Shell><p role="status">正在确认库存读取权限…</p></Shell>;
  if (!permissions.canRead("ops", "ops_data_import")) return <Shell><p role="alert">没有库存读取权限，旧数据已隐藏。</p></Shell>;
  const owner = { userId: user.id, workspaceId: user.defaultWorkspaceId, role: user.role };
  return <OwnedInventory key={JSON.stringify([owner.userId, owner.workspaceId, owner.role])} owner={owner} />;
}

export default function InventorySnapshotReadOnly({ withRefresh = false }: { withRefresh?: boolean } = {}) {
  return <>{withRefresh && <InventorySnapshotRefresh />}<InventorySnapshotReader /></>;
}
