import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { readFileSync } from "fs";

const conn = await createConnection(process.env.DATABASE_URL);

for (const file of ["drizzle/video_script_migration.sql", "drizzle/video_script_v2_migration.sql"]) {
  const sql = readFileSync(file, "utf-8");
  const stmts = sql.split(";").map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith("--"));
  for (const stmt of stmts) {
    try {
      await conn.execute(stmt);
      console.log("OK:", stmt.slice(0, 60));
    } catch (e) {
      if (e.code === "ER_TABLE_EXISTS_ERROR" || e.message.includes("already exists") || e.message.includes("Duplicate")) {
        console.log("SKIP:", stmt.slice(0, 60));
      } else {
        console.warn("WARN:", e.message.slice(0, 100));
      }
    }
  }
}

await conn.end();
console.log("Done");
