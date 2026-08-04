import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Loader2,
  Lock,
  Play,
} from "lucide-react";
import type { WorkflowCheckpointLike, WorkflowId, WorkflowStepDefinition } from "./types";
import {
  getCheckpointForStep,
  isWorkflowStepDone,
  normalizeCheckpointStatus,
  toWorkflowIdSet,
  workflowIdKey,
  WORKFLOW_STATUS_LABELS,
} from "./workflowUtils";

export function WorkflowStatusBadge({ status }: { status?: string | null }) {
  const normalized = normalizeCheckpointStatus(status);
  const tone =
    normalized === "failed"
      ? "border-red-200 bg-red-50 text-red-700"
      : normalized === "running"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : normalized === "waiting_human"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : isWorkflowStepDone(normalized)
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : normalized === "ready"
      ? "border-violet-200 bg-violet-50 text-violet-700"
      : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", tone)}>
      {WORKFLOW_STATUS_LABELS[normalized]}
    </Badge>
  );
}

function StepStateIcon({ status, active }: { status: string; active: boolean }) {
  const normalized = normalizeCheckpointStatus(status);
  if (normalized === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  if (normalized === "failed") return <AlertCircle className="h-3.5 w-3.5" />;
  if (normalized === "locked") return <Lock className="h-3.5 w-3.5" />;
  if (isWorkflowStepDone(normalized)) return <Check className="h-3.5 w-3.5" />;
  if (normalized === "ready") return <Play className="h-3.5 w-3.5" />;
  return active ? <Circle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />;
}

export function WorkflowStepProgress({
  steps,
  activeStepId,
  completedStepIds,
  lockedStepIds,
  blockedStepIds,
  disabledStepIds,
  stepTitleById,
  checkpoints,
  onStepClick,
  compact = false,
  className,
}: {
  steps: WorkflowStepDefinition[];
  activeStepId: WorkflowId;
  completedStepIds?: Iterable<WorkflowId>;
  lockedStepIds?: Iterable<WorkflowId>;
  blockedStepIds?: Iterable<WorkflowId>;
  disabledStepIds?: Iterable<WorkflowId>;
  stepTitleById?: Record<string, string>;
  checkpoints?: WorkflowCheckpointLike[];
  onStepClick?: (stepId: WorkflowId) => void;
  compact?: boolean;
  className?: string;
}) {
  const completed = toWorkflowIdSet(completedStepIds);
  const locked = toWorkflowIdSet(lockedStepIds);
  const blocked = toWorkflowIdSet(blockedStepIds);
  const disabled = toWorkflowIdSet(disabledStepIds);
  const activeKey = workflowIdKey(activeStepId);

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <div className={cn("flex min-w-max items-stretch gap-2", compact && "gap-1.5")}>
        {steps.map((step, index) => {
          const stepKey = workflowIdKey(step.id);
          const checkpoint = getCheckpointForStep(step, checkpoints);
          const checkpointStatus = normalizeCheckpointStatus(checkpoint?.status);
          const isCompleted = completed.has(stepKey) || isWorkflowStepDone(checkpointStatus);
          const isLocked = locked.has(stepKey) || checkpointStatus === "locked";
          const isBlocked = blocked.has(stepKey) && !isCompleted && !isLocked;
          const isDisabled = disabled.has(stepKey);
          const isActive = activeKey === stepKey;
          const status = isBlocked ? "locked" : isLocked ? "locked" : isCompleted ? "confirmed" : checkpointStatus;
          const StepIcon = step.icon;

          return (
            <Button
              key={stepKey}
              type="button"
              variant="outline"
              disabled={isDisabled}
              title={stepTitleById?.[stepKey] || step.description || step.label}
              onClick={() => onStepClick?.(step.id)}
              className={cn(
                "h-auto min-w-[148px] justify-start gap-2 rounded-lg border px-3 py-2 text-left",
                compact && "min-w-[118px] px-2.5 py-1.5",
                isActive && "border-primary bg-primary/8 text-primary shadow-sm",
                isCompleted && !isActive && "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50",
                isLocked && "border-emerald-300 bg-emerald-50 text-emerald-700",
                isBlocked && "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50",
                isBlocked && isActive && "border-amber-300 bg-amber-50 text-amber-800",
                checkpointStatus === "failed" && "border-red-200 bg-red-50 text-red-700",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  compact && "h-6 w-6",
                  isActive ? "border-primary bg-primary text-primary-foreground" : "border-current/20 bg-background/70",
                )}
              >
                {StepIcon && !isCompleted && checkpointStatus === "pending" ? (
                  <StepIcon className="h-3.5 w-3.5" />
                ) : (
                  <StepStateIcon status={status} active={isActive} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[10px] opacity-60">{String(index + 1).padStart(2, "0")}</span>
                  <span className="truncate text-sm font-medium">{step.shortLabel || step.label}</span>
                </span>
                {!compact && step.description && (
                  <span className="mt-0.5 block truncate text-[11px] opacity-65">{step.description}</span>
                )}
              </span>
              {isCompleted && !compact && <CheckCircle2 className="h-4 w-4 shrink-0 opacity-75" />}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
