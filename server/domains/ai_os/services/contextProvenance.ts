import { randomUUID, createHash } from "node:crypto";
import { rawExecute } from "../routerContext";
import { appendRunLedgerEvent } from "./runLedger";

const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
const parse = (value: unknown) => typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return {}; } })() : (value || {});

export function extractContextProvenanceSources(manifest: unknown) {
  const root: any = parse(manifest);
  const context = root.context || root;
  const attachments = Array.isArray(context.attachments) ? context.attachments : [];
  const knowledge = Array.isArray(context.knowledgeReferences) ? context.knowledgeReferences : [];
  return [
    ...attachments.map((item: any) => ({ sourceType: "attachment", sourceKey: String(item.attachmentId || item.artifactId || "").slice(0, 160), source: { artifactId: item.artifactId || null, mimeType: item.mimeType || null, contextPolicy: item.contextPolicy || null, contextSummary: item.contextSummary || null } })),
    ...knowledge.map((item: any) => ({ sourceType: "knowledge", sourceKey: String(item.referenceId || "").slice(0, 160), source: { sourceKind: item.sourceKind || null, title: item.title || null, tags: item.tags || [], contextSummary: item.contextSummary || null } })),
  ].filter((item) => item.sourceKey);
}

export async function recordContextSourceProvenance(input: { manifestId: string; traceId: string; manifest: unknown }) {
  for (const item of extractContextProvenanceSources(input.manifest)) {
    await rawExecute(
      "INSERT INTO emperor_context_source_provenance (provenanceId,manifestId,traceId,sourceType,sourceKey,sourceHash) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE sourceHash=VALUES(sourceHash)",
      [`provenance_${randomUUID().replace(/-/g, "")}`, input.manifestId, input.traceId, item.sourceType, item.sourceKey, fingerprint(item.source)],
    );
  }
}

export async function listRunLedgerProjection(input: { traceId: string; afterId?: number; limit?: number }) {
  const limit = Math.min(Math.max(Math.floor(input.limit || 100), 1), 300);
  const events = await rawExecute(
    `SELECT id,eventId,eventType,entityType,entityId,nodeId,skillSlug,toolSlug,jobRunId,actorUserId,payload,visibility,occurredAt
     FROM emperor_run_ledger_events WHERE traceId=? AND id>? ORDER BY id ASC LIMIT ${limit}`,
    [input.traceId, Math.max(Number(input.afterId || 0), 0)],
  );
  const provenance = await rawExecute("SELECT sourceType,sourceKey,status,invalidationReason,invalidatedAt FROM emperor_context_source_provenance WHERE traceId=? ORDER BY id ASC", [input.traceId]);
  return { events: events.map((event: any) => ({ ...event, payload: parse(event.payload) })), provenance, nextCursor: events.length ? Number(events[events.length - 1].id) : Math.max(Number(input.afterId || 0), 0) };
}

export async function listInvalidatedContextSources(traceId: string) {
  return rawExecute(
    "SELECT sourceType,sourceKey,invalidationReason,invalidatedAt FROM emperor_context_source_provenance WHERE traceId=? AND status='invalidated' ORDER BY id ASC",
    [traceId],
  );
}

export async function invalidateContextSource(input: { sourceType: string; sourceKey: string; reason: string; userId: number }) {
  // rawExecute标准化为行集，不暴露UPDATE元数据；先计算仍为valid的匹配数，避免把空行集误判为0。
  const pendingRows = await rawExecute(
    "SELECT COUNT(*) AS count FROM emperor_context_source_provenance WHERE sourceType=? AND sourceKey=? AND status='valid'",
    [input.sourceType, input.sourceKey],
  );
  const invalidated = Number((pendingRows[0] as any)?.count || 0);
  await rawExecute(
    "UPDATE emperor_context_source_provenance SET status='invalidated',invalidationReason=?,invalidatedBy=?,invalidatedAt=NOW() WHERE sourceType=? AND sourceKey=? AND status='valid'",
    [input.reason.slice(0, 512), input.userId, input.sourceType, input.sourceKey],
  );
  const rows = await rawExecute("SELECT DISTINCT traceId FROM emperor_context_source_provenance WHERE sourceType=? AND sourceKey=? AND status='invalidated'", [input.sourceType, input.sourceKey]);
  await Promise.all(rows.map((row: any) => appendRunLedgerEvent({ traceId: row.traceId, eventType: "context.source_invalidated", entityType: "system", entityId: `${input.sourceType}:${input.sourceKey}`, actorUserId: input.userId, payload: { sourceType: input.sourceType, sourceKey: input.sourceKey, reason: input.reason.slice(0, 512) }, visibility: "admin" })));
  return { invalidated };
}
