import { useParams, useLocation, Link } from "wouter";
import { toast } from "sonner";
import MissingAssetActions from "./MissingAssetActions";
import AcquisitionRecordActions from "./AcquisitionRecordActions";
import { ArrowLeft, CheckCircle2, ImageIcon, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { collectionVideoGapText } from "@shared/knowledgeCollection";

const roleLabels: Record<string, string> = { main: "主图", secondary: "副图", aplus: "A+", brand_story: "品牌故事", video: "视频" };
const statusLabels: Record<string, string> = { queued: "排队中", running: "采集中", confirmed: "采集完成", failed: "采集失败", canceled: "已取消", review_required: "待补充" };
export default function AcquisitionJobDetailsPage() {
  const [, navigate] = useLocation();
  const { jobId } = useParams<{ jobId: string }>();
  const id = Number(jobId);
  const query = trpc.acquisition.jobDetails.useQuery({ jobId: id }, {
    enabled: Number.isSafeInteger(id) && id > 0,
    refetchInterval: state => ["queued", "running"].includes(state.state.data?.status ?? "") || Boolean(state.state.data?.repair) || ["queued", "running"].includes(state.state.data?.tagging?.status ?? "") ? 2500 : false,
  });
  const confirm = trpc.acquisition.confirmCompletedCollection.useMutation({
    onSuccess: () => { toast.success("已入库，小酷正在自动打标签"); void query.refetch(); },
    onError: error => toast.error(error.message),
  });
  const data = query.data;
  if (query.isLoading) return <div className="p-8 flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />正在读取采集情况…</div>;
  if (!data || query.error) return <div className="p-8 space-y-4"><p role="alert">采集情况暂时无法读取，请刷新重试。</p><Button onClick={() => query.refetch()}>重新读取</Button><Link href="/knowledge/acquisition">返回采集任务</Link></div>;
  const active = ["queued", "running"].includes(data.status);
  const progress = data.total ? Math.round(100 * data.completed / data.total) : 0;
  const videoGaps = collectionVideoGapText(data);
  return <div className="p-6 space-y-5 max-w-7xl mx-auto">
    <Link href="/knowledge/acquisition" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" />返回采集任务</Link>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">{data.asin} <span className="text-muted-foreground font-normal">采集情况</span></h1><p className="mt-2 text-sm text-muted-foreground max-w-3xl">{data.title || "正在读取商品页面与图片结构"}</p></div>
      <div className="flex flex-wrap items-center gap-2"><AcquisitionRecordActions jobId={id} asin={data.asin} status={data.status} onDeleted={() => navigate("/knowledge/acquisition")} /><Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw className="h-4 w-4 mr-2" />刷新</Button>
        {data.status === "confirmed" && <Button asChild><Link href="/knowledge/images">查看图片知识库</Link></Button>}
      </div>
    </header>
    {!active && data.status !== "canceled" && !data.acceptedMissing && videoGaps && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-2">
      <p className="font-medium">视频待补录：{videoGaps}</p>
      <p>{data.status === "confirmed" ? "图片已入库，已保存的图片、视频和标签保持不变。" : "已保存的素材会保留。"}本任务已列入“采集失败 / 待补录”。</p>
      {!data.cacheExpiredAt && <a href="#collection-videos" className="inline-block underline underline-offset-4">查看未取得的视频</a>}
    </div>}
    {data.cacheExpiredAt && <div role="status" className="rounded-lg border bg-muted/30 p-4 text-sm">
      临时采集缓存已过期，采集历史和结果仍保留。已入库的图片、视频和标签可在知识库查看。
    </div>}
    {data.status === "review_required" && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm space-y-3">
      <p>{data.failed ? "图片或视频尚有缺失，整套暂未入库、未打标。可在对应位置补采或上传，也可确认接受缺失后入库。" : "素材已补齐。确认后统一入库并自动打标签。"}</p>
      <Button disabled={!data.canConfirm || confirm.isPending || Boolean(data.repair)} onClick={() => confirm.mutate({jobId:id})}>{confirm.isPending ? "正在入库…" : "确认入库"}</Button>
    </div>}
    {data.repair && <p role="status" className="rounded-lg border bg-muted/30 p-4 text-sm">正在补采缺失部分，已保存素材保持不变。{data.repair.progress}%</p>}
    {Boolean(data.acceptedMissing) && <p className="text-sm text-muted-foreground">已确认接受缺失并入库。缺失位置保留空白占位，本任务按成功处理。</p>}
    <Card><CardContent className="pt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3"><Badge variant={data.status === "failed" ? "destructive" : "secondary"}>{statusLabels[data.status] || "待处理"}</Badge>
        <span className="text-sm text-muted-foreground">{active ? data.total ? `正在保存图片与视频 ${data.completed} / ${data.total}` : "正在获取页面，识别主图、A+ 和品牌故事，进度会自动更新。" : `已保存 ${data.stored} 项 · 未取得 ${data.failed} 项`}</span>
      </div>
      {active && <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-label="图片保存进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="h-full bg-primary transition-all" style={{ width: `${Math.max(3, progress)}%` }} /></div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[["发现素材", data.total], ["已保存", data.stored], ["自动重试", data.retried], ["重试后补回", data.recovered]].map(([label, value]) => <div key={label} className="rounded-lg bg-muted/50 px-4 py-3"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold mt-1">{value}</p></div>)}</div>
      <p className="text-sm text-muted-foreground">图片和视频下载失败会自动重试一次。全部取得后自动入库；仍有任何缺失时，整套等待确认。补采只处理缺失位置。确认后，缺失位置保留空白并提示缺失图片或视频。</p>
      {data.tagging && <div className="rounded-lg bg-muted/40 p-3 text-sm" role="status">
        <p className="font-medium">小酷自动打标签 · {({ queued: "排队中", running: "正在打标签", completed: "已完成", failed: "部分标签未完成", waiting: "等待打标签" })[data.tagging.status]}</p>
        <p className="mt-1 text-muted-foreground">整套标签{data.tagging.setCompleted ? "已完成" : "待完成"}；单图/模块标签已完成 {data.tagging.completed} / {data.tagging.total} 个。主图、副图逐张打标；A+ 每个完整模块一组标签，保存到第一张图。品牌故事不打标签，视频单独打标；已有标签及人工确认内容保留。{data.tagging.status === "failed" || data.tagging.status === "waiting" ? "尚未完成的内容可在知识库查看，管理员可检查小酷的模型配置和执行记录。" : ""}</p>
      </div>}
      {data.status === "failed" && <p className="text-sm text-destructive">本次未完成采集。页面可能暂时无法访问，已取得的图片会在下方保留，请稍后重新采集或人工补图。</p>}
    </CardContent></Card>
    {!data.cacheExpiredAt && Object.entries(roleLabels).map(([role, label]) => {
      const assets = data.assets.filter(asset => asset.role === role);
      return <Card key={role} id={role === "video" ? "collection-videos" : undefined} className="scroll-mt-6"><CardHeader className="py-4"><CardTitle className="text-base flex items-center gap-2">{label}<Badge variant="outline">{assets.filter(asset => asset.status === "saved").length} 项已保存</Badge>{role === "video" && videoGaps && <Badge variant="outline" className="text-amber-700">待补录：{videoGaps}</Badge>}</CardTitle></CardHeader>
        <CardContent>{!assets.length ? <p className="text-sm text-muted-foreground">{active ? "等待识别或下载…" : "本次未取得此类素材。"}</p> : <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3">{assets.map(asset => <div key={asset.id} className="border rounded-lg overflow-hidden">
          <div className="aspect-square bg-muted/30 flex items-center justify-center">{asset.previewUrl ? <img loading="lazy" decoding="async" className="h-full w-full object-contain" src={asset.previewUrl} alt={`${label} ${asset.position + 1}`} /> : <ImageIcon className="h-8 w-8 text-muted-foreground" />}</div>
          <div className="p-2 text-xs space-y-1"><p className="font-medium">{asset.label || label} {asset.position + 1}</p><p className={asset.status === "saved" ? "text-emerald-700 flex items-center gap-1" : "text-amber-700"}>{asset.status === "saved" ? <><CheckCircle2 className="h-3 w-3" />{asset.manuallySupplemented ? "已人工补齐" : (asset.attempts ?? 0) > 1 ? "重试后已保存" : "已保存"}</> : (asset.attempts ?? 0) > 1 ? "已重试，仍未取得" : "下载失败"}</p>{asset.status === "failed" && asset.failureReason && <p className="text-muted-foreground">{asset.failureReason}</p>}{data.canSupplement && asset.status === "failed" && <MissingAssetActions jobId={id} assetId={asset.id} video={asset.role === "video"} disabled={active || Boolean(data.repair) || confirm.isPending} onSaved={()=>{void query.refetch();}}/>}</div>
        </div>)}</div>}</CardContent></Card>;
    })}
  </div>;
}
