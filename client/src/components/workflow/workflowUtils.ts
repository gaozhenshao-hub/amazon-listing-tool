import type {
  WorkflowArtifactLike,
  WorkflowCheckpointLike,
  WorkflowCheckpointStatus,
  WorkflowId,
  WorkflowRunDetailLike,
  WorkflowStepDefinition,
} from "./types";

export const WORKFLOW_STATUS_LABELS: Record<WorkflowCheckpointStatus, string> = {
  pending: "等待依赖",
  ready: "可执行",
  running: "执行中",
  waiting_human: "待确认",
  confirmed: "已确认",
  skipped: "已跳过",
  failed: "失败",
  canceled: "已取消",
  paused: "已暂停",
  locked: "已锁定",
};

export function workflowIdKey(id: WorkflowId): string {
  return String(id);
}

export function toWorkflowIdSet(ids?: Iterable<WorkflowId>): Set<string> {
  return new Set(Array.from(ids || []).map(workflowIdKey));
}

export function normalizeCheckpointStatus(status?: string | null): WorkflowCheckpointStatus {
  switch (status) {
    case "completed":
      return "confirmed";
    case "ready":
    case "running":
    case "waiting_human":
    case "confirmed":
    case "skipped":
    case "failed":
    case "canceled":
    case "paused":
    case "locked":
      return status;
    default:
      return "pending";
  }
}

export function isWorkflowStepDone(status: WorkflowCheckpointStatus): boolean {
  return status === "confirmed" || status === "skipped" || status === "locked";
}

export function getCheckpointForStep(
  step: WorkflowStepDefinition,
  checkpoints?: WorkflowCheckpointLike[],
): WorkflowCheckpointLike | undefined {
  if (!step.agentNodeId || !checkpoints?.length) return undefined;
  return checkpoints.find((checkpoint) => checkpoint.nodeId === step.agentNodeId);
}

export function getArtifactsForStep(
  step: WorkflowStepDefinition,
  artifacts?: WorkflowArtifactLike[],
): WorkflowArtifactLike[] {
  if (!artifacts?.length) return [];
  return artifacts.filter((artifact) => {
    const nodeMatches = step.agentNodeId ? artifact.nodeId === step.agentNodeId : true;
    const keyMatches = step.artifactKey ? artifact.artifactKey === step.artifactKey : true;
    return nodeMatches && keyMatches;
  });
}

export function chooseActiveWorkflowStep(
  steps: WorkflowStepDefinition[],
  activeStepId: WorkflowId,
): WorkflowStepDefinition {
  return steps.find((step) => workflowIdKey(step.id) === workflowIdKey(activeStepId)) || steps[0];
}

export function summarizeWorkflowOutput(value: unknown, maxLength = 180): string {
  if (value == null) return "";
  const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return raw.length <= maxLength ? raw : `${raw.slice(0, maxLength)}...`;
}

export function getWorkflowRunProgress(detail?: WorkflowRunDetailLike | null): number {
  const runProgress = Number(detail?.run?.progress);
  if (Number.isFinite(runProgress) && runProgress >= 0) return Math.min(100, Math.round(runProgress));

  const checkpoints = detail?.checkpoints || [];
  if (!checkpoints.length) return 0;
  const done = checkpoints.filter((checkpoint) => isWorkflowStepDone(normalizeCheckpointStatus(checkpoint.status))).length;
  return Math.round((done / checkpoints.length) * 100);
}

export function formatWorkflowDate(value?: string | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export function safeJsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
}

export function parseDraftText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}
