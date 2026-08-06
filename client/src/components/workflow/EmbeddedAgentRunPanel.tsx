import { useEffect, useMemo, useState } from "react";
import { Bot, ExternalLink, Pause, Play, RefreshCw, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { WorkflowArtifactVersionPicker } from "./WorkflowArtifactVersionPicker";
import { WorkflowCheckpointControls } from "./WorkflowCheckpointControls";
import { WorkflowStatusBadge } from "./WorkflowStepProgress";
import { useAgentWorkflowRun } from "./useAgentWorkflowRun";
import { getWorkflowRunProgress } from "./workflowUtils";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";

function queryRunId() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("agentRunId") || "";
}

export function EmbeddedAgentRunPanel({
  title = "Agent 执行记录",
  projectId,
  agentSlug,
  managedByBusinessPage = false,
  businessUrl,
  onManagedNodeSelect,
  className,
}: {
  title?: string;
  projectId?: number | null;
  agentSlug?: string;
  managedByBusinessPage?: boolean;
  businessUrl?: string;
  onManagedNodeSelect?: (nodeId: string) => void;
  className?: string;
}) {
  const [, setLocation] = useLocation();
  const initialRunId = agentSlug ? "" : queryRunId();
  const [runId, setRunId] = useState(initialRunId);
  const projectRuns = trpc.emperor.agents.listProjectRuns.useQuery(
    { projectId: projectId || 0, agentSlug, limit: 10 },
    {
      enabled: Boolean(projectId) && (Boolean(agentSlug) || !runId),
      refetchInterval: managedByBusinessPage ? 2_500 : false,
    },
  );

  useEffect(() => {
    const latestRunId = String((projectRuns.data?.[0] as any)?.runId || "");
    if (latestRunId && (!runId || (agentSlug && latestRunId !== runId))) {
      setRunId(latestRunId);
    }
  }, [agentSlug, projectRuns.data, runId]);
  const workflow = useAgentWorkflowRun(runId);
  const checkpoint = useMemo(
    () => workflow.checkpoints.find((item) => item.status === "waiting_human")
      || workflow.checkpoints.find((item) => item.status === "running")
      || workflow.checkpoints.find((item) => item.status === "ready")
      || workflow.checkpoints[0],
    [workflow.checkpoints],
  );
  const checkpointArtifacts = workflow.artifacts.filter((artifact) => !checkpoint || artifact.nodeId === checkpoint.nodeId);
  const progress = getWorkflowRunProgress(workflow.detail);
  const runLabel = workflow.run
    ? `项目分析 · ${workflow.run.templateVersion || "当前版本"} · ${workflow.run.createdAt ? new Date(workflow.run.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}`
    : "";

  return (
    <section className={cn("space-y-3 rounded-lg border bg-background p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{title}</span>
          {workflow.run?.status && <WorkflowStatusBadge status={workflow.run.status} />}
          {runId && <Badge variant="outline" className="max-w-72 truncate rounded-md">{runLabel || "已关联运行"}</Badge>}
        </div>
        {agentSlug ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!runId}
            onClick={() => runId && setLocation(`/emperor/agents/${encodeURIComponent(agentSlug)}/canvas?runId=${encodeURIComponent(runId)}`)}
          >
            <ExternalLink className="h-4 w-4" />
            Agent 画布
          </Button>
        ) : null}
      </div>

      {!runId && (
        <div className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          首次启动业务流程后，系统会自动创建并关联执行记录，无需输入运行编号。
        </div>
      )}

      {runId && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{workflow.run?.agentSlug || (workflow.isLoading ? "正在读取 Run" : "未找到 Run")}</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
            {!managedByBusinessPage && <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={workflow.actions.scheduleRun.isPending}
                onClick={() => workflow.actions.scheduleRun.mutate({ runId, mode: "next" })}
              >
                {workflow.actions.scheduleRun.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                推进
              </Button>
              {workflow.run?.status === "paused" ? (
                <Button size="sm" variant="outline" onClick={() => workflow.actions.resumeRun.mutate({ runId })}>
                  <Play className="h-4 w-4" />恢复
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => workflow.actions.pauseRun.mutate({ runId })}>
                  <Pause className="h-4 w-4" />暂停
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => workflow.actions.cancelRun.mutate({ runId })}>
                <Square className="h-4 w-4" />取消
              </Button>
            </div>}
          </div>

          {managedByBusinessPage && workflow.checkpoints.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {workflow.checkpoints.map((item) => (
                <button
                  type="button"
                  key={item.nodeId}
                  className="flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-left hover:bg-muted/50"
                  onClick={() => {
                    if (onManagedNodeSelect) onManagedNodeSelect(item.nodeId);
                    else if (businessUrl) setLocation(`${businessUrl}?stage=${encodeURIComponent(item.nodeId)}`);
                  }}
                  title={businessUrl ? "前往对应业务阶段" : item.nodeLabel || item.nodeId}
                >
                  <span className="truncate text-xs font-medium">{item.nodeLabel || item.nodeId}</span>
                  <WorkflowStatusBadge status={item.status} />
                </button>
              ))}
            </div>
          )}

          {!managedByBusinessPage && checkpoint && (
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
              <WorkflowCheckpointControls
                runId={runId}
                checkpoint={checkpoint}
                executeNode={workflow.actions.executeNode}
                rerunNode={workflow.actions.rerunNode}
                updateDraft={workflow.actions.updateDraft}
                confirmNode={workflow.actions.confirmNode}
              />
              <WorkflowArtifactVersionPicker
                runId={runId}
                nodeId={checkpoint.nodeId}
                fallbackArtifacts={checkpointArtifacts}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
