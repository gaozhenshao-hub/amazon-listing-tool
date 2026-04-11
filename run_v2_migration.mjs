import mysql from 'mysql2/promise';
import fs from 'fs';
import { config } from 'dotenv';

config();

async function run() {
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    multipleStatements: true,
  });
  
  const sql = fs.readFileSync('./drizzle/video_script_v2_migration.sql', 'utf-8');
  
  // Split by semicolons but handle CREATE TABLE blocks
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  
  for (const stmt of statements) {
    try {
      console.log(`Executing: ${stmt.substring(0, 80)}...`);
      await conn.execute(stmt);
      console.log('  ✓ Success');
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME' || err.message?.includes('Duplicate column')) {
        console.log(`  ⚠ Column already exists, skipping`);
      } else if (err.code === 'ER_TABLE_EXISTS_ERROR') {
        console.log(`  ⚠ Table already exists, skipping`);
      } else {
        console.error(`  ✗ Error: ${err.message}`);
      }
    }
  }
  
  await conn.end();
  console.log('\nMigration complete!');
}

run().catch(console.error);
