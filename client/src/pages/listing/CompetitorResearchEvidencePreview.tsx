import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { canonicalCompetitorResearchEvidence, type CompetitorResearchEvidenceSummary } from "@shared/competitorResearchEvidence";
import { listingOwnerKey, listingRequestOwner, type ListingRequestOwner } from "./listingResearchSelectionState";

export type CompetitorResearchEvidencePreviewProps = { projectId: number; analysisId: number; asin: string; revision: string };
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().safe();
const id = z.number().int().positive().safe();
const summarySchema = z.object({
  version: z.literal(1),
  identity: z.object({ userId: id, workspaceId: id.nullable(), sourceWorkspaceId: id.nullable(), projectId: id,
    analysisId: id, asin: z.string().regex(/^[A-Z0-9]{10}$/u), revision: hash }).strict(),
  evidenceHash: hash, modelRead: z.literal(false),
  listing: z.object({ titleAvailable: z.boolean(), bulletCount: count, sourceCount: count }).strict(),
  reviews: z.object({ status: z.enum(["available", "unavailable"]), total: count.max(20000).nullable(),
    parserCorpusHash: hash.nullable(), authorizedCorpusHash: hash.nullable(), sourceFileHash: hash.nullable(),
    scope: z.literal("complete_file_not_market_total").nullable(), batchCount: count.max(20000), totalBatchUtf8Bytes: count,
    batches: z.array(z.object({ batchId: z.string(), count: id.max(60), utf8Bytes: id.max(24576), sha256: hash }).strict()).max(20000),
  }).strict(),
}).strict();
const FAILED = "生成依据预览未完成，访问条件、资料版本或返回内容可能已变化。旧预览已隐藏；请核对后手动重新预览。";

/** Checks only summary identity/shape/coverage consistency. Without raw evidence
 * the browser cannot recompute the server's corpus, batch or evidence hashes. */
function checkedSummary(value: unknown, owner: ListingRequestOwner, props: CompetitorResearchEvidencePreviewProps): CompetitorResearchEvidenceSummary {
  // Descriptor-first encoding rejects getters, sparse arrays and extra array
  // properties before schema iteration; never render arbitrary response text.
  const parsed = summarySchema.safeParse(JSON.parse(canonicalCompetitorResearchEvidence(value)));
  if (!parsed.success) throw new Error("EVIDENCE_SUMMARY_INVALID");
  const result = parsed.data, identity = result.identity, r = result.reviews;
  if (identity.userId !== owner.userId || identity.workspaceId !== owner.workspaceId
    || (identity.sourceWorkspaceId !== null && identity.sourceWorkspaceId !== owner.workspaceId)
    || identity.projectId !== props.projectId || identity.analysisId !== props.analysisId || identity.asin !== props.asin || identity.revision !== props.revision
    || result.listing.sourceCount !== result.listing.bulletCount + Number(result.listing.titleAvailable)
    || r.batchCount !== r.batches.length || r.totalBatchUtf8Bytes !== r.batches.reduce((sum, batch) => sum + batch.utf8Bytes, 0)) throw new Error("EVIDENCE_SUMMARY_INVALID");
  if (r.status === "unavailable") {
    if (r.total !== null || r.parserCorpusHash !== null || r.authorizedCorpusHash !== null || r.sourceFileHash !== null || r.scope !== null
      || r.batchCount !== 0 || r.totalBatchUtf8Bytes !== 0) throw new Error("EVIDENCE_SUMMARY_INVALID");
  } else if (r.total === null || r.parserCorpusHash === null || r.authorizedCorpusHash === null || r.sourceFileHash === null
    || r.scope !== "complete_file_not_market_total" || r.total !== r.batches.reduce((sum, batch) => sum + batch.count, 0)
    || r.batches.some((batch, i) => batch.batchId !== `analysis:${props.analysisId}:reviews:${i + 1}`)) throw new Error("EVIDENCE_SUMMARY_INVALID");
  return result;
}

