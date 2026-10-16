import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { listingResearchIdsSchema } from "@shared/listingResearchSelection";
import { actualResearchSelection, confirmedResearchPayload, listingOwnerKey, listingRequestOwner } from "./listingResearchSelectionState";

type Client = ReturnType<typeof trpc.useUtils>["client"];
type Analysis = Awaited<ReturnType<Client["analysis"]["listByProject"]["query"]>>[number];
type SelectionState = { ownerKey: string | null; status: "idle" | "loading" | "error" | "ready"; rows: Analysis[]; selected: number[]; confirmed: number[] | null };
const initial = (ownerKey: string | null): SelectionState => ({ ownerKey, status: "idle", rows: [], selected: [], confirmed: null });

/** This selection is local to this authenticated project. It is never inferred
 * from Comparison checkboxes, URL parameters or the shared query cache. */
export function useListingResearchSelection(projectId: number, enabled: boolean) {
  const auth = useAuth(), owner = listingRequestOwner(auth.user, projectId, auth.loading || !!auth.error);
  const identity = enabled ? listingOwnerKey(owner) : null;
  const generation = useRef({ identity, ownerKey: identity, epoch: 0, ticket: 0 });
  if (generation.current.identity !== identity) {
    const epoch = generation.current.epoch + 1;
    generation.current = { identity, ownerKey: identity ? JSON.stringify([identity, epoch]) : null, epoch, ticket: generation.current.ticket + 1 };
  }
  const ownerKey = generation.current.ownerKey;
  const client = trpc.useUtils().client;
  const [state, setState] = useState<SelectionState>(() => initial(ownerKey));
  const [refresh, setRefresh] = useState(0);
  const current = state.ownerKey === ownerKey ? state : initial(ownerKey);
  const workspaceId = owner?.workspaceId;
  useEffect(() => {
    if (!ownerKey || workspaceId === undefined) return;
    const controller = new AbortController(), ticket = ++generation.current.ticket;
    setState({ ...initial(ownerKey), status: "loading" });
    const request = { projectId, expectedWorkspaceId: workspaceId };
    void client.analysis.listByProject.query(request, { signal: controller.signal }).then(rows => {
      if (controller.signal.aborted || generation.current.ownerKey !== ownerKey || ticket !== generation.current.ticket) return;
      const ids = Array.isArray(rows) ? rows.map(row => row.id) : null;
      if (!ids || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length
        || rows.some(row => row.projectId !== projectId)) {
        setState({ ...initial(ownerKey), status: "error" }); return;
      }
      setState({ ...initial(ownerKey), status: "ready", rows });
    }).catch(() => {
      if (!controller.signal.aborted && generation.current.ownerKey === ownerKey && ticket === generation.current.ticket)
        setState({ ...initial(ownerKey), status: "error" });
    });
    return () => controller.abort();
  }, [client, ownerKey, projectId, refresh, workspaceId]);

  const select = useCallback((id: number, checked: boolean) => {
    if (!ownerKey) return;
    setState(previous => {
      if (previous.ownerKey !== ownerKey || previous.status !== "ready" || !previous.rows.some(row => row.id === id)) return previous;
      const selected = checked ? [...new Set([...previous.selected, id])].sort((a, b) => a - b) : previous.selected.filter(value => value !== id);
      if (!listingResearchIdsSchema.safeParse(selected).success) return previous;
      return { ...previous, selected, confirmed: null };
    });
  }, [ownerKey]);
  const confirm = useCallback(() => {
    if (!ownerKey) return;
    setState(previous => previous.ownerKey === ownerKey && previous.status === "ready"
      && listingResearchIdsSchema.safeParse(previous.selected).success ? { ...previous, confirmed: [...previous.selected] } : previous);
  }, [ownerKey]);
  const reload = useCallback(() => {
    if (!ownerKey) return;
    generation.current.ticket++;
    setState({ ...initial(ownerKey), status: "loading" }); setRefresh(value => value + 1);
  }, [ownerKey]);
  return { ...current, ownerKey, select, confirm, reload,
    payload: confirmedResearchPayload(enabled, current.status === "ready" ? current.confirmed : null) };
}

