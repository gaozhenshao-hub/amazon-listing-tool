import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validatePlan, schemaFingerprint, currentMetadata, countCheck } from './apply-qingdao-reviewed-delta.mjs';

const runFile = promisify(execFile);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = code => Object.assign(new Error(code), { safeCode: code });
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const docker = args => runFile('/usr/bin/docker', args, { maxBuffer: 4 * 1024 * 1024, timeout: 120000 });

// Uses schema metadata only. Never reads production runtime.conf or business rows.
export async function rehearse({ planPath, planHash, snapshotPath, outputParent, appDirectory = '/opt/amazon-listing-tool' }) {
  for (const filename of [planPath, snapshotPath, outputParent, appDirectory]) if (!filename || !path.isAbsolute(filename)) throw fail('ABSOLUTE_PATH_REQUIRED');
  const bytes = fs.readFileSync(planPath), plan = JSON.parse(bytes);
  const steps = validatePlan(plan, bytes, planHash);
  const snapshotBytes = fs.readFileSync(snapshotPath);
  if (sha(snapshotBytes) !== plan.productionSnapshotSha256) throw fail('SNAPSHOT_HASH_MISMATCH');
  const snapshot = JSON.parse(gunzipSync(snapshotBytes));
  const database = snapshot.identity.databaseName;
  if (database !== 'amz_listing') throw fail('UNEXPECTED_REHEARSAL_SCHEMA_NAME');
  const outputDirectory = fs.mkdtempSync(path.join(outputParent, 'schema-rehearsal-'));
  fs.chmodSync(outputDirectory, 0o700);
  const logFile = path.join(outputDirectory, 'execution.jsonl');
  const log = value => fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n', { mode: 0o600 });
  const container = `qingdao-schema-rehearsal-${crypto.randomUUID().slice(0, 8)}`;
  const password = crypto.randomBytes(32).toString('hex');
  const envFile = path.join(outputDirectory, '.mysql-rehearsal.env');
  fs.writeFileSync(envFile, `MYSQL_ROOT_PASSWORD=${password}\nMYSQL_ROOT_HOST=%\nMYSQL_DATABASE=${database}\n`, { flag: 'wx', mode: 0o600 });
  const mysql = createRequire(path.join(appDirectory, 'package.json'))('mysql2/promise');
  let connection, started = false, stepId;
  try {
    // Image must be pulled explicitly beforehand from the official MySQL registry.
    const image = 'mysql:8.0.46';
    const imageResult = await docker(['image', 'inspect', image, '--format', '{{.Id}}']);
    await docker(['run', '-d', '--rm', '--name', container, '--label', 'purpose=qingdao-schema-rehearsal', '--memory', '1536m', '--cpus', '1', '-p', '127.0.0.1::3306', '--env-file', envFile, image, '--event-scheduler=OFF']);
    started = true;
    const binding = JSON.parse((await docker(['inspect', container, '--format', '{{json .NetworkSettings.Ports}}'])).stdout)['3306/tcp'];
    if (binding?.length !== 1 || binding[0].HostIp !== '127.0.0.1' || !/^\d+$/.test(binding[0].HostPort)) throw fail('ISOLATED_PORT_BINDING_INVALID');
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        connection = await mysql.createConnection({ host: '127.0.0.1', port: Number(binding[0].HostPort), user: 'root', password, database, connectTimeout: 1000 });
        await connection.query('SELECT 1');
        break;
      } catch {
        await connection?.end().catch(() => {}); connection = undefined;
        if (attempt % 10 === 0) console.log(JSON.stringify({ status: 'waiting_for_isolated_mysql', attempt }));
        await sleep(1000);
      }
    }
    if (!connection) throw fail('ISOLATED_MYSQL_NOT_READY');
    const [identity] = await connection.query('SELECT DATABASE() AS databaseName, VERSION() AS version, @@lower_case_table_names AS lowerCaseTableNames');
    if (identity[0].databaseName !== database || identity[0].lowerCaseTableNames !== snapshot.identity.lowerCaseTableNames) throw fail('ISOLATED_DATABASE_IDENTITY_MISMATCH');
    const [existing] = await connection.query('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE()');
    if (Number(existing[0].n) !== 0) throw fail('ISOLATED_DATABASE_NOT_EMPTY');
    await connection.query('SET FOREIGN_KEY_CHECKS=0');
    const ordered = [...snapshot.tables.filter(t => t.TABLE_TYPE !== 'VIEW'), ...snapshot.tables.filter(t => t.TABLE_TYPE === 'VIEW')];
    for (const table of ordered) {
      const ddl = snapshot.ddl[table.TABLE_NAME];
      if (!/^CREATE\s/i.test(ddl)) throw fail('INVALID_SNAPSHOT_DDL');
      await connection.query(ddl);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS=1');
    if (schemaFingerprint(await currentMetadata(connection, database)) !== schemaFingerprint(snapshot)) throw fail('RECONSTRUCTED_SCHEMA_DIFFERS');
    log({ status: 'empty_production_structure_reconstructed', tableCount: ordered.length });
    const selectedIds = new Set(steps.map(step => step.id));
    for (const check of plan.upfrontChecks) {
      if (check.enabledByDefault === false || (check.requiresStepId && !selectedIds.has(check.requiresStepId))) continue;
      stepId = `upfront:${check.name}`;
      await countCheck(connection, check);
    }
    for (const step of steps) {
      stepId = step.id;
      for (const check of step.preconditions || []) await countCheck(connection, check);
      await connection.query({ sql: step.sql, timeout: 120000 });
      for (const check of step.postconditions || []) await countCheck(connection, check);
      log({ id: step.id, kind: step.kind, sha256: step.sha256, status: 'applied_and_checked' });
    }
    const after = await currentMetadata(connection, database);
    const ddl = {};
    for (const table of after.tables) {
      const [rows] = await connection.query(`SHOW CREATE ${table.TABLE_TYPE === 'VIEW' ? 'VIEW' : 'TABLE'} ${connection.escapeId(table.TABLE_NAME)}`);
      ddl[table.TABLE_NAME] = rows[0]['Create Table'] || rows[0]['Create View'];
    }
    fs.writeFileSync(path.join(outputDirectory, 'schema-after.json.gz'), gzipSync(Buffer.from(JSON.stringify({ ...after, identity: identity[0], ddl, ledger: [], scope: 'isolated_structure_rehearsal_no_business_rows' }, null, 2))), { flag: 'wx', mode: 0o600 });
    const result = { status: 'schema_rehearsal_passed', outputDirectory, planHash, snapshotHash: plan.productionSnapshotSha256, afterFingerprint: schemaFingerprint(after), appliedSteps: steps.length, image: imageResult.stdout.trim(), databaseVersion: identity[0].version, productionConnectionUsed: false, dataCompatibilityVerified: false };
    fs.writeFileSync(path.join(outputDirectory, 'manifest.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
    return result;
  } catch (error) {
    const details = { status: 'rehearsal_failed', step: stepId, code: error.safeCode || error.code || 'REHEARSAL_FAILED', outputDirectory };
    log(details);
    throw Object.assign(fail(details.code), { safeDetails: details });
  } finally {
    await connection?.end().catch(() => {});
    if (started) {
      // This is only the exact disposable empty-schema container created above.
      await docker(['stop', '--time', '10', container]).then(() => log({ status: 'isolated_container_removed' }), () => log({ status: 'isolated_container_cleanup_requires_operator', container }));
    }
    if (fs.existsSync(envFile)) fs.unlinkSync(envFile);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const [planPath, planHash, snapshotPath, outputParent] = process.argv.slice(2);
  try { console.log(JSON.stringify(await rehearse({ planPath, planHash, snapshotPath, outputParent }), null, 2)); }
  catch (error) { console.error(JSON.stringify(error.safeDetails || { code: error.safeCode || 'REHEARSAL_FAILED' })); process.exitCode = 1; }
}
