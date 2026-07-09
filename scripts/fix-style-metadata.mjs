/**
 * Fix missing colorTone and styleFeature fields in kb_tag_definitions for style tags.
 * Run: node scripts/fix-style-metadata.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config({ path: '.env' });
const mysql = require('mysql2/promise');

const FIXES = [
  {
    name: '大厂工业极简风',
    colorTone: '白、灰、黑、科技蓝',
    styleFeature: '极简、专业、高级、科技感、产品至上',
  },
  {
    name: '户外探险风',
    colorTone: '军绿、卡其、棕色',
    styleFeature: '探索、自由、自然、冒险',
  },
  {
    name: '工业硬核风',
    colorTone: '黑、深灰、工业黄',
    styleFeature: '力量、耐用、专业、机械感',
  },
  {
    name: '田园自然风',
    colorTone: '土黄、草绿、陶土色、米白',
    styleFeature: '自然、有机、乡村、慢生活、亲近自然',
  },
];

const conn = await mysql.createConnection(process.env.DATABASE_URL);

for (const fix of FIXES) {
  // Get current metadata
  const [rows] = await conn.execute(
    "SELECT id, metadata FROM kb_tag_definitions WHERE dimension='style' AND value=? LIMIT 1",
    [fix.name]
  );
  if (rows.length === 0) {
    console.log(`[SKIP] Not found: ${fix.name}`);
    continue;
  }
  const row = rows[0];
  const meta = row.metadata ? JSON.parse(row.metadata) : {};
  meta.colorTone = fix.colorTone;
  meta.styleFeature = fix.styleFeature;
  await conn.execute(
    "UPDATE kb_tag_definitions SET metadata=? WHERE id=?",
    [JSON.stringify(meta), row.id]
  );
  console.log(`[OK] Updated: ${fix.name}`);
}

await conn.end();
console.log('Done.');
