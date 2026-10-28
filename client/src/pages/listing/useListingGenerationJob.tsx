import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { AlertCircle, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

export type ListingRequestOwner = { userId: number; workspaceId: number | null; role: string; projectId: number };
type UserIdentity = { id?: unknown; defaultWorkspaceId?: unknown; role?: unknown } | null | undefined;
export function listingIdentity(user: UserIdentity): Omit<ListingRequestOwner, "projectId"> | null {
  if (!user || typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.role !== "string" || !user.role) return null;
  const workspaceId = user.defaultWorkspaceId;
  if (workspaceId !== null && (typeof workspaceId !== "number" || !Number.isSafeInteger(workspaceId) || workspaceId <= 0)) return null;
  return { userId: user.id, workspaceId: workspaceId as number | null, role: user.role };
}
export function listingRequestOwner(user: UserIdentity, projectId: number, blocked = false): ListingRequestOwner | null {
  const identity = listingIdentity(user);
  return blocked || !identity || !Number.isSafeInteger(projectId) || projectId <= 0 ? null : { ...identity, projectId };
}
export const listingOwnerKey = (owner: ListingRequestOwner | null) => owner ? JSON.stringify([owner.userId, owner.workspaceId, owner.role, owner.projectId]) : null;


function validAnalysisIds(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= 1000 && value.every(id => Number.isSafeInteger(id) && id > 0) && new Set(value).size === value.length;
}

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
  includeHistory?: boolean;
  distillationBinding?: { ledgerKey?: string | null; skillSlugs?: string[] };
  onSucceeded: (output: any, job: any) => void;
  draftFingerprint?: string;
  onConfiguredApplied?: (output: any) => void;
}) {

  const auth = useAuth(), owner = listingRequestOwner(auth.user, input.projectId, auth.loading || !!auth.error);
  const scopeKey = input.scopeKey || "main";
  const identity = owner ? JSON.stringify([listingOwnerKey(owner), input.nodeId, input.operation, scopeKey]) : null;
  const ownerRef = useRef({ identity, epoch: 0, key: identity });
  if (ownerRef.current.identity !== identity) {
    const epoch = ownerRef.current.epoch + 1;
    ownerRef.current = { identity, epoch, key: identity ? JSON.stringify([identity, epoch]) : null };
  }
  const token = ownerRef.current;
  const key = token.key;
  const mounted = useRef(false), request = useRef<AbortController | null>(null);
  const client = trpc.useUtils().client;
  const startMutation = trpc.listing.startGenerationJob.useMutation({ retry: false });
  const cancelMutation = trpc.listing.cancelGenerationJob.useMutation({ retry: false });
  const [state, setState] = useState<{ key: string | null; run: any; history: any[]; loading: boolean; error: boolean }>({ key, run: null, history: [], loading: !!key, error: false });
  const [activeRun, setActiveRun] = useState<{ key: string | null; id: string | null }>({ key, id: null });
  const [pending, setPending] = useState<{ key: string | null; start: boolean; cancel: boolean }>({ key, start: false, cancel: false });
  const pendingRef = useRef({ token, start: false, cancel: false });
  if (pendingRef.current.token !== token) pendingRef.current = { token, start: false, cancel: false };
  const handledRef = useRef({ token, keys: new Set<string>() });
  if (handledRef.current.token !== token) handledRef.current = { token, keys: new Set<string>() };
  const onSucceededRef = useRef(input.onSucceeded);
  onSucceededRef.current = input.onSucceeded;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const current = state.key === key ? state : { key, run: null, history: [], loading: !!key, error: false };
  const run = key ? current.run : null;
  const isStarting = pending.key === key && pending.start;
  const isCanceling = pending.key === key && pending.cancel;
  const activeRunId = activeRun.key === key ? activeRun.id : null;
  const projectId = input.projectId, nodeId = input.nodeId, operation = input.operation;
  const includeHistory = !!input.includeHistory;
  const userId = owner?.userId, workspaceId = owner?.workspaceId;

  const refetch = useCallback(async () => {
    if (!mounted.current || !key || ownerRef.current !== token || userId === undefined || workspaceId === undefined) return null;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setState(previous => ({ key, run: previous.key === key ? previous.run : null, history: previous.key === key ? previous.history : [], loading: true, error: false }));
    try {
      const query = { projectId, nodeId, scopeKey, expectedWorkspaceId: workspaceId };
      const historyQuery = { projectId, nodeId, expectedWorkspaceId: workspaceId };
      const [job, history] = await Promise.all([client.listing.getGenerationRun.query(query, { signal: controller.signal }),
        includeHistory ? client.listing.listGenerationRuns.query(historyQuery, { signal: controller.signal }) : Promise.resolve([])]);
      if (controller.signal.aborted || !mounted.current || ownerRef.current !== token) return null;
      if (job && !jobMatchesOwner(job, { userId, workspaceId, projectId }, nodeId, operation, scopeKey)) throw new Error("JOB_SCOPE_MISMATCH");
      if (!Array.isArray(history) || history.some(item => !jobHistoryMatchesOwner(item, { userId, workspaceId, projectId }, nodeId))) throw new Error("JOB_SCOPE_MISMATCH");
      setState({ key, run: job, history, loading: false, error: false }); return job;
    } catch (error) {
      if (controller.signal.aborted || !mounted.current || ownerRef.current !== token) return null;
      const code = error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object" && "code" in error.data ? error.data.code : null;
      const clear = ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "PRECONDITION_FAILED"].includes(String(code)) || (error instanceof Error && error.message === "JOB_SCOPE_MISMATCH");
      setState(previous => ({ key, run: !clear && previous.key === key ? previous.run : null, history: !clear && previous.key === key ? previous.history : [], loading: false, error: true }));
      return null;
    }
  }, [client, includeHistory, key, nodeId, operation, projectId, scopeKey, token, userId, workspaceId]);
  useEffect(() => { void refetch(); return () => request.current?.abort(); }, [refetch]);
  useEffect(() => {
    if (current.loading || (!isActive(run?.status) && !current.history.some(job => isActive(job.status)))) return;
    const timer = setTimeout(() => { void refetch(); }, 2_000);
    return () => clearTimeout(timer);
  }, [refetch, run, current.error, current.history, current.loading]);

  useEffect(() => {
    if (!run?.runId) return;
    if (isActive(run.status)) {
      setActiveRun(previous => previous.key === key && previous.id ? previous : { key, id: run.runId });
      return;
    }
    const terminalKey = `${run.runId}:${run.status}`;
    if (ownerRef.current !== token || handledRef.current.keys.has(terminalKey)) return;
    handledRef.current.keys.add(terminalKey);
    const wasActive = activeRunId === run.runId;
    setActiveRun({ key, id: null });
    if (run.status === "succeeded" && run.output && !run.output.skipped) {
      onSucceededRef.current(run.output, run);
      if (wasActive) toast.success(`${OPERATION_LABELS[input.operation]}生成完成，请检查并确认`);
    } else if (run.status === "failed" && (wasActive || !run.output)) {
      toast.error(formatError(run.error));
    } else if (run.status === "canceled" && wasActive) {
      toast.info(`${OPERATION_LABELS[input.operation]}任务已取消`);
    }
  }, [activeRunId, input.operation, key, run, token]);

  const start = useCallback(async (payload: Record<string, unknown> = {}) => {
    if (!mounted.current || !key || ownerRef.current !== token || !owner || pendingRef.current.start || pendingRef.current.cancel || isActive(run?.status)) return null;
    if (RESERVED_PAYLOAD_KEYS.some(field => Object.prototype.hasOwnProperty.call(payload, field))
      || (Object.prototype.hasOwnProperty.call(payload, "analysisIds") && (operation !== "sellingPoints" || !validAnalysisIds(payload.analysisIds)))) {
      toast.error("任务参数无效，请重新确认生成范围"); return null;
    }
    pendingRef.current.start = true; setPending({ key, start: true, cancel: false });
    try {
      const job = await startMutation.mutateAsync({
        ...payload,
        projectId: input.projectId,
        nodeId: input.nodeId,
        operation: input.operation,
        scopeKey: input.scopeKey || "main",
        expectedWorkspaceId: owner.workspaceId,
        ...(input.distillationBinding ? { distillationBinding: input.distillationBinding } : {}),
      } as any);
      if (!mounted.current || ownerRef.current !== token) return null;
      if (!jobMatchesOwner(job, owner, nodeId, operation, scopeKey)) throw new Error("任务返回范围不一致，请重新读取当前任务");
      setActiveRun({ key, id: job.runId }); setState(previous => ({ key, run: job, history: previous.key === key ? previous.history : [], loading: false, error: false }));
      await refetch();
      if (!mounted.current || ownerRef.current !== token) return null;
      toast.success(job.status === "running"
        ? `${OPERATION_LABELS[input.operation]}正在后台执行`
        : `${OPERATION_LABELS[input.operation]}已进入后台队列`);
      return job;
    } catch (error) {
      if (mounted.current && ownerRef.current === token) toast.error(formatError(error));
      return null;
    } finally {
      if (pendingRef.current.token === token) pendingRef.current.start = false;
      if (mounted.current && ownerRef.current === token) setPending(previous => ({ ...previous, start: false }));
    }
  }, [input.distillationBinding, input.nodeId, input.operation, input.projectId, input.scopeKey, key, nodeId, operation, owner, refetch, run?.status, scopeKey, startMutation, token]);

  const cancel = useCallback(async () => {
    if (!mounted.current || !key || !owner || ownerRef.current !== token || pendingRef.current.start || pendingRef.current.cancel) return;
    pendingRef.current.cancel = true; setPending({ key, start: false, cancel: true });
    try {
      await cancelMutation.mutateAsync({
        projectId: input.projectId,
        nodeId: input.nodeId,
        scopeKey: input.scopeKey || "main",
        expectedWorkspaceId: owner.workspaceId,
      });
      if (!mounted.current || ownerRef.current !== token) return;
      setActiveRun({ key, id: null });
      await refetch();
      if (!mounted.current || ownerRef.current !== token) return;
      toast.info(`${OPERATION_LABELS[input.operation]}任务已取消`);
    } catch (error) {
      if (mounted.current && ownerRef.current === token) toast.error(formatError(error));
    } finally {
      if (pendingRef.current.token === token) pendingRef.current.cancel = false;
      if (mounted.current && ownerRef.current === token) setPending(previous => ({ ...previous, cancel: false }));
    }
  }, [cancelMutation, input.nodeId, input.operation, input.projectId, input.scopeKey, key, owner, refetch, token]);

  return {
    run,
    history: key ? current.history : [],
    isLoadingRun: current.loading,
    readError: current.error,
    ownerKey: key,
    responseOwner: token,
    isGenerating: isStarting || isActive(run?.status),
    isStarting,
    isCanceling,
    start,
    cancel,
    refetch,
  };
}

