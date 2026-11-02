import { count, eq } from "drizzle-orm";
import { dataImports, lingxingProductWeekly, opsExternalSyncBatches, opsExternalSyncConfirmations } from "../drizzle/schema";
import { rawExecute } from "../server/domains/ai_os/routerContext";
import { getDb } from "../server/repositories/dbClient";

async function main() {
  const batchId = Number(process.env.BATCH_ID || "3");
  const importId = Number(process.env.IMPORT_ID || "630002");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [batch] = await db.select({ status: opsExternalSyncBatches.status, traceId: opsExternalSyncBatches.traceId }).from(opsExternalSyncBatches).where(eq(opsExternalSyncBatches.id, batchId)).limit(1);
  if (!batch) throw new Error("Sync batch not found");
  const confirmations = await db.select({ action: opsExternalSyncConfirmations.action, selectedRowIds: opsExternalSyncConfirmations.selectedRowIds }).from(opsExternalSyncConfirmations).where(eq(opsExternalSyncConfirmations.batchId, batchId));
  const [importRow] = await db.select({ id: dataImports.id, status: dataImports.status, totalRows: dataImports.totalRows, importedRows: dataImports.importedRows, skippedRows: dataImports.skippedRows }).from(dataImports).where(eq(dataImports.id, importId)).limit(1);
  const [weeklyCount] = await db.select({ count: count() }).from(lingxingProductWeekly).where(eq(lingxingProductWeekly.importId, importId));
  const ledger = batch.traceId ? await rawExecute("SELECT eventType, COUNT(*) AS count FROM emperor_run_ledger_events WHERE traceId=? GROUP BY eventType ORDER BY eventType", [String(batch.traceId)]).catch(() => []) : [];
  console.log(JSON.stringify({ batchStatus: batch.status, confirmations: confirmations.map((item) => ({ action: item.action, selectedCount: Array.isArray(item.selectedRowIds) ? item.selectedRowIds.length : 0 })), import: importRow || null, weeklyCount: Number(weeklyCount?.count || 0), ledger }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "LingXing order profit batch audit failed"); process.exitCode = 1; });
