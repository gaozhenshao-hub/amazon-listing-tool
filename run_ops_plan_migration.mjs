import fs from 'fs';
import mysql from 'mysql2/promise';

const sql = fs.readFileSync('./drizzle/ops_plan_migration_fix.sql', 'utf-8');

// Split by semicolons, filter out comments and empty lines
const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'));

const conn = await mysql.createConnection(process.env.DATABASE_URL);

for (const stmt of statements) {
  try {
    console.log(`Executing: ${stmt.substring(0, 80)}...`);
    await conn.execute(stmt);
    console.log('  ✓ OK');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log(`  ⚠ Column already exists, skipping`);
    } else if (err.code === 'ER_CANT_DROP_FIELD_OR_KEY') {
      console.log(`  ⚠ Column doesn't exist, skipping`);
    } else {
      console.error(`  ✗ Error: ${err.message}`);
    }
  }
}

await conn.end();
console.log('\nMigration complete!');
