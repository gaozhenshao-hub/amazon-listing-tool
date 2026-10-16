import { useEffect, useRef, useState } from "react";
import { useParams, useSearch } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { MERGED_LISTING_WORKFLOW_ENABLED } from "@/lib/mergedListingWorkflow";
import { trpc } from "@/lib/trpc";
import { COMPETITOR_REVIEW_PARSER_VERSION, type CompetitorReviewItem, type CompetitorReviewPage } from "@shared/competitorReviewCorpus";
import { listingOwnerKey, listingRequestOwner } from "./listingResearchSelectionState";

type ReviewPage = CompetitorReviewPage;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const natural = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function routeId(value: string | null | undefined) {
  return value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : 0;
}
function readableItem(item: CompetitorReviewItem, asin: string) {
  return !!item && typeof item.reviewId === "string" && !!item.reviewId && item.asin === asin
    && typeof item.body === "string" && !!item.body.trim()
    && [item.title, item.date, item.author, item.variant].every(value => value === null || typeof value === "string")
    && (item.rating === null || (typeof item.rating === "number" && Number.isFinite(item.rating) && item.rating >= 0 && item.rating <= 5))
    && Array.isArray(item.occurrences) && item.occurrences.length > 0 && item.occurrences.every(location => location
      && typeof location.sheet === "string" && natural(location.row) && location.row > 0
      && ["row_asin", "filename_unique_asin"].includes(location.assignment)
      && Array.isArray(location.fields) && location.fields.every(field => field && natural(field.column) && typeof field.header === "string"
        && (field.value === null || ["string", "number", "boolean"].includes(typeof field.value)))
      && Array.isArray(location.warnings) && location.warnings.every(warning => typeof warning === "string"));
}
function checkedPage(value: unknown, projectId: number, analysisId: number, page: number, corpusHash?: string): ReviewPage {
  if (!value || typeof value !== "object") throw new Error("REVIEW_RESPONSE_INVALID");
  const row = value as ReviewPage;
  if (row.projectId !== projectId || row.analysisId !== analysisId || !/^[A-Z0-9]{10}$/.test(row.asin)
    || row.page !== page || row.pageSize !== 30 || !Array.isArray(row.items)
    || (row.reason !== null && typeof row.reason !== "string")) throw new Error("REVIEW_RESPONSE_INVALID");
  if (row.status === "unavailable") {
    if (typeof row.reason !== "string" || row.parserVersion !== null || row.total !== null || row.corpusHash !== null || row.source !== null || row.coverage !== null || row.items.length) throw new Error("REVIEW_RESPONSE_INVALID");
    if (corpusHash) throw new Error("COMPETITOR_REVIEWS_CORPUS_CHANGED");
    return row;
  }
  const coverage = row.coverage;
  if (row.status !== "available" || row.reason !== null || row.parserVersion !== COMPETITOR_REVIEW_PARSER_VERSION || !hash(row.corpusHash) || (corpusHash && row.corpusHash !== corpusHash)
    || !natural(row.total) || !row.source || typeof row.source.runId !== "string" || !row.source.runId
    || typeof row.source.fileName !== "string" || !hash(row.source.fileHash) || !coverage
    || coverage.scope !== "complete_file_not_market_total" || coverage.sourceFileHash !== row.source.fileHash
    || coverage.sourceFileName !== row.source.fileName || coverage.uniqueReviews !== row.total
    || ![coverage.totalRows, coverage.blankRows, coverage.emptyBodyRows, coverage.unassignedRows, coverage.otherAsinRows,
      coverage.matchedRows, coverage.duplicateRows, coverage.filenameFallbackRows].every(natural)
    || coverage.matchedRows !== coverage.uniqueReviews + coverage.duplicateRows
    || coverage.totalRows !== coverage.blankRows + coverage.emptyBodyRows + coverage.unassignedRows + coverage.otherAsinRows + coverage.matchedRows
    || row.items.length !== Math.min(30, row.total - (page - 1) * 30) || row.items.some(item => !readableItem(item, row.asin))
    || new Set(row.items.map(item => item.reviewId)).size !== row.items.length) throw new Error("REVIEW_RESPONSE_INVALID");
  return row;
}
function errorCode(error: unknown) {
  return error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object" && "code" in error.data ? String(error.data.code) : "";
}
function readErrorMessage(error: unknown) {
  // Only exact, fixed service identifiers select a message; never echo an error payload.
  const message = error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
  if (message === "COMPETITOR_REVIEWS_FILE_UNSUPPORTED_OR_INVALID")
    return "来源文件格式或内容不受支持。当前仅支持 UTF-8 CSV 和受限 XLSX；XLS、公式等文件不能读取。请核对原文件，不要反复重试。";
  if (message === "COMPETITOR_REVIEWS_SOURCE_HISTORY_LIMIT")
    return "评论来源历史或累计大小已超限，反复重新读取不能解除限制。请联系管理员核对来源。";
  if (["COMPETITOR_REVIEWS_SCHEMA_UNAVAILABLE", "COMPETITOR_REVIEWS_TRANSACTION_REQUIRED"].includes(message))
    return "原评论读取服务尚未就绪，未返回原文。请联系管理员检查服务配置。";
  if (["COMPETITOR_REVIEWS_WORKSPACE_CHANGED", "COMPETITOR_REVIEWS_SOURCE_CHANGED", "COMPETITOR_REVIEWS_CORPUS_CHANGED"].includes(message))
    return "当前工作区或评论来源已变化，未混用不同版本。请明确重新读取来源，从第 1 页核对。";
  if (["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(errorCode(error)))
    return "原评论访问条件已变化，已隐藏旧内容；请核对当前项目与权限。";
  return "原评论读取失败或返回范围不匹配，不能视为零条评论。请重新读取来源；持续失败请联系管理员。";
}

/** Read-only evidence. Route identity never selects a workspace or starts a model. */
export default function CompetitorReviewsPage() {
  const params = useParams<{ analysisId: string }>(), search = useSearch(), auth = useAuth();
  const query = new URLSearchParams(search), projectValues = query.getAll("projectId");
  const projectId = projectValues.length === 1 ? routeId(projectValues[0]) : 0, analysisId = routeId(params.analysisId);
  const owner = listingRequestOwner(auth.user, projectId, auth.loading || !!auth.error), identity = analysisId && owner ? listingOwnerKey(owner) + ":" + analysisId : null;
  const boundary = useRef({ identity, epoch: 0 });
  if (boundary.current.identity !== identity) boundary.current = { identity, epoch: boundary.current.epoch + 1 };
  if (!MERGED_LISTING_WORKFLOW_ENABLED) return <p>原评论研究入口尚未启用。</p>;
  if (!projectId || !analysisId) return <p role="alert">项目或竞品链接无效，未读取原评论。</p>;
  if (!identity || !owner) return <p role={auth.loading ? "status" : "alert"}>{auth.loading ? "正在确认原评论读取身份…" : "登录或工作区信息不完整，未读取原评论。"}</p>;
  return <OwnedCompetitorReviews key={identity + ":" + boundary.current.epoch} projectId={projectId} analysisId={analysisId} workspaceId={owner.workspaceId} />;
}

function OwnedCompetitorReviews({ projectId, analysisId, workspaceId }: { projectId: number; analysisId: number; workspaceId: number | null }) {
  const client = trpc.useUtils().client;
  const [request, setRequest] = useState<{ page: number; corpusHash?: string; epoch: number }>({ page: 1, epoch: 0 });
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; data: ReviewPage | null; message: string }>({ status: "loading", data: null, message: "" });
  const ticket = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), current = ++ticket.current;
    setState({ status: "loading", data: null, message: "" });
    void client.analysis.listCompetitorReviews.query({ projectId, analysisId, expectedWorkspaceId: workspaceId,
      page: request.page, pageSize: 30, ...(request.corpusHash ? { expectedCorpusHash: request.corpusHash } : {}) }, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted || current !== ticket.current) return;
      setState({ status: "ready", data: checkedPage(value, projectId, analysisId, request.page, request.corpusHash), message: "" });
    }).catch(error => {
      if (controller.signal.aborted || current !== ticket.current) return;
      setState({ status: "error", data: null, message: readErrorMessage(error) });
    });
    return () => { controller.abort(); };
  }, [analysisId, client, projectId, request, workspaceId]);
  const data = state.data, coverage = data?.coverage;
  return <main className="space-y-5">
    <a className="text-primary underline" href={`/listing/comparison?projectId=${projectId}`}>返回竞品并排研究</a>
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">{data?.asin ? data.asin + " · " : ""}原评论</h1>
      <p className="mt-1 text-sm text-muted-foreground">显示可恢复来源文件中的原文，不代表 Amazon 累计评论或全部买家；不会启动采集或 AI 分析。</p></div>
      <Button variant="outline" onClick={() => setRequest(previous => ({ page: 1, epoch: previous.epoch + 1 }))}>重新读取来源</Button></header>
    {state.status === "loading" && <p role="status">正在读取第 {request.page} 页原评论…</p>}
    {state.status === "error" && <p role="alert">{state.message}</p>}
    {data?.status === "unavailable" && <section aria-label="原评论不可恢复" className="rounded-lg border p-4"><h2 className="font-semibold">当前没有可恢复的原评论来源</h2>
      <p className="mt-2 whitespace-pre-wrap">{data.reason || "已保存分析不包含可恢复的逐条原评论。"}</p><p className="mt-2 text-sm">这不表示零条评论，也不表示此前的二级分析已核验原文。</p></section>}
    {data?.status === "available" && coverage && <>
      <section aria-label="评论来源与覆盖范围" className="space-y-2 rounded-lg border p-4 text-sm">
        <h2 className="font-semibold">来源文件：{data.source?.fileName}</h2>
        <p>可恢复原文共 {data.total} 条（去重后）；不是 Amazon 累计评论数，也不是深度分析已读样本数。</p>
        <p>文件数据行 {coverage.totalRows}；匹配当前 ASIN {coverage.matchedRows} 行；合并重复 {coverage.duplicateRows} 行。</p>
        <p>未归属 ASIN {coverage.unassignedRows} 行；其他 ASIN {coverage.otherAsinRows} 行；正文为空 {coverage.emptyBodyRows} 行；空白 {coverage.blankRows} 行。</p>
        <p>依据文件名唯一 ASIN 归属 {coverage.filenameFallbackRows} 行；未归属行不计入原文总数。</p>
      </section>
      <section aria-label="原评论列表" className="space-y-4">{data.items.map(item => <article key={item.reviewId} aria-label={`原评论 ${item.reviewId}`} className="space-y-2 rounded-lg border p-4">
        <h2 className="font-semibold">{item.title || "无标题"}</h2><p className="text-xs text-muted-foreground">评分：{item.rating ?? "未提供"} · 日期：{item.date || "未提供"} · 变体：{item.variant || "未提供"}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{item.body}</p>
        <details><summary className="cursor-pointer text-sm text-primary">原文位置（{item.occurrences.length} 处）</summary><div className="mt-2 space-y-3 text-xs">{item.occurrences.map((location, index) => <div key={index} className="rounded border p-2">
          <p>{location.sheet} · 第 {location.row} 行 · {location.assignment === "row_asin" ? "行内 ASIN" : "文件名唯一 ASIN"}</p>
          <dl>{location.fields.map(field => <div key={field.column} className="mt-1 whitespace-pre-wrap break-words"><dt className="font-medium">列 {field.column} · {field.header}</dt><dd>{field.value === null ? "空值" : String(field.value)}</dd></div>)}</dl>
          {location.warnings.map((warning, warningIndex) => <p key={warningIndex} className="mt-1 text-amber-700">{warning}</p>)}
        </div>)}</div></details>
      </article>)}{data.total === 0 && <p>此来源文件没有归属当前 ASIN 的有效评论正文；已列明排除情况，不代表商品没有评论。</p>}</section>
      <nav aria-label="原评论分页" className="flex items-center gap-3"><Button variant="outline" disabled={data.page <= 1} onClick={() => setRequest({ page: data.page - 1, corpusHash: data.corpusHash!, epoch: request.epoch })}>上一页</Button>
        <span>第 {data.page} / {Math.max(1, Math.ceil((data.total ?? 0) / 30))} 页</span>
        <Button variant="outline" disabled={data.page * 30 >= (data.total ?? 0)} onClick={() => setRequest({ page: data.page + 1, corpusHash: data.corpusHash!, epoch: request.epoch })}>下一页</Button></nav>
    </>}
  </main>;
}
