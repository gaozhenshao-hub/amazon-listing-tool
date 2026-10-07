import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type Props = {
  projectId: number;
  coreRevisionId?: number;
  coreInputHash?: string;
  factRevisionIds: number[];
  factLabels: Record<number, string>;
  newestCandidateId?: number;
  /** Project history is intentionally display-only: a historical candidate may never inherit a different current core. */
  readOnlyHistory?: boolean;
};

export function CandidateReviewPanel({ projectId, coreRevisionId, coreInputHash, factRevisionIds, factLabels, newestCandidateId, readOnlyHistory = false }: Props) {
  const utils = trpc.useUtils();
  const factRevisionIdsKey = factRevisionIds.join(",");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [subtitle, setSubtitle] = useState("");
  const [fullText, setFullText] = useState("");
  const [reason, setReason] = useState("");
  const [selectedFactIds, setSelectedFactIds] = useState<number[]>(factRevisionIds);
  const [showHistory, setShowHistory] = useState(false);
  const [syncCandidate, setSyncCandidate] = useState<{ id: number; revision: number } | null>(null);
  const candidates = trpc.listing.listCandidates.useQuery({ projectId, ...(coreRevisionId ? { coreRevisionId } : {}),
    ...(readOnlyHistory ? { includeHistory: true } : {}), limit: 60 });
  const { refetch: refetchCandidates } = candidates;
  useEffect(() => {
    setEditingId(null);
    setSubtitle(""); setFullText(""); setReason("");
    setSelectedFactIds(factRevisionIdsKey ? factRevisionIdsKey.split(",").map(Number) : []);
    setSyncCandidate(null);
  }, [coreRevisionId, factRevisionIdsKey, projectId]);
  useEffect(() => { if (newestCandidateId && !readOnlyHistory) void refetchCandidates(); }, [newestCandidateId, readOnlyHistory, refetchCandidates]);
  const history = trpc.listing.listCandidateReviews.useQuery({ projectId, limit: 60 }, { enabled: showHistory });
  const syncPreview = trpc.listing.previewConfirmedListingSync.useQuery(
    syncCandidate
      ? { projectId, candidateId: syncCandidate.id, expectedCandidateRevision: syncCandidate.revision }
      : { projectId, candidateId: 1, expectedCandidateRevision: 1 },
    { enabled: Boolean(syncCandidate), retry: false }
  );
  const refresh = async () => {
    await Promise.all([utils.listing.listCandidates.invalidate({ projectId }),
      utils.listing.listCandidateReviews.invalidate({ projectId })]);
    setEditingId(null);
    setSubtitle(""); setFullText(""); setReason("");
  };
  const onError = (error: { message: string; data?: { code?: string } | null }) => {
    toast.error(error.message);
    if (error.data?.code === "CONFLICT") void refresh();
  };
  const create = trpc.listing.createHumanCandidate.useMutation({ onSuccess: async () => {
    await refresh(); toast.success("人工候选已保存为待审核修订，未同步正式 Listing");
  }, onError });
  const edit = trpc.listing.editCandidate.useMutation({ onSuccess: async () => {
    await refresh(); toast.success("已保存新候选修订，原候选仍保留供审计");
  }, onError });
  const confirm = trpc.listing.confirmCandidate.useMutation({ onSuccess: async () => {
    await refresh(); toast.success("候选已记录人工确认；正式 Listing 尚未变更");
  }, onError });
  const reject = trpc.listing.rejectCandidate.useMutation({ onSuccess: async () => {
    await refresh(); toast.success("候选已拒绝且保留在审阅历史中");
  }, onError });
  const applySync = trpc.listing.syncConfirmedToListing.useMutation({ onSuccess: async () => {
    await refresh();
    setSyncCandidate(null);
    toast.success("已在同一事务完成 Listing CAS、完整快照、Artifact 指针与历史版本登记");
  }, onError });
  const busy = create.isPending || edit.isPending || confirm.isPending || reject.isPending || applySync.isPending;
  const selected = candidates.data?.find((row) => row.id === editingId);
  return <section className="mt-3 space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3" aria-label="卖点候选人工审阅">
    <div className="flex items-start justify-between gap-2">
      <div><p className="text-sm font-medium text-indigo-950">{readOnlyHistory ? "历史候选审计" : "候选修订与人工确认"}</p>
        <p className="text-xs text-indigo-800">{readOnlyHistory
          ? "只展示当前项目的候选历史。已失效、不同核心或不同事实版本绝不会绑定到本面板，也不能在这里确认或同步。"
          : "仅使用此条当前已审核心和事实。编辑、拒绝、确认都会留下版本；确认不会自动覆盖旧 Listing。"}</p></div>
      <button type="button" className="text-xs underline" onClick={() => { void candidates.refetch(); }}>刷新</button>
    </div>
    {candidates.isLoading && <p className="text-xs text-slate-600">读取审阅候选中…</p>}
    {candidates.error && <p role="alert" className="text-xs text-red-700">候选账本读取失败：{candidates.error.message}</p>}
    {!candidates.error && candidates.data?.length === 0 && <p className="text-xs text-slate-700">{readOnlyHistory ? "当前项目没有可显示的候选历史。" : "暂无候选；模型成功后会自动存为待人审版本，也可人工新建草案。"}</p>}
    {candidates.data?.map((row) => <article key={row.id} className="space-y-1.5 rounded border border-slate-200 bg-white p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2"><strong>修订 {row.candidateRevision}</strong><span>状态：{row.status}</span>
        <span>{row.skillRunId ? `受治理运行 #${row.skillRunId}` : "人工录入"}</span>
        {row.actualModel && <span>实际模型：{row.actualModel}</span>}</div>
      <p className="break-words text-slate-800">{row.subtitle} {row.fullText}</p>
      <p className="text-slate-600">引用的已确认事实：{Array.isArray(row.evidenceFactIdsJson) && row.evidenceFactIdsJson.length
        ? row.evidenceFactIdsJson.map((id) => factLabels[Number(id)] || `事实 #${id}`).join("；")
        : "无"}；字数：{`${row.subtitle || ""} ${row.fullText || ""}`.trim().length}</p>
      <div className="flex flex-wrap gap-2">
        {!readOnlyHistory && !['stale', 'rejected', 'confirmed', 'failed', 'gate_failed'].includes(row.status) && <>
          <button type="button" disabled={busy} className="rounded border px-2 py-1" onClick={() => {
            setEditingId(row.id); setSubtitle(row.subtitle || ""); setFullText(row.fullText || ""); setReason("");
            setSelectedFactIds(Array.isArray(row.evidenceFactIdsJson) ? row.evidenceFactIdsJson as number[] : []);
          }}>人工修改</button>
          <button type="button" disabled={busy || candidates.isError} className="rounded border px-2 py-1" onClick={() => {
            void confirm.mutateAsync({ projectId, candidateId: row.id, expectedCandidateRevision: row.candidateRevision,
              reason: "人工核对内容、产品事实及美国站措辞" });
          }}>人工确认</button>
          <button type="button" disabled={busy} className="rounded border px-2 py-1" onClick={() => {
            void reject.mutateAsync({ projectId, candidateId: row.id, expectedCandidateRevision: row.candidateRevision, reason: "人工拒绝候选" });
          }}>拒绝</button>
        </>}
        {!readOnlyHistory && row.status === "confirmed" && <button type="button" disabled={busy} className="rounded border border-emerald-700 px-2 py-1 text-emerald-800" onClick={() => {
          setSyncCandidate({ id: row.id, revision: row.candidateRevision });
        }}>查看完整同步预览</button>}
      </div>
    </article>)}
    {!readOnlyHistory && syncCandidate && <section className="space-y-2 rounded border-2 border-emerald-300 bg-emerald-50 p-3 text-xs" aria-label="正式 Listing 同步完整预览">
      <div className="flex items-start justify-between gap-2"><div><strong className="text-emerald-950">正式 Listing 同步：完整预览</strong>
        <p className="mt-1 text-emerald-900">请核对以下完整字段镜像、目标卖点和 CAS 令牌；只有点击下方最终确认才会写入正式 Listing。</p></div>
        <button type="button" className="underline" onClick={() => setSyncCandidate(null)} disabled={applySync.isPending}>关闭预览</button></div>
      {syncPreview.isLoading && <p>正在锁定并校验完整 Listing、候选、核心、事实与人工确认记录…</p>}
      {syncPreview.error && <p role="alert" className="text-red-700">无法生成同步预览：{syncPreview.error.message}</p>}
      {syncPreview.data && <>
        <dl className="grid gap-1 sm:grid-cols-2"><div><dt className="font-medium">目标卖点</dt><dd>第 {syncPreview.data.preview.sellingPointIndex + 1} 条</dd></div>
          <div><dt className="font-medium">CAS 版本</dt><dd>{syncPreview.data.preview.expectedListingVersion} → {syncPreview.data.preview.nextListingVersion}</dd></div>
          <div className="sm:col-span-2"><dt className="font-medium">完整 Listing 哈希</dt><dd className="break-all font-mono">{syncPreview.data.preview.currentFullHash}</dd></div>
          <div className="sm:col-span-2"><dt className="font-medium">人工确认审计</dt><dd>{syncPreview.data.preview.humanApprovalRef}</dd></div></dl>
        <div><p className="font-medium">当前目标卖点</p><pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-white p-2">{JSON.stringify(syncPreview.data.preview.currentBullet, null, 2)}</pre></div>
        <div><p className="font-medium">拟替换为</p><pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-white p-2">{JSON.stringify(syncPreview.data.preview.candidateBullet, null, 2)}</pre></div>
        <details className="rounded bg-white p-2"><summary className="cursor-pointer font-medium">展开完整当前 Listing 字段镜像（{Object.keys(syncPreview.data.preview.currentFullPayload).length} 字段）</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap">{JSON.stringify(syncPreview.data.preview.currentFullPayload, null, 2)}</pre></details>
        <details className="rounded bg-white p-2"><summary className="cursor-pointer font-medium">展开完整拟写入 Listing 字段镜像（{Object.keys(syncPreview.data.preview.proposedFullPayload).length} 字段）</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap">{JSON.stringify(syncPreview.data.preview.proposedFullPayload, null, 2)}</pre></details>
        <p className="text-amber-900">受控变更仅限 {syncPreview.data.preview.changedFields.join("、")}。令牌将在 {new Date(syncPreview.data.expiresAt).toLocaleTimeString()} 失效；冲突时不会覆盖旧内容。</p>
        <button type="button" disabled={busy} className="rounded bg-emerald-700 px-3 py-1 font-medium text-white disabled:opacity-50" onClick={() => {
          void applySync.mutateAsync({ previewToken: syncPreview.data!.previewToken });
        }}>{applySync.isPending ? "正在原子写入…" : "我已查看完整预览，最终确认写入正式 Listing"}</button>
      </>}
    </section>}
    {!readOnlyHistory && coreRevisionId && coreInputHash && <div className="space-y-2 rounded border border-indigo-200 bg-white p-2 text-xs">
      <strong>{selected ? "编辑候选（保存为新修订）" : "人工编写新候选"}</strong>
      <label className="block">小标题（英文）<input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} maxLength={500}
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1" placeholder="Benefit for Everyday Use:" /></label>
      <label className="block">卖点正文（自然美式英语）<textarea value={fullText} onChange={(event) => setFullText(event.target.value)} maxLength={5000}
        className="mt-1 min-h-20 w-full rounded border border-slate-300 px-2 py-1" /></label>
      {selected && <label className="block">修改说明（可选）<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000}
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1" /></label>}
      <fieldset className="flex flex-wrap gap-2"><legend>本条正文直接引用的已确认事实（至少选一条）</legend>
        {factRevisionIds.map((id) => <label key={id} className="rounded border px-2 py-1"><input type="checkbox" checked={selectedFactIds.includes(id)}
          onChange={(event) => setSelectedFactIds((current) => event.target.checked ? [...new Set([...current, id])] : current.filter((item) => item !== id))} /> {factLabels[id] || `事实 #${id}`}</label>)}
      </fieldset>
      <div className="flex items-center gap-2"><button type="button" className="rounded bg-indigo-700 px-3 py-1 text-white disabled:opacity-50"
        disabled={busy || !fullText.trim() || selectedFactIds.length === 0 || candidates.isError}
        onClick={() => { if (selected) void edit.mutateAsync({ projectId, candidateId: selected.id,
          expectedCandidateRevision: selected.candidateRevision, subtitle, fullText, evidenceFactIds: selectedFactIds, reason });
        else void create.mutateAsync({ projectId, coreRevisionId, coreInputHash, subtitle, fullText, evidenceFactIds: selectedFactIds }); }}>
        {selected ? "保存新修订" : "保存人工候选"}</button>
        {selected && <button type="button" className="underline" onClick={() => { setEditingId(null); setSubtitle(""); setFullText(""); }}>取消编辑</button>}
      </div>
    </div>}
    {!readOnlyHistory && <button type="button" className="text-xs underline" onClick={() => setShowHistory((value) => !value)}>
      {showHistory ? "收起审阅记录" : "查看审阅记录"}</button>}
    {!readOnlyHistory && showHistory && <div className="space-y-1 text-xs">{history.error && <p role="alert">审阅记录读取失败：{history.error.message}</p>}
      {history.data?.map((row) => <p key={row.id}>候选 #{row.candidateId} · {row.decision} · 审核人 #{row.actorId} · {new Date(row.createdAt).toLocaleString()}</p>)}</div>}
    <p className="text-xs text-amber-800">{readOnlyHistory ? "历史记录只读；请在对应的当前已审核心面板中继续人工审阅。" : "正式同步需等待全字段快照与乐观版本门禁验收；此处只记录审阅结论，不覆盖任何历史 Listing。"}</p>
  </section>;
}
