import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { listingOwnerKey, listingRequestOwner, type ListingRequestOwner } from "./listingResearchSelectionState";
import { parseCompetitorDeepResultView, type CompetitorDeepResultView } from "./competitorDeepResultView";
import CompetitorDeepResultPanel from "./CompetitorDeepResultPanel";

export type CompetitorDeepResultReaderProps = { projectId: number; analysisId: number; asin: string; revision: string };
const FAILED = "四栏结果读取未完成，身份、权限、资料版本或返回内容可能已变化。旧显示已隐藏，请核对后手动重新读取。";

/** Explicit read of a saved candidate, never a generation/confirmation action.
 * Deliberately bypass shared query caches. The owner epoch also isolates a return
 * to a previous account/role/row after an intervening scope change. */
export default function CompetitorDeepResultReader(props: CompetitorDeepResultReaderProps) {
  const auth = useAuth();
  const owner = listingRequestOwner(auth.user, props.projectId, auth.loading || !!auth.error);
  const valid = Number.isSafeInteger(props.analysisId) && props.analysisId > 0
    && /^[A-Z0-9]{10}$/u.test(props.asin) && /^[a-f0-9]{64}$/u.test(props.revision);
  const identity = owner && valid ? JSON.stringify([listingOwnerKey(owner), props.analysisId, props.asin, props.revision]) : null;
  const boundary = useRef({ identity, epoch: 0 });
  if (boundary.current.identity !== identity) boundary.current = { identity, epoch: boundary.current.epoch + 1 };
  if (!identity || !owner) return <p role={auth.loading ? "status" : "alert"} className="text-sm text-muted-foreground">
    {auth.loading ? "正在核对四栏结果读取身份…" : "身份、工作区或竞品版本不完整，未读取四栏结果。"}
  </p>;
  return <OwnedResultReader key={`${identity}:${boundary.current.epoch}`} {...props} owner={owner} />;
}

function OwnedResultReader({ owner, ...props }: CompetitorDeepResultReaderProps & { owner: ListingRequestOwner }) {
  const client = trpc.useUtils().client;
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; data: CompetitorDeepResultView | null }>({ status: "idle", data: null });
  const live = useRef(false), busy = useRef(false), ticket = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; controller.current?.abort(); };
  }, []);
  async function read() {
    if (!live.current || busy.current) return;
    busy.current = true;
    const current = ++ticket.current, abort = new AbortController();
    controller.current?.abort(); controller.current = abort;
    setState({ status: "loading", data: null });
    try {
      const response = await client.analysis.getCompetitorDeepResult.query({ projectId: props.projectId, analysisId: props.analysisId,
        expectedWorkspaceId: owner.workspaceId, expectedRevision: props.revision }, { signal: abort.signal });
      if (!live.current || abort.signal.aborted || current !== ticket.current) return;
      const data = parseCompetitorDeepResultView(response, { userId: owner.userId, workspaceId: owner.workspaceId,
        projectId: props.projectId, analysisId: props.analysisId, asin: props.asin, revision: props.revision });
      setState({ status: "ready", data });
    } catch {
      if (!live.current || abort.signal.aborted || current !== ticket.current) return;
      setState({ status: "error", data: null });
    } finally { if (live.current && current === ticket.current) busy.current = false; }
  }
  return <section aria-label={`${props.asin} 已保存四栏结果`} className="min-w-0 max-w-full space-y-3">
    <Button type="button" variant="outline" size="sm" disabled={state.status === "loading"} onClick={() => void read()}>查看已保存的四栏结果</Button>
    {state.status === "idle" && <p className="text-xs text-muted-foreground">仅查看已保存结果，不启动分析、上传文件或调用模型。</p>}
    {state.status === "loading" && <p role="status" className="text-sm">正在核对四栏结果及来源…</p>}
    {state.status === "error" && <p role="alert" className="text-sm text-amber-700">{FAILED}</p>}
    {state.data?.status === "not_available" && <p role="status" className="text-sm text-muted-foreground">当前竞品没有可核验的已保存四栏结果。旧摘要或任务状态不能代替四项研究；此处不会自动生成。</p>}
    {state.data?.status === "available" && <CompetitorDeepResultPanel view={state.data} />}
  </section>;
}
