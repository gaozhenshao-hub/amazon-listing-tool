import { TRPCError } from "@trpc/server";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../../../repositories/dbClient";
import { createHarnessReviewRequest, normalizeReviewType } from "./harnessCompletion";

export type AgentNodeStatus = "pending" | "ready" | "running" | "waiting_human" | "confirmed" | "skipped" | "failed" | "canceled";
export type AgentRunStatus = "running" | "waiting_human" | "paused" | "completed" | "failed" | "canceled";

export const NODE_STATUS_TRANSITIONS: Record<AgentNodeStatus, AgentNodeStatus[]> = {
  pending: ["ready", "skipped"],
  // Business-managed nodes (Listing, image workflow) may go directly from ready to waiting_human/confirmed
  // without going through the running state, since the AI job runs externally
  ready: ["running", "skipped", "pending", "waiting_human", "confirmed"],
  running: ["waiting_human", "confirmed", "failed", "canceled", "pending"],
  waiting_human: ["confirmed", "skipped", "running", "canceled", "pending"],
  confirmed: ["ready", "pending"],
  skipped: ["ready", "pending"],
  failed: ["ready", "running", "pending"],
  canceled: ["ready", "running", "pending"],
};

export const RUN_STATUS_TRANSITIONS: Record<AgentRunStatus, AgentRunStatus[]> = {
  waiting_human: ["running", "paused", "completed", "failed", "canceled"],
  running: ["waiting_human", "paused", "completed", "failed", "canceled"],
  paused: ["waiting_human", "running", "failed", "canceled"],
  failed: ["waiting_human", "running", "paused", "canceled"],
  completed: [],
  canceled: [],
};

type SqlExecutor = {
  execute: (query: unknown) => Promise<unknown>;
};

type CheckpointMutationResult = {
  runId: string;
  nodeId: string;
  status: AgentNodeStatus;
  lockToken?: string | null;
  aiJobRunId?: string | null;
  aiJobAttempt?: number | null;
};

function normalizeRows(result: unknown): any[] {
  const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
  return Array.isArray(rows) ? rows as any[] : [];
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

async function rawExecute(executor: SqlExecutor, sqlStr: string, params: unknown[] = []): Promise<any[]> {
  let result: unknown;
  if (params.length > 0) {
    const parts = sqlStr.split("?");
    const chunks: any[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      chunks.push(drizzleSql.raw(parts[i]));
      if (i < params.length) chunks.push(drizzleSql`${params[i]}`);
    }
    result = await executor.execute(drizzleSql.join(chunks, drizzleSql.raw("")));
  } else {
    result = await executor.execute(drizzleSql.raw(sqlStr));
  }
  return normalizeRows(result);
}

export function canTransitionNodeStatus(from: AgentNodeStatus, to: AgentNodeStatus): boolean {
  return from === to || NODE_STATUS_TRANSITIONS[from]?.includes(to) === true;
}

export function canTransitionRunStatus(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return from === to || RUN_STATUS_TRANSITIONS[from]?.includes(to) === true;
}

export function assertNodeTransition(from: AgentNodeStatus, to: AgentNodeStatus, action: string) {
  if (canTransitionNodeStatus(from, to)) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `Invalid node transition for ${action}: ${from} -> ${to}`,
  });
}

export function assertRunTransition(from: AgentRunStatus, to: AgentRunStatus, action: string) {
  if (canTransitionRunStatus(from, to)) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `Invalid run transition for ${action}: ${from} -> ${to}`,
  });
}

export class AgentStateMachine {
  constructor(private readonly executor: SqlExecutor) {}

  static canTransitionNodeStatus = canTransitionNodeStatus;
  static canTransitionRunStatus = canTransitionRunStatus;
  static assertNodeTransition = assertNodeTransition;
  static assertRunTransition = assertRunTransition;

  private async getRunForUpdate(runId: string) {
    const rows = await rawExecute(this.executor, "SELECT * FROM emperor_agent_runs WHERE runId=? LIMIT 1 FOR UPDATE", [runId]);
    if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Agent run not found" });
    return rows[0];
  }

