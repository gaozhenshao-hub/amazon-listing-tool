/**
 * 使用 drizzle-kit 从 schema.ts 生成完整建表 SQL，然后执行到数据库
 * 策略：先用 drizzle-kit push 直接推送 schema（CREATE TABLE IF NOT EXISTS）
 */
import "dotenv/config";
import { execSync } from "child_process";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL 未设置");
  process.exit(1);
}

console.log("🚀 使用 drizzle-kit push 推送完整 schema...");
try {
  execSync("npx drizzle-kit push --force", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL },
  });
  console.log("✅ Schema 推送完成");
} catch (err) {
  console.error("❌ Schema 推送失败:", err.message);
  process.exit(1);
}
