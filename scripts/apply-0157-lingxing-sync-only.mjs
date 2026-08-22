import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "mysql2/promise";

if (!process.argv.includes("--confirm-0157-only")) throw new Error("Pass --confirm-0157-only to apply this forward repair");
if (!process.env.DATABASE_URL || process.env.ALLOW_PRODUCTION_MIGRATIONS !== "true") throw new Error("DATABASE_URL and ALLOW_PRODUCTION_MIGRATIONS=true are required");

const migrationName = "0157_ops_external_sync_drafts.sql";
const sql = readFileSync(join(process.cwd(), "drizzle", migrationName), "utf8").replaceAll("--> statement-breakpoint", "");
const checksum = createHash("sha256").update(sql).digest("hex");
const connection = await createConnection({ uri: process.env.DATABASE_URL, multipleStatements: true });
try {
  await connection.query(`CREATE TABLE IF NOT EXISTS app_schema_migrations (
    migrationName varchar(255) NOT NULL, checksum varchar(64) NOT NULL,
    status enum('started','succeeded','failed','baselined') NOT NULL, executionId varchar(80),
    startedAt timestamp NULL, finishedAt timestamp NULL, error text, metadata json,
    createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (migrationName))`);
  const [existing] = await connection.execute("SELECT checksum,status FROM app_schema_migrations WHERE migrationName=?", [migrationName]);
  if (existing[0]?.checksum && existing[0].checksum !== checksum) throw new Error("0157 checksum mismatch; refusing to overwrite migration ledger");
  if (existing[0]?.status === "succeeded") {
    console.log(JSON.stringify({ migrationName, status: "already_succeeded" }));
  } else {
    await connection.execute("INSERT INTO app_schema_migrations (migrationName,checksum,status,executionId,startedAt,metadata) VALUES (?,?,'started','forward-repair-0157',NOW(),JSON_OBJECT('reason','isolated forward migration after historical duplicate-column ledger repair')) ON DUPLICATE KEY UPDATE checksum=VALUES(checksum),status='started',startedAt=NOW(),error=NULL", [migrationName, checksum]);
    await connection.query(sql);
    await connection.execute("UPDATE app_schema_migrations SET status='succeeded',finishedAt=NOW(),error=NULL WHERE migrationName=?", [migrationName]);
    console.log(JSON.stringify({ migrationName, status: "succeeded", tables: ["ops_external_sync_batches", "ops_external_sync_rows", "ops_external_sync_confirmations"] }));
  }
} catch (error) {
  await connection.execute("UPDATE app_schema_migrations SET status='failed',finishedAt=NOW(),error=? WHERE migrationName=?", [String(error?.message || error).slice(0, 8000), migrationName]).catch(() => undefined);
  throw error;
} finally {
  await connection.end();
}
