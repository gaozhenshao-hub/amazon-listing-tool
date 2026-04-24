import fs from 'fs';
import mysql from 'mysql2/promise';

const sql = fs.readFileSync('./drizzle/review_migration.sql', 'utf8');
const statements = sql.split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('--'))
  .join('\n')
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0);

const conn = await mysql.createConnection(process.env.DATABASE_URL);
for (const stmt of statements) {
  try {
    await conn.execute(stmt);
    console.log('OK:', stmt.substring(0, 80));
  } catch (e) {
    if (e.message.includes('Duplicate column') || e.message.includes("Can't DROP")) {
      console.log('SKIP (already exists/dropped):', stmt.substring(0, 80));
    } else {
      console.error('FAIL:', stmt.substring(0, 80), e.message);
    }
  }
}
await conn.end();
console.log('Migration complete');
