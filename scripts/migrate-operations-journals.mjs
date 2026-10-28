import mysql from "mysql2/promise";
import { acquireMigrationLock, applyMigrations, ensureLedger, loadOperationsJournalMigrationPlan } from "./run-database-migrations.mjs";

const plan = loadOperationsJournalMigrationPlan();
if (!process.argv.includes("--execute")) {
  console.log(JSON.stringify(plan.map(({ fileName, checksum }) => ({ fileName, checksum }))));
} else {
  const target = process.argv.find(value => value.startsWith("--database="))?.slice(11);
  if (!target || !process.env.DATABASE_URL) throw new Error("Explicit target database and DATABASE_URL are required");
  const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, multipleStatements: true });
  let unlock;
  try {
    const [rows] = await connection.query("SELECT DATABASE() AS name");
    if (rows[0]?.name !== target) throw new Error("Target database mismatch");
    unlock = await acquireMigrationLock(connection);
    await ensureLedger(connection);
    await applyMigrations(connection, plan);
    const [columns] = await connection.query("SHOW COLUMNS FROM ops_work_journals");
    if (columns.length !== 11) throw new Error("Journal schema mismatch");
  } finally { if (unlock) await unlock(); await connection.end(); }
}
