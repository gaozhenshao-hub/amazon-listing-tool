import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => Object.assign(new Error(code), { safeCode: code });
const units = ['amazon-listing-web.service', 'amazon-listing-worker.service', 'amazon-listing-scheduler.service'];

export function validatePlan(plan, bytes, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || digest(bytes) !== expectedHash) throw fail('PLAN_HASH_MISMATCH');
  if (!Array.isArray(plan.steps) || !plan.steps.length || !Array.isArray(plan.upfrontChecks)) throw fail('INVALID_PLAN');
  const ids = new Set();
  for (const step of plan.steps) {
    if (ids.has(step.id) || digest(step.sql) !== step.sha256) throw fail('STEP_ID_OR_HASH_MISMATCH');
    ids.add(step.id);
    if (!/^\s*(CREATE\s+(TABLE|(?:UNIQUE\s+)?INDEX)|ALTER\s+TABLE|UPDATE)\b/i.test(step.sql)) throw fail('UNEXPECTED_SQL_VERB');
    if (/\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM)\b/i.test(step.sql)) throw fail('DESTRUCTIVE_SQL_REFUSED');
    for (const check of [...(step.preconditions || []), ...(step.postconditions || [])]) validateCheck(check);
  }
  for (const check of plan.upfrontChecks) validateCheck(check);
  return plan.steps.filter(step => step.enabledByDefault !== false);
}

function validateCheck(check) {
  if (!/^\s*SELECT\s/i.test(check.sql) || !Number.isSafeInteger(check.equals)) throw fail('INVALID_COUNT_CHECK');
}

export function schemaFingerprint(metadata) {
  return digest(JSON.stringify([metadata.tables, metadata.columns, metadata.indexes, metadata.foreignKeys]));
}

export async function currentMetadata(connection, schema) {
  const [tables] = await connection.execute('SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME', [schema]);
  const [columns] = await connection.execute('SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_DEFAULT, IS_NULLABLE, DATA_TYPE, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_KEY, EXTRA, GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME, ORDINAL_POSITION', [schema]);
  const [indexes] = await connection.execute('SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, COLLATION, SUB_PART, INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX', [schema]);
  const [foreignKeys] = await connection.execute('SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION', [schema]);
  return { tables, columns, indexes, foreignKeys };
}

export async function countCheck(connection, check) {
  const [rows] = await connection.query({ sql: check.sql, timeout: 120000 });
  if (rows.length !== 1 || !Object.hasOwn(rows[0], 'n') || Number(rows[0].n) !== check.equals) throw fail('COUNT_PRE_OR_POSTCONDITION_FAILED');
}

function requireWritersStopped() {
  for (const unit of units) {
    const state = execFileSync('/usr/bin/systemctl', ['show', '--no-pager', '--property=ActiveState', '--value', unit], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (state !== 'inactive') throw fail('PRODUCTION_WRITERS_NOT_STOPPED');
  }
}

async function verifyBackup(manifestPath, identity, configPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.status !== 'backup_complete' || manifest.configPath !== '/etc/amazon-listing-tool/runtime.conf') throw fail('VERIFIED_PRODUCTION_BACKUP_REQUIRED');
  if (manifest.databaseIdentity?.databaseName !== identity.databaseName || manifest.databaseIdentity?.serverUuid !== identity.serverUuid) throw fail('BACKUP_TARGET_IDENTITY_MISMATCH');
  const age = Date.now() - Date.parse(manifest.completedAt);
  if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) throw fail('RECENT_BACKUP_REQUIRED');
  const configCopy = manifest.configurationFiles?.find(copy => copy.original === configPath);
  if (!configCopy || configCopy.sha256 !== digest(fs.readFileSync(configPath))) throw fail('BACKUP_ACTIVE_CONFIG_MISMATCH');
  for (const item of [manifest.database, manifest.schema]) {
    if (!item || path.basename(item.file) !== item.file) throw fail('INVALID_BACKUP_ARTIFACT');
    const hash = crypto.createHash('sha256');
    const filename = path.join(path.dirname(manifestPath), item.file);
    for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
    if (hash.digest('hex') !== item.sha256 || fs.statSync(filename).size !== item.bytes) throw fail('BACKUP_HASH_MISMATCH');
  }
}

