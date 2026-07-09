/**
 * 按顺序执行 drizzle/ 目录下的所有 SQL 迁移文件
 * 忽略"表已存在"等幂等性错误，确保可重复执行
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL 未设置");
  process.exit(1);
}

// 按文件名排序，确保按序执行
const drizzleDir = join(__dirname, "drizzle");
const allFiles = readdirSync(drizzleDir)
  .filter(f => f.endsWith(".sql"))
  .sort();

console.log(`📦 共找到 ${allFiles.length} 个 SQL 文件，开始迁移...\n`);

const conn = await createConnection(DATABASE_URL);

let successCount = 0;
let skipCount = 0;
let errorCount = 0;

for (const file of allFiles) {
  const filePath = join(drizzleDir, file);
  const sql = readFileSync(filePath, "utf-8");

  // 按分号拆分多条语句，过滤空语句
  const statements = sql
    .split(";")
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith("--"));

  let fileOk = true;
  for (const stmt of statements) {
    try {
      await conn.execute(stmt);
    } catch (err) {
      const code = err?.code || "";
      const msg = err?.message || "";
      // 忽略幂等性错误：表已存在、列已存在、索引已存在、重复键
      if (
        code === "ER_TABLE_EXISTS_ERROR" ||
        code === "ER_DUP_FIELDNAME" ||
        code === "ER_DUP_KEYNAME" ||
        code === "ER_DUP_ENTRY" ||
        msg.includes("already exists") ||
        msg.includes("Duplicate")
      ) {
        // 静默跳过
      } else {
        console.error(`  ⚠️  [${file}] 语句执行失败: ${msg.slice(0, 120)}`);
        fileOk = false;
        errorCount++;
      }
    }
  }

  if (fileOk) {
    console.log(`  ✅ ${file}`);
    successCount++;
  } else {
    skipCount++;
  }
}

await conn.end();

console.log(`\n🎉 迁移完成！成功: ${successCount}, 跳过/警告: ${skipCount}, 错误: ${errorCount}`);
if (errorCount > 0) {
  process.exit(1);
}
