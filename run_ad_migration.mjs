import mysql from 'mysql2/promise';
import fs from 'fs';

const sql = fs.readFileSync('./drizzle/ad_tracking_migration.sql', 'utf8');

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Remove SQL comments first, then split by semicolons
const cleanedSql = sql.replace(/--[^\n]*/g, '');
const statements = cleanedSql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0);

console.log(`Found ${statements.length} statements to execute`);

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  try {
    await conn.execute(stmt);
    console.log(`[${i+1}/${statements.length}] OK: ${stmt.substring(0, 60)}...`);
  } catch(e) {
    console.error(`[${i+1}/${statements.length}] ERR: ${e.message}`);
    console.error(`  SQL: ${stmt.substring(0, 100)}`);
  }
}

await conn.end();
console.log('Migration complete!');
