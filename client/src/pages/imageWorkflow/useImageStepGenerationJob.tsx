import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { useDistillationGuidance } from "@/contexts/DistillationGuidanceContext";
import { AlertCircle, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type ImageGenerationStep = 0 | 1 | 2 | 3;

const STEP_LABELS: Record<ImageGenerationStep, string> = {
  0: "竞品图片分析",
  1: "卖点梳理",
  2: "图片大纲",
  3: "风格推荐",
};

const isActive = (status?: string | null) => status === "queued" || status === "running";

export function shouldApplyCompletedImageStepOutput(input: {
  wasActive: boolean;
  status?: string | null;
  output?: any;
}) {
  return input.wasActive && input.status === "succeeded" && Boolean(input.output) && !input.output?.skipped;
}

function formatError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "任务执行失败");
  if (/<!doctype\s+html|<html[\s>]/i.test(message)) return "上游服务返回异常页面，任务已按后台重试策略处理";
  return message.length > 360 ? `${message.slice(0, 360)}...` : message;
}

export function useImageStepGenerationJob(input: {
  projectId: number;
  step: ImageGenerationStep;
  onSucceeded: (output: any) => void;
  onRefresh?: () => void | Promise<unknown>;
}) {
  const distillationBinding = useDistillationGuidance();
  const startMutation = trpc.imageWorkflow.startStepGeneration.useMutation();
  const cancelMutation = trpc.imageWorkflow.cancelStepGeneration.useMutation();
  const utils = trpc.useUtils();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const handledRef = useRef(new Set<string>());
  const onSucceededRef = useRef(input.onSucceeded);
  const onRefreshRef = useRef(input.onRefresh);
  onSucceededRef.current = input.onSucceeded;
  onRefreshRef.current = input.onRefresh;

  const runQuery = trpc.imageWorkflow.getStepGenerationRun.useQuery(
    { projectId: input.projectId, step: input.step },
    { refetchInterval: (query) => isActive((query.state.data as any)?.status) ? 2_000 : false },
  );
  const run = runQuery.data as any;
  const generating = startMutation.isPending || isActive(run?.status);

  useEffect(() => {
    if (!run?.runId) return;
    if (isActive(run.status)) {
      setActiveRunId((current) => current || run.runId);
      return;
    }
    const terminalKey = `${run.runId}:${run.status}`;
    if (handledRef.current.has(terminalKey)) return;
    handledRef.current.add(terminalKey);
    const wasActive = activeRunId === run.runId;
    setActiveRunId(null);
    if (run.status === "succeeded" && run.output && !run.output.skipped) {
      // 页面刷新后会读取到历史已完成任务。它们只能用于审计，不能重新写入本地编辑态，
      // 否则会把用户后来保存的多图A+草稿覆盖成旧AI版本。
      if (shouldApplyCompletedImageStepOutput({ wasActive, status: run.status, output: run.output })) {
        onSucceededRef.current(run.output);
        void utils.imageWorkflow.getSession.invalidate({ projectId: input.projectId });
        void onRefreshRef.current?.();
        toast.success(`${STEP_LABELS[input.step]}完成，请检查并确认`);
      }
    } else if (run.status === "failed" && (wasActive || !run.output)) {
      toast.error(formatError(run.error));
    } else if (run.status === "canceled" && wasActive) {
      toast.info(`${STEP_LABELS[input.step]}任务已取消`);
    }
  }, [activeRunId, input.projectId, input.step, run, utils.imageWorkflow.getSession]);

  const start = useCallback(async () => {
    try {
      const job = await startMutation.mutateAsync({
        projectId: input.projectId,
        step: input.step,
        ...(distillationBinding?.ledgerKey || distillationBinding?.skillSlugs?.length ? { distillationBinding } : {}),
      });
      setActiveRunId(job.runId);
      await runQuery.refetch();
      toast.success(job.status === "running" ? `${STEP_LABELS[input.step]}正在后台执行` : `${STEP_LABELS[input.step]}已进入后台队列`);
      return job;
    } catch (error) {
      toast.error(formatError(error));
      return null;
    }
  }, [distillationBinding, input.projectId, input.step, runQuery, startMutation]);

  const cancel = useCallback(async () => {
    try {
      await cancelMutation.mutateAsync({ projectId: input.projectId, step: input.step });
      setActiveRunId(null);
      await runQuery.refetch();
      toast.info(`${STEP_LABELS[input.step]}任务已取消`);
    } catch (error) {
      toast.error(formatError(error));
    }
  }, [cancelMutation, input.projectId, input.step, runQuery]);

  return {
    run,
    isGenerating: generating,
    isStarting: startMutation.isPending,
    isCanceling: cancelMutation.isPending,
    start,
    cancel,
    refetch: runQuery.refetch,
  };
}

export function ImageStepGenerationStatus({
  run,
  isGenerating,
  isCanceling,
  onCancel,
  onRetry,
}: {
  run: any;
  isGenerating: boolean;
  isCanceling: boolean;
  onCancel: () => void;
  onRetry: () => void;
}) {
  if (!run || (!isGenerating && run.status !== "failed" && run.status !== "canceled")) return null;
  const queued = run.status === "queued";
  const retrying = queued && Number(run.attempt || 0) > 0 && Boolean(run.error);
  const failed = run.status === "failed";
  return (
    <div className={`mx-6 mb-5 rounded-md border p-3 ${failed ? "border-red-200 bg-red-50" : "border-blue-200 bg-blue-50"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            {failed ? <AlertCircle className="h-4 w-4 text-red-600" /> : <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
            {failed ? "后台任务失败" : retrying ? "等待自动重试" : queued ? "任务排队中" : "皇帝 Skill 正在后台执行"}
            <span className="text-xs font-normal text-muted-foreground">
              第 {Math.max(Number(run.attempt || 0), 1)}/{Number(run.maxAttempts || 1)} 次
            </span>
          </div>
          {failed ? (
            <p className="mt-1 text-xs text-red-700">{formatError(run.error)}</p>
          ) : (
            <Progress value={Number(run.progress || 5)} className="mt-2 h-1.5" />
          )}
        </div>
        {isGenerating ? (
          <Button variant="outline" size="sm" onClick={onCancel} disabled={isCanceling}>
            <XCircle className="mr-1 h-3.5 w-3.5" />取消
          </Button>
        ) : failed ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />重新生成
          </Button>
        ) : null}
      </div>
    </div>
  );
}
