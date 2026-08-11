import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { AlertCircle, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type ListingGenerationOperation =
  | "sellingPoints"
  | "singleBullet"
  | "bullets"
  | "title"
  | "description"
  | "searchTerms"
  | "qa"
  | "batch";

export type ListingGenerationNodeId = "G1" | "G2" | "G3" | "G4" | "G5";

const OPERATION_LABELS: Record<ListingGenerationOperation, string> = {
  sellingPoints: "卖点核心",
  singleBullet: "单条五点描述",
  bullets: "五点描述",
  title: "标题",
  description: "产品描述",
  searchTerms: "后台搜索词",
  qa: "QA问答",
  batch: "Listing批量五步",
};

const isActive = (status?: string | null) => status === "queued" || status === "running";

function formatError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "任务执行失败");
  if (/<!doctype\s+html|<html[\s>]/i.test(message)) return "上游服务返回异常页面，后台任务将按策略重试";
  return message.length > 360 ? `${message.slice(0, 360)}...` : message;
}

export function useListingGenerationJob(input: {
  projectId: number;
  nodeId: ListingGenerationNodeId;
  operation: ListingGenerationOperation;
  scopeKey?: string;
  onSucceeded: (output: any, job: any) => void;
}) {
  const startMutation = trpc.listing.startGenerationJob.useMutation();
  const cancelMutation = trpc.listing.cancelGenerationJob.useMutation();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const handledRef = useRef(new Set<string>());
  const onSucceededRef = useRef(input.onSucceeded);
  onSucceededRef.current = input.onSucceeded;

  const runQuery = trpc.listing.getGenerationRun.useQuery(
    { projectId: input.projectId, nodeId: input.nodeId, scopeKey: input.scopeKey || "main" },
    {
      enabled: input.projectId > 0,
      refetchInterval: (query) => isActive((query.state.data as any)?.status) ? 2_000 : false,
    },
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
      onSucceededRef.current(run.output, run);
      if (wasActive) toast.success(`${OPERATION_LABELS[input.operation]}生成完成，请检查并确认`);
    } else if (run.status === "failed" && (wasActive || !run.output)) {
      toast.error(formatError(run.error));
    } else if (run.status === "canceled" && wasActive) {
      toast.info(`${OPERATION_LABELS[input.operation]}任务已取消`);
    }
  }, [activeRunId, input.operation, run]);

  const start = useCallback(async (payload: Record<string, unknown> = {}) => {
    if (input.projectId <= 0) return null;
    try {
      const job = await startMutation.mutateAsync({
        projectId: input.projectId,
        nodeId: input.nodeId,
        operation: input.operation,
        scopeKey: input.scopeKey || "main",
        ...payload,
      } as any);
      setActiveRunId(job.runId);
      await runQuery.refetch();
      toast.success(job.status === "running"
        ? `${OPERATION_LABELS[input.operation]}正在后台执行`
        : `${OPERATION_LABELS[input.operation]}已进入后台队列`);
      return job;
    } catch (error) {
      toast.error(formatError(error));
      return null;
    }
  }, [input.nodeId, input.operation, input.projectId, input.scopeKey, runQuery, startMutation]);

  const cancel = useCallback(async () => {
    try {
      await cancelMutation.mutateAsync({
        projectId: input.projectId,
        nodeId: input.nodeId,
        scopeKey: input.scopeKey || "main",
      });
      setActiveRunId(null);
      await runQuery.refetch();
      toast.info(`${OPERATION_LABELS[input.operation]}任务已取消`);
    } catch (error) {
      toast.error(formatError(error));
    }
  }, [cancelMutation, input.nodeId, input.operation, input.projectId, input.scopeKey, runQuery]);

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

export function ListingGenerationJobStatus({
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
    <div className={`rounded-md border p-3 ${failed ? "border-red-200 bg-red-50" : "border-blue-200 bg-blue-50"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            {failed ? <AlertCircle className="h-4 w-4 text-red-600" /> : <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
            {failed ? "后台任务失败" : retrying ? "等待自动重试" : queued ? "任务排队中" : "皇帝 Skill 正在后台执行"}
            <span className="text-xs font-normal text-muted-foreground">
              第 {Math.max(Number(run.attempt || 0), 1)}/{Number(run.maxAttempts || 1)} 次
            </span>
          </div>
          {failed ? <p className="mt-1 text-xs text-red-700">{formatError(run.error)}</p> : (
            <Progress value={Number(run.progress || 5)} className="mt-2 h-1.5" />
          )}
        </div>
        {isGenerating ? (
          <Button variant="outline" size="sm" onClick={onCancel} disabled={isCanceling}>
            <XCircle className="mr-1 h-3.5 w-3.5" />取消
          </Button>
        ) : failed || run.status === "canceled" ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />重新生成
          </Button>
        ) : null}
      </div>
    </div>
  );
}
