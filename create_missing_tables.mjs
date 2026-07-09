/**
 * 直接创建 schema.ts 中定义但迁移文件中缺失的表
 * 这些表在 drizzle journal 中不存在，需要手动创建
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL 未设置");
  process.exit(1);
}

const conn = await createConnection(DATABASE_URL);

const tables = [
  // Video Script tables
  {
    name: "video_scripts",
    sql: `CREATE TABLE IF NOT EXISTS \`video_scripts\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`userId\` int NOT NULL,
      \`projectId\` int,
      \`listingId\` int,
      \`title\` varchar(300) NOT NULL,
      \`asin\` varchar(20),
      \`productName\` varchar(300),
      \`productCategory\` varchar(100),
      \`targetAudience\` text,
      \`videoPurpose\` enum('spv_ad','sbv_ad','main_listing','aplus','social_media','other') DEFAULT 'main_listing',
      \`videoStyle\` varchar(100),
      \`totalDuration\` decimal(5,1),
      \`status\` varchar(30) DEFAULT 'draft',
      \`aiAnalysisData\` json,
      \`productContext\` json,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`video_scripts_id\` PRIMARY KEY(\`id\`)
    )`
  },
  {
    name: "video_competitor_scripts",
    sql: `CREATE TABLE IF NOT EXISTS \`video_competitor_scripts\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`videoScriptId\` int NOT NULL,
      \`asin\` varchar(20),
      \`title\` varchar(300),
      \`videoUrl\` text,
      \`duration\` decimal(5,1),
      \`analysisData\` json,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT \`video_competitor_scripts_id\` PRIMARY KEY(\`id\`)
    )`
  },
  {
    name: "video_product_snapshots",
    sql: `CREATE TABLE IF NOT EXISTS \`video_product_snapshots\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`videoScriptId\` int NOT NULL,
      \`snapshotType\` varchar(50),
      \`data\` json,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT \`video_product_snapshots_id\` PRIMARY KEY(\`id\`)
    )`
  },
  {
    name: "video_script_sections",
    sql: `CREATE TABLE IF NOT EXISTS \`video_script_sections\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`videoScriptId\` int NOT NULL,
      \`sectionType\` varchar(50),
      \`sectionName\` varchar(200),
      \`duration\` decimal(4,1),
      \`purpose\` text,
      \`keyMessage\` text,
      \`sortOrder\` int DEFAULT 0,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`video_script_sections_id\` PRIMARY KEY(\`id\`)
    )`
  },
  {
    name: "video_script_subtopics",
    sql: `CREATE TABLE IF NOT EXISTS \`video_script_subtopics\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`sectionId\` int NOT NULL,
      \`videoScriptId\` int NOT NULL,
      \`subtopicName\` varchar(200),
      \`duration\` decimal(4,1),
      \`keyPoints\` json,
      \`sortOrder\` int DEFAULT 0,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`video_script_subtopics_id\` PRIMARY KEY(\`id\`)
    )`
  },
  {
    name: "video_script_shots",
    sql: `CREATE TABLE IF NOT EXISTS \`video_script_shots\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`subtopicId\` int NOT NULL,
      \`sectionId\` int NOT NULL,
      \`shotCode\` varchar(20),
      \`duration\` decimal(4,1),
      \`shotDescription\` text,
      \`sceneLocation\` varchar(100),
      \`cameraAngle\` enum('extreme_closeup','closeup','medium_closeup','medium','medium_wide','wide','extreme_wide'),
      \`cameraMovement\` varchar(100),
      \`overlayTextEn\` text,
      \`overlayTextCn\` text,
      \`narrationEn\` text,
      \`narrationCn\` text,
      \`subtitleEn\` text,
      \`subtitleCn\` text,
      \`narratorType\` enum('voiceover','model_narration','text_only','none') DEFAULT 'voiceover',
      \`generationStrategy\` enum('real_shoot','ai_image','ai_video','stock_footage','screen_record','mixed') DEFAULT 'real_shoot',
      \`reuseFromShotCode\` varchar(20),
      \`designatedAssets\` json,
      \`colorScheme\` varchar(200),
      \`props\` json,
      \`notes\` text,
      \`referenceImageUrl\` text,
      \`sortOrder\` int DEFAULT 0,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`video_script_shots_id\` PRIMARY KEY(\`id\`)
    )`
  },
  {
    name: "video_edit_scripts",
    sql: `CREATE TABLE IF NOT EXISTS \`video_edit_scripts\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`videoScriptId\` int NOT NULL,
      \`editName\` varchar(200) NOT NULL,
      \`videoPurpose\` enum('spv_ad','sbv_ad','main_listing','aplus','social_media','other') DEFAULT 'main_listing',
      \`maxDuration\` decimal(5,1),
      \`editStyle\` varchar(100),
      \`sectionMapping\` json,
      \`description\` text,
      \`sortOrder\` int DEFAULT 0,
      \`userConfirmed\` int DEFAULT 0,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`video_edit_scripts_id\` PRIMARY KEY(\`id\`)
    )`
  },
  // Product Weekly Ops tables
  {
    name: "product_weekly_ops",
    sql: `CREATE TABLE IF NOT EXISTS \`product_weekly_ops\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`product_id\` int NOT NULL,
      \`user_id\` int NOT NULL,
      \`week_start_date\` varchar(10) NOT NULL,
      \`week_end_date\` varchar(10) NOT NULL,
      \`sales_trend\` enum('up','down','stable') DEFAULT 'stable',
      \`sales_qty\` int DEFAULT 0,
      \`order_qty\` int DEFAULT 0,
      \`sales_amount\` decimal(12,2) DEFAULT '0',
      \`order_profit\` decimal(12,2) DEFAULT '0',
      \`order_profit_margin\` decimal(6,2) DEFAULT '0',
      \`session_total\` int DEFAULT 0,
      \`total_cvr\` decimal(6,2) DEFAULT '0',
      \`ad_cvr\` decimal(6,2) DEFAULT '0',
      \`organic_cvr\` decimal(6,2) DEFAULT '0',
      \`ad_orders\` int DEFAULT 0,
      \`organic_orders\` int DEFAULT 0,
      \`ad_clicks\` int DEFAULT 0,
      \`organic_clicks\` int DEFAULT 0,
      \`ctr\` decimal(6,4) DEFAULT '0',
      \`ad_impressions\` int DEFAULT 0,
      \`cpc\` decimal(8,2) DEFAULT '0',
      \`ad_spend\` decimal(12,2) DEFAULT '0',
      \`acos\` decimal(6,2) DEFAULT '0',
      \`rating\` decimal(3,1) DEFAULT '0',
      \`review_count\` int DEFAULT 0,
      \`return_rate\` decimal(6,2) DEFAULT '0',
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`product_weekly_ops_id\` PRIMARY KEY(\`id\`)
    )`
  },
  {
    name: "product_monthly_summary",
    sql: `CREATE TABLE IF NOT EXISTS \`product_monthly_summary\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`product_id\` int NOT NULL,
      \`user_id\` int NOT NULL,
      \`month\` varchar(7) NOT NULL,
      \`total_sales_qty\` int DEFAULT 0,
      \`total_sales_amount\` decimal(12,2) DEFAULT '0',
      \`total_profit\` decimal(12,2) DEFAULT '0',
      \`avg_profit_margin\` decimal(6,2) DEFAULT '0',
      \`avg_acos\` decimal(6,2) DEFAULT '0',
      \`total_ad_spend\` decimal(12,2) DEFAULT '0',
      \`avg_rating\` decimal(3,1) DEFAULT '0',
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`product_monthly_summary_id\` PRIMARY KEY(\`id\`)
    )`
  },
  {
    name: "product_basic_info",
    sql: `CREATE TABLE IF NOT EXISTS \`product_basic_info\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`product_id\` int NOT NULL,
      \`user_id\` int NOT NULL,
      \`asin\` varchar(20),
      \`sku\` varchar(100),
      \`title\` varchar(500),
      \`brand\` varchar(200),
      \`category\` varchar(200),
      \`marketplace\` varchar(20) DEFAULT 'US',
      \`launch_date\` varchar(10),
      \`cost\` decimal(10,2),
      \`price\` decimal(10,2),
      \`weight\` decimal(8,2),
      \`dimensions\` varchar(200),
      \`image_url\` text,
      \`status\` varchar(30) DEFAULT 'active',
      \`notes\` text,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`product_basic_info_id\` PRIMARY KEY(\`id\`)
    )`
  },
  // Ad tracking tables
  {
    name: "ad_portfolio_mappings",
    sql: `CREATE TABLE IF NOT EXISTS \`ad_portfolio_mappings\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`userId\` int NOT NULL,
      \`portfolioId\` varchar(100),
      \`portfolioName\` varchar(300),
      \`asin\` varchar(20),
      \`productName\` varchar(300),
      \`marketplace\` varchar(20) DEFAULT 'US',
      \`status\` varchar(30) DEFAULT 'active',
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`ad_portfolio_mappings_id\` PRIMARY KEY(\`id\`)
    )`
  },
  {
    name: "ad_keyword_weekly",
    sql: `CREATE TABLE IF NOT EXISTS \`ad_keyword_weekly\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`userId\` int NOT NULL,
      \`asin\` varchar(20),
      \`keyword\` varchar(500),
      \`matchType\` varchar(20),
      \`weekStartDate\` varchar(10),
      \`impressions\` int DEFAULT 0,
      \`clicks\` int DEFAULT 0,
      \`spend\` decimal(12,2) DEFAULT '0',
      \`sales\` decimal(12,2) DEFAULT '0',
      \`orders\` int DEFAULT 0,
      \`acos\` decimal(6,2) DEFAULT '0',
      \`cpc\` decimal(8,2) DEFAULT '0',
      \`ctr\` decimal(6,4) DEFAULT '0',
      \`cvr\` decimal(6,2) DEFAULT '0',
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT \`ad_keyword_weekly_id\` PRIMARY KEY(\`id\`)
    )`
  },
  {
    name: "ad_keyword_meta",
    sql: `CREATE TABLE IF NOT EXISTS \`ad_keyword_meta\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`userId\` int NOT NULL,
      \`asin\` varchar(20),
      \`keyword\` varchar(500),
      \`matchType\` varchar(20),
      \`campaignId\` varchar(100),
      \`adGroupId\` varchar(100),
      \`bid\` decimal(8,2),
      \`status\` varchar(30) DEFAULT 'active',
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`ad_keyword_meta_id\` PRIMARY KEY(\`id\`)
    )`
  },
  {
    name: "ad_competitor_ranks",
    sql: `CREATE TABLE IF NOT EXISTS \`ad_competitor_ranks\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`userId\` int NOT NULL,
      \`asin\` varchar(20),
      \`competitorAsin\` varchar(20),
      \`keyword\` varchar(500),
      \`rankDate\` varchar(10),
      \`organicRank\` int,
      \`sponsoredRank\` int,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT \`ad_competitor_ranks_id\` PRIMARY KEY(\`id\`)
    )`
  },
];

console.log(`🔨 开始创建 ${tables.length} 个缺失的表...\n`);

let created = 0;
let skipped = 0;

for (const { name, sql } of tables) {
  try {
    await conn.execute(sql);
    console.log(`  ✅ ${name}`);
    created++;
  } catch (err) {
    if (err.code === "ER_TABLE_EXISTS_ERROR" || err.message.includes("already exists")) {
      console.log(`  ⏭️  ${name} (已存在)`);
      skipped++;
    } else {
      console.error(`  ❌ ${name}: ${err.message}`);
    }
  }
}

await conn.end();
console.log(`\n🎉 完成！创建: ${created}, 跳过: ${skipped}`);
