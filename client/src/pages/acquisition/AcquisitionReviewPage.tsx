import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Loader2, Save, ShieldAlert, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import AssetReviewGrid, { type AssetReviewStatus } from "./AssetReviewGrid";

function objectOf(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

export default function AcquisitionReviewPage() {
  const params = useParams<{ snapshotId: string }>();
  const snapshotId = Number(params.snapshotId);
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const review = trpc.acquisition.review.useQuery({ snapshotId }, { enabled: Number.isInteger(snapshotId) && snapshotId > 0 });
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [bullets, setBullets] = useState("");
  const [note, setNote] = useState("");
  const [assetReviews, setAssetReviews] = useState<Record<number, AssetReviewStatus>>({});

  useEffect(() => {
    if (!review.data) return;
    const base = objectOf(review.data.snapshot.normalizedData);
    const patch = objectOf(review.data.revision?.patch);
    const merged = { ...base, ...patch };
    setTitle(String(merged.title ?? ""));
    setBrand(String(merged.brand ?? ""));
    setCategory(String(merged.category ?? ""));
    setDescription(String(merged.description ?? ""));
    setBullets(Array.isArray(merged.bulletPoints) ? merged.bulletPoints.join("\n") : "");
    setNote(review.data.snapshot.reviewNote || "");
    setAssetReviews(Object.fromEntries(review.data.assets.map(asset => [asset.id, asset.reviewStatus as AssetReviewStatus])));
  }, [review.data]);

  const reviewItems = useMemo(() => review.data?.assets.map(asset => ({
    assetId: asset.id,
    reviewStatus: assetReviews[asset.id] || "pending",
  })).filter(item => item.reviewStatus !== "pending") as Array<{ assetId: number; reviewStatus: "approved" | "rejected" }> || [], [review.data, assetReviews]);
  const hasPendingAssets = review.data?.assets.some(asset => (assetReviews[asset.id] || "pending") === "pending") ?? true;
  const hasApprovedGallery = review.data?.assets.some(asset => ["main", "secondary"].includes(asset.role) && assetReviews[asset.id] === "approved") ?? false;

  const patch = {
    title: title.trim() || null,
    brand: brand.trim() || null,
    category: category.trim() || null,
    description: description.trim() || null,
    bulletPoints: bullets.split("\n").map(item => item.trim()).filter(Boolean),
  };
  const saveReview = trpc.acquisition.saveReview.useMutation({ onError: error => toast.error(error.message) });
  const confirmReview = trpc.acquisition.confirmReview.useMutation({ onError: error => toast.error(error.message) });
  const rejectReview = trpc.acquisition.rejectReview.useMutation({ onError: error => toast.error(error.message) });

  const handleSave = async () => {
    await saveReview.mutateAsync({ snapshotId, patch, assetReviews: reviewItems, note: note.trim() || null });
    toast.success("审核草稿已保存，原始Snapshot未被覆盖");
    await review.refetch();
  };
  const handleConfirm = async () => {
    if (hasPendingAssets) return toast.error("请先对全部图片选择保留或排除");
    if (!hasApprovedGallery) return toast.error("至少保留一张主图或辅图");
    await saveReview.mutateAsync({ snapshotId, patch, assetReviews: reviewItems, note: note.trim() || null });
    const confirmed = await confirmReview.mutateAsync({ snapshotId, note: note.trim() || null });
    if (confirmed.analysisJobStatus === "failed_to_queue") {
      toast.warning("确认版本已生成，但后续AI分析未能排队", {
        description: "Snapshot确认不会回滚，请稍后从AI任务中心重试分析。",
      });
    } else if (confirmed.analysisJobRunId) {
      toast.success("确认版本已生成，后续AI分析已排队");
    } else {
      toast.success("确认版本已生成，可供授权业务模块消费");
    }
    await utils.acquisition.listJobs.invalidate();
    navigate("/knowledge/acquisition");
  };
  const handleReject = async () => {
    if (!note.trim()) return toast.error("拒绝时必须填写原因");
    await rejectReview.mutateAsync({ snapshotId, note: note.trim() });
    toast.success("Snapshot已拒绝并停止向下游流转");
    await utils.acquisition.listJobs.invalidate();
    navigate("/knowledge/acquisition");
  };

  if (review.isLoading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  if (review.error || !review.data) return <div className="p-6"><Card><CardContent className="flex items-center gap-2 p-6 text-destructive"><ShieldAlert className="h-5 w-5" />{review.error?.message || "未找到可审核Snapshot"}</CardContent></Card></div>;
  const reviewAssets = review.data.assets;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div><Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => navigate("/knowledge/acquisition")}><ArrowLeft className="mr-2 h-4 w-4" />返回任务中心</Button><h1 className="text-2xl font-semibold">竞品采集人工审核</h1><p className="mt-1 text-sm text-muted-foreground">{review.data.snapshot.asin} · {review.data.snapshot.marketplace} · Snapshot #{review.data.snapshot.id}</p></div>
        <div className="flex gap-2"><Badge variant="outline">{review.data.snapshot.status}</Badge>{review.data.revision ? <Badge variant="secondary">修订 v{review.data.revision.version}</Badge> : null}</div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.4fr]">
        <Card>
          <CardHeader><CardTitle>基础信息</CardTitle><CardDescription>编辑会生成Revision，不覆盖Provider原始Snapshot。空字段保持“未返回”，不会自动解释为没有。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label>标题</Label><Textarea value={title} onChange={event => setTitle(event.target.value)} rows={3} /></div>
            <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>品牌</Label><Input value={brand} onChange={event => setBrand(event.target.value)} /></div><div className="space-y-2"><Label>类目</Label><Input value={category} onChange={event => setCategory(event.target.value)} /></div></div>
            <div className="space-y-2"><Label>描述</Label><Textarea value={description} onChange={event => setDescription(event.target.value)} rows={5} /></div>
            <div className="space-y-2"><Label>五点描述（每行一条）</Label><Textarea value={bullets} onChange={event => setBullets(event.target.value)} rows={7} /></div>
            <div className="space-y-2"><Label>审核备注</Label><Textarea value={note} onChange={event => setNote(event.target.value)} rows={3} placeholder="记录纠错依据或拒绝原因" /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>竞品证据图片</CardTitle><CardDescription>按主图、辅图、A+和品牌故事逐图审核；确认前必须处理全部图片。</CardDescription></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setAssetReviews(Object.fromEntries(reviewAssets.map(asset => [asset.id, asset.previewUrl ? "approved" : "rejected"]))) }><CheckCircle2 className="mr-1 h-4 w-4" />保留可用图片</Button><Button size="sm" variant="outline" onClick={() => setAssetReviews(Object.fromEntries(reviewAssets.map(asset => [asset.id, "rejected"]))) }><XCircle className="mr-1 h-4 w-4" />全部排除</Button></div></div></CardHeader>
          <CardContent><AssetReviewGrid assets={reviewAssets} reviews={assetReviews} onChange={(assetId, status) => setAssetReviews(current => ({ ...current, [assetId]: status }))} /></CardContent>
        </Card>
      </div>

      <div className="sticky bottom-4 flex flex-col gap-3 rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">待处理 {reviewAssets.filter(asset => (assetReviews[asset.id] || "pending") === "pending").length} 张 · 已保留 {reviewAssets.filter(asset => assetReviews[asset.id] === "approved").length} 张</div>
        <div className="flex gap-2"><Button variant="outline" onClick={handleSave} disabled={saveReview.isPending}><Save className="mr-2 h-4 w-4" />保存草稿</Button><Button variant="destructive" onClick={handleReject} disabled={rejectReview.isPending}>拒绝Snapshot</Button><Button onClick={handleConfirm} disabled={saveReview.isPending || confirmReview.isPending || hasPendingAssets || !hasApprovedGallery}>确认并授权消费</Button></div>
      </div>
    </div>
  );
}
