import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export function CoreReviewPanel({ projectId }: { projectId: number }) {
  const facts = trpc.listing.listReviewedFacts.useQuery({ projectId });
  const cores = trpc.listing.listCurrentCores.useQuery({ projectId });
  const utils = trpc.useUtils();
  const [selectedCoreId, setSelectedCoreId] = useState<string | null>(null);
  const [pointIndex, setPointIndex] = useState(0);
  const [buyerReason, setBuyerReason] = useState("");
  const [selectedFacts, setSelectedFacts] = useState<number[]>([]);
  const selected = cores.data?.find((item) => item.coreId === selectedCoreId);
  const confirmedFacts = (facts.data || []).filter((item) => item.status === "confirmed");
  const editableCores = (cores.data || []).filter((item) => item.status === "draft" || item.status === "confirmed");
  const historicalCores = (cores.data || []).filter((item) => item.status !== "draft" && item.status !== "confirmed");
  useEffect(() => {
    setSelectedCoreId(null);
    setSelectedFacts([]);
    setBuyerReason("");
    setPointIndex(0);
  }, [projectId]);
  const review = trpc.listing.reviewCore.useMutation({
    onSuccess: async (result) => {
      await utils.listing.listCurrentCores.invalidate({ projectId });
      setSelectedCoreId(result.coreId);
      toast.success(result.status === "confirmed" ? "卖点核心与事实版本已人工确认，旧候选不会被覆盖" : "卖点核心审阅版本已记录");
    },
    onError: (error) => {
      if (error.data?.code === "CONFLICT") void utils.listing.listCurrentCores.invalidate({ projectId });
      toast.error(error.message);
    },
  });
  const chooseCore = (coreId: string | null) => {
    const core = cores.data?.find((item) => item.coreId === coreId);
    setSelectedCoreId(coreId);
    setBuyerReason(core?.buyerReason || "");
    setPointIndex(core?.sellingPointIndex || 0);
    setSelectedFacts(Array.isArray(core?.factRevisionIdsJson) ? (core.factRevisionIdsJson as number[]) : []);
  };
  const submit = (decision: "draft" | "confirm" | "reject") => review.mutate({ projectId,
    ...(selected ? { coreId: selected.coreId } : {}), sellingPointIndex: pointIndex, buyerReason,
    factRevisionIds: selectedFacts, expectedRevision: selected?.revision || 0, decision,
  });
  return <section className="rounded-lg border border-teal-200 bg-teal-50/20 p-4 space-y-3" aria-label="卖点核心版本化人审">
    <div>
      <h3 className="font-semibold text-slate-900">确认卖点核心与事实版本</h3>
      <p className="mt-1 text-xs text-slate-600">选择一个真实购买理由，并勾选与之匹配的已确认本品事实；竞品观察、旧文案和未经核对的AI草稿不可作为证据。此处只记录可恢复的人审版本，不会覆盖现有Listing。</p>
    </div>
    {(facts.isLoading || cores.isLoading) && <p className="text-xs text-slate-600">正在读取当前项目的事实与核心版本…</p>}
    {(facts.error || cores.error) && <p role="alert" className="text-xs text-red-700">版本读取失败，请刷新：{facts.error?.message || cores.error?.message}</p>}
    {!facts.isLoading && !cores.isLoading && !facts.error && !cores.error && editableCores.length === 0 && <p className="text-xs text-slate-600">当前项目尚无可继续审核的核心；保存草案或人工确认后会出现在这里。</p>}
    <div className="flex flex-wrap gap-2 items-center text-xs">
      <label htmlFor="core-revision-select">当前核心</label>
      <select id="core-revision-select" value={selectedCoreId || ""} className="rounded border border-slate-300 bg-white px-2 py-1"
        onChange={(event) => chooseCore(event.target.value || null)}>
        <option value="">新建核心</option>
        {editableCores.map((item) => <option key={item.coreId} value={item.coreId}>第 {item.sellingPointIndex + 1} 条 · v{item.revision} · {item.status} · {item.buyerReason.slice(0, 35)}</option>)}
      </select>
      {selected && <span>当前版本 v{selected.revision}，状态 {selected.status}</span>}
    </div>
    {historicalCores.length > 0 && <details className="rounded border border-amber-200 bg-amber-50/60 px-2 py-1.5 text-xs text-amber-900">
      <summary className="cursor-pointer">查看 {historicalCores.length} 条已过期/已拒绝核心记录（只读）</summary>
      <ul className="mt-1 list-disc pl-4">{historicalCores.map((item) => <li key={`${item.coreId}-${item.revision}`}>第 {item.sellingPointIndex + 1} 条 · v{item.revision} · {item.status} · {item.buyerReason.slice(0, 60)}</li>)}</ul>
    </details>}
    <label className="block text-xs text-slate-700">卖点顺序
      <select value={pointIndex} className="ml-2 rounded border border-slate-300 bg-white px-2 py-1" onChange={(event) => setPointIndex(Number(event.target.value))}>
        {Array.from({ length: 9 }, (_, index) => <option key={index} value={index}>第 {index + 1} 条</option>)}
      </select>
    </label>
    <label className="block text-xs text-slate-700">一个明确的买家购买理由
      <textarea className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" value={buyerReason} maxLength={500} rows={2}
        onChange={(event) => setBuyerReason(event.target.value)} placeholder="例如：真实规格与用户场景结合后的单一购买理由，而非堆砌FABE小标题" />
    </label>
    <fieldset className="rounded border border-slate-200 p-2 text-xs text-slate-700">
      <legend className="px-1 font-medium">选取支撑这条核心的已确认事实</legend>
      {!confirmedFacts.length && <p className="text-amber-800">尚无已确认本品事实，请先核对上方原始属性表。证据不足时不派发模型。</p>}
      <div className="grid gap-1 max-h-40 overflow-auto">
        {confirmedFacts.map((fact) => <label key={fact.id} className="flex items-start gap-2 rounded p-1 hover:bg-white">
          <input type="checkbox" className="mt-0.5" checked={selectedFacts.includes(fact.id)} onChange={() => setSelectedFacts((previous) => previous.includes(fact.id) ? previous.filter((id) => id !== fact.id) : [...previous, fact.id])} />
          <span>{fact.attributeKey}：{fact.value} <span className="text-slate-500">（事实 v{fact.revision}）</span></span>
        </label>)}
      </div>
    </fieldset>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="rounded border border-teal-600 bg-teal-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40" disabled={!buyerReason.trim() || !selectedFacts.length || review.isPending || facts.isLoading || cores.isLoading || !!facts.error || !!cores.error} onClick={() => submit("confirm")}>人工确认核心</button>
      <button type="button" className="rounded border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-40" disabled={!buyerReason.trim() || !selectedFacts.length || review.isPending} onClick={() => submit("draft")}>保存可编辑草案</button>
      {selected && <button type="button" className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-700 disabled:opacity-40" disabled={review.isPending} onClick={() => submit("reject")}>不采纳该核心</button>}
    </div>
  </section>;
}