  private async getCheckpointForUpdate(runId: string, nodeId: string) {
    const rows = await rawExecute(this.executor, "SELECT * FROM emperor_agent_checkpoints WHERE runId=? AND nodeId=? LIMIT 1 FOR UPDATE", [runId, nodeId]);
    if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Agent checkpoint not found" });
    return rows[0];
  }

  async transitionRun(input: {
    runId: string;
    to: AgentRunStatus;
    action: string;
    currentNodeId?: string | null;
    progress?: number | null;
    outputs?: unknown;
    errorMessage?: string | null;
    completedAt?: Date | null;
    clearError?: boolean;
  }) {
    const run = await this.getRunForUpdate(input.runId);
    const from = String(run.status) as AgentRunStatus;
    assertRunTransition(from, input.to, input.action);
    const sets = ["status=?", "updatedAt=NOW()"];
    const params: unknown[] = [input.to];
    if ("currentNodeId" in input) {
      sets.push("currentNodeId=?");
      params.push(input.currentNodeId ?? null);
    }
    if ("progress" in input) {
      sets.push("progress=?");
      params.push(input.progress ?? 0);
    }
    if ("outputs" in input) {
      sets.push("outputs=?");
      params.push(serializeJson(input.outputs));
    }
    if ("completedAt" in input) {
      sets.push("completedAt=?");
      params.push(input.completedAt ?? null);
    }
    if (input.clearError) {
      sets.push("errorMessage=NULL");
    } else if ("errorMessage" in input) {
      sets.push("errorMessage=?");
      params.push(input.errorMessage ?? null);
    }
    params.push(input.runId);
    await rawExecute(this.executor, `UPDATE emperor_agent_runs SET ${sets.join(",")} WHERE runId=?`, params);
    return { from, to: input.to };
  }

  async refreshRun(input: {
    runId: string;
    to: AgentRunStatus;
    currentNodeId?: string | null;
    progress: number;
    outputs: unknown;
    completedAt?: Date | null;
  }) {
    const run = await this.getRunForUpdate(input.runId);
    const from = String(run.status) as AgentRunStatus;
    if (from === "paused" || from === "canceled") {
      return { from, to: from, skipped: true };
    }
    assertRunTransition(from, input.to, "refresh run");
    await rawExecute(
      this.executor,
      "UPDATE emperor_agent_runs SET status=?,currentNodeId=?,progress=?,outputs=?,completedAt=? WHERE runId=?",
      [input.to, input.currentNodeId ?? null, input.progress, serializeJson(input.outputs), input.completedAt ?? null, input.runId],
    );
    return { from, to: input.to, skipped: false };
  }

  async markNodeReady(input: {
    runId: string;
    nodeId: string;
    action?: string;
  }) {
    const checkpoint = await this.getCheckpointForUpdate(input.runId, input.nodeId);
    const from = String(checkpoint.status) as AgentNodeStatus;
    assertNodeTransition(from, "ready", input.action || "mark node ready");
    await rawExecute(
      this.executor,
      "UPDATE emperor_agent_checkpoints SET status='ready',updatedAt=NOW() WHERE runId=? AND nodeId=?",
      [input.runId, input.nodeId],
    );
    return { from, to: "ready" as AgentNodeStatus };
  }

