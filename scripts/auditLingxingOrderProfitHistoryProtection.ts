import { rawExecute } from "../server/domains/ai_os/routerContext";
import { getDb } from "../server/repositories/dbClient";
import { opsExternalSyncBatches } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const batchId = Number(process.env.BATCH_ID || "3");
  const importId = Number(process.env.IMPORT_ID || "630002");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [batch] = await db.select({ appliedAt: opsExternalSyncBatches.appliedAt }).from(opsExternalSyncBatches).where(eq(opsExternalSyncBatches.id, batchId)).limit(1);
  if (!batch?.appliedAt) throw new Error("Applied sync batch timestamp not found");
  const [imports] = await rawExecute("SELECT COUNT(*) AS historicalImportCount, COALESCE(SUM(updatedAt > ?), 0) AS updatedAfterApply FROM data_imports WHERE source_type='lingxing' AND id<>?", [batch.appliedAt, importId]) as any[];
  const [weekly] = await rawExecute("SELECT COUNT(*) AS historicalWeeklyCount, COALESCE(SUM(import_id<>?), 0) AS preservedWeeklyCount FROM lingxing_product_weekly WHERE import_id<>?", [importId, importId]) as any[];
  console.log(JSON.stringify({ historicalImportCount: Number(imports?.historicalImportCount || 0), historicalImportsUpdatedAfterApply: Number(imports?.updatedAfterApply || 0), historicalWeeklyCount: Number(weekly?.historicalWeeklyCount || 0), preservedWeeklyCount: Number(weekly?.preservedWeeklyCount || 0) }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "History protection audit failed"); process.exitCode = 1; });
