import { createHash, randomUUID } from "node:crypto";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../../../repositories/dbClient";

export type RunLedgerEventInput = {
  traceId: string;
  eventType: string;
  entityType: "agent_run" | "agent_node" | "skill_run" | "tool_run" | "ai_job" | "human_review" | "artifact" | "system";
  entityId?: string | null;
  nodeId?: string | null;
  skillSlug?: string | null;
  toolSlug?: string | null;
  jobRunId?: string | null;
  actorUserId?: number | null;
  payload?: unknown;
  visibility?: "admin" | "operator" | "system";
};

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|token|secret|password|api[-_]?key|access[-_]?key|refresh[-_]?token|connection[-_]?string|dsn)/i;

function sanitizeLedgerPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MaxDepth]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeLedgerPayload(item, depth + 1));
  if (typeof value !== "object") return typeof value === "string" && value.length > 24_000 ? `${value.slice(0, 24_000)}…[truncated]` : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 200).map(([key, item]) => [key, SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeLedgerPayload(item, depth + 1)]));
}

function json(value: unknown) { return JSON.stringify(sanitizeLedgerPayload(value ?? null)); }
function hash(value: unknown) { return createHash("sha256").update(json(value)).digest("hex"); }
function rowsOf(value: unknown): any[] {
  if (Array.isArray(value) && Array.isArray(value[0])) return value[0] as any[];
  return Array.isArray(value) ? value as any[] : [];
}

async function execute(sqlText: string, params: unknown[] = []) {
  const db = await getDb();
  if (!db) throw new Error("Database not available for Run Ledger");
  if (!params.length) return db.execute(drizzleSql.raw(sqlText));
  const parts = sqlText.split("?");
  const chunks: any[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    chunks.push(drizzleSql.raw(parts[index]));
    if (index < params.length) chunks.push(drizzleSql`${params[index]}`);
  }
  return db.execute(drizzleSql.join(chunks, drizzleSql.raw("")));
}

export async function ensureRunTrace(input: { runId: string; rootRunType: "agent_run" | "conversation_step" | "skill_run"; workspaceId?: number | null; agentSlug?: string | null; projectId?: number | null; userId?: number | null; metadata?: unknown }) {
  await execute(
    `INSERT INTO emperor_run_traces (workspaceId,traceId,rootRunId,rootRunType,agentSlug,projectId,userId,status,metadata)
     VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE updatedAt=NOW()`,
    [input.workspaceId ?? null, input.runId, input.runId, input.rootRunType, input.agentSlug ?? null, input.projectId ?? null, input.userId ?? null, "running", json(input.metadata)],
  );
  return input.runId;
}

export async function ensureAgentRunTrace(input: { runId: string; workspaceId?: number | null; agentSlug?: string | null; projectId?: number | null; userId?: number | null; metadata?: unknown }) {
  return ensureRunTrace({ ...input, rootRunType: "agent_run" });
}

export async function completeRunTrace(traceId: string, status: "completed" | "failed" | "running") {
  await execute("UPDATE emperor_run_traces SET status=?,updatedAt=NOW() WHERE traceId=?", [status, traceId]);
}

export async function appendRunLedgerEvent(input: RunLedgerEventInput) {
  const payload = sanitizeLedgerPayload(input.payload ?? null);
  await execute(
    `INSERT INTO emperor_run_ledger_events (eventId,traceId,eventType,entityType,entityId,nodeId,skillSlug,toolSlug,jobRunId,actorUserId,payloadHash,payload,visibility)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [`ledger_${randomUUID()}`, input.traceId, input.eventType, input.entityType, input.entityId ?? null, input.nodeId ?? null, input.skillSlug ?? null, input.toolSlug ?? null, input.jobRunId ?? null, input.actorUserId ?? null, hash(payload), JSON.stringify(payload), input.visibility ?? "admin"],
  );
}

export async function recordContextManifest(input: {
  traceId: string;
  runId: string;
  nodeId?: string | null;
  manifest: unknown;
  sourceCount?: number;
  estimatedTokens?: number | null;
  maxTokens?: number | null;
}) {
  const manifest = sanitizeLedgerPayload(input.manifest);
  const contextHash = hash(manifest);
  await execute(
    `INSERT INTO emperor_context_manifests (manifestId,traceId,runId,nodeId,manifestVersion,contextHash,estimatedTokens,maxTokens,sourceCount,manifest)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [`manifest_${randomUUID()}`, input.traceId, input.runId, input.nodeId ?? null, "1.0", contextHash, input.estimatedTokens ?? null, input.maxTokens ?? null, input.sourceCount ?? 0, JSON.stringify(manifest)],
  );
  await execute("UPDATE emperor_run_traces SET contextManifestHash=?,updatedAt=NOW() WHERE traceId=?", [contextHash, input.traceId]);
  return contextHash;
}

export async function listRunTraces(input: { limit?: number; projectId?: number } = {}) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 300);
  const where = input.projectId ? "WHERE projectId=?" : "";
  return rowsOf(await execute(`SELECT * FROM emperor_run_traces ${where} ORDER BY createdAt DESC LIMIT ${limit}`, input.projectId ? [input.projectId] : []));
}

export async function getRunTrace(traceId: string) {
  const [traces, events, manifests] = await Promise.all([
    execute("SELECT * FROM emperor_run_traces WHERE traceId=? LIMIT 1", [traceId]),
    execute("SELECT * FROM emperor_run_ledger_events WHERE traceId=? ORDER BY id ASC", [traceId]),
    execute("SELECT * FROM emperor_context_manifests WHERE traceId=? ORDER BY id ASC", [traceId]),
  ]);
  return { trace: rowsOf(traces)[0] ?? null, events: rowsOf(events), manifests: rowsOf(manifests) };
}