  async claimNodeRunning(input: {
    runId: string;
    nodeId: string;
    nodeInput: unknown;
    lockToken: string;
    lockedAt: Date;
    timeoutAt: Date;
    allowedFromStatuses: AgentNodeStatus[];
    action?: string;
  }): Promise<CheckpointMutationResult & { claimed: boolean; from: AgentNodeStatus }> {
    const checkpoint = await this.getCheckpointForUpdate(input.runId, input.nodeId);
    const from = String(checkpoint.status) as AgentNodeStatus;
    if (!input.allowedFromStatuses.includes(from)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Node is not executable: ${from}` });
    }
    assertNodeTransition(from, "running", input.action || "claim node running");

    const run = await this.getRunForUpdate(input.runId);
    assertRunTransition(String(run.status) as AgentRunStatus, "running", input.action || "claim node running");

    await rawExecute(
      this.executor,
      `UPDATE emperor_agent_checkpoints
       SET status='running',attempt=attempt+1,input=?,errorMessage=NULL,startedAt=?,lockToken=?,lockedAt=?,timeoutAt=?,
           aiJobRunId=NULL,aiJobAttempt=0,aiJobClaimedAt=NULL,retryScheduledAt=NULL,lastFailureKind=NULL,updatedAt=NOW()
       WHERE runId=? AND nodeId=?`,
      [serializeJson(input.nodeInput), input.lockedAt, input.lockToken, input.lockedAt, input.timeoutAt, input.runId, input.nodeId],
    );
    await rawExecute(
      this.executor,
      "UPDATE emperor_agent_runs SET status='running',currentNodeId=?,updatedAt=NOW() WHERE runId=?",
      [input.nodeId, input.runId],
    );
    return { runId: input.runId, nodeId: input.nodeId, status: "running", lockToken: input.lockToken, claimed: true, from };
  }

  async attachNodeAiJob(input: {
    runId: string;
    nodeId: string;
    aiJobRunId: string;
    aiJobAttempt?: number | null;
    lockToken?: string | null;
  }) {
    const checkpoint = await this.getCheckpointForUpdate(input.runId, input.nodeId);
    if (checkpoint.status !== "running") {
      throw new TRPCError({ code: "CONFLICT", message: `Cannot attach AI job to node in ${checkpoint.status}` });
    }
    if (input.lockToken && checkpoint.lockToken !== input.lockToken) {
      throw new TRPCError({ code: "CONFLICT", message: "Node execution lock changed before AI job attach" });
    }
    await rawExecute(
      this.executor,
      "UPDATE emperor_agent_checkpoints SET aiJobRunId=?,aiJobAttempt=?,aiJobClaimedAt=NULL,updatedAt=NOW() WHERE runId=? AND nodeId=?",
      [input.aiJobRunId, input.aiJobAttempt ?? 0, input.runId, input.nodeId],
    );
    return { runId: input.runId, nodeId: input.nodeId, status: "running" as AgentNodeStatus, aiJobRunId: input.aiJobRunId, aiJobAttempt: input.aiJobAttempt ?? 0 };
  }

  async recordNodeJobAttempt(input: {
    runId: string;
    nodeId: string;
    aiJobRunId: string;
    aiJobAttempt: number;
    aiJobClaimedAt?: Date | null;
    timeoutAt: Date;
  }) {
    const checkpoint = await this.getCheckpointForUpdate(input.runId, input.nodeId);
    const from = String(checkpoint.status) as AgentNodeStatus;
    if (from !== "running" || checkpoint.aiJobRunId !== input.aiJobRunId) {
      return {
        recorded: false,
        stale: true,
        status: from,
        currentAiJobRunId: checkpoint.aiJobRunId || null,
        currentAiJobAttempt: Number(checkpoint.aiJobAttempt || 0),
      };
    }
    const currentAttempt = Number(checkpoint.aiJobAttempt || 0);
    if (currentAttempt > input.aiJobAttempt) {
      return {
        recorded: false,
        stale: true,
        status: from,
        currentAiJobRunId: checkpoint.aiJobRunId || null,
        currentAiJobAttempt: currentAttempt,
      };
    }
    await rawExecute(
      this.executor,
      `UPDATE emperor_agent_checkpoints
       SET aiJobAttempt=?,aiJobClaimedAt=?,timeoutAt=?,errorMessage=NULL,retryScheduledAt=NULL,lastFailureKind=NULL,updatedAt=NOW()
       WHERE runId=? AND nodeId=?`,
      [input.aiJobAttempt, input.aiJobClaimedAt ?? null, input.timeoutAt, input.runId, input.nodeId],
    );
    return {
      recorded: true,
      stale: false,
      status: "running" as AgentNodeStatus,
      currentAiJobRunId: input.aiJobRunId,
      currentAiJobAttempt: input.aiJobAttempt,
    };
  }

  async completeNode(input: {
    runId: string;
    nodeId: string;
    to: Extract<AgentNodeStatus, "waiting_human" | "confirmed">;
    output: unknown;
    metadata: unknown;
    skillRunId?: string | null;
    reviewerUserId?: number | null;
    completedAt: Date;
    confirmedAt?: Date | null;
    sourceAiJobRunId?: string | null;
    sourceAiJobAttempt?: number | null;
    updateRunToWaitingHuman?: boolean;
  }) {
    const checkpoint = await this.getCheckpointForUpdate(input.runId, input.nodeId);
    const from = String(checkpoint.status) as AgentNodeStatus;
    const run = await this.getRunForUpdate(input.runId);
    if (run.status === "canceled") {
      return { ignored: true, from, currentAiJobRunId: checkpoint.aiJobRunId || null, runStatus: "canceled" as AgentRunStatus };
    }
    if (input.sourceAiJobRunId && (from !== "running" || checkpoint.aiJobRunId !== input.sourceAiJobRunId)) {
      return { ignored: true, from, currentAiJobRunId: checkpoint.aiJobRunId || null };
    }
    if (input.sourceAiJobAttempt !== undefined && input.sourceAiJobAttempt !== null && Number(checkpoint.aiJobAttempt || 0) !== input.sourceAiJobAttempt) {
      return { ignored: true, from, currentAiJobRunId: checkpoint.aiJobRunId || null, currentAiJobAttempt: Number(checkpoint.aiJobAttempt || 0) };
    }
    assertNodeTransition(from, input.to, "complete node");
    await rawExecute(
      this.executor,
      "UPDATE emperor_agent_checkpoints SET status=?,output=?,metadata=?,skillRunId=COALESCE(?,skillRunId),reviewerUserId=?,completedAt=?,confirmedAt=?,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,retryScheduledAt=NULL,lastFailureKind=NULL,updatedAt=NOW() WHERE runId=? AND nodeId=?",
      [
        input.to,
        serializeJson(input.output),
        serializeJson(input.metadata),
        input.skillRunId || null,
        input.reviewerUserId ?? null,
        input.completedAt,
        input.confirmedAt ?? null,
        input.runId,
        input.nodeId,
      ],
    );
    if (input.updateRunToWaitingHuman) {
      if (run.status !== "paused") {
        assertRunTransition(String(run.status) as AgentRunStatus, "waiting_human", "complete node waiting human");
        await rawExecute(
          this.executor,
          "UPDATE emperor_agent_runs SET status='waiting_human',currentNodeId=?,updatedAt=NOW() WHERE runId=?",
          [input.nodeId, input.runId],
        );
      }
    }
    if (input.to === "waiting_human") {
      const metadata = (input.metadata && typeof input.metadata === "object" ? input.metadata : {}) as Record<string, any>;
      const node = metadata.node && typeof metadata.node === "object" ? metadata.node : {};
      const protocol = normalizeReviewType(node.approvalProtocol || metadata.approvalProtocol);
      void createHarnessReviewRequest({
        workspaceId: run.workspaceId ?? null,
        agentRunId: input.runId,
        nodeId: input.nodeId,
        requestType: protocol,
        title: `${node.label || checkpoint.nodeLabel || input.nodeId}：${protocol === "selection_required" ? "请选择候选结果" : protocol === "approval_required" ? "请批准继续执行" : "请审核结果"}`,
        candidateSummary: { nodeType: node.nodeType || checkpoint.nodeType || null, output: input.output },
        requestedReason: String(node.approvalReason || metadata.approvalReason || "节点已完成，等待人工决定"),
        requestedBy: run.userId ?? null,
      }).catch(() => null);
    }
    return { ignored: false, from, to: input.to };
  }

  async failNode(input: {
    runId: string;
    nodeId: string;
    message: string;
    completedAt: Date;
    failRun?: boolean;
    sourceAiJobRunId?: string | null;
    sourceAiJobAttempt?: number | null;
    failureKind?: string | null;
  }) {
    const checkpoint = await this.getCheckpointForUpdate(input.runId, input.nodeId);
    const from = String(checkpoint.status) as AgentNodeStatus;
    if (input.sourceAiJobRunId && (from !== "running" || checkpoint.aiJobRunId !== input.sourceAiJobRunId)) {
      return { ignored: true, from, currentAiJobRunId: checkpoint.aiJobRunId || null, currentAiJobAttempt: Number(checkpoint.aiJobAttempt || 0) };
    }
    if (input.sourceAiJobAttempt !== undefined && input.sourceAiJobAttempt !== null && Number(checkpoint.aiJobAttempt || 0) !== input.sourceAiJobAttempt) {
      return { ignored: true, from, currentAiJobRunId: checkpoint.aiJobRunId || null, currentAiJobAttempt: Number(checkpoint.aiJobAttempt || 0) };
    }
    assertNodeTransition(from, "failed", "fail node");
    await rawExecute(
      this.executor,
      "UPDATE emperor_agent_checkpoints SET status='failed',errorMessage=?,completedAt=?,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,retryScheduledAt=NULL,lastFailureKind=?,updatedAt=NOW() WHERE runId=? AND nodeId=?",
      [input.message, input.completedAt, input.failureKind || "error", input.runId, input.nodeId],
    );
    if (input.failRun !== false) {
      const run = await this.getRunForUpdate(input.runId);
      assertRunTransition(String(run.status) as AgentRunStatus, "failed", "fail node");
      await rawExecute(
        this.executor,
        "UPDATE emperor_agent_runs SET status='failed',errorMessage=?,currentNodeId=?,updatedAt=NOW() WHERE runId=?",
        [input.message, input.nodeId, input.runId],
      );
    }
    return { ignored: false, from, to: "failed" as AgentNodeStatus };
  }

  async cancelNode(input: {
    runId: string;
    nodeId: string;
    message: string;
    completedAt: Date;
    sourceAiJobRunId?: string | null;
  }) {
    const checkpoint = await this.getCheckpointForUpdate(input.runId, input.nodeId);
    const from = String(checkpoint.status) as AgentNodeStatus;
    if (input.sourceAiJobRunId && checkpoint.aiJobRunId !== input.sourceAiJobRunId) {
      return { ignored: true, from, currentAiJobRunId: checkpoint.aiJobRunId || null };
    }
    if (from === "canceled") return { ignored: false, from, to: "canceled" as AgentNodeStatus };
    assertNodeTransition(from, "canceled", "cancel node");
    await rawExecute(
      this.executor,
      "UPDATE emperor_agent_checkpoints SET status='canceled',errorMessage=?,completedAt=?,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,retryScheduledAt=NULL,lastFailureKind='cancel',updatedAt=NOW() WHERE runId=? AND nodeId=?",
      [input.message, input.completedAt, input.runId, input.nodeId],
    );
    return { ignored: false, from, to: "canceled" as AgentNodeStatus };
  }

  async updateNodeRetry(input: {
    runId: string;
    nodeId: string;
    message: string;
    timeoutAt: Date;
    aiJobRunId: string;
    aiJobAttempt: number;
    retryCount: number;
    retryScheduledAt: Date;
    failureKind: string;
  }) {
    const checkpoint = await this.getCheckpointForUpdate(input.runId, input.nodeId);
    if (checkpoint.status !== "running") {
      return { updated: false, status: String(checkpoint.status) as AgentNodeStatus };
    }
    if (checkpoint.aiJobRunId !== input.aiJobRunId || Number(checkpoint.aiJobAttempt || 0) !== input.aiJobAttempt) {
      return {
        updated: false,
        stale: true,
        status: String(checkpoint.status) as AgentNodeStatus,
        currentAiJobRunId: checkpoint.aiJobRunId || null,
        currentAiJobAttempt: Number(checkpoint.aiJobAttempt || 0),
      };
    }
    await rawExecute(
      this.executor,
      "UPDATE emperor_agent_checkpoints SET errorMessage=?,timeoutAt=?,retryCount=?,retryScheduledAt=?,lastFailureKind=?,updatedAt=NOW() WHERE runId=? AND nodeId=?",
      [input.message, input.timeoutAt, input.retryCount, input.retryScheduledAt, input.failureKind, input.runId, input.nodeId],
    );
    return { updated: true, stale: false, status: "running" as AgentNodeStatus };
  }

  async confirmNode(input: {
    runId: string;
    nodeId: string;
    to: Extract<AgentNodeStatus, "confirmed" | "skipped">;
    output?: unknown;
    userEdit: unknown;
    reviewerUserId: number;
    confirmedAt: Date;
  }) {
    const checkpoint = await this.getCheckpointForUpdate(input.runId, input.nodeId);
    const from = String(checkpoint.status) as AgentNodeStatus;
    assertNodeTransition(from, input.to, "confirm node");
    await rawExecute(
      this.executor,
      "UPDATE emperor_agent_checkpoints SET status=?,output=COALESCE(?,output),userEdit=?,reviewerUserId=?,confirmedAt=?,completedAt=?,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,retryScheduledAt=NULL,lastFailureKind=NULL,updatedAt=NOW() WHERE runId=? AND nodeId=?",
      [
        input.to,
        input.output === undefined ? null : serializeJson(input.output),
        serializeJson(input.userEdit),
        input.reviewerUserId,
        input.confirmedAt,
        input.confirmedAt,
        input.runId,
        input.nodeId,
      ],
    );
    return { from, to: input.to };
  }

  async resetNodeForRerun(input: {
    runId: string;
    nodeId: string;
  }) {
    const checkpoint = await this.getCheckpointForUpdate(input.runId, input.nodeId);
    const from = String(checkpoint.status) as AgentNodeStatus;
    assertNodeTransition(from, "ready", "rerun node");
    await rawExecute(
      this.executor,
      `UPDATE emperor_agent_checkpoints
       SET status='ready',input=NULL,output=NULL,userEdit=NULL,skillRunId=NULL,aiJobRunId=NULL,aiJobAttempt=0,aiJobClaimedAt=NULL,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,retryCount=0,retryScheduledAt=NULL,lastFailureKind=NULL,reviewerUserId=NULL,errorMessage=NULL,startedAt=NULL,completedAt=NULL,confirmedAt=NULL,updatedAt=NOW()
       WHERE runId=? AND nodeId=?`,
      [input.runId, input.nodeId],
    );
    const run = await this.getRunForUpdate(input.runId);
    assertRunTransition(String(run.status) as AgentRunStatus, "waiting_human", "rerun node");
    await rawExecute(
      this.executor,
      "UPDATE emperor_agent_runs SET status='waiting_human',currentNodeId=?,errorMessage=NULL,completedAt=NULL,updatedAt=NOW() WHERE runId=?",
      [input.nodeId, input.runId],
    );
    return { from, to: "ready" as AgentNodeStatus };
  }

  async resetDescendants(input: {
    runId: string;
    nodeIds: string[];
  }) {
    if (input.nodeIds.length === 0) return { reset: 0 };
    for (const nodeId of input.nodeIds) {
      const checkpoint = await this.getCheckpointForUpdate(input.runId, nodeId);
      assertNodeTransition(String(checkpoint.status) as AgentNodeStatus, "pending", "reset descendant");
    }
    const placeholders = input.nodeIds.map(() => "?").join(",");
    await rawExecute(
      this.executor,
      `UPDATE emperor_agent_checkpoints
       SET status='pending',input=NULL,output=NULL,userEdit=NULL,skillRunId=NULL,aiJobRunId=NULL,aiJobAttempt=0,aiJobClaimedAt=NULL,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,retryCount=0,retryScheduledAt=NULL,lastFailureKind=NULL,reviewerUserId=NULL,errorMessage=NULL,startedAt=NULL,completedAt=NULL,confirmedAt=NULL,updatedAt=NOW()
       WHERE runId=? AND nodeId IN (${placeholders})`,
      [input.runId, ...input.nodeIds],
    );
    return { reset: input.nodeIds.length };
  }

  async cancelRun(input: {
    runId: string;
    reason: string;
    completedAt: Date;
  }) {
    const run = await this.getRunForUpdate(input.runId);
    assertRunTransition(String(run.status) as AgentRunStatus, "canceled", "cancel run");
    await rawExecute(
      this.executor,
      "UPDATE emperor_agent_checkpoints SET status='canceled',errorMessage=?,completedAt=?,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,retryScheduledAt=NULL,lastFailureKind='cancel',updatedAt=NOW() WHERE runId=? AND status='running'",
      [input.reason, input.completedAt, input.runId],
    );
    await rawExecute(
      this.executor,
      "UPDATE emperor_agent_runs SET status='canceled',currentNodeId=NULL,errorMessage=?,completedAt=?,updatedAt=NOW() WHERE runId=?",
      [input.reason, input.completedAt, input.runId],
    );
    return { from: String(run.status) as AgentRunStatus, to: "canceled" as AgentRunStatus };
  }
}

export async function withAgentStateMachine<T>(callback: (stateMachine: AgentStateMachine) => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return (db as any).transaction(async (tx: SqlExecutor) => callback(new AgentStateMachine(tx)));
}
