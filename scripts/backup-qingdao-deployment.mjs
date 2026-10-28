import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

const UNITS = ['amazon-listing-web.service', 'amazon-listing-worker.service', 'amazon-listing-scheduler.service'];
const PRIVATE_MODE = 0o600;
const COMMAND_ENV = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', LC_ALL: 'C' };
const fail = code => Object.assign(new Error(code), { safeCode: code });

export function mysqlOption(value) {
  if (String(value).includes('\0')) throw fail('MYSQL_OPTION_CONTAINS_NUL');
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t')}"`;
}

export function databaseOptions(databaseUrl) {
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw fail('INVALID_DATABASE_URL'); }
  if (!['mysql:', 'mysql2:'].includes(parsed.protocol) || !parsed.hostname || !parsed.username || parsed.hash) throw fail('UNSUPPORTED_DATABASE_URL');
  // Do not silently drop TLS/socket options from a MySQL driver connection URL.
  for (const key of parsed.searchParams.keys()) {
    if (key !== 'charset' || !['utf8mb4', 'utf8mb4_unicode_ci'].includes(parsed.searchParams.get(key))) throw fail('DATABASE_URL_OPTIONS_REQUIRE_REVIEW');
  }
  let user, password, database;
  try {
    user = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
    database = decodeURIComponent(parsed.pathname.slice(1));
  } catch { throw fail('INVALID_DATABASE_URL_ENCODING'); }
  if (!database || database.startsWith('-') || /[\0\r\n/]/.test(database)) throw fail('INVALID_DATABASE_NAME');
  return {
    database,
    defaults: `[client]\nprotocol=TCP\nhost=${mysqlOption(parsed.hostname.replace(/^\[|\]$/g, ''))}\nport=${mysqlOption(parsed.port || '3306')}\nuser=${mysqlOption(user)}\npassword=${mysqlOption(password)}\ndefault-character-set=utf8mb4\n`,
  };
}

export function assertNoPersonalMysqlOverrides(homeDirectories = [os.userInfo().homedir, os.homedir()]) {
  // MySQL reads user option/login files after defaults-extra-file. Never silently
  // let those redirect a production backup to another account or database host.
  for (const directory of new Set(homeDirectories)) {
    for (const filename of ['.my.cnf', '.mylogin.cnf']) {
      if (fs.existsSync(path.join(directory, filename))) throw fail('PERSONAL_MYSQL_OPTIONS_REQUIRE_REVIEW');
    }
  }
}

function writePrivate(filename, data) {
  fs.writeFileSync(filename, data, { flag: 'wx', mode: PRIVATE_MODE });
}

export async function fileDigest(filename) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) digest.update(chunk);
  return { sha256: digest.digest('hex'), bytes: fs.statSync(filename).size };
}

async function verifyGzip(filename) {
  let bytes = 0;
  await pipeline(fs.createReadStream(filename), createGunzip(), new Writable({ write(chunk, _encoding, callback) { bytes += chunk.length; callback(); } }));
  if (bytes === 0) throw fail('EMPTY_DATABASE_DUMP');
  return bytes;
}

export async function dumpDatabase({ defaultsFile, database, output, schemaOnly = false, signal, spawnProcess = spawn }) {
  const partial = `${output}.partial`;
  const stderrFile = `${output}.stderr.log`;
  const stderrFd = fs.openSync(stderrFile, 'wx', PRIVATE_MODE);
  const args = [
    `--defaults-extra-file=${defaultsFile}`, '--single-transaction', '--quick', '--skip-lock-tables',
    '--routines', '--triggers', '--events', '--hex-blob', '--no-tablespaces',
    '--set-gtid-purged=OFF', '--column-statistics=0', '--default-character-set=utf8mb4',
    ...(schemaOnly ? ['--no-data'] : []), database,
  ];
  let child;
  try {
    child = spawnProcess('/usr/bin/mysqldump', args, { stdio: ['ignore', 'pipe', stderrFd], env: COMMAND_ENV, signal });
  } finally { fs.closeSync(stderrFd); }
  const exited = new Promise((resolve, reject) => {
    child.once('error', () => reject(fail('MYSQLDUMP_START_OR_ABORT_FAILED')));
    child.once('close', (code, killedSignal) => code === 0 && !killedSignal ? resolve() : reject(fail('MYSQLDUMP_EXIT_FAILED')));
  });
  const streamed = pipeline(child.stdout, createGzip({ level: 6 }), fs.createWriteStream(partial, { flags: 'wx', mode: PRIVATE_MODE }))
    .catch(error => { child.kill('SIGTERM'); throw error; });
  // Both branches must settle: a successful compressor must never mask a failed dump.
  const results = await Promise.allSettled([exited, streamed]);
  if (results.some(result => result.status === 'rejected')) throw fail('DATABASE_DUMP_INCOMPLETE');
  let uncompressedBytes;
  try { uncompressedBytes = await verifyGzip(partial); } catch { throw fail('DATABASE_DUMP_GZIP_INVALID'); }
  const digest = await fileDigest(partial);
  // Do not overwrite an existing final artifact, even if the caller reuses a path.
  fs.linkSync(partial, output);
  fs.unlinkSync(partial);
  writePrivate(`${output}.sha256`, `${digest.sha256}  ${path.basename(output)}\n`);
  return { file: path.basename(output), ...digest, uncompressedBytes, schemaOnly, stderrFile: path.basename(stderrFile) };
}

