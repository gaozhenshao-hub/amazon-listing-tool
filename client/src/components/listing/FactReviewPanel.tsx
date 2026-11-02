import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type Props = { projectId: number };
const PAGE_SIZE = 30;

export function FactReviewPanel({ projectId }: Props) {
  const [page, setPage] = useState(0);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const utils = trpc.useUtils();
  const suggestions = trpc.listing.listRawFactSuggestions.useQuery({ projectId, offset: page * PAGE_SIZE, limit: PAGE_SIZE });
  const reviews = trpc.listing.listReviewedFacts.useQuery({ projectId });
  const review = trpc.listing.reviewRawFact.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.listing.listRawFactSuggestions.invalidate({ projectId }),
        utils.listing.listReviewedFacts.invalidate({ projectId }), utils.listing.listCurrentCores.invalidate({ projectId }),
        utils.listing.listCandidates.invalidate({ projectId })]);
      toast.success("审核结果已记录到事实版本账本；已有卖点不会自动覆盖");
    },
    onError: (error) => {
      if (error.data?.code === "CONFLICT") {
        void utils.listing.listRawFactSuggestions.invalidate({ projectId });
        void utils.listing.listReviewedFacts.invalidate({ projectId });
      }
      toast.error(error.message);
    },
  });
  const revisionByAttribute = new Map((reviews.data || []).map((item) => [item.attributeKey, item]));
  const source = suggestions.data;
  const rows = source?.suggestions || [];
  return <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3" aria-label="原始属性事实人工审核">
    <div>
      <h3 className="font-semibold text-slate-900">原始属性事实审核</h3>
      <p className="text-xs text-slate-600 mt-1">仅展示当前项目原始属性表中可定位的非空字段；模板示例已过滤。候选不等于已确认事实，AI分析不能代替人工核对。</p>
    </div>
    {suggestions.isLoading && <p className="text-sm text-slate-500">正在读取完整原始属性表…</p>}
    {suggestions.error && <p role="alert" className="text-sm text-red-700">原始表核对失败：{suggestions.error.message}</p>}
    {source?.status === "legacy_unverified" && <p role="alert" className="text-sm text-amber-800">历史属性上传没有可核验原文指纹；请重新上传或补充真实产品资料，不能自动确认。</p>}
    {source?.status === "source_not_ready" && <p role="alert" className="text-sm text-amber-800">最新原始属性表尚未完成上传与解析，请等待完成或重新上传；旧上传不能替代当前事实来源。</p>}
    {source?.status === "no_source" && <p role="alert" className="text-sm text-amber-800">尚无可核验的产品属性表，请先上传本品资料。</p>}
    {reviews.error && <p role="alert" className="text-sm text-red-700">事实版本读取失败：{reviews.error.message}</p>}
    {source?.status === "reviewable" && rows.length === 0 && <p className="text-sm text-slate-600">这一页没有可审核字段；纯文本说明、空值、示例和外部商品标识不会自动作为事实。</p>}
    <div className="space-y-2">
      {source?.status === "reviewable" && rows.map((item) => {
        const key = `${source.file?.id}-${item.sourceLine}-${item.sourceLineHash}`;
        const latest = revisionByAttribute.get(item.attributeKey);
        const correctedValue = corrections[key] ?? item.value;
        const reviewNote = notes[key] || "";
        return <div key={key} className="rounded-md border border-slate-200 px-3 py-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <strong className="text-slate-900">{item.attributeKey}</strong>
            <span className="text-slate-500">原始表第 {item.sourceLine} 行</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{latest?.status === "confirmed" ? "已确认" : latest?.status === "rejected" ? "已拒绝" : latest?.status === "stale" ? "旧版本已失效" : "待审核"}</span>
          </div>
          <p className="text-sm text-slate-700 break-words">原始值：{item.value}</p>
          <label className="block text-xs text-slate-600">人工核对值（不同于原文时须注明理由）
            <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900" value={correctedValue} maxLength={500}
              onChange={(event) => setCorrections((previous) => ({ ...previous, [key]: event.target.value }))} />
          </label>
          <label className="block text-xs text-slate-600">审核说明
            <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900" value={reviewNote} maxLength={2000}
              placeholder="若更正原文，请填写核对依据或原因；认证/保修等强主张须另有证明文件"
              onChange={(event) => setNotes((previous) => ({ ...previous, [key]: event.target.value }))} />
          </label>
          <div className="flex gap-2">
            {(["confirm", "reject"] as const).map((decision) => <button type="button" key={decision}
              disabled={review.isPending || reviews.isLoading || !!reviews.error || !source.file || (decision === "confirm" && correctedValue !== item.value && reviewNote.trim().length < 8)}
              className="rounded border border-slate-300 px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 hover:bg-slate-50"
              onClick={() => { if (!source.file) return; review.mutate({ projectId, fileId: source.file.id, rawHash: source.file.rawHash,
                sourceLine: item.sourceLine, sourceLineHash: item.sourceLineHash, expectedRevision: latest?.revision || 0,
                decision, ...(decision === "confirm" ? { correctedValue, reviewNote } : { reviewNote }) }); }}>
              {decision === "confirm" ? "人工确认事实" : "拒绝该字段"}
            </button>)}
          </div>
        </div>;
      })}
    </div>
    {source?.status === "reviewable" && source.total > PAGE_SIZE && <div className="flex items-center justify-between text-xs text-slate-600">
      <button type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>上一页</button>
      <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, source.total)} / {source.total}</span>
      <button type="button" disabled={(page + 1) * PAGE_SIZE >= source.total} onClick={() => setPage((current) => current + 1)}>下一页</button>
    </div>}
  </section>;
}
