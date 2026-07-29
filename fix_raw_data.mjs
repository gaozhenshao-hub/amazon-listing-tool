import mysql from 'mysql2/promise';
const urlObj = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: urlObj.hostname, port: parseInt(urlObj.port),
  user: urlObj.username, password: urlObj.password,
  database: urlObj.pathname.slice(1), ssl: { rejectUnauthorized: false },
});

// Clear bad step1AiResult (raw format)
const [r1] = await conn.query(
  `UPDATE image_workflow_sessions SET step1AiResult = NULL, step1Confirmed = 0 WHERE step1AiResult LIKE '{"raw":%'`
);
console.log(`Cleared bad step1AiResult: ${r1.affectedRows} rows`);

// Clear bad step2AiResult
const [r2] = await conn.query(
  `UPDATE image_workflow_sessions SET step2AiResult = NULL, step2Confirmed = 0 WHERE step2AiResult LIKE '{"raw":%'`
);
console.log(`Cleared bad step2AiResult: ${r2.affectedRows} rows`);

// Clear bad step3AiResult
const [r3] = await conn.query(
  `UPDATE image_workflow_sessions SET step3AiResult = NULL, step3Confirmed = 0 WHERE step3AiResult LIKE '{"raw":%'`
);
console.log(`Cleared bad step3AiResult: ${r3.affectedRows} rows`);

// Clear bad step4AiResult
const [r4] = await conn.query(
  `UPDATE image_workflow_sessions SET step4AiResult = NULL, step4Confirmed = 0 WHERE step4AiResult LIKE '{"raw":%'`
);
console.log(`Cleared bad step4AiResult: ${r4.affectedRows} rows`);

// Clear bad step5AiResult
const [r5] = await conn.query(
  `UPDATE image_workflow_sessions SET step5AiResult = NULL, step5Confirmed = 0 WHERE step5AiResult LIKE '{"raw":%'`
);
console.log(`Cleared bad step5AiResult: ${r5.affectedRows} rows`);

await conn.end();
console.log('Done! All bad raw data cleared.');
