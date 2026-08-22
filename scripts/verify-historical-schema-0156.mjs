import { createConnection } from "mysql2/promise";

const requiredTables = [
  "ops_asin_daily_snapshots", "ops_inventory_planning_parameters", "ops_asin_lifecycle_status",
];
const requiredColumns = [
  ["data_imports", "data_granularity"], ["data_imports", "replaces_import_id"], ["data_imports", "superseded_at"], ["ops_inventory_planning_parameters", "parent_asin"],
  ["dev_project_progress", "operatorName"], ["dev_project_progress", "landingStage"], ["dev_panorama_status", "currentVersionId"],
];
const connection = await createConnection({ uri: process.env.DATABASE_URL });
try {
  const [tables] = await connection.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?)", [requiredTables]);
  const [columns] = await connection.query("SELECT table_name AS tableName,column_name AS columnName FROM information_schema.columns WHERE table_schema=DATABASE() AND (table_name,column_name) IN (?)", [requiredColumns]);
  const tableNames = new Set(tables.map((row) => row.name));
  const columnNames = new Set(columns.map((row) => `${row.tableName}.${row.columnName}`));
  const missingTables = requiredTables.filter((name) => !tableNames.has(name));
  const missingColumns = requiredColumns.map(([table, column]) => `${table}.${column}`).filter((name) => !columnNames.has(name));
  console.log(JSON.stringify({ verified: missingTables.length === 0 && missingColumns.length === 0, missingTables, missingColumns, requiredTableCount: requiredTables.length, requiredColumnCount: requiredColumns.length }));
  if (missingTables.length || missingColumns.length) process.exitCode = 2;
} finally {
  await connection.end();
}
