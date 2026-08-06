import { useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, History, RefreshCw, RotateCcw, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
};

const STATUS_STYLES: Record<string, string> = {
  queued: "border-amber-200 bg-amber-50 text-amber-700",
  running: "border-blue-200 bg-blue-50 text-blue-700",
  succeeded: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  canceled: "border-slate-200 bg-slate-50 text-slate-600",
};

function formatTime(value: unknown) {
  if (!value) return "时间未知";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function jobName(job: { kind?: string; procedure?: string | null; skillSlug?: string | null }) {
  return job.skillSlug || job.procedure || job.kind || "AI 长任务";
}

export function AiJobHistoryPanel({
  module,
  projectId,
  title = "AI Job 历史",
  className,
}: {
  module: string;
  projectId?: number | null;
  title?: string;
  className?: string;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const jobsQuery = trpc.aiJobs.list.useQuery(
    { module, projectId: projectId || undefined, limit: 20 },
    { refetchInterval: open ? 4_000 : false },
  );
  const cancelJob = trpc.aiJobs.cancel.useMutation({
    onSuccess: async () => {
      toast.success("任务已取消");
      await utils.aiJobs.list.invalidate();
    },
    onError: (error) => toast.error(error.message || "取消失败"),
  });
  const retryJob = trpc.aiJobs.retry.useMutation({
    onSuccess: async () => {
      toast.success("已创建恢复任务，原失败记录仍会保留");
      await utils.aiJobs.list.invalidate();
    },
    onError: (error) => toast.error(error.message || "恢复失败"),
  });
  const jobs = useMemo(() => jobsQuery.data || [], [jobsQuery.data]);
  const activeCount = useMemo(
    () => jobs.filter((job) => job.status === "queued" || job.status === "running").length,
    [jobs],
  );
  const failedCount = useMemo(
    () => jobs.filter((job) => job.status === "failed").length,
    [jobs],
  );

  const toggleDetails = (runId: string) => {
    setExpandedJobs((current) => {
      const next = new Set(current);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  return (
    <section className={cn("rounded-lg border bg-background", className)} data-testid="ai-job-history">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{title}</span>
          {activeCount > 0 && <Badge variant="outline">进行中 {activeCount}</Badge>}
          {failedCount > 0 && <Badge variant="outline" className="border-red-200 text-red-700">失败 {failedCount}</Badge>}
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="space-y-3 border-t px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">记录保留执行进度、重试次数、错误详情和恢复关系。</p>
            <Button size="icon" variant="ghost" title="刷新任务历史" onClick={() => jobsQuery.refetch()}>
              <RefreshCw className={cn("h-4 w-4", jobsQuery.isFetching && "animate-spin")} />
            </Button>
          </div>
          {jobs.map((job) => {
            const active = job.status === "queued" || job.status === "running";
            const recoverable = job.status === "failed" || job.status === "canceled";
            const expanded = expandedJobs.has(job.runId);
            return (
              <div key={job.runId} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{jobName(job)}</span>
                      <Badge variant="outline" className={STATUS_STYLES[job.status] || ""}>
                        {STATUS_LABELS[job.status] || job.status}
                      </Badge>
                      {job.recoveryOfRunId && <Badge variant="outline">失败恢复任务</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatTime(job.createdAt)} · 第 {Math.max(job.attempt, 0)}/{job.maxAttempts} 次尝试 · 超时 {job.timeoutSeconds} 秒
                    </p>
                    {active && <Progress value={job.progress} className="mt-2 h-1.5" />}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => toggleDetails(job.runId)}>
                      <AlertCircle className="h-4 w-4" />详情
                    </Button>
                    {active && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={cancelJob.isPending}
                        onClick={() => cancelJob.mutate({ runId: job.runId, reason: "用户从任务历史取消" })}
                      >
                        <Square className="h-4 w-4" />取消
                      </Button>
                    )}
                    {recoverable && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retryJob.isPending}
                        onClick={() => retryJob.mutate({ runId: job.runId, reason: "用户从任务历史恢复" })}
                      >
                        <RotateCcw className="h-4 w-4" />恢复任务
                      </Button>
                    )}
                  </div>
                </div>
                {expanded && (
                  <div className="mt-3 grid gap-2 border-t pt-3 text-xs sm:grid-cols-2">
                    <div><span className="text-muted-foreground">队列：</span>{job.queueName}</div>
                    <div><span className="text-muted-foreground">开始：</span>{formatTime(job.startedAt)}</div>
                    <div><span className="text-muted-foreground">结束：</span>{formatTime(job.completedAt)}</div>
                    <div><span className="text-muted-foreground">下一次尝试：</span>{formatTime(job.nextRunAt)}</div>
                    {(job.error || job.deadLetterReason) && (
                      <div className="sm:col-span-2 rounded-md bg-red-50 p-2 text-red-700">
                        {job.deadLetterReason || job.error}
                      </div>
                    )}
                    {job.recoveryReason && (
                      <div className="sm:col-span-2 rounded-md bg-muted p-2">
                        恢复原因：{job.recoveryReason}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!jobsQuery.isLoading && jobs.length === 0 && (
            <p className="py-5 text-center text-sm text-muted-foreground">暂无后台任务记录</p>
          )}
        </div>
      )}
    </section>
  );
}
