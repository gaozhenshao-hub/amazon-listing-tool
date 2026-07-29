import mysql from 'mysql2/promise';
const urlObj = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: urlObj.hostname, port: parseInt(urlObj.port),
  user: urlObj.username, password: urlObj.password,
  database: urlObj.pathname.slice(1), ssl: { rejectUnauthorized: false },
});

// Check image_workflow_sessions for session 780001
const [sess] = await conn.query(`SELECT id, projectId, currentStep, step1AiResult, step2AiResult, step3AiResult FROM image_workflow_sessions WHERE id = 780001`);
if (sess.length) {
  const s = sess[0];
  console.log('Session 780001:', { id: s.id, projectId: s.projectId, currentStep: s.currentStep });
  console.log('  step1AiResult:', s.step1AiResult ? s.step1AiResult.substring(0, 200) : 'NULL');
  console.log('  step2AiResult:', s.step2AiResult ? s.step2AiResult.substring(0, 200) : 'NULL');
  console.log('  step3AiResult:', s.step3AiResult ? s.step3AiResult.substring(0, 200) : 'NULL');
} else {
  console.log('Session 780001 not found');
}

// Check recent sessions
const [allSess] = await conn.query(`SELECT id, projectId, currentStep FROM image_workflow_sessions ORDER BY id DESC LIMIT 10`);
console.log('\nRecent sessions:', JSON.stringify(allSess));

// Check projects table for id=90001
const [proj90001] = await conn.query(`SELECT id, name, productName, brand, category FROM projects WHERE id = 90001`);
console.log('\nProject 90001:', JSON.stringify(proj90001[0] || 'NOT FOUND'));

// Check expression_groups for projectId=90001
const [groups] = await conn.query(`SELECT id, competitorName, imageCount FROM expression_groups WHERE projectId = 90001 LIMIT 5`);
console.log('\nExpression groups for project 90001:', JSON.stringify(groups));

// If session 780001 exists, check its project
if (sess.length) {
  const pid = sess[0].projectId;
  console.log('\nProjectId from session 780001:', pid);
  const [projX] = await conn.query(`SELECT id, name, productName, brand, category FROM projects WHERE id = ?`, [pid]);
  console.log('Project for session:', JSON.stringify(projX[0] || 'NOT FOUND'));
  const [grpX] = await conn.query(`SELECT id, competitorName, imageCount FROM expression_groups WHERE projectId = ? LIMIT 5`, [pid]);
  console.log('Expression groups for project:', JSON.stringify(grpX));
}

await conn.end();
