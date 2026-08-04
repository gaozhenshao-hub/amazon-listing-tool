import { useEffect, useMemo, useState } from "react";
import { Bot, Link2, Pause, Play, RefreshCw, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { WorkflowArtifactVersionPicker } from "./WorkflowArtifactVersionPicker";
import { WorkflowCheckpointControls } from "./WorkflowCheckpointControls";
import { WorkflowStatusBadge } from "./WorkflowStepProgress";
import { useAgentWorkflowRun } from "./useAgentWorkflowRun";
import { getWorkflowRunProgress } from "./workflowUtils";
import { trpc } from "@/lib/trpc";

function queryRunId() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("agentRunId") || "";
}

export function EmbeddedAgentRunPanel({
  title = "Agent 执行记录",
  projectId,
  className,
}: {
  title?: string;
  projectId?: number | null;
  className?: string;
}) {
  const [runId, setRunId] = useState(queryRunId);
  const [draftRunId, setDraftRunId] = useState(queryRunId);
  const projectRuns = trpc.emperor.agents.listProjectRuns.useQuery(
    { projectId: projectId || 0, limit: 10 },
    { enabled: !runId && Boolean(projectId) },
  );

  useEffect(() => {
    const latestRunId = String((projectRuns.data?.[0] as any)?.runId || "");
    if (!runId && latestRunId) {
      setRunId(latestRunId);
      setDraftRunId(latestRunId);
    }
  }, [projectRuns.data, runId]);
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

  const attachRun = () => {
    const nextRunId = draftRunId.trim();
    setRunId(nextRunId);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (nextRunId) url.searchParams.set("agentRunId", nextRunId);
      else url.searchParams.delete("agentRunId");
      window.history.replaceState({}, "", url);
    }
  };

  return (
    <section className={cn("space-y-3 rounded-lg border bg-background p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{title}</span>
          {workflow.run?.status && <WorkflowStatusBadge status={workflow.run.status} />}
          {runId && <Badge variant="outline" className="max-w-56 truncate rounded-md">{runId}</Badge>}
        </div>
        <div className="flex min-w-64 flex-1 items-center justify-end gap-2 sm:flex-none">
          <Input
            value={draftRunId}
            onChange={(event) => setDraftRunId(event.target.value)}
            placeholder="输入 Agent Run ID"
            className="h-8 max-w-72"
          />
          <Button size="sm" variant="outline" onClick={attachRun}>
            <Link2 className="h-4 w-4" />
            连接
          </Button>
        </div>
      </div>

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
            <div className="flex items-center gap-2">
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
            </div>
          </div>

          {checkpoint && (
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
