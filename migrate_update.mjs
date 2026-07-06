import { createPool } from 'mysql2/promise';

const pool = createPool(process.env.DATABASE_URL);

const sqls = [
  // listings 新字段
  'ALTER TABLE listings ADD COLUMN IF NOT EXISTS itemHighlights text',
  'ALTER TABLE listings ADD COLUMN IF NOT EXISTS itemHighlightsCn text',
  // listingVersions 新字段
  'ALTER TABLE listingVersions ADD COLUMN IF NOT EXISTS itemHighlights text',
  'ALTER TABLE listingVersions ADD COLUMN IF NOT EXISTS itemHighlightsCn text',
  // kb_image_sets 新字段
  'ALTER TABLE kb_image_sets ADD COLUMN IF NOT EXISTS setStyle varchar(30)',
  'ALTER TABLE kb_image_sets ADD COLUMN IF NOT EXISTS setStyleParams text',
  'ALTER TABLE kb_image_sets ADD COLUMN IF NOT EXISTS setPrimaryColor varchar(20)',
  'ALTER TABLE kb_image_sets ADD COLUMN IF NOT EXISTS setAccentColor varchar(20)',
  'ALTER TABLE kb_image_sets ADD COLUMN IF NOT EXISTS setCategory varchar(30)',
  'ALTER TABLE kb_image_sets ADD COLUMN IF NOT EXISTS setTargetAudience varchar(200)',
  'ALTER TABLE kb_image_sets ADD COLUMN IF NOT EXISTS setCategoryScene varchar(200)',
  // kb_images 新字段（7维标签v2）
  'ALTER TABLE kb_images ADD COLUMN IF NOT EXISTS tagImageBelong varchar(20)',
  'ALTER TABLE kb_images ADD COLUMN IF NOT EXISTS tagImageBelongSub varchar(30)',
  'ALTER TABLE kb_images ADD COLUMN IF NOT EXISTS tagImageTypeMain varchar(20)',
  'ALTER TABLE kb_images ADD COLUMN IF NOT EXISTS tagImageTypeSub varchar(30)',
  'ALTER TABLE kb_images ADD COLUMN IF NOT EXISTS tagSellingPointCategory varchar(20)',
  'ALTER TABLE kb_images ADD COLUMN IF NOT EXISTS tagSellingPointDetail varchar(200)',
  'ALTER TABLE kb_images ADD COLUMN IF NOT EXISTS tagComposition varchar(20)',
  'ALTER TABLE kb_images ADD COLUMN IF NOT EXISTS tagColorSchemeV2 varchar(30)',
  'ALTER TABLE kb_images ADD COLUMN IF NOT EXISTS tagDesignStyleV2 varchar(30)',
  // 新建 buyer_questions 表
  `CREATE TABLE IF NOT EXISTS buyer_questions (
    id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
    project_id int NOT NULL,
    user_id int NOT NULL,
    question text NOT NULL,
    question_cn text,
    source enum('ad_search_term','sp_prompts','qa_section','competitor_review','manual') NOT NULL DEFAULT 'manual',
    category varchar(100),
    frequency int DEFAULT 1,
    priority enum('high','medium','low') NOT NULL DEFAULT 'medium',
    covered_in_bullet int DEFAULT 0,
    covered_in_description int DEFAULT 0,
    covered_in_qa int DEFAULT 0,
    suggested_answer text,
    status enum('active','dismissed','covered') NOT NULL DEFAULT 'active',
    createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  // 新建 kb_tag_definitions 表
  `CREATE TABLE IF NOT EXISTS kb_tag_definitions (
    id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
    userId int NOT NULL,
    dimension varchar(50) NOT NULL,
    parentValue varchar(100),
    value varchar(200) NOT NULL,
    sortOrder int NOT NULL DEFAULT 0,
    isSystem int NOT NULL DEFAULT 0,
    metadata text,
    usageCount int NOT NULL DEFAULT 0,
    createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
];

let ok = 0, fail = 0;
for (const sql of sqls) {
  try {
    await pool.execute(sql);
    console.log('✓', sql.substring(0, 70));
    ok++;
  } catch (e) {
    console.error('✗', e.message.substring(0, 100));
    fail++;
  }
}
await pool.end();
console.log(`\n完成: ${ok} 成功, ${fail} 失败`);
