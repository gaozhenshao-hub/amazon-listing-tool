/**
 * 正确解析并执行 video_script_migration.sql
 * 该文件中 CREATE TABLE 语句以 ); 结尾，需要正确分割
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { readFileSync } from "fs";

const conn = await createConnection(process.env.DATABASE_URL);

for (const file of ["drizzle/video_script_migration.sql", "drizzle/video_script_v2_migration.sql"]) {
  console.log(`\n=== ${file} ===`);
  const sql = readFileSync(file, "utf-8");
  
  // 按 --> statement-breakpoint 或 ";\n" 分割（避免在 enum 值内分割）
  // 更好的方式：找到每个顶层语句的结束位置（括号深度为0时的分号）
  const stmts = [];
  let current = "";
  let depth = 0;
  let inString = false;
  let stringChar = "";
  
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    
    if (inString) {
      current += ch;
      if (ch === stringChar && sql[i-1] !== "\\") {
        inString = false;
      }
      continue;
    }
    
    if (ch === "'" || ch === '"' || ch === "`") {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }
    
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    
    current += ch;
    
    if (ch === ";" && depth === 0) {
      const stmt = current.trim().replace(/^--.*$/gm, "").trim();
      if (stmt && stmt !== ";") {
        stmts.push(stmt);
      }
      current = "";
    }
  }
  
  // 处理最后一个没有分号的语句
  if (current.trim()) {
    const stmt = current.trim().replace(/^--.*$/gm, "").trim();
    if (stmt) stmts.push(stmt);
  }
  
  for (const stmt of stmts) {
    const preview = stmt.replace(/\s+/g, " ").slice(0, 80);
    if (!stmt.trim() || stmt.trim().startsWith("--")) continue;
    
    try {
      await conn.execute(stmt);
      console.log("  ✅", preview);
    } catch (e) {
      const code = e.code || "";
      const msg = e.message || "";
      if (
        code === "ER_TABLE_EXISTS_ERROR" ||
        code === "ER_DUP_KEYNAME" ||
        msg.includes("already exists") ||
        msg.includes("Duplicate key name")
      ) {
        console.log("  ⏭️ SKIP:", preview);
      } else {
        console.warn("  ⚠️ WARN:", msg.slice(0, 100));
        console.warn("     SQL:", preview);
      }
    }
  }
}

await conn.end();
console.log("\n✅ Done");
