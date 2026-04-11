import fs from 'fs';
import mysql from 'mysql2/promise';

const sql = fs.readFileSync('drizzle/video_script_migration.sql', 'utf8');

// Use multiStatements to execute the entire SQL file at once
const conn = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  multipleStatements: true
});

try {
  console.log('Executing migration...');
  const [results] = await conn.query(sql);
  if (Array.isArray(results)) {
    console.log(`Executed ${results.length} statements successfully`);
  } else {
    console.log('Migration executed successfully');
  }
} catch (err) {
  console.error('Migration error:', err.message);
}

await conn.end();
console.log('Migration complete!');
