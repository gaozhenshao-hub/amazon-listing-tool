import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error('DATABASE_URL not set');

// Parse DATABASE_URL: mysql://user:pass@host:port/db
const url = new URL(dbUrl);
const conn = await mysql.createConnection({
  host: url.hostname,
  port: parseInt(url.port) || 3306,
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  multipleStatements: true,
  ssl: { rejectUnauthorized: false },
});

console.log('Connected to DB');

// Load all batch files
let totalInserted = 0;
for (let i = 1; i <= 6; i++) {
  const sql = readFileSync(`/tmp/emperor_batch_${i}.sql`, 'utf8');
  const statements = sql.split(';\n').filter(s => s.trim());
  console.log(`Batch ${i}: ${statements.length} statements`);
  for (const stmt of statements) {
    if (!stmt.trim()) continue;
    try {
      await conn.execute(stmt);
      totalInserted++;
    } catch (e) {
      console.error(`Error in batch ${i}: ${e.message.slice(0, 100)}`);
    }
  }
  console.log(`Batch ${i} done`);
}

// Insert agents and MCPs
const store = JSON.parse(readFileSync('/home/ubuntu/emperor_platform_store.json', 'utf8'));

for (const a of store.agents || []) {
  const dag = a.dagDefinition || a.dag || {};
  try {
    await conn.execute(
      'INSERT IGNORE INTO emperor_agents (slug,name,description,category,status,dagDefinition) VALUES (?,?,?,?,?,?)',
      [a.slug||'', a.name||'', a.description||'', a.category||'通用', a.status||'Released', JSON.stringify(dag)]
    );
  } catch(e) { console.error('Agent insert error:', e.message.slice(0,80)); }
}
console.log(`Agents: ${(store.agents||[]).length} inserted`);

for (const m of store.mcpConnectors || []) {
  const cfg = m.config || m.configuration || {};
  const connType = ['http_api','database','webhook','internal','script'].includes(m.connectionType||m.type) 
    ? (m.connectionType||m.type) : 'http_api';
  try {
    await conn.execute(
      'INSERT IGNORE INTO emperor_mcp_connectors (slug,name,description,connectionType,config,isActive) VALUES (?,?,?,?,?,1)',
      [m.slug||'', m.name||'', m.description||'', connType, JSON.stringify(cfg)]
    );
  } catch(e) { console.error('MCP insert error:', e.message.slice(0,80)); }
}
console.log(`MCPs: ${(store.mcpConnectors||[]).length} inserted`);

// Insert default model providers
const providers = [
  ['manus-builtin-default','Manus 内置 LLM','manus_builtin','manus-default','Manus 内置（推荐）',1,1],
  ['deepseek-chat','DeepSeek Chat','deepseek','deepseek-chat','DeepSeek-V3',0,1],
  ['deepseek-reasoner','DeepSeek Reasoner','deepseek','deepseek-reasoner','DeepSeek-R1（推理）',0,1],
  ['openai-gpt4o','OpenAI GPT-4o','openai','gpt-4o','GPT-4o',0,0],
  ['anthropic-claude','Anthropic Claude','anthropic','claude-3-5-sonnet-20241022','Claude 3.5 Sonnet',0,0],
];
for (const [slug,name,provider,modelId,displayName,isDefault,isActive] of providers) {
  try {
    await conn.execute(
      'INSERT IGNORE INTO emperor_model_providers (slug,name,provider,modelId,displayName,isDefault,isActive) VALUES (?,?,?,?,?,?,?)',
      [slug,name,provider,modelId,displayName,isDefault,isActive]
    );
  } catch(e) { console.error('Provider insert error:', e.message.slice(0,80)); }
}
console.log('Model providers: 5 inserted');

// Verify counts
const [skillRows] = await conn.execute('SELECT COUNT(*) as cnt FROM emperor_skills');
const [agentRows] = await conn.execute('SELECT COUNT(*) as cnt FROM emperor_agents');
const [mcpRows] = await conn.execute('SELECT COUNT(*) as cnt FROM emperor_mcp_connectors');
const [providerRows] = await conn.execute('SELECT COUNT(*) as cnt FROM emperor_model_providers');

console.log(`\n=== Import Complete ===`);
console.log(`Skills: ${skillRows[0].cnt}`);
console.log(`Agents: ${agentRows[0].cnt}`);
console.log(`MCPs: ${mcpRows[0].cnt}`);
console.log(`Model Providers: ${providerRows[0].cnt}`);

await conn.end();
