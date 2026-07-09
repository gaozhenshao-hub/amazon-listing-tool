/**
 * 完整数据库迁移脚本
 * 策略：
 * 1. 清空 __drizzle_migrations 表（只有 1 条记录，不影响数据）
 * 2. 按 _journal.json 顺序执行所有 SQL 文件
 * 3. 每个文件执行后插入迁移记录
 * 4. 忽略幂等性错误（表已存在、列已存在等）
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL 未设置");
  process.exit(1);
}

const conn = await createConnection(DATABASE_URL);

// 读取 journal
const journal = JSON.parse(readFileSync(join(__dirname, "drizzle/meta/_journal.json"), "utf-8"));
const entries = journal.entries;

console.log(`📋 共 ${entries.length} 个迁移文件\n`);

// 清空迁移记录（只有 1 条，安全）
await conn.execute("DELETE FROM __drizzle_migrations");
console.log("🗑️  已清空迁移记录，重新执行...\n");

let successCount = 0;
let errorCount = 0;

for (const entry of entries) {
  const sqlFile = join(__dirname, "drizzle", entry.tag + ".sql");
  
  if (!existsSync(sqlFile)) {
    console.log(`  ⏭️  跳过（文件不存在）: ${entry.tag}`);
    continue;
  }

  const sql = readFileSync(sqlFile, "utf-8");
  const hash = createHash("sha256").update(sql).digest("hex");

  // 按 --> statement-breakpoint 或分号拆分语句
  const statements = sql
    .split(/;|--> statement-breakpoint/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith("--"));

  let fileOk = true;
  for (const stmt of statements) {
    if (!stmt.trim()) continue;
    try {
      await conn.execute(stmt);
    } catch (err) {
      const code = err?.code || "";
      const msg = err?.message || "";
      // 忽略幂等性错误
      if (
        code === "ER_TABLE_EXISTS_ERROR" ||
        code === "ER_DUP_FIELDNAME" ||
        code === "ER_DUP_KEYNAME" ||
        code === "ER_DUP_ENTRY" ||
        msg.includes("already exists") ||
        msg.includes("Duplicate entry") ||
        msg.includes("Duplicate key")
      ) {
        // 静默跳过
      } else {
        console.warn(`    ⚠️  [${entry.tag}] ${msg.slice(0, 100)}`);
        fileOk = false;
      }
    }
  }

  // 记录迁移（无论是否有警告，都记录以避免重复执行）
  try {
    await conn.execute(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      [hash, Date.now()]
    );
  } catch (e) {
    // 忽略重复插入
  }

  if (fileOk) {
    console.log(`  ✅ ${entry.tag}`);
    successCount++;
  } else {
    console.log(`  ⚠️  ${entry.tag} (部分语句有警告，已跳过)`);
    errorCount++;
  }
}

// 额外执行非 journal 中的迁移文件
const extraFiles = [
  "0059_product_weekly_ops.sql",
  "0099_budget_tracking.sql",
  "0100_data_import_center.sql",
  "ad_tracking_migration.sql",
  "dsp_migration.sql",
  "ops_plan_migration.sql",
  "ops_plan_migration_fix.sql",
  "review_migration.sql",
  "video_script_migration.sql",
  "video_script_v2_migration.sql",
];

console.log("\n📦 执行额外迁移文件...");
for (const file of extraFiles) {
  const sqlFile = join(__dirname, "drizzle", file);
  if (!existsSync(sqlFile)) continue;

  const sql = readFileSync(sqlFile, "utf-8");
  const statements = sql
    .split(/;|--> statement-breakpoint/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith("--"));

  let fileOk = true;
  for (const stmt of statements) {
    if (!stmt.trim()) continue;
    try {
      await conn.execute(stmt);
    } catch (err) {
      const code = err?.code || "";
      const msg = err?.message || "";
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
        console.warn(`    ⚠️  [${file}] ${msg.slice(0, 100)}`);
        fileOk = false;
      }
    }
  }

  if (fileOk) {
    console.log(`  ✅ ${file}`);
    successCount++;
  } else {
    console.log(`  ⚠️  ${file} (部分语句有警告)`);
    errorCount++;
  }
}

await conn.end();

// 统计
console.log(`\n🎉 迁移完成！成功: ${successCount}, 有警告: ${errorCount}`);
