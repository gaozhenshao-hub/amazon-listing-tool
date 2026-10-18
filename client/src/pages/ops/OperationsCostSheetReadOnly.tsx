import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  OperationsCostSheetReadInputSchema,
  OperationsCostSheetReadResultSchema,
  type OperationsCostSheetReadResult,
  type OperationsCostSheetScope,
} from "@shared/operationsCostSheetRead";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { OperationsCostSheetActions, subscribeOperationsCostSheetChanges } from "./OperationsCostSheetActions";

const PAGE_SIZE = 20;
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
const shown = (value: string | number | null | undefined) => value === null || value === undefined ? "未提供" : String(value);
const cellClass = "max-w-72 whitespace-pre-wrap break-words border-b p-3 align-top";
type Owner = { userId: number; workspaceId: number; role: string };
type ReadState = { status: "idle" | "loading" | "error" | "invalid" } | { status: "ready"; result: OperationsCostSheetReadResult };

function Shell({ children }: { children: ReactNode }) {
  return <section aria-label="完整成本表只读查看" className="manus-no-record min-w-0 max-w-full space-y-4 overflow-hidden rounded-xl border bg-card p-4 md:p-5">
    <header className="space-y-2"><h2 className="text-lg font-semibold">完整成本表 · 来源查看与授权编辑</h2>
      <p className="text-sm text-muted-foreground">按父 ASIN、店铺和站点明确读取已保存的完整成本设置。查看不会自动保存、上传或执行模型，也不会用旧库存参数代替成本表；编辑需单独核验权限并确认保存。修改查询范围后旧结果即清除，需再次点击读取。</p></header>
    {children}
  </section>;
}

/** Presentation of a validated read result only. No price inference or local
 * recalculation: all amounts, rule outcomes and unavailable reasons are server
 * projections. Pagination changes visibility, never the underlying row set. */
