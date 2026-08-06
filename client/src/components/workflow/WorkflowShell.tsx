import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Bot, Pause, Play, RefreshCw, Square, Workflow } from "lucide-react";
import type { WorkflowCheckpointLike, WorkflowShellProps } from "./types";
import { WorkflowArtifactVersionPicker } from "./WorkflowArtifactVersionPicker";
import { WorkflowCheckpointControls } from "./WorkflowCheckpointControls";
import { WorkflowStepProgress, WorkflowStatusBadge } from "./WorkflowStepProgress";
import { useAgentWorkflowRun } from "./useAgentWorkflowRun";
import {
  chooseActiveWorkflowStep,
  getArtifactsForStep,
  getCheckpointForStep,
  getWorkflowRunProgress,
  normalizeCheckpointStatus,
  toWorkflowIdSet,
  workflowIdKey,
} from "./workflowUtils";

function chooseDisplayCheckpoint(
  activeCheckpoint?: WorkflowCheckpointLike,
  checkpoints?: WorkflowCheckpointLike[],
): WorkflowCheckpointLike | undefined {
  return (
    activeCheckpoint ||
    checkpoints?.find((checkpoint) => checkpoint.status === "waiting_human") ||
    checkpoints?.find((checkpoint) => checkpoint.status === "ready") ||
    checkpoints?.find((checkpoint) => checkpoint.status === "running") ||
    checkpoints?.[0]
  );
}

export function WorkflowShell({
  title,
  subtitle,
  kind = "generic",
  steps,
  activeStepId,
  completedStepIds,
  lockedStepIds,
  disabledStepIds,
  runId,
  runDetail,
  isLoadingRun,
  onStepClick,
  headerActions,
  beforeContent,
  children,
  className,
  contentClassName,
  showAgentPanel = true,
}: WorkflowShellProps) {
  const agentRun = useAgentWorkflowRun(runId);
  const detail = runDetail || agentRun.detail || null;
  const checkpoints = detail?.checkpoints || [];
  const artifacts = detail?.artifacts || [];
  const activeStep = chooseActiveWorkflowStep(steps, activeStepId);
  const activeCheckpoint = getCheckpointForStep(activeStep, checkpoints);
  const activeArtifacts = getArtifactsForStep(activeStep, artifacts);
  const displayCheckpoint = chooseDisplayCheckpoint(activeCheckpoint, checkpoints);
  const progress = getWorkflowRunProgress(detail);
  const completed = toWorkflowIdSet(completedStepIds);
  const locked = toWorkflowIdSet(lockedStepIds);
  const activeKey = workflowIdKey(activeStepId);
  const isRunLoading = isLoadingRun || agentRun.isLoading;
  const isTerminalRun = detail?.run?.status === "completed" || detail?.run?.status === "canceled";

  const renderedChildren =
    typeof children === "function"
      ? children({ activeStep, activeCheckpoint, activeArtifacts, run: detail?.run })
      : children;

  return (
    <div className={cn("mx-auto max-w-7xl space-y-5 p-6", className)} data-workflow-kind={kind}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Workflow className="h-5 w-5 text-primary" />
            <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
            {detail?.run?.runId && <WorkflowStatusBadge status={detail.run.status} />}
          </div>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {headerActions && <div className="flex flex-wrap items-center gap-2">{headerActions}</div>}
      </div>

      {(detail?.run || isRunLoading) && (
        <div className="rounded-lg border bg-background p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{detail?.run?.agentSlug || "Agent Run"}</span>
              {detail?.run?.runId && (
                <Badge variant="outline" className="rounded-md text-xs">
                  {detail.run.createdAt ? `执行于 ${new Date(detail.run.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "已关联执行记录"}
                </Badge>
              )}
            </div>
            {runId && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={agentRun.actions.scheduleRun.isPending || isTerminalRun}
                  onClick={() => agentRun.actions.scheduleRun.mutate({ runId, mode: "next" })}
                >
                  {agentRun.actions.scheduleRun.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  推进
                </Button>
                {detail?.run?.status === "paused" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={agentRun.actions.resumeRun.isPending}
                    onClick={() => agentRun.actions.resumeRun.mutate({ runId })}
                  >
                    <Play className="h-4 w-4" />
                    恢复
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={agentRun.actions.pauseRun.isPending || isTerminalRun}
                    onClick={() => agentRun.actions.pauseRun.mutate({ runId, reason: "Paused from workflow shell" })}
                  >
                    <Pause className="h-4 w-4" />
                    暂停
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={agentRun.actions.cancelRun.isPending || isTerminalRun}
                  onClick={() => agentRun.actions.cancelRun.mutate({ runId, reason: "Canceled from workflow shell" })}
                >
                  <Square className="h-4 w-4" />
                  取消
                </Button>
              </div>
            )}
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
      )}

      {beforeContent}

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-3">
          <div className="rounded-lg border bg-background p-3">
            <WorkflowStepProgress
              steps={steps}
              activeStepId={activeStepId}
              completedStepIds={completed}
              lockedStepIds={locked}
              disabledStepIds={disabledStepIds}
              checkpoints={checkpoints}
              onStepClick={onStepClick}
              compact
              className="[&>div]:flex-col [&>div]:items-stretch"
            />
          </div>
          {showAgentPanel && runId && (
            <div className="space-y-3">
              <WorkflowCheckpointControls
                runId={runId}
                checkpoint={displayCheckpoint}
                executeNode={agentRun.actions.executeNode}
                rerunNode={agentRun.actions.rerunNode}
                updateDraft={agentRun.actions.updateDraft}
                confirmNode={agentRun.actions.confirmNode}
              />
              <WorkflowArtifactVersionPicker
                runId={runId}
                nodeId={displayCheckpoint?.nodeId || activeStep.agentNodeId}
                artifactKey={activeStep.artifactKey}
                fallbackArtifacts={activeArtifacts}
              />
            </div>
          )}
        </aside>

        <main className={cn("min-w-0 space-y-4", contentClassName)} data-active-workflow-step={activeKey}>
          {activeCheckpoint && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span className="font-medium">{activeCheckpoint.nodeLabel || activeCheckpoint.nodeId}</span>
              <WorkflowStatusBadge status={activeCheckpoint.status} />
            </div>
          )}
          {renderedChildren}
        </main>
      </div>
    </div>
  );
}
