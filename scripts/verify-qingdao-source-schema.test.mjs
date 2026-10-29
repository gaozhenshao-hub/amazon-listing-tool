import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCreate, parseColumn, splitSqlParts, sourceContract, verifyMetadata, verifyFiles } from './verify-qingdao-source-schema.mjs';

const table = name => ({ TABLE_NAME: name, TABLE_TYPE: 'BASE TABLE', ENGINE: 'InnoDB', TABLE_COLLATION: 'utf8mb4_bin' });
const column = (t, name, type, position, nullable = true, defaultValue = null, extras = {}) => ({ TABLE_NAME: t, COLUMN_NAME: name, ORDINAL_POSITION: position, COLUMN_DEFAULT: defaultValue, IS_NULLABLE: nullable ? 'YES' : 'NO', DATA_TYPE: type.split('(')[0], COLUMN_TYPE: type, CHARACTER_SET_NAME: /varchar|text|enum/.test(type) ? 'utf8mb4' : null, COLLATION_NAME: /varchar|text|enum/.test(type) ? 'utf8mb4_bin' : null, COLUMN_KEY: '', EXTRA: '', GENERATION_EXPRESSION: '', ...extras });
const idx = (t, name, col, unique = false, prefix = null, seq = 1) => ({ TABLE_NAME: t, INDEX_NAME: name, NON_UNIQUE: unique ? 0 : 1, SEQ_IN_INDEX: seq, COLUMN_NAME: col, COLLATION: 'A', SUB_PART: prefix, INDEX_TYPE: 'BTREE' });
function fixture() {
  const before = { tables: [table('old')], columns: [column('old', 'id', 'int', 1, false), column('old', 'kept', 'varchar(50)', 2)], indexes: [idx('old', 'PRIMARY', 'id', true)], foreignKeys: [] };
  const after = structuredClone(before);
  after.tables.push(table('new_table'));
  after.columns[1].COLUMN_TYPE = 'text'; after.columns[1].DATA_TYPE = 'text';
  after.columns.push(column('old', 'status', "enum('draft','confirmed')", 3, false, 'draft'), column('new_table', 'id', 'int', 1, false), column('new_table', 'value', 'varchar(80)', 2));
  after.indexes.push(idx('new_table', 'PRIMARY', 'id', true));
  const plan = { steps: [
    { id: '1', kind: 'create-table', table: 'new_table', sql: 'CREATE TABLE new_table (id INT PRIMARY KEY,value VARCHAR(80) NULL DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;' },
    { id: '2', kind: 'add-column', table: 'old', column: 'status', sql: "ALTER TABLE old ADD COLUMN status ENUM('draft','confirmed') NOT NULL DEFAULT 'draft';" },
    { id: '3', kind: 'widen-or-nullable', table: 'old', column: 'kept', sql: 'ALTER TABLE old MODIFY COLUMN kept TEXT NULL;' },
  ] };
  const contract = { tables: [{ name: 'old', columns: ['id', 'kept', 'status'], indexes: [{ name: 'PRIMARY', columns: ['id'], unique: true }] }, { name: 'new_table', columns: ['id', 'value'], indexes: [] }], approvedLegacyDifferences: [] };
  return { before, after, plan, contract };
}
const check = x => verifyMetadata(x.after, x.before, x.plan, x.contract);

test('DDL parser preserves enum commas, quoted defaults, primary keys and explicit ASCII columns', () => {
  assert.deepEqual(splitSqlParts("kind enum('a','b'), title varchar(80) DEFAULT 'a,b'"), ["kind enum('a','b')", "title varchar(80) DEFAULT 'a,b'"]);
  assert.equal(parseColumn('x VARCHAR(10) NULL DEFAULT NULL').default, null);
  assert.equal(parseColumn("x VARCHAR(10) DEFAULT 'New conversation'").default, "'New conversation'");
  assert.equal(parseColumn('createdAt timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP').default, '(now())');
  assert.equal(parseColumn('id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY').type, 'bigint unsigned');
  const result = parseCreate('CREATE TABLE aliases (username varchar(32) CHARACTER SET ascii COLLATE ascii_general_ci PRIMARY KEY,userId INT NOT NULL, UNIQUE KEY login_user (userId)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;');
  assert.equal(result.columns[0].notNull, true);
  assert.equal(result.columns[0].charset, 'ascii');
  assert.equal(result.columns[0].collation, 'ascii_general_ci');
  assert.deepEqual(result.indexes.map(i => i.name), ['PRIMARY', 'login_user']);
  assert.equal(result.collation, 'utf8mb4_bin');
});

test('accepts exactly additive tables/columns and the reviewed widening while preserving baseline', () => {
  const x = fixture(), baseline = JSON.stringify(x.before), result = check(x);
  assert.equal(result.status, 'source_schema_verified');
  assert.equal(result.tableCount, 2); assert.equal(result.columnCount, 5);
  assert.equal(result.afterFingerprint.length, 64);
  assert.equal(JSON.stringify(x.before), baseline);
});

