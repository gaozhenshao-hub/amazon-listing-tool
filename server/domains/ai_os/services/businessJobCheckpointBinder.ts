import type { EmperorAgentDag } from "./agentRunner/runtimeCore";
import { parseJson, rawExecute } from "./agentRunner/runtimeCore";
import {
  markBusinessManagedNodeCanceled,
  markBusinessManagedNodeConfirmed,
  markBusinessManagedNodeFailed,
  markBusinessManagedNodeProgress,
  markBusinessManagedNodeRunning,
  markBusinessManagedNodeWaitingHuman,
} from "./businessManagedAgent";
import { recordAiOsMetric } from "./observability";
import {
  BUSINESS_AI_JOB_MODULES,
  readBusinessJobAgentBinding,
} from "./businessJobBindingPolicy";

export type BusinessJobLifecycleStatus =
  | "queued"
  | "running"
  | "retrying"
  | "succeeded"
  | "confirmed"
  | "failed"
  | "canceled";

export const BUSINESS_JOB_CHECKPOINT_STATUS_MAP = {
  queued: "running",
  running: "running",
  retrying: "running",
  succeeded: "waiting_human",
  confirmed: "confirmed",
  failed: "failed",
  canceled: "canceled",
} as const satisfies Record<BusinessJobLifecycleStatus, string>;

export type BusinessJobCheckpointBinding = {
  runId: string;
  dag: EmperorAgentDag;
  nodeId: string;
  aiJobRunId: string;
  aiJobAttempt?: number | null;
  maxAttempts?: number | null;
  progress?: number;
  output?: unknown;
  userEdit?: unknown;
  errorMessage?: string | null;
  failureKind?: "error" | "timeout" | "cancel";
  finalAttempt?: boolean;
  metadata?: Record<string, unknown>;
  resetNodeIds?: string[];
  userId?: number;
  workspaceId?: number | null;
  projectId?: number | null;
};

function lifecycleMetadata(status: BusinessJobLifecycleStatus, input: BusinessJobCheckpointBinding) {
  return {
    ...(input.metadata || {}),
    businessJobStatus: status,
    businessJobStatusLabel: status === "queued"
      ? "排队中"
      : status === "retrying"
        ? "重试中"
        : undefined,
    aiJobRunId: input.aiJobRunId,
    aiJobAttempt: input.aiJobAttempt ?? 0,
    maxAttempts: input.maxAttempts ?? null,
    retryPending: status === "retrying",
  };
}

export class BusinessJobCheckpointBinder {
  async sync(status: BusinessJobLifecycleStatus, input: BusinessJobCheckpointBinding) {
    const metadata = lifecycleMetadata(status, input);
    let synchronized = false;
    try {
      if (status === "queued" || status === "running" || status === "retrying") {
        await markBusinessManagedNodeRunning({
          ...input,
          metadata,
          allowJobReplacement: status === "queued",
        });
        synchronized = await markBusinessManagedNodeProgress({
          ...input,
          progress: input.progress ?? (status === "queued" ? 2 : status === "retrying" ? 15 : 10),
          errorMessage: status === "retrying" ? input.errorMessage : null,
          metadata,
        });
      } else if (status === "succeeded") {
        synchronized = await markBusinessManagedNodeWaitingHuman({
          ...input,
          progress: 100,
          metadata,
        });
      } else if (status === "confirmed") {
        await markBusinessManagedNodeConfirmed({
          ...input,
          progress: 100,
          metadata,
        });
        synchronized = true;
      } else if (status === "canceled") {
        synchronized = await markBusinessManagedNodeCanceled({
          ...input,
          metadata,
        });
      } else {
        synchronized = await markBusinessManagedNodeFailed({
          ...input,
          finalAttempt: input.finalAttempt !== false,
          failureKind: input.failureKind || "error",
          progress: 100,
          metadata,
        });
      }
      return synchronized;
    } finally {
      void recordAiOsMetric({
        entityType: "agent_node",
        entityId: `${input.runId}:${input.nodeId}:${input.aiJobRunId}`,
        metricName: "business_job_checkpoint_binding",
        metricValue: synchronized ? 1 : 0,
        status,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId ?? null,
        projectId: input.projectId ?? null,
        nodeId: input.nodeId,
        metadata: { expectedCheckpointStatus: BUSINESS_JOB_CHECKPOINT_STATUS_MAP[status] },
      });
    }
  }
}

export const businessJobCheckpointBinder = new BusinessJobCheckpointBinder();

