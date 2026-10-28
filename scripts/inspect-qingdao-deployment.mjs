import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

// Read-only production metadata collector. Never serializes credentials or business rows.
const [outputDirectory, appDirectory = '/opt/amazon-listing-tool', configPath = '/etc/amazon-listing-tool/runtime.conf'] = process.argv.slice(2);
if (!outputDirectory || !path.isAbsolute(outputDirectory) || !path.isAbsolute(appDirectory) || !path.isAbsolute(configPath)) {
  throw new Error('Usage: node inspect-qingdao-deployment.mjs ABSOLUTE_NEW_OUTPUT_DIRECTORY [APP_DIRECTORY] [CONFIG_PATH]');
}
const requireApp = createRequire(path.join(appDirectory, 'package.json'));
const dotenv = requireApp('dotenv');
const mysql = requireApp('mysql2/promise');
const configuration = dotenv.parse(fs.readFileSync(configPath));
if (!configuration.DATABASE_URL) throw new Error('DATABASE_URL_MISSING');
const permitted = ['AUTH_MODE', 'STORAGE_PROVIDER', 'LOCAL_STORAGE_DIR', 'DESIGN_STUDIO_STORAGE_ROOT', 'MEETING_AUDIO_STORAGE_ROOT', 'LISTING_SUPPLEMENT_LOCAL_ROOT', 'APP_PUBLIC_URL', 'APP_BASE_URL', 'MEETING_AUDIO_PUBLIC_ORIGIN', 'APP_PROCESS_ROLE', 'AI_JOB_IN_PROCESS', 'ENABLE_LEGACY_SAIHU_SYNC', 'ENABLE_SAIHU_REPORT_SCHEDULER', 'ENABLE_SAIHU_REPORT_WRITES', 'ENABLE_MERGED_OPS_INVENTORY_COLLECTION'];
let connection;
try {
  connection = await mysql.createConnection(configuration.DATABASE_URL);
  await connection.query('SET SESSION TRANSACTION READ ONLY');
  await connection.query('START TRANSACTION');
  const [identity] = await connection.query('SELECT DATABASE() AS databaseName, VERSION() AS version, @@lower_case_table_names AS lowerCaseTableNames');
  const schema = identity[0].databaseName;
  if (!schema) throw new Error('DATABASE_NOT_SELECTED');
  const [tables] = await connection.execute('SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME', [schema]);
  const [columns] = await connection.execute('SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_DEFAULT, IS_NULLABLE, DATA_TYPE, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_KEY, EXTRA, GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME, ORDINAL_POSITION', [schema]);
  const [indexes] = await connection.execute('SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, COLLATION, SUB_PART, INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX', [schema]);
  const [foreignKeys] = await connection.execute('SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION', [schema]);
  const ddl = {};
  for (const table of tables) {
    const [result] = await connection.query(`SHOW CREATE ${table.TABLE_TYPE === 'VIEW' ? 'VIEW' : 'TABLE'} ${connection.escapeId(table.TABLE_NAME)}`);
    ddl[table.TABLE_NAME] = result[0]['Create Table'] ?? result[0]['Create View'];
  }
  let ledger = [];
  if (tables.some(table => table.TABLE_NAME === 'app_schema_migrations')) {
    const safeColumns = columns.filter(column => column.TABLE_NAME === 'app_schema_migrations' && /^(id|name|filename|migration_name|checksum|status|applied_at|appliedAt|started_at|startedAt|finished_at|finishedAt|completed_at|created_at|createdAt|updated_at|updatedAt)$/.test(column.COLUMN_NAME)).map(column => connection.escapeId(column.COLUMN_NAME));
    if (safeColumns.length) [ledger] = await connection.query(`SELECT ${safeColumns.join(', ')} FROM app_schema_migrations`);
  }
  await connection.rollback();
  const metadata = {capturedAt: new Date().toISOString(), scope: 'schema_and_migration_metadata_only', sourceAppDirectory: appDirectory, configPath, identity: identity[0], configuration: Object.fromEntries(permitted.filter(key => configuration[key] !== undefined).map(key => [key, configuration[key]])), tables, columns, indexes, foreignKeys, ddl, ledger};
  fs.mkdirSync(outputDirectory, {mode: 0o700});
  const bytes = Buffer.from(JSON.stringify(metadata, null, 2));
  const output = path.join(outputDirectory, 'schema.json.gz');
  fs.writeFileSync(output, gzipSync(bytes), {mode: 0o600, flag: 'wx'});
  const digest = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  console.log(JSON.stringify({output, sha256: digest, bytes: fs.statSync(output).size, tables: tables.length, columns: columns.length, indexes: indexes.length, ledger: ledger.length, identity: identity[0], configuration: metadata.configuration}, null, 2));
} catch (error) {
  console.error(JSON.stringify({error: error.code || 'METADATA_COLLECTION_FAILED', type: error.name, location: String(error.stack || '').split('\n').slice(1, 5), knownReason: ['DATABASE_NOT_SELECTED'].includes(error.message) ? error.message : undefined}));
  process.exitCode = 1;
} finally {
  await connection?.end();
}
