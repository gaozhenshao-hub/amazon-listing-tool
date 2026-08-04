import type { ComponentType, ReactNode } from "react";

export type WorkflowId = string | number;

export type WorkflowCheckpointStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting_human"
  | "confirmed"
  | "skipped"
  | "failed"
  | "canceled"
  | "paused"
  | "locked";

export type WorkflowKind = "listing" | "image" | "ads" | "video" | "ops" | "generic";

export interface WorkflowStepDefinition {
  id: WorkflowId;
  label: string;
  shortLabel?: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  agentNodeId?: string;
  artifactKey?: string;
  required?: boolean;
  summary?: string;
}

export interface WorkflowCheckpointLike {
  nodeId: string;
  nodeLabel?: string | null;
  nodeType?: string | null;
  status?: WorkflowCheckpointStatus | string | null;
  output?: unknown;
  userEdit?: unknown;
  metadata?: unknown;
  retryCount?: number | null;
  errorMessage?: string | null;
  aiJobRunId?: string | null;
  updatedAt?: string | Date | null;
  confirmedAt?: string | Date | null;
  completedAt?: string | Date | null;
}

export interface WorkflowArtifactLike {
  artifactId?: number | string;
  runId?: string;
  nodeId?: string;
  artifactKey?: string;
  artifactType?: string;
  version?: number;
  status?: string;
  isCurrent?: boolean | number;
  ref?: string;
  currentRef?: string;
  fileName?: string | null;
  mimeType?: string | null;
  storageUri?: string | null;
  contentHash?: string | null;
  content?: unknown;
  metadata?: unknown;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
}

export interface WorkflowRunLike {
  runId?: string;
  agentSlug?: string;
  status?: string;
  progress?: number;
  currentNodeId?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
}

export interface WorkflowRunDetailLike {
  run?: WorkflowRunLike;
  checkpoints?: WorkflowCheckpointLike[];
  artifacts?: WorkflowArtifactLike[];
  events?: unknown[];
}

export interface WorkflowActionSlot {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  disabled?: boolean;
  loading?: boolean;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  onClick: () => void;
}

export interface WorkflowShellRenderProps {
  activeStep: WorkflowStepDefinition;
  activeCheckpoint?: WorkflowCheckpointLike;
  activeArtifacts: WorkflowArtifactLike[];
  run?: WorkflowRunLike;
}

export interface WorkflowShellProps {
  title: string;
  subtitle?: string;
  kind?: WorkflowKind;
  steps: WorkflowStepDefinition[];
  activeStepId: WorkflowId;
  completedStepIds?: Iterable<WorkflowId>;
  lockedStepIds?: Iterable<WorkflowId>;
  disabledStepIds?: Iterable<WorkflowId>;
  runId?: string | null;
  runDetail?: WorkflowRunDetailLike | null;
  isLoadingRun?: boolean;
  onStepClick: (stepId: WorkflowId) => void;
  headerActions?: ReactNode;
  beforeContent?: ReactNode;
  children: ReactNode | ((props: WorkflowShellRenderProps) => ReactNode);
  className?: string;
  contentClassName?: string;
  showAgentPanel?: boolean;
}
