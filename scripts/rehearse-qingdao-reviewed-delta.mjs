import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { validatePlan, schemaFingerprint, currentMetadata, countCheck } from './apply-qingdao-reviewed-delta.mjs';

const runFile = promisify(execFile);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = code => Object.assign(new Error(code), { safeCode: code });
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const docker = args => runFile('/usr/bin/docker', args, { maxBuffer: 4 * 1024 * 1024, timeout: 120000 });
const NATIVE_BINARY = '/usr/sbin/mysqld';
const nativeEnvironment = Object.freeze({ PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', TZ: 'UTC' });

export function assertMysqlVersion(binaryVersion, snapshotVersion) {
  const release = value => String(value).match(/\b(8\.\d+\.\d+)(?=[-\s]|$)/)?.[1];
  if (/mariadb/i.test(String(binaryVersion) + String(snapshotVersion)) || release(binaryVersion) !== '8.0.46' || release(snapshotVersion) !== '8.0.46') throw fail('MYSQL_VERSION_MUST_MATCH_8_0_46');
}

export function nativeLayout(directory) {
  if (path.dirname(directory) !== '/tmp' || !/^qingdao-mysql-rehearsal-[A-Za-z0-9]+$/.test(path.basename(directory))) throw fail('ISOLATED_NATIVE_DIRECTORY_INVALID');
  return { directory, data: path.join(directory, 'data'), temporary: path.join(directory, 'tmp'), files: path.join(directory, 'files'), socket: path.join(directory, 'mysql.sock'), pid: path.join(directory, 'mysqld.pid'), log: path.join(directory, 'mysqld.log') };
}

export function nativeArguments(directory, lowerCaseTableNames, initialize = false) {
  if (lowerCaseTableNames !== 0) throw fail('NATIVE_CASE_MODE_MISMATCH');
  const layout = nativeLayout(directory);
  // --no-defaults MUST be the first mysqld option: never read /etc/mysql or a user's config.
  return ['--no-defaults', ...(initialize ? ['--initialize-insecure'] : []), '--basedir=/usr',
    `--datadir=${layout.data}`, `--socket=${layout.socket}`, `--pid-file=${layout.pid}`, `--log-error=${layout.log}`,
    `--tmpdir=${layout.temporary}`, `--secure-file-priv=${layout.files}`, '--skip-networking', '--mysqlx=0',
    '--event-scheduler=OFF', '--local-infile=0', '--skip-log-bin', '--general-log=OFF', '--slow-query-log=OFF',
    '--performance-schema=OFF', '--skip-name-resolve', '--lower-case-table-names=0',
    '--innodb-buffer-pool-size=128M', '--innodb-redo-log-capacity=64M', '--max-connections=8',
    '--table-open-cache=128', '--table-definition-cache=400', '--max-allowed-packet=64M'];
}

export function nativeCommand({ directory, lowerCaseTableNames, initialize = false, uid, gid, privileged }) {
  if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0) throw fail('NATIVE_NON_ROOT_IDENTITY_REQUIRED');
  const args = ['-n', '10', NATIVE_BINARY, ...nativeArguments(directory, lowerCaseTableNames, initialize)];
  // setpriv execs nice/mysqld in-place; cleanup retains the exact spawned PID, never a PID-file target.
  return privileged
    ? { file: '/usr/bin/setpriv', args: [`--reuid=${uid}`, `--regid=${gid}`, '--clear-groups', '--', '/usr/bin/nice', ...args] }
    : { file: '/usr/bin/nice', args };
}

export function assertNativeRuntime(row, directory, snapshotVersion) {
  const layout = nativeLayout(directory);
  assertMysqlVersion(row.version, snapshotVersion);
  const same = (actual, expected) => typeof actual === 'string' && path.resolve(actual) === expected;
  if (!same(row.dataDirectory, layout.data) || !same(row.socketPath, layout.socket) || !same(row.pidPath, layout.pid)
    || Number(row.skipNetworking) !== 1 || row.eventScheduler !== 'OFF' || Number(row.mysqlxActive) !== 0) throw fail('NATIVE_RUNTIME_ISOLATION_MISMATCH');
}

async function startNative(snapshot, log) {
  if (process.platform !== 'linux') throw fail('NATIVE_REHEARSAL_REQUIRES_LINUX');
  const version = await runFile(NATIVE_BINARY, ['--no-defaults', '--version'], { env: nativeEnvironment, timeout: 15000, maxBuffer: 65536 });
  assertMysqlVersion(version.stdout, snapshot.identity.version);
  const privileged = process.getuid() === 0;
  const uid = privileged ? Number((await runFile('/usr/bin/id', ['-u', 'mysql'])).stdout.trim()) : process.getuid();
  const gid = privileged ? Number((await runFile('/usr/bin/id', ['-g', 'mysql'])).stdout.trim()) : process.getgid();
  // Validate the identity before creating anything or invoking mysqld.
  nativeCommand({ directory: '/tmp/qingdao-mysql-rehearsal-validation', lowerCaseTableNames: snapshot.identity.lowerCaseTableNames, uid, gid, privileged });
  const directory = fs.mkdtempSync('/tmp/qingdao-mysql-rehearsal-');
  const layout = nativeLayout(directory);
  for (const folder of [directory, layout.data, layout.temporary, layout.files]) {
    if (folder !== directory) fs.mkdirSync(folder, { mode: 0o700 });
    fs.chmodSync(folder, 0o700);
    if (privileged) fs.chownSync(folder, uid, gid);
  }
  log({ status: 'native_isolation_directory_created', directory, uid, gid, binary: NATIVE_BINARY, binaryVersion: version.stdout.trim() });
  const options = { cwd: directory, env: nativeEnvironment, timeout: 120000, maxBuffer: 65536 };
  const initialize = nativeCommand({ directory, lowerCaseTableNames: snapshot.identity.lowerCaseTableNames, initialize: true, uid, gid, privileged });
  await runFile(initialize.file, initialize.args, options);
  const command = nativeCommand({ directory, lowerCaseTableNames: snapshot.identity.lowerCaseTableNames, uid, gid, privileged });
  const child = spawn(command.file, command.args, { cwd: directory, env: nativeEnvironment, stdio: 'ignore' });
  const state = { child, layout, exit: null, spawnError: null, version: version.stdout.trim(), uid, gid };
  child.once('error', error => { state.spawnError = error.code || 'NATIVE_SPAWN_FAILED'; });
  child.once('exit', (code, signal) => { state.exit = { code, signal }; });
  return state;
}

async function stopNative(state, log) {
  if (!state || state.exit || state.spawnError) return;
  state.child.kill('SIGTERM');
  for (let i = 0; i < 100 && !state.exit; i++) await sleep(100);
  if (!state.exit) {
    state.child.kill('SIGKILL');
    for (let i = 0; i < 50 && !state.exit; i++) await sleep(100);
  }
  log({ status: state.exit ? 'isolated_native_process_stopped' : 'isolated_native_cleanup_requires_operator', pid: state.child.pid, directory: state.layout.directory, retainedForInspection: true });
}

// Uses schema metadata only. Never reads production runtime.conf or business rows.
export async function rehearse({ planPath, planHash, snapshotPath, outputParent, appDirectory = '/opt/amazon-listing-tool', engine = 'docker' }) {
  if (!['docker', 'native'].includes(engine)) throw fail('REHEARSAL_ENGINE_INVALID');
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
  const mysql = createRequire(path.join(appDirectory, 'package.json'))('mysql2/promise');
  let connection, started = false, stepId, native, backend;
  try {
    let connectionOptions;
    if (engine === 'docker') {
      // Image must be pulled explicitly beforehand from the official MySQL registry.
      const image = 'mysql:8.0.46';
      const imageResult = await docker(['image', 'inspect', image, '--format', '{{.Id}}']);
      fs.writeFileSync(envFile, `MYSQL_ROOT_PASSWORD=${password}\nMYSQL_ROOT_HOST=%\nMYSQL_DATABASE=${database}\n`, { flag: 'wx', mode: 0o600 });
      await docker(['run', '-d', '--rm', '--name', container, '--label', 'purpose=qingdao-schema-rehearsal', '--memory', '1536m', '--cpus', '1', '-p', '127.0.0.1::3306', '--env-file', envFile, image, '--event-scheduler=OFF']);
      started = true;
      const binding = JSON.parse((await docker(['inspect', container, '--format', '{{json .NetworkSettings.Ports}}'])).stdout)['3306/tcp'];
      if (binding?.length !== 1 || binding[0].HostIp !== '127.0.0.1' || !/^\d+$/.test(binding[0].HostPort)) throw fail('ISOLATED_PORT_BINDING_INVALID');
      connectionOptions = { host: '127.0.0.1', port: Number(binding[0].HostPort), user: 'root', password, database, connectTimeout: 1000 };
      backend = { engine, image: imageResult.stdout.trim() };
    } else {
      native = await startNative(snapshot, log);
      // No host, port or production credentials can be inherited into this socket-only connection.
      connectionOptions = { socketPath: native.layout.socket, user: 'root', password: '', connectTimeout: 1000 };
      backend = { engine, binary: NATIVE_BINARY, binaryVersion: native.version, nativeDirectory: native.layout.directory, runUid: native.uid, runGid: native.gid };
    }
    for (let attempt = 0; attempt < 90; attempt++) {
      if (native?.spawnError || native?.exit) throw fail('ISOLATED_NATIVE_MYSQL_EXITED');
      try {
        if (native && !fs.lstatSync(native.layout.socket).isSocket()) throw fail('NATIVE_SOCKET_INVALID');
        connection = await mysql.createConnection(connectionOptions);
        await connection.query('SELECT 1');
        break;
      } catch {
        await connection?.end().catch(() => {}); connection = undefined;
        if (attempt % 10 === 0) console.log(JSON.stringify({ status: 'waiting_for_isolated_mysql', attempt }));
        await sleep(1000);
      }
    }
    if (!connection) throw fail('ISOLATED_MYSQL_NOT_READY');
    if (native) {
      const [runtime] = await connection.query("SELECT VERSION() AS version, @@datadir AS dataDirectory, @@socket AS socketPath, @@pid_file AS pidPath, @@skip_networking AS skipNetworking, @@event_scheduler AS eventScheduler, (SELECT COUNT(*) FROM information_schema.plugins WHERE plugin_name='mysqlx' AND plugin_status='ACTIVE') AS mysqlxActive");
      assertNativeRuntime(runtime[0], native.layout.directory, snapshot.identity.version);
      await connection.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?", [password]);
      await connection.query('CREATE DATABASE `amz_listing` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
      await connection.query('USE `amz_listing`');
      log({ status: 'native_runtime_isolation_verified', ...backend });
    }
    const [identity] = await connection.query('SELECT DATABASE() AS databaseName, VERSION() AS version, @@lower_case_table_names AS lowerCaseTableNames');
    assertMysqlVersion(identity[0].version, snapshot.identity.version);
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
    const result = { status: 'schema_rehearsal_passed', outputDirectory, planHash, snapshotHash: plan.productionSnapshotSha256, afterFingerprint: schemaFingerprint(after), appliedSteps: steps.length, ...backend, databaseVersion: identity[0].version, productionConnectionUsed: false, dataCompatibilityVerified: false };
    fs.writeFileSync(path.join(outputDirectory, 'manifest.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
    return result;
  } catch (error) {
    const details = { status: 'rehearsal_failed', step: stepId, code: error.safeCode || error.code || 'REHEARSAL_FAILED', outputDirectory };
    log(details);
    throw Object.assign(fail(details.code), { safeDetails: details });
  } finally {
    await connection?.end().catch(() => {});
    await stopNative(native, log);
    if (started) {
      // This is only the exact disposable empty-schema container created above.
      await docker(['stop', '--time', '10', container]).then(() => log({ status: 'isolated_container_removed' }), () => log({ status: 'isolated_container_cleanup_requires_operator', container }));
    }
    if (fs.existsSync(envFile)) fs.unlinkSync(envFile);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const [planPath, planHash, snapshotPath, outputParent, engineOption] = process.argv.slice(2);
  const engine = engineOption === undefined ? 'docker' : engineOption === '--engine=native' ? 'native' : 'invalid';
  try { console.log(JSON.stringify(await rehearse({ planPath, planHash, snapshotPath, outputParent, engine }), null, 2)); }
  catch (error) { console.error(JSON.stringify(error.safeDetails || { code: error.safeCode || 'REHEARSAL_FAILED' })); process.exitCode = 1; }
}
