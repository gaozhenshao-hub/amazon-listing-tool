import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config({ path: '.env' });
const mysql = require('mysql2/promise');

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(
  "SELECT value, metadata FROM kb_tag_definitions WHERE dimension='style' AND isSystem=1 ORDER BY id"
);
let allOk = true;
for (const r of rows) {
  const m = r.metadata ? JSON.parse(r.metadata) : {};
  const missing = [];
  if (!m.colorTone) missing.push('colorTone');
  if (!m.styleFeature) missing.push('styleFeature');
  if (missing.length) {
    console.log(`[MISSING] ${r.value}: ${missing.join(', ')}`);
    allOk = false;
  } else {
    console.log(`[OK] ${r.value}: colorTone="${m.colorTone}" | styleFeature="${m.styleFeature}"`);
  }
}
console.log(`\nTotal: ${rows.length} | ${allOk ? 'All fields complete!' : 'Some fields missing!'}`);
await conn.end();
