import fs from 'fs';
import mysql from 'mysql2/promise';

const sql = fs.readFileSync('drizzle/migrations/ad_deep_optimization.sql', 'utf8');

const conn = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  multipleStatements: true
});

try {
  console.log('Executing ad deep optimization migration...');
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
