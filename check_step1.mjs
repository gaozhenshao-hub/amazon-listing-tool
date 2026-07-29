import mysql from 'mysql2/promise';
const urlObj = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: urlObj.hostname, port: parseInt(urlObj.port),
  user: urlObj.username, password: urlObj.password,
  database: urlObj.pathname.slice(1), ssl: { rejectUnauthorized: false },
});
const [rows] = await conn.query(
  `SELECT id, projectId, currentStep, SUBSTRING(step1AiResult, 1, 600) as s1, SUBSTRING(step3AiResult, 1, 600) as s3 FROM image_workflow_sessions ORDER BY id DESC LIMIT 2`
);
for (const row of rows) {
  console.log('=== Session', row.id, '===');
  console.log('step1 preview:', row.s1 || '(NULL)');
  console.log('step3 preview:', row.s3 || '(NULL)');
  console.log();
}
await conn.end();
