import { randomUUID, createHash } from "node:crypto";
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

export async function ensureAgentRunTrace(input: { runId: string; workspaceId?: number | null; agentSlug?: string | null; projectId?: number | null; userId?: number | null; metadata?: unknown }) {
  await execute(
    `INSERT INTO emperor_run_traces (workspaceId,traceId,rootRunId,rootRunType,agentSlug,projectId,userId,status,metadata)
     VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE updatedAt=NOW()`,
    [input.workspaceId ?? null, input.runId, input.runId, "agent_run", input.agentSlug ?? null, input.projectId ?? null, input.userId ?? null, "running", json(input.metadata)],
  );
  return input.runId;
}

export async function appendRunLedgerEvent(input: RunLedgerEventInput) {
  const payload = sanitizeLedgerPayload(input.payload ?? null);
  await execute(
    `INSERT INTO emperor_run_ledger_events (eventId,traceId,eventType,entityType,entityId,nodeId,skillSlug,toolSlug,jobRunId,actorUserId,payloadHash,payload,visibility)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [`ledger_${randomUUID()}`, input.traceId, input.eventType, input.entityType, input.entityId ?? null, input.nodeId ?? null, input.skillSlug ?? null, input.toolSlug ?? null, input.jobRunId ?? null, input.actorUserId ?? null, hash(payload), JSON.stringify(payload), input.visibility ?? "admin"],
  );
}
