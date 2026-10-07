import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Clock3, DatabaseZap, Loader2, Play, RefreshCw, Settings2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const statusLabels: Record<string, string> = {
  queued: "排队中",
  running: "采集中",
  review_required: "历史入库未完成",
  confirmed: "已直接录入",
  failed: "失败关闭",
  canceled: "已取消",
};
const capabilityLabels: Record<string, string> = { catalog_basic: "商品基础信息", image_gallery: "主图/副图", aplus: "A+", brand_story: "品牌故事" };
const coverageLabels: Record<string, string> = {
  returned: "已取得并保存", not_returned: "本次未取得（不代表商品没有）",
  confirmed_absent: "已核实不存在", provider_unsupported: "当前Provider不支持",
  download_failed: "部分图片下载失败", pending_supplement: "待人工补充",
  manually_supplemented: "已人工补充", not_requested: "本次未请求",
};

function ingestionStatusText(status: string, isQualification: boolean) {
  if (isQualification) return "资格记录";
  if (status === "confirmed") return "已直接录入";
  if (status === "failed") return "失败关闭";
  if (status === "review_required") return "历史任务：可直接录入已安全保存的图片";
  if (status === "queued" || status === "running") return "自动安全校验中（无需人工审核）";
  return "等待任务处理";
}

function formatDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function AcquisitionJobsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const utils = trpc.useUtils();
  const jobs = trpc.acquisition.listJobs.useQuery({ limit: 50 });
  const profile = trpc.acquisition.providerProfile.useQuery(undefined, { enabled: isSuperAdmin });
  const [asin, setAsin] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [supplementCapability, setSupplementCapability] = useState<"image_gallery" | "aplus" | "brand_story" | null>(null);
  const coverage = trpc.acquisition.jobCoverage.useQuery({ jobId: selectedJobId ?? 1 }, { enabled: selectedJobId !== null });
  const [perRunMaxUsd, setPerRunMaxUsd] = useState("0.10");
  const [dailyBudgetUsd, setDailyBudgetUsd] = useState("5.00");
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState("100.00");
  const [profileStatus, setProfileStatus] = useState<"qualification_pending" | "active" | "paused" | "rejected">("active");

  useEffect(() => {
    if (!profile.data) return;
    setPerRunMaxUsd(String(profile.data.perRunMaxUsd ?? 0.1));
    setDailyBudgetUsd(String(profile.data.dailyBudgetUsd ?? 5));
    setMonthlyBudgetUsd(String(profile.data.monthlyBudgetUsd ?? 100));
    setProfileStatus(profile.data.status as typeof profileStatus);
  }, [profile.data]);

  const createJob = trpc.acquisition.createJob.useMutation({
    onSuccess: async (result) => {
      toast.success(result.cacheHitSnapshotId ? "已复用确认快照并直接录入" : "采集任务已进入持久化队列，完成后将自动直接录入");
      setAsin("");
      setSupplementCapability(null);
      await utils.acquisition.listJobs.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const saveProfile = trpc.acquisition.saveProviderProfile.useMutation({
    onSuccess: async () => {
      toast.success("Provider预算与状态已保存");
      await utils.acquisition.providerProfile.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const ingestLegacyPartial = trpc.acquisition.ingestLegacyPartialJob.useMutation({
    onSuccess: async (result) => {
      toast.success(result.partialIngestion
        ? `已直接入库 ${result.confirmedAssetCount} 张安全保存图片；${result.missingAssetCount} 张可人工补充或重新采集`
        : `已直接入库 ${result.confirmedAssetCount} 张图片`);
      await utils.acquisition.listJobs.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const handleCreate = () => {
    const normalizedAsin = asin.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(normalizedAsin)) return toast.error("请输入10位有效ASIN");
    createJob.mutate({
      consumerType: "competitor_monitor",
      consumerRef: `manual:${normalizedAsin}`,
      marketplace: "US",
      asin: normalizedAsin,
      capabilities: supplementCapability ? ["catalog_basic", supplementCapability] : ["catalog_basic", "image_gallery"],
      cachePolicy: "prefer_cache",
      maxChargeUsd: Number(perRunMaxUsd) || 0.1,
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">统一受控Amazon采集平台</p>
          <h1 className="text-2xl font-semibold tracking-tight">采集任务与直接录入</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">外部Provider先形成独立Snapshot；规范化通过后，已安全保存的图片立即直接录入。缺失图片保留为可见缺口，可人工补图或按预算重新采集；结构异常与无可用图库仍失败关闭。</p>
        </div>
        <Button variant="outline" onClick={() => jobs.refetch()} disabled={jobs.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${jobs.isFetching ? "animate-spin" : ""}`} />刷新</Button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><DatabaseZap className="h-5 w-5" />新建受控采集</CardTitle><CardDescription>首期仅US站公开商品基础信息、完整主图组及可获取的A+/品牌故事；不会采集评论、搜索词、Offers或卖家信息。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
              <div className="space-y-2"><Label htmlFor="asin">竞品ASIN</Label><Input id="asin" value={asin} onChange={event => setAsin(event.target.value.toUpperCase())} placeholder="10位美国站ASIN" maxLength={10} /></div>
              <div className="space-y-2"><Label htmlFor="maxCharge">单次最高费用（USD）</Label><Input id="maxCharge" type="number" min="0.01" max="100" step="0.01" value={perRunMaxUsd} onChange={event => setPerRunMaxUsd(event.target.value)} /></div>
              <Button onClick={handleCreate} disabled={createJob.isPending}><Play className="mr-2 h-4 w-4" />{createJob.isPending ? "入队中" : supplementCapability ? `确认补采${capabilityLabels[supplementCapability]}` : "创建任务"}</Button>
            </div>
            {supplementCapability ? <p className="text-xs text-amber-800">已预填本次缺口：{capabilityLabels[supplementCapability]}。请核对ASIN与单次最高费用后点击确认；预填不会自动创建任务。<Button size="sm" variant="link" onClick={() => setSupplementCapability(null)}>取消预填</Button></p> : null}
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />Provider失败时失败关闭，不会自动回退旧内嵌爬虫；24小时内同范围已确认快照默认复用，避免重复付费。</div>
          </CardContent>
        </Card>

        {isSuperAdmin && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5" />Provider治理</CardTitle><CardDescription>凭证仅通过受管Secret读取。本页只显示配置状态，不显示Token。</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3"><span className="text-sm">Apify凭证</span><Badge variant={profile.data?.secretConfigured ? "default" : "destructive"}>{profile.data?.secretConfigured ? "已配置" : "未配置"}</Badge></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>每日预算</Label><Input type="number" min="0.01" step="0.01" value={dailyBudgetUsd} onChange={event => setDailyBudgetUsd(event.target.value)} /></div>
                <div className="space-y-2"><Label>每月预算</Label><Input type="number" min="0.01" step="0.01" value={monthlyBudgetUsd} onChange={event => setMonthlyBudgetUsd(event.target.value)} /></div>
              </div>
              <div className="space-y-2"><Label>状态</Label><select className="h-10 w-full rounded-md border bg-muted px-3 text-sm" value={profileStatus} disabled><option value="active">启用（仅资格验证成功后自动切换）</option><option value="paused">暂停</option><option value="qualification_pending">待资格验证</option><option value="rejected">拒绝</option></select><p className="text-xs text-muted-foreground">为防止绕过费用与能力门禁，本页不能手动启用Provider；仅可保存预算。</p></div>
              <Button className="w-full" variant="outline" disabled={saveProfile.isPending || profile.isLoading || !profile.data} onClick={() => saveProfile.mutate({
                displayName: "Apify Amazon主Provider",
                actorName: "junglee/Amazon-crawler",
                status: profileStatus,
                capabilities: profile.data?.capabilities ?? ["catalog_basic", "image_gallery"],
                perRunMaxUsd: Number(perRunMaxUsd) || 0.1,
                dailyBudgetUsd: Number(dailyBudgetUsd) || 5,
                monthlyBudgetUsd: Number(monthlyBudgetUsd) || 100,
                cacheTtlSeconds: 86400,
              })}>保存Provider策略</Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>任务记录</CardTitle><CardDescription>Job/Run、费用、失败类别、来源哈希与直接录入状态均保留审计记录。</CardDescription></CardHeader>
        <CardContent>
          {jobs.isLoading ? <div className="flex h-36 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : jobs.error ? (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{jobs.error.message}</div>
          ) : !jobs.data?.length ? (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">尚无采集任务。创建任务后将进入持久化队列。</div>
          ) : (
            <div className="space-y-3">
              {jobs.data.map((job: any) => {
                const isQualification = job.consumerType === "provider_qualification";
                return (
                <div key={job.id} className="grid gap-3 rounded-xl border p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{isQualification ? "Provider 技术资格验证（样本已脱敏）" : job.asin}</span><Badge variant="outline">{job.marketplace}</Badge><Badge>{statusLabels[job.status] || job.status}</Badge>{job.cacheHitSnapshotId ? <Badge variant="secondary">缓存命中</Badge> : null}</div><p className="mt-1 truncate text-xs text-muted-foreground">用途：{isQualification ? "仅验证受控能力，不进入任何业务分析" : `${job.consumerType} · ${job.consumerRef}`} · 创建于 {formatDate(job.createdAt)}</p></div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">{job.status === "running" || job.status === "queued" ? <Clock3 className="h-4 w-4" /> : job.status === "confirmed" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}<span>上限 ${job.maxChargeUsd}</span></div>
                  <div className="flex flex-col items-end gap-2"><span className="text-right text-xs text-muted-foreground">{ingestionStatusText(job.status, isQualification)}</span>{job.status === "confirmed" && !isQualification ? <Button size="sm" variant="outline" onClick={() => setSelectedJobId(selectedJobId === job.id ? null : job.id)}>{selectedJobId === job.id ? "收起范围" : "查看入库范围与缺口"}</Button> : null}{job.status === "review_required" && !isQualification ? <Button size="sm" variant="outline" onClick={() => ingestLegacyPartial.mutate({ jobId: job.id })} disabled={ingestLegacyPartial.isPending}><DatabaseZap className="mr-1 h-3.5 w-3.5" />直接入库已保存图片</Button> : null}</div>
                  {selectedJobId === job.id && <div className="md:col-span-3 space-y-2 border-t pt-3 text-sm">
                    {coverage.isLoading ? <p>正在读取能力状态…</p> : coverage.error ? <p className="text-destructive">{coverage.error.message}</p> : !coverage.data?.coverage.length ? <p>该任务尚无可展示的确认快照。</p> : <>
                      {!coverage.data.isCurrent && <p className="text-amber-700">该快照已被更新版替代，请查看新任务的当前范围。</p>}
                      {coverage.data.coverage.map(item => <div key={item.capability} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2">
                        <span className="font-medium">{capabilityLabels[item.capability] ?? item.capability}</span>
                        <Badge variant={item.state === "returned" ? "secondary" : "outline"}>{coverageLabels[item.state] ?? item.state}</Badge>
                        {item.storedCount > 0 ? <span>已安全保存 {item.storedCount} 张</span> : null}
                        {item.failedCount > 0 ? <span className="text-amber-700">失败 {item.failedCount} 张</span> : null}
                        {coverage.data?.isCurrent && ["image_gallery", "aplus", "brand_story"].includes(item.capability) && ["not_requested", "not_returned", "download_failed"].includes(item.state) ? <Button size="sm" variant="outline" onClick={() => { setAsin(job.asin); setSupplementCapability(item.capability as "image_gallery" | "aplus" | "brand_story"); toast.info("已预填缺口，请到新建受控采集区核对费用后手动创建"); }}>预填补采</Button> : null}
                      </div>)}
                    </>}
                  </div>}
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
