import { count, eq } from "drizzle-orm";
import { adCampaignReports, adReportImports, opsExternalSyncBatches, opsExternalSyncConfirmations } from "../drizzle/schema";
import { getDb } from "../server/repositories/dbClient";
import { rawExecute } from "../server/domains/ai_os/routerContext";

async function main() {
  const batchId = Number(process.env.BATCH_ID || "1");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [batch] = await db.select({ status: opsExternalSyncBatches.status, traceId: opsExternalSyncBatches.traceId }).from(opsExternalSyncBatches).where(eq(opsExternalSyncBatches.id, batchId)).limit(1);
  if (!batch) throw new Error("Sync batch not found");
  const confirmations = await db.select({ action: opsExternalSyncConfirmations.action, selectedRowIds: opsExternalSyncConfirmations.selectedRowIds }).from(opsExternalSyncConfirmations).where(eq(opsExternalSyncConfirmations.batchId, batchId));
  const [importRow] = await db.select({ id: adReportImports.id, status: adReportImports.status, totalRows: adReportImports.totalRows }).from(adReportImports).where(eq(adReportImports.id, 120001)).limit(1);
  const [campaignCount] = await db.select({ count: count() }).from(adCampaignReports).where(eq(adCampaignReports.uploadId, 120001));
  const ledger = batch.traceId ? await rawExecute("SELECT eventType, COUNT(*) AS count FROM emperor_run_ledger_events WHERE traceId=? GROUP BY eventType ORDER BY eventType", [String(batch.traceId)]).catch(() => []) : [];
  console.log(JSON.stringify({ batchStatus: batch.status, confirmations: confirmations.map((item) => ({ action: item.action, selectedCount: Array.isArray(item.selectedRowIds) ? item.selectedRowIds.length : 0 })), import: importRow || null, campaignRowCount: Number(campaignCount?.count || 0), ledger }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "LingXing ad batch audit failed"); process.exitCode = 1; });
