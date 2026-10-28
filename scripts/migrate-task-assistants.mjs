import mysql from "mysql2/promise";
import { acquireMigrationLock, applyMigrations, ensureLedger, loadTaskAssistantMigrationPlan } from "./run-database-migrations.mjs";

const plan = loadTaskAssistantMigrationPlan();
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
    const [columns] = await connection.query("SHOW COLUMNS FROM team_tasks");
    if (!["assistant_id", "assistant_name"].every(name => columns.some(column => column.Field === name))) throw new Error("Task assistant schema mismatch");
  } finally { if (unlock) await unlock(); await connection.end(); }
}
