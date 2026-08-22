import { and, asc, count, eq, gte, lte } from "drizzle-orm";
import { inventoryConfig, opsExternalSyncConfirmations, opsInventoryPlanningParameters, opsLocalInventoryAdjustments } from "../drizzle/schema";
import { getDb } from "../server/repositories/dbClient";

async function main() {
  const batchId = Number(process.env.BATCH_ID || "2");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const confirmations = await db.select({ action: opsExternalSyncConfirmations.action, createdAt: opsExternalSyncConfirmations.createdAt }).from(opsExternalSyncConfirmations).where(eq(opsExternalSyncConfirmations.batchId, batchId)).orderBy(asc(opsExternalSyncConfirmations.createdAt));
  const confirmedAt = confirmations.find((item) => item.action === "confirm")?.createdAt;
  const appliedAt = confirmations.find((item) => item.action === "apply")?.createdAt;
  if (!confirmedAt || !appliedAt) throw new Error("Confirm/apply audit window not found");
  const window = and(gte(opsInventoryPlanningParameters.updatedAt, confirmedAt), lte(opsInventoryPlanningParameters.updatedAt, appliedAt));
  const [planningUpdates] = await db.select({ count: count() }).from(opsInventoryPlanningParameters).where(window);
  const [legacyConfigUpdates] = await db.select({ count: count() }).from(inventoryConfig).where(and(gte(inventoryConfig.updatedAt, confirmedAt), lte(inventoryConfig.updatedAt, appliedAt)));
  const [localInventoryChanges] = await db.select({ count: count() }).from(opsLocalInventoryAdjustments).where(and(gte(opsLocalInventoryAdjustments.createdAt, confirmedAt), lte(opsLocalInventoryAdjustments.createdAt, appliedAt)));
  console.log(JSON.stringify({ batchId, confirmationEvents: confirmations.map((item) => item.action), planningParameterUpdatesDuringApply: Number(planningUpdates?.count || 0), legacyInventoryConfigUpdatesDuringApply: Number(legacyConfigUpdates?.count || 0), localInventoryAdjustmentsDuringApply: Number(localInventoryChanges?.count || 0) }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "FBA parameter protection audit failed"); process.exitCode = 1; });
