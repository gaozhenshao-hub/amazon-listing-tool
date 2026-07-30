import "dotenv/config";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

// 直接测试 Teamo Router 通过 emperor_model_providers 的路由
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const conn = await mysql.createConnection(DB_URL);
const db = drizzle(conn);

// 1. 查找 listing.sellingpoints.generate skill 及其模型配置
const [skillRows] = await conn.execute(
  "SELECT slug, name, modelOverride, JSON_EXTRACT(manifest, '$.implementation.systemPrompt') as sp FROM emperor_skills WHERE slug = 'listing.sellingpoints.generate' LIMIT 1"
);
const skill = skillRows[0];
console.log("=== Skill 配置 ===");
console.log("Slug:", skill?.slug);
console.log("Name:", skill?.name);
console.log("ModelOverride:", skill?.modelOverride);
console.log("SystemPrompt (前100字):", String(skill?.sp || "").slice(0, 100));

// 2. 查找对应模型
const modelSlug = skill?.modelOverride;
const [modelRows] = await conn.execute(
  "SELECT slug, provider, modelId, baseUrl, SUBSTRING(apiKeyRef, 1, 20) as keyPrefix FROM emperor_model_providers WHERE slug = ? LIMIT 1",
  [modelSlug]
);
const model = modelRows[0];
console.log("\n=== 模型配置 ===");
console.log("Slug:", model?.slug);
console.log("Provider:", model?.provider);
console.log("ModelId:", model?.modelId);
console.log("BaseUrl:", model?.baseUrl);
console.log("ApiKey前缀:", model?.keyPrefix);

// 3. 真实调用 Teamo Router
if (model?.provider === "custom" && model?.baseUrl) {
  console.log("\n=== 真实 AI 调用测试 ===");
  const start = Date.now();
  const resp = await fetch(`${model.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${model.keyPrefix}...` // 仅用于显示
    },
    body: JSON.stringify({
      model: model.modelId,
      messages: [
        { role: "system", content: "你是亚马逊Listing专家。" },
        { role: "user", content: "请用一句话介绍卖点精雕的作用。" }
      ],
      max_tokens: 200
    }),
    signal: AbortSignal.timeout(30000)
  }).catch(e => ({ ok: false, error: e.message }));
  
  if (resp.ok) {
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    console.log("✓ 调用成功，耗时:", Date.now() - start, "ms");
    console.log("响应:", content);
    console.log("Token 消耗:", data?.usage);
  } else {
    console.log("✗ 调用失败:", resp.error || resp.status);
  }
}

await conn.end();