export type ListingResearchSelectionController = ReturnType<typeof useListingResearchSelection>;
export default function ListingResearchSelection({ selection, disabled = false }: { selection: ListingResearchSelectionController; disabled?: boolean }) {
  return <section aria-label="卖点生成竞品范围" className="space-y-3 rounded-lg border p-4">
    <div><h3 className="font-semibold">选择本次参考的竞品研究</h3><p className="text-xs text-muted-foreground">此处选择只用于下一次卖点方向生成。竞品研究不是本品事实，选择不会确认事实或改动已有方向。</p></div>
    {!selection.ownerKey && <p role="alert">请先确认当前用户、工作区和项目。</p>}
    {selection.ownerKey && selection.status === "loading" && <p role="status">正在读取当前项目竞品研究…</p>}
    {selection.status === "error" && <p role="alert">竞品研究读取失败，请重新读取后再确认范围。</p>}
    {selection.status === "ready" && <>
      {selection.rows.length === 0 && <p>当前项目暂无竞品研究；仍需明确确认不使用竞品。</p>}
      <div className="max-h-64 space-y-2 overflow-auto">{selection.rows.map(row => <label key={row.id} className="flex items-start gap-2 text-sm">
        <input type="checkbox" aria-label={`选择竞品研究 ${row.asin || row.id}`} disabled={disabled || (selection.selected.length >= 1000 && !selection.selected.includes(row.id))} checked={selection.selected.includes(row.id)}
          onChange={event => selection.select(row.id, event.target.checked)} />
        <span>{row.asin || `研究 #${row.id}`} · {row.title || "未填写标题"} <span className="text-xs text-muted-foreground">#{row.id} · {row.summaryStatus === "confirmed" ? "研究摘要已确认（非本品事实）" : "研究摘要待核实"}</span></span>
      </label>)}</div>
      {selection.selected.length >= 1000 && <p className="text-xs">单次最多选择 1000 条竞品研究。</p>}
      <Button type="button" variant="outline" disabled={disabled} onClick={selection.confirm}>{selection.selected.length ? `确认使用所选 ${selection.selected.length} 条研究` : "确认不使用竞品"}</Button>
      {selection.confirmed !== null ? <p role="status" className="text-sm">{selection.confirmed.length ? `已确认下一次使用 ${selection.confirmed.length} 条竞品研究` : "已确认下一次不使用竞品"}；实际采用范围以任务记录为准。</p>
        : <p className="text-xs text-amber-800">尚未确认本次范围；勾选或重新读取后须再次确认。</p>}
    </>}
    <Button type="button" variant="ghost" disabled={disabled || !selection.ownerKey || selection.status === "loading"} onClick={selection.reload}>重新读取竞品研究</Button>
  </section>;
}

export function ListingResearchRunSummary({ run }: { run: unknown }) {
  if (!run) return null;
  const selection = actualResearchSelection(run);
  return <section aria-label="任务记录的竞品范围" className="rounded border p-3 text-xs">
    {!selection ? <p>此任务未记录可核验的竞品范围，不能从当前勾选推断。</p> : <>
      <p className="font-medium">{selection.phase === "actual" ? "本任务实际采用范围" : "本任务已冻结范围（尚非执行结果）"} · {selection.binding.mode === "legacy_all" ? "旧调用：创建任务时的全部研究" : "明确选择"}</p>
      <p>{selection.binding.analysisIds.length ? `研究 ID：${selection.binding.analysisIds.join("、")}` : "明确不使用竞品研究"}</p>
      {selection.analyzedAsins !== null && <p>{selection.analyzedAsins.length ? `实际 ASIN：${selection.analyzedAsins.join("、")}` : "实际无竞品 ASIN"}</p>}
    </>}
  </section>;
}
