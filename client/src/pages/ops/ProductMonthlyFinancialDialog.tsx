import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductBoardReadInputSchema, ProductBoardReadResultSchema, type ProductBoardReadInput, type ProductBoardReadResult } from "@shared/productBoardRead";
import { profitBoardMonths } from "@shared/profitBoardRead";
import { ProductFinancialHistory } from "./ProductFinancialHistory";
import ProfitAnalysisWorkflow from "./ProfitAnalysisWorkflow";
import { subscribeMonthlyFinancialChanges } from "./monthlyFinancialWriteEvents";

export type ProductMonthlyFinancialTarget = { identity: { userId: number; workspaceId: number }; storeName: string; country: string; parentAsin: string };
import { defaultProductFinancialMonth } from "./productFinancialTrend";
export { defaultProductFinancialMonth } from "./productFinancialTrend";
const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";
const manager = (role: string) => ["admin", "super_admin", "ops_manager"].includes(role);
function OwnedProductFinancial({ target, role }: { target: ProductMonthlyFinancialTarget; role: string }) {
  const client = trpc.useUtils().client;
  const [month, setMonth] = useState(defaultProductFinancialMonth), [result, setResult] = useState<ProductBoardReadResult | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const lane = useRef({ sequence: 0, controller: null as AbortController | null });
  function clear() { lane.current.sequence++; lane.current.controller?.abort(); lane.current.controller = null; setBusy(false); setResult(null); }
  useEffect(() => () => { lane.current.sequence++; lane.current.controller?.abort(); }, []);
  useEffect(() => subscribeMonthlyFinancialChanges(notice => {
    if (notice.workspaceId === target.identity.workspaceId && notice.action !== "upload") { clear(); setMessage("月报来源已变化，旧月报与分析视图已清除；请重新读取。未决任务编号仍保留。"); }
  }), [target.identity.workspaceId]);
  async function read(previous?: ProductBoardReadResult, requestedOffset?: number) {
    clear(); setMessage("");
    const parsed = ProductBoardReadInputSchema.safeParse({ expectedWorkspaceId: target.identity.workspaceId, storeName: target.storeName, country: target.country, parentAsin: target.parentAsin, month, search: "", highReturnsOffset: 0, highProfitOffset: 0, losingOffset: 0, allOffset: requestedOffset ?? previous?.sections.all.page.nextOffset ?? 0, pageSize: 10 });
    if (!parsed.success || month < "1000-06") { setMessage("月份或产品范围不合法，未发送请求。"); return; }
    const input: ProductBoardReadInput = parsed.data, sequence = ++lane.current.sequence, controller = new AbortController(); lane.current.controller = controller; setBusy(true);
    const current = () => sequence === lane.current.sequence && !controller.signal.aborted;
    try {
      const raw = await client.productBoardRead.get.query(input, { signal: controller.signal }); if (!current()) return;
      const value = ProductBoardReadResultSchema.parse(raw);
      if (value.identity.userId !== target.identity.userId || value.identity.workspaceId !== target.identity.workspaceId || JSON.stringify(value.request) !== JSON.stringify(input)) throw new Error("SCOPE_CHANGED");
      if (!manager(role) && (value.history?.visibility === "full" || value.sources.some(source => source.batch?.visibility === "full"))) throw new Error("PRIVATE_SCOPE_CHANGED");
      if (previous && JSON.stringify([previous.sources, previous.history, previous.sections.all.page.totalProducts]) !== JSON.stringify([value.sources, value.history, value.sections.all.page.totalProducts])) throw new Error("SOURCE_CHANGED");
      if (current()) setResult(value);
    } catch { if (current()) setMessage("月报读取失败，或身份、权限、范围及完整性已变化。旧数据已清除；未调用模型或读取手填利润。"); }
    finally { if (current()) { lane.current.controller = null; setBusy(false); } }
  }
  return <div className="manus-no-record min-w-0 max-w-full space-y-4">
    <p className="break-words text-sm">{target.storeName} / {target.country} / {target.parentAsin}。按当前授权的已确认月报读取，币种和汇总依据分开，不混合不同站点。</p>
    <p className="text-xs text-muted-foreground">沿用朋友版默认展示月份：北京时间每月16日起选上月，之前选上上月。这只是初始选择，不是已冻结归档或覆盖确认；可选更早月份。</p>
    <form className="flex flex-wrap items-center gap-3" onSubmit={event => { event.preventDefault(); void read(); }}><label>月报截至月份<input aria-label="产品月报截至月份" type="month" value={month} className="ml-2 rounded border bg-background p-2" onChange={event => { clear(); setMessage(""); setMonth(event.currentTarget.value); }} /></label><button type="submit" className={buttonClass} disabled={busy}>读取完整历史月报</button><button type="button" className={buttonClass} onClick={() => { clear(); setMessage("已清除本页显示，未取消后台任务或删除分析报告。"); }}>取消读取并清除</button></form>
    {busy && <p role="status">正在核验全部已保存历史与当前权限…</p>}{message && <p role="alert">{message}</p>}
    {result && (result.status !== "ready" ? <p role="alert">当前没有可完整读取的月报（{result.reasonCode}）。不把缺失当作零利润。</p> : <>
      <p className="text-sm">已完整核验可见历史范围；当前分区 {result.sections.all.page.totalProducts ? result.sections.all.page.offset + 1 : 0}–{Math.min(result.sections.all.page.offset + result.sections.all.entries.length, result.sections.all.page.totalProducts)} / {result.sections.all.page.totalProducts}。不是只展示最近六个月的明细。</p>
      {result.sections.all.entries.map(({ productId: id }) => { const product = result.products.find(item => item.id === id); if (!product) return null; return <section key={`${lane.current.sequence}:${id}`} className="min-w-0 space-y-4 rounded border p-3"><ProductFinancialHistory product={product} rows={result.pageRows} sources={result.sources} />
        {product.parentAsin && (product.basis === "child_rows" || product.basis === "reported_parent_row") && <ProfitAnalysisWorkflow identity={result.identity} scope={{ storeName: result.request.storeName, country: result.request.country, parentAsin: product.parentAsin, currency: product.currency, basis: product.basis }} months={profitBoardMonths(result.request.month)} />}</section>; })}
      <nav aria-label="产品月报分区分页" className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={result.sections.all.page.offset === 0} onClick={() => { void read(result, Math.max(0, result.sections.all.page.offset - result.sections.all.page.limit)); }}>上一页币种及汇总分区</button><button type="button" className={buttonClass} disabled={!result.sections.all.page.hasMore} onClick={() => { void read(result); }}>下一页币种及汇总分区</button></nav>
    </>)}
  </div>;
}
export default function ProductMonthlyFinancialDialog({ target, onClose }: { target: ProductMonthlyFinancialTarget | null; onClose: () => void }) {
  const auth = useAuth(), permissions = usePermissions(), user = auth.user;
  const allowed = target && !auth.loading && !auth.error && !permissions.isLoading && user && user.id === target.identity.userId && user.defaultWorkspaceId === target.identity.workspaceId && permissions.canRead("ops", "ops_data_import");
  return <Dialog open={target !== null} onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="manus-no-record flex max-h-[90vh] w-[96vw] max-w-[96vw] min-w-0 flex-col overflow-hidden"><DialogHeader><DialogTitle>产品月度财务与利润分析</DialogTitle><DialogDescription>完整父子月报、收入费用明细，以及按月份独立生成和手动保存的分析。</DialogDescription></DialogHeader><div className="min-w-0 overflow-auto">
    {allowed ? <OwnedProductFinancial key={JSON.stringify([target, user.role])} target={target} role={user.role} /> : <p role="alert">正在核对身份，或没有当前产品月报读取权限；旧内容未保留。</p>}
  </div></DialogContent></Dialog>;
}
