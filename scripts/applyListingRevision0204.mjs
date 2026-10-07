import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { acquireMigrationLock, applyMigrations, ensureLedger, loadMigrationPlan, readLedger } from "./run-database-migrations.mjs";

const targetName = "0204_listing_revision_governance.sql";
const args = new Set(process.argv.slice(2));
const [migration] = loadMigrationPlan().filter((item) => item.fileName === targetName);
if (!migration) throw new Error(`Missing reviewed migration ${targetName}`);
if (!args.has("--apply-dev")) {
  console.log(JSON.stringify({ mode: "preview", file: targetName, checksum: migration.checksum, statements: "five additive tables only" }));
  process.exit(0);
}
if (args.size !== 1 || process.env.NODE_ENV === "production") throw new Error("Only a dedicated development --apply-dev run is supported; production requires a separately authorized release plan");
if (!process.env.DATABASE_URL) throw new Error("Development DATABASE_URL is required");
const connection = await createConnection({ uri: process.env.DATABASE_URL, multipleStatements: true });
let releaseLock;
try {
  const [dbName] = await connection.query("SELECT DATABASE() AS name");
  if (!String(dbName?.[0]?.name || "").trim()) throw new Error("No database selected");
  releaseLock = await acquireMigrationLock(connection);
  await ensureLedger(connection);
  const ledger = await readLedger(connection);
  const existing = ledger.get(targetName);
  if (existing && existing.checksum !== migration.checksum) throw new Error("Reviewed migration checksum drifted; refuse to apply");
  if (existing?.status === "failed" || existing?.status === "started") throw new Error("Migration requires manual inspection before retry");
  await applyMigrations(connection, [migration], { retryFailed: false });
  const final = (await readLedger(connection)).get(targetName);
  if (final?.status !== "succeeded" || final.checksum !== migration.checksum) throw new Error("Migration ledger postcondition failed");
  console.log(JSON.stringify({ mode: "development", file: targetName, status: "succeeded", checksum: migration.checksum }));
} finally {
  if (releaseLock) await releaseLock();
  await connection.end();
}