export function classifyBusinessJobFailure(input: {
  error: unknown;
  signal?: AbortSignal | null;
  attempt: number;
  maxAttempts: number;
}) {
  const message = input.error instanceof Error ? input.error.message : String(input.error || "业务任务执行失败");
  const signalReason = String(input.signal?.reason || "");
  const timedOut = /timeout|timed out|超时/i.test(`${message} ${signalReason}`);
  const failureKind: "error" | "timeout" | "cancel" = timedOut
    ? "timeout"
    : input.signal?.aborted || /cancel|abort|取消/i.test(message)
      ? "cancel"
      : "error";
  return {
    message,
    failureKind,
    finalAttempt: failureKind === "cancel" || input.attempt >= input.maxAttempts,
    lifecycleStatus: failureKind === "cancel"
      ? "canceled" as const
      : input.attempt >= input.maxAttempts
        ? "failed" as const
        : "retrying" as const,
  };
}

type BindingAuditInput = {
  userId: number;
  module?: string;
  projectId?: number;
  limit?: number;
};

function expectedCheckpointStatuses(jobStatus: string, metadata: Record<string, unknown>) {
  if (jobStatus === "queued") return ["running"];
  if (jobStatus === "running") return ["running"];
  if (jobStatus === "succeeded") {
    return metadata.businessJobStatus === "confirmed" ? ["confirmed"] : ["waiting_human", "confirmed"];
  }
  if (jobStatus === "failed") return ["failed"];
  if (jobStatus === "canceled") return ["canceled"];
  return [];
}

export async function auditBusinessJobCheckpointBindings(input: BindingAuditInput) {
  const filters = ["j.userId=?"];
  const params: unknown[] = [input.userId];
  if (input.module) {
    filters.push("j.module=?");
    params.push(input.module);
  } else {
    filters.push(`j.module IN (${BUSINESS_AI_JOB_MODULES.map(() => "?").join(",")})`);
    params.push(...BUSINESS_AI_JOB_MODULES);
  }
  if (input.projectId !== undefined) {
    filters.push("j.projectId=?");
    params.push(input.projectId);
  }
  params.push(Math.min(Math.max(input.limit || 100, 1), 500));
  const rows = await rawExecute(
    `SELECT j.runId,j.module,j.status AS jobStatus,j.input,j.errorMessage,j.updatedAt,
            c.runId AS agentRunId,c.nodeId,c.status AS checkpointStatus,c.metadata,c.aiJobRunId
     FROM ai_jobs j
     LEFT JOIN emperor_agent_checkpoints c ON c.aiJobRunId=j.runId
     WHERE ${filters.join(" AND ")}
     ORDER BY j.id DESC LIMIT ?`,
    params,
  );

  const jobs = new Map<string, any[]>();
  for (const row of rows) {
    const runId = String(row.runId || "");
    if (!runId) continue;
    jobs.set(runId, [...(jobs.get(runId) || []), row]);
  }
  const issues = [...jobs.entries()].flatMap(([aiJobRunId, jobRows]) => {
    const job = jobRows[0];
    const binding = readBusinessJobAgentBinding(parseJson(job.input, {}));
    const matchingCheckpoint = binding
      ? jobRows.find((row) => String(row.agentRunId || "") === binding.agentRunId && String(row.nodeId || "") === binding.agentNodeId)
      : null;
    const anyCheckpoint = jobRows.find((row) => row.checkpointStatus);
    const checkpoint = matchingCheckpoint || anyCheckpoint || job;
    const metadata = parseJson(checkpoint.metadata, {}) as Record<string, unknown>;
    const expected = expectedCheckpointStatuses(String(job.jobStatus), metadata);
    const checkpointStatus = checkpoint.checkpointStatus ? String(checkpoint.checkpointStatus) : null;
    const checkpointRunId = checkpoint.agentRunId ? String(checkpoint.agentRunId) : null;
    const checkpointNodeId = checkpoint.nodeId ? String(checkpoint.nodeId) : null;
    const reason = !binding
      ? "Job 缺少 agentRunId / agentNodeId"
      : !anyCheckpoint
        ? "未找到绑定的 Agent Checkpoint"
        : !matchingCheckpoint
          ? "Job 与 Checkpoint 的 Run / 节点不一致"
          : !checkpointStatus || !expected.includes(checkpointStatus)
            ? "状态映射不一致"
            : null;
    if (!reason) return [];
    return [{
      aiJobRunId,
      module: String(job.module),
      jobStatus: String(job.jobStatus),
      agentRunId: binding?.agentRunId || checkpointRunId,
      nodeId: binding?.agentNodeId || checkpointNodeId,
      checkpointStatus,
      expectedCheckpointStatuses: expected,
      reason,
    }];
  });

  return {
    total: jobs.size,
    bound: jobs.size - issues.length,
    mismatched: issues.length,
    healthy: issues.length === 0,
    issues,
  };
}
