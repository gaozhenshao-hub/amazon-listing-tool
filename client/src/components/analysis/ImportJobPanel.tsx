import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export type ImportJobView = {
  runId: string;
  kind: string;
  filename: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  progress: number;
  result: unknown;
  error: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type ImportJobFailure = { asin: string; code: string; message: string; retryable: boolean };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function getImportJobOutcome(job: ImportJobView) {
  const result = record(job.result);
  const rows = Array.isArray(result.results) ? result.results.map(record) : [];
  const failures: ImportJobFailure[] = rows.filter(row => row.status === "failed").map(row => {
    const failure = record(row.failure);
    return {
      asin: String(row.asin || "未识别 ASIN"),
      code: String(failure.code || "ANALYSIS_FAILED"),
      message: String(failure.message || row.error || "本条分析未完成，请查看任务错误。"),
      retryable: failure.retryable === true,
    };
  });
  const succeeded = typeof result.succeeded === "number"
    ? result.succeeded
    : rows.filter(row => ["matched", "new", "success"].includes(String(row.status))).length;
  const failed = Math.max(typeof result.failed === "number" ? result.failed : 0, failures.length);
  const active = job.status === "queued" || job.status === "running";
  const complete = job.status === "succeeded" && failed === 0;
  return { failures, succeeded, failed, active, complete };
}

export function ImportJobPanel({ jobs, isLoading, error, onRefresh }: {
  jobs: ImportJobView[];
  isLoading: boolean;
  error?: string | null;
  onRefresh: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">后台导入任务</CardTitle>
          <Button variant="ghost" size="sm" onClick={onRefresh} aria-label="刷新导入任务">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <CardDescription>任务提交后在后台执行，刷新或离开页面后仍可回来查看。系统不会自动重试失败分析。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            暂时无法更新任务状态：{error}。已提交任务仍在后台继续，请稍后刷新状态，勿重复提交文件。
          </div>
        )}
        {isLoading && <p className="text-sm text-muted-foreground">正在读取后台任务…</p>}
        {!isLoading && !jobs.length && !error && <p className="text-sm text-muted-foreground">暂无导入任务，提交后将在这里显示进度。</p>}
        {jobs.map(job => {
          const outcome = getImportJobOutcome(job);
          const statusText = job.status === "queued" ? "后台排队中"
            : job.status === "running" ? "后台分析中"
              : outcome.complete ? "全部完成"
                : outcome.succeeded > 0 ? "部分完成"
                  : job.status === "canceled" ? "已停止" : "未完成";
          const progress = Math.max(0, Math.min(100, job.progress || 0));
          return (
            <div key={job.runId} className="space-y-2 rounded-lg border p-3" data-testid="import-job-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium">{job.filename}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {job.kind === "reviews" ? "评论导入" : "卖家精灵"} · {new Date(job.createdAt).toLocaleString("zh-CN")}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 gap-1">
                  {job.status === "queued" ? <Clock className="h-3 w-3" />
                    : outcome.active ? <Loader2 className="h-3 w-3 animate-spin" />
                      : outcome.complete ? <CheckCircle2 className="h-3 w-3 text-green-600" />
                        : <AlertTriangle className="h-3 w-3 text-amber-600" />}
                  {statusText}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Progress value={progress} className="h-1.5" aria-label={`${job.filename} 处理进度`} />
                <span className="text-xs tabular-nums text-muted-foreground">{progress}%</span>
              </div>
              {(outcome.succeeded > 0 || outcome.failed > 0) && (
                <p className="text-xs">已完成 {outcome.succeeded} 条 · 未完成 {outcome.failed} 条</p>
              )}
              {job.error && <p className="break-words text-xs text-amber-800">{job.error}</p>}
              {outcome.failures.length > 0 && (
                <ul className="max-h-48 space-y-2 overflow-y-auto rounded-md bg-amber-50 p-2" aria-label="逐 ASIN 失败详情">
                  {outcome.failures.map((failure, index) => (
                    <li key={`${failure.asin}-${index}`} className="break-words text-xs text-amber-950">
                      <span className="font-mono font-medium">{failure.asin}</span>：{failure.message}
                      <span className="ml-1 text-amber-700">（{failure.retryable ? "可人工重试" : "请先检查原因"}）</span>
                    </li>
                  ))}
                </ul>
              )}
              {!outcome.active && !outcome.complete && (
                <p className="text-xs text-muted-foreground">请检查失败原因后再手动提交；如果已刷新或切换项目，请重新选择原文件。</p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
