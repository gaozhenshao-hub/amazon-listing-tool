import mysql from "mysql2/promise";
const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(`
  SELECT slug, name, category,
    JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.implementation.systemPrompt')) as systemPrompt,
    JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.implementation.userPromptTemplate')) as userPromptTemplate,
    modelOverride
  FROM emperor_skills
  ORDER BY category, slug
`);
// Output as JSON for processing
import { writeFileSync } from 'fs';
writeFileSync('/tmp/all_skills.json', JSON.stringify(rows, null, 2));
console.log(`Total skills: ${rows.length}`);
// Show categories
const cats = {};
for (const r of rows) { cats[r.category] = (cats[r.category]||0)+1; }
console.log('Categories:', JSON.stringify(cats, null, 2));
await conn.end();