const RESERVED_PAYLOAD_KEYS = ["projectId", "nodeId", "operation", "scopeKey", "userId", "workspaceId", "expectedWorkspaceId", "agentRunId", "agentNodeId", "researchBinding", "distillationBinding"];
function jobMatchesOwner(job: any, owner: Pick<ListingRequestOwner, "userId" | "workspaceId" | "projectId">, nodeId: ListingGenerationNodeId, operation: ListingGenerationOperation, scopeKey: string) {
  const data = job?.input;
  return !!job && job.module === "listing" && typeof job.runId === "string" && job.userId === owner.userId && job.workspaceId === owner.workspaceId && job.projectId === owner.projectId
    && data?.projectId === owner.projectId && (data.scopeKey || "main") === scopeKey
    && ((data.operation === "batch" && scopeKey === "main") || (data.nodeId === nodeId && data.operation === operation));
}
function jobHistoryMatchesOwner(job: any, owner: Pick<ListingRequestOwner, "userId" | "workspaceId" | "projectId">, nodeId: ListingGenerationNodeId) {
  return !!job && job.module === "listing" && typeof job.runId === "string" && job.userId === owner.userId && job.workspaceId === owner.workspaceId && job.projectId === owner.projectId
    && job.input?.projectId === owner.projectId && (job.input.operation === "batch" || job.input.nodeId === nodeId);
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
