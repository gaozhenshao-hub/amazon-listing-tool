import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { competitorStudy, type CompetitorStudyRecord } from "./competitorStudyModel";

export default function CompetitorStudyComparison({ analyses, pendingIds, onConfirm, onUnlock }: {
  analyses: CompetitorStudyRecord[];
  pendingIds: ReadonlySet<number>;
  onConfirm: (analysis: CompetitorStudyRecord, summary: string) => void;
  onUnlock: (analysis: CompetitorStudyRecord) => void;
}) {
  return <section aria-label="选中竞品并排研究" className="space-y-3">
    <div><h2 className="text-lg font-semibold">选中竞品 · 并排研究</h2>
      <p className="text-sm text-muted-foreground">所选范围仅用于本页研究与对比，尚未限定 Listing 生成的竞品输入。这里展示已保存内容，不会自动采集或启动分析。</p>
      <a className="text-sm text-primary underline" href="/listing/analysis">前往竞品采集、分析与后台任务</a>
    </div>
    {!analyses.length ? <p className="text-sm text-muted-foreground">从上方选择竞品；单个可先审阅，2–8 个可继续结构化对比。</p> :
      <div className="overflow-x-auto pb-3"><div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${analyses.length}, minmax(340px, 1fr))` }}>
        {analyses.map(analysis => {
          const study = competitorStudy(analysis), pending = pendingIds.has(analysis.id);
          return <article key={analysis.id} aria-label={`${analysis.asin} 研究`} className="space-y-4 rounded-lg border bg-card p-4">
            <header className="space-y-2"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{analysis.asin}</Badge>
              <Badge variant={study.confirmed && !study.historical && !study.sourceUnknown ? "default" : "secondary"}>{study.inconsistent ? "摘要状态不完整" : study.historical ? study.confirmed ? "历史摘要曾确认" : "历史摘要" : study.sourceUnknown ? "来源状态未核验" : study.confirmed ? "已确认" : analysis.summaryStatus === "draft" ? "待确认" : "状态未提供"}</Badge>
              {Number.isSafeInteger(analysis.summaryVersion) && (analysis.summaryVersion ?? 0) > 0 && <span className="text-xs">v{analysis.summaryVersion}</span>}
            </div><h3 className="whitespace-pre-wrap break-words font-medium">{analysis.title || "未保存标题"}</h3>
              <p className="text-xs text-muted-foreground">价格：{analysis.price || "未提供"} · 评分：{analysis.rating || "未提供"} · 评论数：{analysis.reviewCount ?? "未提供"}</p>
            </header>
            <details><summary className="cursor-pointer text-sm font-medium">已保存五点原文（{study.bullets.length} 条）</summary>
              {study.bulletsUnavailable ? <p role="alert" className="text-sm">原文字段无法读取，请回分析页核对。</p> : study.bullets.length ? <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">{study.bullets.map((text, index) => <li key={index} className="whitespace-pre-wrap break-words">{text || "空条目"}</li>)}</ol> : <p className="text-sm text-muted-foreground">尚无已保存五点原文。</p>}
            </details>
            <div><h4 className="text-sm font-medium">{study.summarySource}</h4>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{study.summary || "请到竞品分析页完成分析后刷新；不根据缺失字段推测任务状态。"}</p>
              {study.historical && <p role="alert" className="text-sm text-amber-700">{study.analysisStale
                ? "资料已变化，旧摘要仅作历史参考；需要重新分析当前资料后再确认。"
                : "当前仅保存采集资料，旧摘要不代表当前资料分析；需要重新分析后再确认。"}</p>}
              {study.sourceUnknown && <p role="alert" className="text-sm text-amber-700">来源状态无法核验，不能确认摘要；请到分析页核对。此状态不代表分析任务成功、失败或资料已过期。</p>}
              {study.inconsistent && <p role="alert" className="text-sm text-amber-700">确认状态缺少已保存原文，请先在分析页核对。</p>}
            </div>
            <div className="flex flex-wrap gap-2"><Button size="sm" disabled={pending || !study.canConfirm} onClick={() => { if (!pending && study.canConfirm) onConfirm(analysis, study.summary); }}>确认此摘要</Button>
              <Button size="sm" variant="outline" disabled={pending || !study.canUnlock} onClick={() => { if (!pending && study.canUnlock) onUnlock(analysis); }}>解锁此摘要</Button>
            </div>
            <p className="text-xs text-muted-foreground">确认 / 解锁仅更新此条已保存摘要；编辑请回分析页。任务的真实排队、失败与重试信息以原后台任务页为准。</p>
          </article>;
        })}
      </div></div>}
  </section>;
}