export function OperationsCostSheetReadOnlyContent({ result }: { result: OperationsCostSheetReadResult }) {
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [result]);
  const pageCount = Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = result.rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const saved = result.saved;
  return <div className="min-w-0 max-w-full space-y-4">
    <div className="space-y-1 text-sm">
      <p className="break-all">父 ASIN：{result.scope.parentAsin} · 店铺：{result.scope.storeName} · 站点：{result.scope.country}</p>
      <p>工作区：{result.scope.workspaceId} · 规则基准日期：{result.asOfDate}</p>
      <p>{result.sourceStatus === "available" ? `本次报表来源记录：${result.sourceRecordCount} 条` : "报表来源不可用，记录数量未知（不是零条）"}</p>
      <p className="break-all">来源：{result.provenance.kind} · 规则版本：{result.provenance.ruleVersion} · 报表选择：最新且无歧义的观测，不按来源名称覆盖新数据</p>
      <p>仅为当前保存版本；历史版本不可用，不能由此核验历史成本。</p>
    </div>
    {result.status === "not_saved" && <p role="status">此范围尚未保存完整成本表。成本输入未提供，不按零值计算，也不回填旧库存参数。</p>}
    {result.status === "not_connected" && <p role="status">完整成本表尚未连接（缺表）。不能将此解释为未保存或零成本。</p>}
    {result.status === "corrupt" && <p role="alert">已保存成本内容损坏或不兼容，未用默认值替换，也未据此计算利润。</p>}
    {result.missingReason && <p className="whitespace-pre-wrap break-words text-sm">来源说明：{result.missingReason}</p>}
    {result.reasonCode && <p className="text-xs">状态依据：{result.reasonCode}</p>}
    {saved && <section aria-label="已保存完整成本设置" className="space-y-2 rounded-lg border p-3 text-sm">
      <h3 className="font-medium">已保存完整成本设置</h3>
      <p>记录 {saved.id} · 版本 {saved.version} · 更新人 {shown(saved.updatedBy)} · 更新时间 {shown(saved.updatedAt)}</p>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div><dt>结算币种兑人民币汇率</dt><dd>{shown(saved.payload.settings.cnyPerCurrency)}</dd></div>
        <div><dt>预测运费单价（人民币 / kg）</dt><dd>{shown(saved.payload.settings.freightRate)}</dd></div>
        <div><dt>标准品确认</dt><dd>{saved.payload.settings.standardGoodsConfirmed === true ? "已确认" : "未确认"}</dd></div>
      </dl>
      <p>保存输入 {saved.payload.rows.length} 行；下方保留未匹配报表的孤立行，不自动删除或补值。</p>
    </section>}
    <p className="text-xs leading-6 text-muted-foreground">固定15%佣金假设下的单件测算，非会计利润。预测运费与预测 FBA 不等于实际扣费；保存实际 FBA 与报表实际 FBA 分列，不互相覆盖。币种不明、冲突、歧义或缺必要输入时不计算。页面不将空值显示为零。</p>
    {!result.rows.length ? <p>当前返回无可展示行；这不代表零成本或零利润。</p> : <>
      <p className="text-sm" aria-live="polite">完整结果 {result.rows.length} 行 · 第 {currentPage + 1} / {pageCount} 页 · 每页最多 {PAGE_SIZE} 行</p>
      <div role="region" aria-label="成本明细横向滚动表" tabIndex={0} className="min-w-0 max-w-full overflow-x-auto rounded border focus-visible:outline focus-visible:outline-2">
        <table className="w-full min-w-[2300px] text-left text-xs">
          <caption className="sr-only">完整成本明细，包含保存孤立行、报表来源和各项缺失原因；可横向滚动。</caption>
          <thead><tr>{["商品 / SKU / 键", "状态 / 币种", "报表售价（结算币种 / 件）", "产品成本（人民币 / 件）", "包装成本（人民币 / 件）", "重量 / 尺寸", "预测运费", "保存实际运费（人民币 / 件）", "预测 FBA", "保存实际 FBA（结算币种 / 件）", "报表实际 FBA（结算币种 / 件）", "测算毛利 / 毛利率", "当前报表来源 / 日期 / ID", "全部来源观测与依据"].map(label => <th scope="col" className="whitespace-nowrap p-3" key={label}>{label}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.key}>
            <td className={cellClass}><span className="font-medium">{shown(row.name)}</span><br />SKU：{shown(row.sku)}<br /><span className="break-all">{row.key}</span></td>
            <td className={cellClass}>{row.orphaned ? "保存孤立行（未匹配报表）" : "报表匹配行"}<br />{row.ambiguous ? "匹配存在歧义" : "无已报告歧义"}<br />{row.currencyMismatch ? "币种冲突" : "无已报告币种冲突"}<br />{row.sourceConflict ? "同日来源冲突，不能据此计算利润" : "无已报告来源冲突"}<br />币种：{shown(row.currency)}</td>
            <td className={cellClass}>{shown(row.fact?.price)}</td>
            <td className={cellClass}>{shown(row.input?.productCost)}</td>
            <td className={cellClass}>{shown(row.input?.packagingCost)}</td>
            <td className={cellClass}>kg：{shown(row.input?.weightKg)}<br />cm：{shown(row.input?.lengthCm)} × {shown(row.input?.widthCm)} × {shown(row.input?.heightCm)}</td>
            <td className={cellClass}>{row.estimatedFreight ? <>人民币：{shown(row.estimatedFreight.cost)}<br />体积 kg：{shown(row.estimatedFreight.dimensionalKg)}<br />计费 kg：{shown(row.estimatedFreight.billableKg)}</> : "无法预测（缺少所需设置或尺寸重量）"}</td>
            <td className={cellClass}>{shown(row.input?.actualFreight)}</td>
            <td className={cellClass}>{shown(row.estimatedFba.fee)} {row.estimatedFba.currency}<br />{row.estimatedFba.reason}<br /><span className="break-all">{row.estimatedFba.ruleVersion}</span><br />{row.estimatedFba.asOfDate}</td>
            <td className={cellClass}>{shown(row.input?.actualFba)}</td>
            <td className={cellClass}>{shown(row.fact?.actualFba)}</td>
            <td className={cellClass}>{row.profit ? <>{shown(row.profit.profit)} {shown(row.currency)} / 件<br />{row.profit.margin === null ? "毛利率未提供" : `${row.profit.margin}%`}<br />{row.profit.label}</> : <>未计算<br />{row.profitUnavailableReason}</>}</td>
            <td className={cellClass}>{row.fact ? <>{row.fact.source.kind === "lingxing" ? "领星" : "赛狐"}<br />日期：{shown(row.fact.source.date)}<br />ID：{row.fact.source.id}<br />导入：{shown(row.fact.source.importId)}</> : "报表来源未提供"}</td>
            <td className={cellClass}>{!row.observations.length ? "未提供" : <details><summary className="cursor-pointer">查看全部 {row.observations.length} 条来源观测</summary>{row.observations.map((observation, index) => <div key={index} className="mt-2 space-y-1 border-t pt-2">
              <p>{observation.source.kind === "lingxing" ? "领星" : "赛狐"} · {shown(observation.source.date)} · ID {observation.source.id} · 导入 {shown(observation.source.importId)}</p>
              <p>来源类型：{shown(observation.source.sourceKind)} · 批次：{shown(observation.source.sourceBatchId)} · 追踪：{shown(observation.source.sourceTraceId)} · 来源版本：{shown(observation.source.sourceSchemaVersion)}</p>
              <p>商品 {shown(observation.name)} · SKU {shown(observation.sku)} · 键 {observation.key}</p>
              <p>售价 {shown(observation.price)} · 实际 FBA {shown(observation.actualFba)} · 币种 {shown(observation.currency)} · {observation.ambiguous ? "歧义观测" : "无已报告歧义"}</p>
              <p>原售价：{shown(observation.source.raw.price)} · 原单件 FBA：{shown(observation.source.raw.actualFbaUnitFee)} · 原 FBA 总费：{shown(observation.source.raw.actualFbaTotalFee)} · 原 FBA 销量：{shown(observation.source.raw.fbaSalesQty)}</p>
              <p>缺失来源列：{observation.source.missingColumns.length ? observation.source.missingColumns.join("、") : "无已报告缺列"}</p>
              <p>售价依据：{shown(observation.source.basis.price)}<br />FBA 依据：{shown(observation.source.basis.actualFba)}<br />币种依据：{shown(observation.source.basis.currency)}</p>
            </div>)}</details>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <nav aria-label="成本明细分页" className="flex flex-wrap gap-3">
        <button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页成本行</button>
        <button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>下一页成本行</button>
      </nav>
    </>}
  </div>;
}

function OwnedCostSheet({ owner }: { owner: Owner }) {
  const client = trpc.useUtils().client;
  const [scope, setScope] = useState({ parentAsin: "", storeName: "", country: "" });
  const [state, setState] = useState<ReadState>({ status: "idle" });
  const [actionScope, setActionScope] = useState<OperationsCostSheetScope | null>(null);
  const sequence = useRef(0), pending = useRef<AbortController | null>(null);
  const readRef = useRef(read); readRef.current = read;
  useEffect(() => () => { sequence.current++; pending.current?.abort(); }, []);
  function clear(preserveActions = false) { sequence.current++; pending.current?.abort(); pending.current = null; setState({ status: "idle" }); if (!preserveActions) setActionScope(null); }
  function change(field: keyof typeof scope, value: string) { clear(); setScope(previous => ({ ...previous, [field]: value })); }
  async function read(event?: FormEvent) {
    event?.preventDefault(); clear(true);
    const input = OperationsCostSheetReadInputSchema.safeParse({ ...scope, expectedWorkspaceId: owner.workspaceId });
    if (!input.success) { setState({ status: "invalid" }); return; }
    const ticket = ++sequence.current, controller = new AbortController(); pending.current = controller;
    const current = () => ticket === sequence.current && !controller.signal.aborted;
    setState({ status: "loading" });
    try {
      const value = await client.productCostsReadOnly.get.query(input.data, { signal: controller.signal });
      if (!current()) return;
      const parsed = OperationsCostSheetReadResultSchema.safeParse(value);
      if (!parsed.success || parsed.data.identity.userId !== owner.userId || parsed.data.identity.workspaceId !== owner.workspaceId
        || parsed.data.scope.workspaceId !== owner.workspaceId || parsed.data.scope.parentAsin !== input.data.parentAsin
        || parsed.data.scope.storeName !== input.data.storeName || parsed.data.scope.country !== input.data.country) {
        setState({ status: "error" }); setActionScope(null); return;
      }
      setState({ status: "ready", result: parsed.data });
      setActionScope(parsed.data.scope);
    } catch { if (current()) { setState({ status: "error" }); setActionScope(null); } }
    finally { if (current()) pending.current = null; }
  }
  useEffect(() => subscribeOperationsCostSheetChanges(notice => {
    if (notice.userId === owner.userId && actionScope && notice.scope.workspaceId === actionScope.workspaceId
      && notice.scope.storeName === actionScope.storeName && notice.scope.country === actionScope.country && notice.scope.parentAsin === actionScope.parentAsin) void readRef.current();
  }), [owner.userId, actionScope]);
  return <Shell>
    <form onSubmit={event => { void read(event); }} className="space-y-3" aria-label="成本表查询范围">
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">{([
        ["parentAsin", "父 ASIN"], ["storeName", "店铺名称"], ["country", "站点 / 国家代码"],
      ] as const).map(([field, label]) => <label key={field} className="min-w-0 text-sm">{label}<input className="mt-1 w-full min-w-0 rounded border bg-background p-2" value={scope[field]} onChange={event => change(field, event.currentTarget.value)} autoComplete="off" /></label>)}</div>
      <div className="flex flex-wrap gap-3"><button type="submit" className="rounded border px-3 py-2" aria-busy={state.status === "loading"}>读取此范围成本表</button>
        <button type="button" className="rounded border px-3 py-2" onClick={() => clear()}>取消读取并清除结果</button></div>
    </form>
    {state.status === "idle" && <p className="text-sm">选择范围后点击读取；当前没有读取成本数据。</p>}
    {state.status === "loading" && <p role="status">正在读取所选范围的完整成本表…</p>}
    {state.status === "invalid" && <p role="alert">请完整填写合法的父 ASIN、店铺和站点；未发送读取请求。</p>}
    {state.status === "error" && <p role="alert">读取失败、权限或范围已变化，或返回数据不完整。旧结果已清除；未回退缓存、旧库存参数或默认成本。可核对范围后显式重读。</p>}
    {state.status === "ready" && <OperationsCostSheetReadOnlyContent key={sequence.current} result={state.result} />}
    {actionScope && <OperationsCostSheetActions owner={owner} scope={actionScope} />}
  </Shell>;
}

export default function OperationsCostSheetReadOnly() {
  const auth = useAuth(), permissions = usePermissions();
  if (auth.loading) return <Shell><p role="status">正在确认登录身份…</p></Shell>;
  if (auth.error) return <Shell><p role="alert">身份读取失败，成本数据已隐藏。</p></Shell>;
  const user = auth.user;
  if (!user || !positiveId(user.id) || !positiveId(user.defaultWorkspaceId) || typeof user.role !== "string" || !user.role) {
    return <Shell><p role="alert">需要有效登录用户及明确工作区后才能读取成本表；未使用全局或旧工作区数据。</p></Shell>;
  }
  if (permissions.isLoading) return <Shell><p role="status">正在确认成本表读取权限…</p></Shell>;
  if (!permissions.canRead("ops", "ops_data_import")) return <Shell><p role="alert">没有成本表读取权限，旧数据已隐藏。</p></Shell>;
  const owner = { userId: user.id, workspaceId: user.defaultWorkspaceId, role: user.role };
  return <OwnedCostSheet key={JSON.stringify([owner.userId, owner.workspaceId, owner.role])} owner={owner} />;
}