/** Explicit, read-only preview. No query cache, polling, model, upload or writes.
 * The owner key isolates role as well as actor/workspace/project; server policy
 * remains authoritative. Abort is best effort; the local late guard is required. */
export default function CompetitorResearchEvidencePreview(props: CompetitorResearchEvidencePreviewProps) {
  const auth = useAuth();
  const owner = listingRequestOwner(auth.user, props.projectId, auth.loading || !!auth.error);
  const validProps = id.safeParse(props.analysisId).success && /^[A-Z0-9]{10}$/u.test(props.asin) && hash.safeParse(props.revision).success;
  const identity = owner && validProps ? JSON.stringify([listingOwnerKey(owner), props.analysisId, props.asin, props.revision]) : null;
  const boundary = useRef({ identity, epoch: 0 });
  if (boundary.current.identity !== identity) boundary.current = { identity, epoch: boundary.current.epoch + 1 };
  if (!identity || !owner) return <p role={auth.loading ? "status" : "alert"} className="text-sm text-muted-foreground">
    {auth.loading ? "正在确认生成依据预览身份…" : "身份、工作区或竞品版本不完整，未读取生成依据。"}
  </p>;
  return <OwnedPreview key={identity + ":" + boundary.current.epoch} {...props} owner={owner} />;
}

function OwnedPreview({ owner, ...props }: CompetitorResearchEvidencePreviewProps & { owner: ListingRequestOwner }) {
  const client = trpc.useUtils().client;
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; data: CompetitorResearchEvidenceSummary | null }>({ status: "idle", data: null });
  const live = useRef(false), ticket = useRef(0), busy = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; controller.current?.abort(); };
  }, []);
  async function preview() {
    if (!live.current || busy.current) return;
    busy.current = true; const current = ++ticket.current, abort = new AbortController();
    controller.current?.abort(); controller.current = abort;
    setState({ status: "loading", data: null });
    try {
      const value = await client.analysis.previewResearchEvidence.query({ projectId: props.projectId, analysisId: props.analysisId,
        expectedWorkspaceId: owner.workspaceId, expectedRevision: props.revision }, { signal: abort.signal });
      if (!live.current || abort.signal.aborted || current !== ticket.current) return;
      const data = checkedSummary(value, owner, props);
      setState({ status: "ready", data });
    } catch {
      if (!live.current || abort.signal.aborted || current !== ticket.current) return;
      setState({ status: "error", data: null });
    } finally { if (live.current && current === ticket.current) busy.current = false; }
  }
  const data = state.data;
  return <section aria-label={`${props.asin} 生成依据预览`} className="space-y-2 rounded border p-3 text-sm">
    <Button type="button" variant="outline" size="sm" disabled={state.status === "loading"} onClick={() => void preview()}>预览生成依据</Button>
    {state.status === "idle" && <p className="text-muted-foreground">点击后只读取当前版本的证据准备情况，不启动分析。</p>}
    {state.status === "loading" && <p role="status">正在核对当前版本的生成依据…</p>}
    {state.status === "error" && <p role="alert">{FAILED}</p>}
    {data && <div aria-label="已核对的证据摘要" className="space-y-1">
      <p>标题原文：{data.listing.titleAvailable ? "已保存" : "未提供"}；五点原文：{data.listing.bulletCount} 条。</p>
      {data.reviews.status === "available" ? <>
        <p>完整来源文件内归属当前竞品的评论：{data.reviews.total} 条（去重后）。</p>
        <p>计划分批：{data.reviews.batchCount} 批；证据 JSON 合计 {data.reviews.totalBatchUtf8Bytes} 字节。</p>
        <p className="text-muted-foreground">数量仅限本次可核验的完整来源文件，不是平台累计评论或全市场样本；不表示模型已读。</p>
      </> : <p>原评论来源未知，数量无法确认，不能视为 0 条；已有二级分析不等于原文证据。</p>}
    </div>}
    <p className="text-xs text-muted-foreground">图片内容、OCR 和问答尚未纳入。此预览不调用模型，不代表标题、卖点、买家与总结四项研究已完成。</p>
  </section>;
}