async function commandText(binary, args, signal) {
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'ignore'], env: COMMAND_ENV, signal });
  let text = '';
  child.stdout.on('data', data => {
    text += data.toString('utf8');
    if (text.length > 4 * 1024 * 1024) child.kill('SIGTERM');
  });
  await new Promise((resolve, reject) => {
    child.once('error', () => reject(fail('READ_ONLY_COMMAND_START_FAILED')));
    child.once('close', code => code === 0 && text.length <= 4 * 1024 * 1024 ? resolve() : reject(fail('READ_ONLY_COMMAND_FAILED')));
  });
  return text;
}

async function copyConfiguration(source, outputDirectory, copies) {
  if (!path.isAbsolute(source) || path.normalize(source) !== source) throw fail('INVALID_CONFIGURATION_PATH');
  const stat = fs.statSync(source);
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw fail('UNEXPECTED_CONFIGURATION_FILE');
  const relative = path.join('files', source.slice(1));
  const destination = path.join(outputDirectory, relative);
  if (copies.some(copy => copy.original === source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, PRIVATE_MODE);
  copies.push({ original: source, file: relative, originalMode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid, ...(await fileDigest(destination)) });
}

function restoreInstructions(appDirectory, configPath) {
  return `PRIVATE BACKUP — operator-reviewed recovery only\n\nThis tool does not stop services, change production data, restore files, or delete old backups.\nThe SQL and runtime configuration contain credentials/business data. Keep this directory private and do not publish or attach it to GitHub.\n\nVerification:\n  cd BACKUP_DIRECTORY\n  sha256sum -c database.sql.gz.sha256\n  gzip -t database.sql.gz\n  sha256sum -c schema.sql.gz.sha256\n  gzip -t schema.sql.gz\n\nRestore drill (manual; use a NEW EMPTY database on an isolated MySQL 8 instance):\n  1. Provision the isolated database and an operator-owned 0600 /root/restore-client.cnf.\n     It must contain [client], host, user, password and required TLS options. Do not put the password in argv or shell history.\n  2. Confirm the target hostname and database are NOT production. SQL omits CREATE DATABASE/USE, so the operator chooses the isolated target.\n  3. Review event definitions before import; the isolated server must have event_scheduler=OFF to avoid executing restored events.\n  4. In bash, after replacing RESTORE_EMPTY_DATABASE:\n       set -o pipefail\n       gzip -dc database.sql.gz | mysql --defaults-extra-file=/root/restore-client.cnf RESTORE_EMPTY_DATABASE\n  5. Require BOTH pipeline exits to be zero, then compare table inventory/schema and application read-only smoke checks.\n\nProduction rollback requires a separate reviewed plan and maintenance window. Do NOT blindly import this snapshot into a running production database: writes since the snapshot would be lost.\nFor additive deployment changes, prefer rolling code back first and retaining compatible additive schema.\n\nCode is intentionally NOT duplicated by this backup (may contain large user uploads). Before cutover preserve the complete original ${appDirectory} by an on-filesystem rename or equivalent reviewed release-directory strategy; record its exact path. Do not delete it or user data.\nThe runtime config was ${configPath}. Original config/unit paths, ownership, modes and hashes are recorded in manifest.json; backup copies are all 0600. Restore only explicitly reviewed files with their recorded mode/owner, run systemctl daemon-reload only if units changed, then explicitly restart the three named units in the reviewed rollback plan. This script never runs those commands.\n\nConsistency caveat: --single-transaction provides one InnoDB data snapshot. Do not run ALTER/CREATE/DROP/RENAME/TRUNCATE concurrently with the backup. The separate schema-only dump is captured afterwards; absence of concurrent DDL is required. Uploaded objects/local files are not backed up by this script and must remain in place.\n`;
}

export async function backupDeployment({ parentDirectory, appDirectory = '/opt/amazon-listing-tool', configPath = '/etc/amazon-listing-tool/runtime.conf', signal }) {
  for (const value of [parentDirectory, appDirectory, configPath]) {
    if (!value || !path.isAbsolute(value) || path.normalize(value) !== value) throw fail('ABSOLUTE_NORMALIZED_PATHS_REQUIRED');
  }
  if (!fs.statSync(parentDirectory).isDirectory()) throw fail('BACKUP_PARENT_NOT_DIRECTORY');
  const outputDirectory = fs.mkdtempSync(path.join(parentDirectory, 'backup-'));
  fs.chmodSync(outputDirectory, 0o700);
  const defaultsFile = path.join(outputDirectory, '.mysql-client.cnf');
  const requireApp = createRequire(path.join(appDirectory, 'package.json'));
  let connection;
  try {
    const configuration = requireApp('dotenv').parse(fs.readFileSync(configPath));
    if (!configuration.DATABASE_URL) throw fail('DATABASE_URL_MISSING');
    const options = databaseOptions(configuration.DATABASE_URL);
    assertNoPersonalMysqlOverrides();
    connection = await requireApp('mysql2/promise').createConnection(configuration.DATABASE_URL);
    const [identityRows] = await connection.query('SELECT DATABASE() AS databaseName, @@server_uuid AS serverUuid');
    const databaseIdentity = identityRows[0];
    if (databaseIdentity.databaseName !== options.database || !databaseIdentity.serverUuid) throw fail('BACKUP_DATABASE_IDENTITY_MISMATCH');
    const [tables] = await connection.execute('SELECT TABLE_NAME, ENGINE, DATA_LENGTH, INDEX_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = \'BASE TABLE\'', [options.database]);
    if (!tables.length) throw fail('DATABASE_HAS_NO_BASE_TABLES');
    if (tables.some(table => table.ENGINE !== 'InnoDB')) throw fail('NON_INNODB_TABLES_REQUIRE_BACKUP_REVIEW');
    await connection.end();
    connection = undefined;
    const disk = fs.statfsSync(outputDirectory, { bigint: true });
    const freeBytes = disk.bavail * disk.bsize;
    const estimatedBytes = tables.reduce((sum, table) => sum + BigInt(table.DATA_LENGTH || 0) + BigInt(table.INDEX_LENGTH || 0), 0n);
    if (freeBytes < (estimatedBytes * 2n > 536870912n ? estimatedBytes * 2n : 536870912n)) throw fail('INSUFFICIENT_BACKUP_DISK_HEADROOM');
    const copies = [];
    await copyConfiguration(configPath, outputDirectory, copies);
    for (const unit of UNITS) {
      const effective = await commandText('/usr/bin/systemctl', ['cat', '--no-pager', unit], signal);
      writePrivate(path.join(outputDirectory, `${unit}.effective.txt`), effective);
      const paths = [...effective.matchAll(/^# (\/(?:etc|run|usr\/lib|lib)\/systemd\/system\/[^\r\n]+)$/gm)].map(match => match[1]);
      if (!paths.length) throw fail('SYSTEMD_SOURCE_PATH_NOT_FOUND');
      for (const source of paths) await copyConfiguration(source, outputDirectory, copies);
    }
    const provenance = [];
    for (const relative of ['package.json', 'dist/index.js', 'dist/aiWorker.js', 'dist/scheduler.js', 'dist/public/release-features.json']) {
      const filename = path.join(appDirectory, relative);
      if (fs.existsSync(filename) && fs.statSync(filename).isFile()) provenance.push({ file: relative, ...(await fileDigest(filename)) });
    }
    const dumpVersion = (await commandText('/usr/bin/mysqldump', ['--version'], signal)).trim();
    writePrivate(defaultsFile, options.defaults);
    const database = await dumpDatabase({ defaultsFile, database: options.database, output: path.join(outputDirectory, 'database.sql.gz'), signal });
    const schema = await dumpDatabase({ defaultsFile, database: options.database, output: path.join(outputDirectory, 'schema.sql.gz'), schemaOnly: true, signal });
    const manifest = { status: 'backup_complete', completedAt: new Date().toISOString(), appDirectory, configPath, databaseIdentity, baseTableCount: tables.length, dumpVersion, database, schema, configurationFiles: copies, codeProvenanceOnly: provenance, codeAndObjectStorageBackedUp: false, consistency: 'InnoDB single-transaction; operator must prevent concurrent DDL' };
    writePrivate(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    writePrivate(path.join(outputDirectory, 'RESTORE-INSTRUCTIONS.txt'), restoreInstructions(appDirectory, configPath));
    return { status: manifest.status, outputDirectory, baseTableCount: tables.length, database, schema, configFiles: copies.length, codeAndObjectStorageBackedUp: false };
  } catch (error) {
    writePrivate(path.join(outputDirectory, 'FAILED.json'), `${JSON.stringify({ status: 'incomplete_do_not_use', error: error.safeCode || 'BACKUP_FAILED', failedAt: new Date().toISOString() })}\n`);
    throw Object.assign(fail(error.safeCode || 'BACKUP_FAILED'), { outputDirectory });
  } finally {
    if (connection) await connection.end().catch(() => {});
    if (fs.existsSync(defaultsFile)) fs.unlinkSync(defaultsFile);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const [parentDirectory, appDirectory, configPath] = process.argv.slice(2);
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    const result = await backupDeployment({ parentDirectory, appDirectory, configPath, signal: controller.signal });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.safeCode || 'BACKUP_FAILED', outputDirectory: error.outputDirectory }));
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}