test('atomic Saihu widening parses DEFAULT NULL separately from the following ADD INDEX', () => {
  const name = 'saihu_product_weekly';
  const before = { tables: [table(name)], columns: [column(name, 'asin', 'varchar(500)', 1), column(name, 'week_start_date', 'date', 2)],
    indexes: [idx(name, 'idx_sh_asin_week', 'asin'), idx(name, 'idx_sh_asin_week', 'week_start_date', false, null, 2)], foreignKeys: [] };
  const after = structuredClone(before);
  after.columns[0].COLUMN_TYPE = 'varchar(2000)';
  after.indexes[0].SUB_PART = 191;
  const plan = { steps: [{ id: '093', kind: 'widen-saihu-list', table: name, column: 'asin',
    sql: 'ALTER TABLE `saihu_product_weekly` DROP INDEX `idx_sh_asin_week`, MODIFY COLUMN `asin` VARCHAR(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL, ADD INDEX `idx_sh_asin_week` (`asin`(191),`week_start_date`);' }] };
  const contract = { tables: [{ name, columns: ['asin', 'week_start_date'], indexes: [] }], approvedLegacyDifferences: [] };
  assert.equal(verifyMetadata(after, before, plan, contract).status, 'source_schema_verified');
  after.columns[0].COLUMN_DEFAULT = 'unexpected';
  assert.ok(verifyMetadata(after, before, plan, contract).findings.some(f => f.code === 'PLANNED_COLUMN_SHAPE_MISMATCH' && f.name === 'asin' && f.detail === 'default'));
});

test('reports required table/column/index gaps, unplanned columns and old column loss', () => {
  const x = fixture(); x.after.columns = x.after.columns.filter(c => c.COLUMN_NAME !== 'status' && c.COLUMN_NAME !== 'kept');
  x.after.columns.push(column('old', 'surprise', 'int', 4));
  x.after.indexes = x.after.indexes.filter(i => i.TABLE_NAME !== 'old');
  x.after.indexes.push(idx('new_table', 'unexpected_unique', 'value', true));
  const codes = check(x).findings.map(f => f.code);
  for (const code of ['OLD_COLUMN_MISSING', 'SOURCE_COLUMN_MISSING', 'PLANNED_COLUMN_MISSING', 'SOURCE_INDEX_MISSING', 'OLD_INDEX_CHANGED_OR_MISSING', 'UNPLANNED_COLUMN', 'UNPLANNED_INDEX']) assert.ok(codes.includes(code), code);
  x.after.tables = x.after.tables.filter(t => t.TABLE_NAME !== 'new_table');
  assert.ok(check(x).findings.some(f => f.code === 'SOURCE_TABLE_MISSING'));
});

test('does not mask unexpected old defaults, type narrowing, nullability or table collation changes', () => {
  const x = fixture(); x.after.columns[0].COLUMN_TYPE = 'smallint'; x.after.columns[1].COLUMN_DEFAULT = 'changed'; x.after.tables[0].TABLE_COLLATION = 'utf8mb4_unicode_ci';
  const codes = check(x).findings.map(f => f.code);
  for (const code of ['UNPLANNED_COLUMN_CHANGE', 'WIDENING_CHANGED_UNREVIEWED_PROPERTY', 'OLD_TABLE_OPTIONS_CHANGED', 'PLANNED_COLUMN_SHAPE_MISMATCH']) assert.ok(codes.includes(code), code);
  x.after.columns.find(c => c.COLUMN_NAME === 'status').IS_NULLABLE = 'YES';
  assert.ok(check(x).findings.some(f => f.name === 'status' && f.detail.includes('nullability')));
});

test('deferred optional steps are not required and derived COLUMN_KEY changes are not data-shape changes', () => {
  const x = fixture(); x.plan.steps.push({ id: '4', kind: 'create-unique-index', table: 'old', index: 'deferred', column: 'kept', enabledByDefault: false });
  x.after.columns[0].COLUMN_KEY = 'MUL';
  assert.equal(check(x).status, 'source_schema_verified');
});

test('frozen source contract covers all 350 modeled/raw tables but omits the three approved index mismatches', () => {
  const contract = sourceContract(); assert.equal(contract.tables.length, 350);
  for (const name of ['ops_inventory_collection_jobs', 'saihu_product_weekly', 'listing_uploaded_files', 'user_login_aliases', 'ops_north_america_notes']) assert.ok(contract.tables.some(t => t.name === name));
  for (const [tableName, indexName] of [['security_audit_logs', 'security_audit_logs_auditId_unique'], ['emperor_agent_runs', 'emperor_agent_runs_runId_unique'], ['competitorComparisonReports', 'idx_competitor_comparison_project_selection']]) assert.equal(contract.tables.find(t => t.name === tableName).indexes.some(i => i.name === indexName), false);
});

test('CLI rejects paths before IO and contains no database/app imports, writes or SQL execution', () => {
  assert.throws(() => verifyFiles('relative', '/before', '/plan'), /ABSOLUTE_PATH_REQUIRED/);
  const source = fs.readFileSync(new URL('./verify-qingdao-source-schema.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /mysql2|createConnection|runtime\.conf|writeFile|appendFile|execFile|spawn\(/);
  assert.equal([...source.matchAll(/^import .*? from '([^']+)'/gm)].every(m => m[1].startsWith('node:')), true);
});
