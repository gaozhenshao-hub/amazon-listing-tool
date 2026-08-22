import { count, eq } from "drizzle-orm";
import { opsAsinDailySnapshots } from "../drizzle/schema";
import { dataImportRouter } from "../server/routers/dataImport";
import { getDb } from "../server/repositories/dbClient";

const user = { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } as any;

async function main() {
  const importId = Number(process.env.IMPORT_ID || "630001");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const snapshots = await db.select({ reportDate: opsAsinDailySnapshots.reportDate, asin: opsAsinDailySnapshots.asin, storeName: opsAsinDailySnapshots.storeName, country: opsAsinDailySnapshots.country }).from(opsAsinDailySnapshots).where(eq(opsAsinDailySnapshots.importId, importId));
  if (!snapshots.length) throw new Error("FBA import snapshots not found");
  const asOfDate = snapshots[0].reportDate;
  const caller = dataImportRouter.createCaller({ user, workspaceId: user.defaultWorkspaceId, requestId: "lingxing-fba-planning-read-audit", req: { headers: {}, header: () => undefined } as any, res: { locals: { requestId: "lingxing-fba-planning-read-audit" } } as any });
  const planning = await caller.getInventoryPlanningFromImport({ asOfDate, marketplace: "ALL" });
  const snapshotKeys = new Set(snapshots.map((row) => `${row.asin}::${row.storeName}::${row.country}`));
  const matchedPlanningRows = planning.rows.filter((row: any) => snapshotKeys.has(`${row.asin}::${row.storeName}::${row.country}`));
  console.log(JSON.stringify({ importId, snapshotCount: snapshots.length, asOfDate, planningAsOfDate: planning.asOfDate, planningRowCount: planning.rows.length, matchedPlanningRows: matchedPlanningRows.length }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "FBA planning read audit failed"); process.exitCode = 1; });