export async function runDelta({ mode, planPath, planHash, snapshotPath, outputParent, backupManifest, rehearsalManifest, configPath = '/etc/amazon-listing-tool/runtime.conf', appDirectory = '/opt/amazon-listing-tool' }) {
  if (!['preflight', 'apply'].includes(mode)) throw fail('MODE_MUST_BE_PREFLIGHT_OR_APPLY');
  for (const filename of [planPath, snapshotPath, outputParent, configPath, appDirectory]) if (!filename || !path.isAbsolute(filename)) throw fail('ABSOLUTE_PATH_REQUIRED');
  const planBytes = fs.readFileSync(planPath);
  const plan = JSON.parse(planBytes);
  const steps = validatePlan(plan, planBytes, planHash);
  const snapshotBytes = fs.readFileSync(snapshotPath);
  if (digest(snapshotBytes) !== plan.productionSnapshotSha256) throw fail('REVIEWED_SNAPSHOT_HASH_MISMATCH');
  const snapshot = JSON.parse(gunzipSync(snapshotBytes));
  const expectedSchema = snapshot.identity.databaseName;
  const outputDirectory = fs.mkdtempSync(path.join(outputParent, `${mode}-delta-`));
  fs.chmodSync(outputDirectory, 0o700);
  const logPath = path.join(outputDirectory, 'execution.jsonl');
  const log = value => fs.appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n', { mode: 0o600 });
  const requireApp = createRequire(path.join(appDirectory, 'package.json'));
  const configuration = requireApp('dotenv').parse(fs.readFileSync(configPath));
  let connection, locked = false, activeStep, rehearsal;
  try {
    if (mode === 'apply') {
      if (configPath !== '/etc/amazon-listing-tool/runtime.conf' || appDirectory !== '/opt/amazon-listing-tool') throw fail('PRODUCTION_TARGET_MISMATCH');
      requireWritersStopped();
      if (!backupManifest || !path.isAbsolute(backupManifest)) throw fail('BACKUP_MANIFEST_REQUIRED');
      if (!rehearsalManifest || !path.isAbsolute(rehearsalManifest)) throw fail('REHEARSAL_MANIFEST_REQUIRED');
      rehearsal = JSON.parse(fs.readFileSync(rehearsalManifest, 'utf8'));
      if (rehearsal.status !== 'schema_rehearsal_passed' || rehearsal.planHash !== planHash || rehearsal.snapshotHash !== plan.productionSnapshotSha256 || !/^[a-f0-9]{64}$/.test(rehearsal.afterFingerprint)) throw fail('REHEARSAL_EVIDENCE_MISMATCH');
    }
    connection = await requireApp('mysql2/promise').createConnection(configuration.DATABASE_URL);
    const [identity] = await connection.query('SELECT DATABASE() AS databaseName, @@lower_case_table_names AS lowerCaseTableNames, @@server_uuid AS serverUuid');
    if (identity[0].databaseName !== expectedSchema || identity[0].lowerCaseTableNames !== snapshot.identity.lowerCaseTableNames) throw fail('DATABASE_IDENTITY_MISMATCH');
    if (mode === 'apply') {
      await verifyBackup(backupManifest, identity[0], configPath);
      const [locks] = await connection.query("SELECT GET_LOCK('qingdao_friend_release_schema', 0) AS acquired");
      if (Number(locks[0].acquired) !== 1) throw fail('DEPLOYMENT_LOCK_UNAVAILABLE');
      locked = true;
      await connection.query('SET SESSION lock_wait_timeout=15');
      await connection.query('SET SESSION innodb_lock_wait_timeout=15');
    } else {
      await connection.query('SET SESSION TRANSACTION READ ONLY');
      await connection.query('START TRANSACTION');
    }
    const before = await currentMetadata(connection, expectedSchema);
    if (schemaFingerprint(before) !== schemaFingerprint(snapshot)) throw fail('PRODUCTION_SCHEMA_DRIFT');
    const selectedIds = new Set(steps.map(step => step.id));
    for (const check of plan.upfrontChecks) {
      if (check.enabledByDefault === false || (check.requiresStepId && !selectedIds.has(check.requiresStepId))) continue;
      activeStep = `upfront:${check.name}`;
      await countCheck(connection, check);
      log({ check: activeStep, status: 'passed' });
    }
    if (mode === 'preflight') {
      await connection.rollback();
      log({ status: 'read_only_preflight_passed', selectedSteps: steps.length });
      return { status: 'read_only_preflight_passed', outputDirectory, selectedSteps: steps.length };
    }
    requireWritersStopped();
    for (const step of steps) {
      activeStep = step.id;
      for (const check of step.preconditions || []) await countCheck(connection, check);
      log({ id: step.id, stage: step.stage, kind: step.kind, sha256: step.sha256, status: 'started' });
      const [result] = await connection.query({ sql: step.sql, timeout: 180000 });
      for (const check of step.postconditions || []) await countCheck(connection, check);
      log({ id: step.id, status: 'applied_and_checked', affectedRows: result.affectedRows ?? null });
    }
    const after = await currentMetadata(connection, expectedSchema);
    fs.writeFileSync(path.join(outputDirectory, 'schema-after.json'), JSON.stringify(after, null, 2), { flag: 'wx', mode: 0o600 });
    if (schemaFingerprint(after) !== rehearsal.afterFingerprint) throw fail('POST_SCHEMA_DIFFERS_FROM_REHEARSAL');
    const result = { status: 'delta_applied', outputDirectory, appliedSteps: steps.length, planHash, schemaMatchesRehearsal: true, fullSourceCompatibilityVerified: false, next: 'Run complete metadata comparison and staged application checks before starting production services.' };
    fs.writeFileSync(path.join(outputDirectory, 'manifest.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
    log(result);
    return result;
  } catch (error) {
    const safe = { status: 'stopped_do_not_blindly_retry', step: activeStep, code: error.safeCode || error.code || 'DELTA_FAILED', outputDirectory };
    log(safe);
    throw Object.assign(fail(safe.code), { safeDetails: safe });
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('qingdao_friend_release_schema')").catch(() => {});
    await connection?.end().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const [mode, planPath, planHash, snapshotPath, outputParent, backupManifest, rehearsalManifest] = process.argv.slice(2);
  try { console.log(JSON.stringify(await runDelta({ mode, planPath, planHash, snapshotPath, outputParent, backupManifest, rehearsalManifest }), null, 2)); }
  catch (error) { console.error(JSON.stringify(error.safeDetails || { code: error.safeCode || 'DELTA_FAILED' })); process.exitCode = 1; }
}
