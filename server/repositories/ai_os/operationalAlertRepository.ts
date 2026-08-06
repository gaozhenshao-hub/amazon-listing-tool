import { desc, eq, notInArray, sql } from "drizzle-orm";
import { aiOperationalAlerts } from "../../../drizzle/schema";
import { requireDb } from "../dbClient";

export type OperationalAlertInput = {
  alertId: string;
  fingerprint: string;
  category: string;
  severity: "warning" | "critical";
  title: string;
  message: string;
  metadata?: unknown;
};

export async function upsertOperationalAlert(input: OperationalAlertInput) {
  const db = await requireDb("AI operational alert repository");
  await db.execute(sql`
    INSERT INTO ai_operational_alerts
      (alertId, fingerprint, category, severity, status, title, message, occurrenceCount,
       firstOccurredAt, lastOccurredAt, metadata)
    VALUES
      (${input.alertId}, ${input.fingerprint}, ${input.category}, ${input.severity}, 'open',
       ${input.title}, ${input.message}, 1, NOW(), NOW(), ${JSON.stringify(input.metadata ?? {})})
    ON DUPLICATE KEY UPDATE
      severity = VALUES(severity),
      status = 'open',
      title = VALUES(title),
      message = VALUES(message),
      occurrenceCount = occurrenceCount + 1,
      lastOccurredAt = NOW(),
      resolvedAt = NULL,
      metadata = VALUES(metadata),
      updatedAt = NOW()
  `);
  const rows = await db
    .select()
    .from(aiOperationalAlerts)
    .where(eq(aiOperationalAlerts.fingerprint, input.fingerprint))
    .limit(1);
  return rows[0] || null;
}

export async function markOperationalAlertNotified(fingerprint: string) {
  const db = await requireDb("AI operational alert notification");
  await db
    .update(aiOperationalAlerts)
    .set({ notifiedAt: new Date() })
    .where(eq(aiOperationalAlerts.fingerprint, fingerprint));
}

export async function resolveInactiveOperationalAlerts(activeFingerprints: string[]) {
  const db = await requireDb("AI operational alert resolution");
  const condition = activeFingerprints.length > 0
    ? notInArray(aiOperationalAlerts.fingerprint, activeFingerprints)
    : undefined;
  await db
    .update(aiOperationalAlerts)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(condition
      ? sql`${aiOperationalAlerts.status} = 'open' AND ${condition}`
      : eq(aiOperationalAlerts.status, "open"));
}

export async function listOperationalAlerts(input: { status?: "open" | "resolved"; limit?: number } = {}) {
  const db = await requireDb("AI operational alert history");
  const limit = Math.min(Math.max(Math.floor(input.limit || 50), 1), 200);
  const query = db.select().from(aiOperationalAlerts);
  return (input.status
    ? query.where(eq(aiOperationalAlerts.status, input.status))
    : query)
    .orderBy(desc(aiOperationalAlerts.lastOccurredAt))
    .limit(limit);
}
