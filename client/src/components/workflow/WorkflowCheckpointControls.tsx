import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Check, Loader2, Pencil, Play, RefreshCw, Save, SkipForward } from "lucide-react";
import type { WorkflowCheckpointLike } from "./types";
import {
  formatWorkflowDate,
  getWorkflowCheckpointDisplayStatus,
  getWorkflowCheckpointMetadata,
  normalizeCheckpointStatus,
  parseDraftText,
  safeJsonText,
  WORKFLOW_STATUS_LABELS,
} from "./workflowUtils";
import { WorkflowStatusBadge } from "./WorkflowStepProgress";

type CheckpointMutation = {
  isPending?: boolean;
  mutate: (input: any) => void;
};

export function WorkflowCheckpointControls({
  runId,
  checkpoint,
  executeNode,
  rerunNode,
  updateDraft,
  confirmNode,
  onAfterLocalEdit,
  allowSkip = true,
  className,
}: {
  runId?: string | null;
  checkpoint?: WorkflowCheckpointLike;
  executeNode?: CheckpointMutation;
  rerunNode?: CheckpointMutation;
  updateDraft?: CheckpointMutation;
  confirmNode?: CheckpointMutation;
  onAfterLocalEdit?: (draft: unknown) => void;
  allowSkip?: boolean;
  className?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const status = normalizeCheckpointStatus(checkpoint?.status);
  const displayStatus = getWorkflowCheckpointDisplayStatus(checkpoint);
  const checkpointMetadata = getWorkflowCheckpointMetadata(checkpoint);
  const jobAttempt = Number(checkpointMetadata.businessJobAttempt ?? checkpoint?.aiJobAttempt ?? 0);
  const jobMaxAttempts = Number(checkpointMetadata.businessJobMaxAttempts ?? 0);
  const nodeId = checkpoint?.nodeId;

  const sourceDraft = useMemo(
    () => safeJsonText(checkpoint?.userEdit ?? checkpoint?.output ?? {}),
    [checkpoint?.output, checkpoint?.userEdit],
  );

  useEffect(() => {
    if (!isEditing) setDraftText(sourceDraft);
  }, [isEditing, sourceDraft]);

  if (!runId || !checkpoint) return null;

  const canExecute = status === "ready" || status === "failed";
  // Allow confirming from both "waiting_human" (AI output ready) and "ready" (business-managed nodes)
  const canConfirm = status === "waiting_human" || status === "ready";
  const canEdit = status === "waiting_human" || status === "ready" || status === "failed";
  const isBusy =
    executeNode?.isPending ||
    rerunNode?.isPending ||
    updateDraft?.isPending ||
    confirmNode?.isPending;

  const handleSaveDraft = () => {
    const userEdit = parseDraftText(draftText);
    updateDraft?.mutate({ runId, nodeId, userEdit });
    onAfterLocalEdit?.(userEdit);
    setIsEditing(false);
  };

  return (
    <div className={cn("rounded-lg border bg-background p-3", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{checkpoint.nodeLabel || checkpoint.nodeId}</p>
            <WorkflowStatusBadge checkpoint={checkpoint} />
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {checkpoint.aiJobRunId && <span>Job {checkpoint.aiJobRunId}</span>}
            {!!checkpoint.retryCount && <span>重试 {checkpoint.retryCount}</span>}
            {jobMaxAttempts > 0 && <span>尝试 {jobAttempt}/{jobMaxAttempts}</span>}
            {checkpoint.updatedAt && <span>{formatWorkflowDate(checkpoint.updatedAt)}</span>}
          </div>
        </div>
        <Badge variant="secondary" className="rounded-md text-xs">
          {WORKFLOW_STATUS_LABELS[displayStatus]}
        </Badge>
      </div>

      {checkpoint.errorMessage && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {checkpoint.errorMessage}
        </div>
      )}

      {isEditing && (
        <Textarea
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          className="mb-3 min-h-40 font-mono text-xs"
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={isBusy || !canExecute}
          onClick={() => executeNode?.mutate({ runId, nodeId })}
        >
          {executeNode?.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          执行
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isBusy}
          onClick={() => rerunNode?.mutate({ runId, nodeId, resetDescendants: true })}
        >
          {rerunNode?.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          重跑
        </Button>
        {isEditing ? (
          <Button size="sm" disabled={isBusy} onClick={handleSaveDraft}>
            {updateDraft?.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存草稿
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={isBusy || !canEdit} onClick={() => setIsEditing(true)}>
            <Pencil className="h-4 w-4" />
            编辑
          </Button>
        )}
        <Button
          size="sm"
          disabled={isBusy || !canConfirm}
          onClick={() => confirmNode?.mutate({ runId, nodeId, userEdit: parseDraftText(draftText) })}
        >
          {confirmNode?.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          确认并锁定
        </Button>
        {allowSkip && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isBusy || !canConfirm}
            onClick={() => confirmNode?.mutate({ runId, nodeId, skip: true })}
          >
            <SkipForward className="h-4 w-4" />
            跳过
          </Button>
        )}
      </div>
    </div>
  );
}
