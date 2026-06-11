/**
 * 直接使用 drizzle-orm 的 mysql2 驱动推送 schema
 * 通过 drizzle 的 migrate 功能执行所有迁移文件
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL 未设置");
  process.exit(1);
}

console.log("🚀 开始执行数据库迁移...");

const connection = await mysql.createConnection(DATABASE_URL);
const db = drizzle(connection);

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✅ 迁移完成！");
} catch (err) {
  console.error("❌ 迁移失败:", err.message);
  process.exit(1);
} finally {
  await connection.end();
}
