import { createConnection } from "mysql2/promise";

const connection = await createConnection({ uri: process.env.DATABASE_URL });
try {
  const [rows] = await connection.query(
    "SELECT migrationName,status,error,updatedAt FROM app_schema_migrations WHERE migrationName >= '0137_dev_project_operator_stage.sql' ORDER BY migrationName",
  );
  console.log(JSON.stringify(rows.map((row) => ({ migrationName: row.migrationName, status: row.status, hasError: Boolean(row.error), updatedAt: row.updatedAt })), null, 2));
} finally {
  await connection.end();
}
