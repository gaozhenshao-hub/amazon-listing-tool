import { useState } from "react";
import { Link } from "wouter";
import { AlertCircle, CheckCircle2, Clock3, DatabaseZap, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KnowledgeCollectionForm } from "./KnowledgeCollectionForm";
import AcquisitionRecordActions from "./AcquisitionRecordActions";
import { collectionDisplayAsin, collectionNeedsAttention, collectionVideoGapText, knowledgeCollectionVersion } from "@shared/knowledgeCollection";

const statusLabels: Record<string, string> = {
  queued: "排队中",
  running: "采集中",
  review_required: "待补录确认",
  confirmed: "已保存到知识库",
  failed: "采集失败",
  canceled: "已取消",
};
const recordGroups = [
  { id: "attention", title: "采集失败 / 待补录", statuses: ["failed", "review_required"] },
  { id: "active", title: "排队与采集中", statuses: ["queued", "running"] },
  { id: "canceled", title: "已取消", statuses: ["canceled"] },
  { id: "completed", title: "采集成功", statuses: ["confirmed"] },
];
const capabilityLabels: Record<string, string> = { catalog_basic: "商品基础信息", image_gallery: "主图/副图", aplus: "A+", brand_story: "品牌故事" };
const coverageLabels: Record<string, string> = {
  returned: "已取得并保存", not_returned: "本次未取得（不代表商品没有）",
  confirmed_absent: "已核实不存在", provider_unsupported: "暂不支持此类内容",
  download_failed: "部分图片下载失败", pending_supplement: "待人工补充",
  manually_supplemented: "已人工补充", not_requested: "本次未请求",
};

function ingestionStatusText(status: string, isQualification: boolean) {
  if (isQualification) return "资格记录";
  if (status === "confirmed") return "已保存到知识库";
  if (status === "failed") return "采集失败";
  if (status === "review_required") return "素材有缺失，请查看采集情况并确认入库";
  if (status === "queued" || status === "running") return "自动安全校验中（无需人工审核）";
  return "等待任务处理";
}

function formatDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function AcquisitionJobsPage() {
  const jobs = trpc.acquisition.listJobs.useQuery({ limit: 100, scope: "knowledge" }, {
    refetchInterval: query => query.state.data?.some(job => ["queued", "running"].includes(job.status)) ? 3000 : false,
  });
  const [showRepeat, setShowRepeat] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const coverage = trpc.acquisition.jobCoverage.useQuery({ jobId: selectedJobId ?? 1 }, { enabled: selectedJobId !== null });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">亚马逊图片采集</p>
          <h1 className="text-2xl font-semibold tracking-tight">图片采集任务</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">输入 ASIN，采集商品图片、A+ 和品牌故事。视频只采集第一个主图视频及 A+ 视频，首次下载失败自动重试一次；全部素材齐全后自动入库并打标签，有缺失则整套等待确认。</p>
        </div>
        <Button variant="outline" onClick={() => jobs.refetch()} disabled={jobs.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${jobs.isFetching ? "animate-spin" : ""}`} />刷新</Button>
      </div>

      <div className="grid gap-5">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><DatabaseZap className="h-5 w-5" />新建采集</CardTitle><CardDescription>使用系统自带采集，支持亚马逊美国站；如页面暂时无法访问，可稍后重试或手动上传。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <KnowledgeCollectionForm />
            <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">已采集或正在采集的 ASIN 自动排除。缺失的图片或视频可在对应位置单独补采、上传。点击“确认入库”后统一入库打标，仍缺失的位置保留空白提示。</p>
          </CardContent>
        </Card>


      </div>

      <Card>
        <CardHeader><CardTitle>任务记录</CardTitle><CardDescription>查看采集进度、已保存图片和需要补充的内容。</CardDescription></CardHeader>
        <CardContent>
          {jobs.isLoading ? <div className="flex h-36 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : jobs.error ? (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{jobs.error.message}</div>
          ) : !jobs.data?.length ? (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">尚无采集任务。输入 ASIN 即可开始采集。</div>
          ) : (
            <div className="space-y-7">
              {recordGroups.map(group => {
                const items = jobs.data.filter(job => group.id === "attention" ? collectionNeedsAttention(job)
                  : group.statuses.includes(job.status) && !collectionNeedsAttention(job));
                if (!items.length) return null;
                return <section key={group.id} aria-labelledby={`collection-${group.id}`} className="space-y-3">
                  <div className={`flex items-center gap-2 border-b pb-3 ${group.id === "attention" ? "text-amber-700 dark:text-amber-300" : ""}`}>
                    {group.id === "attention" ? <AlertCircle className="h-4 w-4" /> : group.id === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Clock3 className="h-4 w-4" />}
                    <h2 id={`collection-${group.id}`} className="text-sm font-semibold">{group.title}</h2>
                    <Badge variant="secondary">{items.length}</Badge>
                    {group.id === "completed" && <Button className="ml-auto" size="sm" variant="ghost" aria-expanded={showCompleted} onClick={()=>setShowCompleted(!showCompleted)}>{showCompleted ? "收起" : "展开"}</Button>}
                  </div>
              {(group.id !== "completed" || showCompleted) && items.map(job => {
                const isQualification = job.consumerType === "provider_qualification";
                const videoGaps = job.acceptedMissing ? "" : collectionVideoGapText(job);
                return (
                <div key={job.id} className="grid gap-3 rounded-xl border p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{isQualification ? "历史采集检查" : collectionDisplayAsin(job.asin, knowledgeCollectionVersion(job.consumerRef))}</span><Badge variant="outline">{job.marketplace}</Badge><Badge>{job.status === "confirmed" && videoGaps ? "视频待补录" : statusLabels[job.status] || job.status}</Badge>{job.cacheHitSnapshotId ? <Badge variant="secondary">使用最近图片</Badge> : null}</div><p className="mt-1 truncate text-xs text-muted-foreground">用途：{isQualification ? "仅验证受控能力，不进入任何业务分析" : "图片知识库"} · 创建于 {formatDate(job.requestedAt)}</p>{videoGaps && !["queued", "running", "canceled"].includes(job.status) && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">待补录：{videoGaps}{job.status === "confirmed" ? " · 图片已入库" : ""}</p>}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">{job.status === "running" || job.status === "queued" ? <Clock3 className="h-4 w-4" /> : job.status === "confirmed" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}</div>
                  <div className="flex flex-col items-end gap-2"><span className="text-right text-xs text-muted-foreground">{ingestionStatusText(job.status, isQualification)}</span>{job.status === "confirmed" && !isQualification ? <Button size="sm" variant="outline" onClick={() => setSelectedJobId(selectedJobId === job.id ? null : job.id)}>{selectedJobId === job.id ? "收起范围" : "查看入库范围与缺口"}</Button> : null}
                    {!isQualification && Number.isSafeInteger(job.id) && job.id > 0 && <Button asChild size="sm"><Link href={`/knowledge/acquisition/job/${job.id}`}>查看采集情况</Link></Button>}
                    {!isQualification && <AcquisitionRecordActions jobId={job.id} asin={collectionDisplayAsin(job.asin, knowledgeCollectionVersion(job.consumerRef))} status={job.status} />}
                  </div>
                  {selectedJobId === job.id && <div className="md:col-span-3 space-y-2 border-t pt-3 text-sm">
                    {coverage.isLoading ? <p>正在读取能力状态…</p> : coverage.error ? <p className="text-destructive">{coverage.error.message}</p> : !coverage.data?.coverage.length ? <p>该任务尚无可展示的确认快照。</p> : <>
                      {coverage.data.cacheExpired ? <p className="text-muted-foreground">临时缓存已过期，以下为本次采集的历史结果；已入库素材请到知识库查看。</p> : !coverage.data.isCurrent && <p className="text-amber-700">该快照已被更新版替代，请查看新任务的当前范围。</p>}
                      {coverage.data.coverage.map(item => <div key={item.capability} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2">
                        <span className="font-medium">{capabilityLabels[item.capability] ?? item.capability}</span>
                        <Badge variant={item.state === "returned" ? "secondary" : "outline"}>{coverageLabels[item.state] ?? item.state}</Badge>
                        {item.storedCount > 0 ? <span>已安全保存 {item.storedCount} 张</span> : null}
                        {item.failedCount > 0 ? <span className="text-amber-700">失败 {item.failedCount} 张</span> : null}
                      </div>)}
                    </>}
                  </div>}
                </div>
                );
              })}
                </section>;
              })}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-5">
        <div><p className="font-medium">已有商品更新了图片？</p><p className="mt-1 text-sm text-muted-foreground">重新采集并保存新版本，保留之前的套图。</p></div>
        <Button variant="outline" onClick={() => setShowRepeat(true)}><RefreshCw className="mr-2 h-4 w-4" />采集重复 ASIN</Button>
      </div>
      <Dialog open={showRepeat} onOpenChange={setShowRepeat}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>采集重复 ASIN</DialogTitle></DialogHeader>
          <KnowledgeCollectionForm mode="new_version" />
        </DialogContent>
      </Dialog>
    </div>
  );
}
