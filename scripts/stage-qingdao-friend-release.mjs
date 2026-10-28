import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { spawn } from 'node:child_process';

const TOP_LEVEL = new Set(['package.json', 'node_modules', 'dist', 'drizzle', 'scripts', 'config']);
const FORCED = Object.freeze({ HOST: '127.0.0.1', AUTH_MODE: 'local', AI_JOB_IN_PROCESS: 'false', KNOWLEDGE_CACHE_CLEANUP_ENABLED: 'false', APP_PUBLIC_URL: 'https://www.kuahaixing.com', MEETING_AUDIO_PUBLIC_ORIGIN: 'https://www.kuahaixing.com' });
const NEW_ROOTS = Object.freeze({ LOCAL_STORAGE_DIR: '/var/lib/amazon-listing-tool/objects', DESIGN_STUDIO_STORAGE_ROOT: '/var/lib/amazon-listing-tool/design-studio', MEETING_AUDIO_STORAGE_ROOT: '/var/lib/amazon-listing-tool/meeting-audio' });
const fail = code => Object.assign(new Error(code), { safeCode: code });
const commandEnv = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', LC_ALL: 'C' };

export function archivePath(name) {
  if (typeof name !== 'string' || !name || /[\\\0\r\n\t]/.test(name) || name.startsWith('/')) throw fail('ARCHIVE_PATH_UNSAFE');
  const normalized = name.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (!normalized || normalized.split('/').some(part => part === '..' || part === '.' || part === '') || !TOP_LEVEL.has(normalized.split('/')[0])) throw fail('ARCHIVE_PATH_OUT_OF_SCOPE');
  return normalized;
}

export function validateArchiveEntry(name, type, linkname = '') {
  const entry = archivePath(name);
  if (!['0', '\0', '', '5', '1', '2'].includes(type)) throw fail('ARCHIVE_ENTRY_TYPE_UNSUPPORTED');
  if (entry === 'package.json' ? !['0', '\0', ''].includes(type) : !entry.includes('/') && type !== '5') throw fail('ARCHIVE_TOP_LEVEL_TYPE_INVALID');
  if (type === '1') archivePath(linkname);
  if (type === '2') {
    if (!linkname || linkname.startsWith('/') || /[\\\0\r\n\t]/.test(linkname)) throw fail('ARCHIVE_LINK_UNSAFE');
    archivePath(path.posix.normalize(path.posix.join(path.posix.dirname(entry), linkname)));
  }
  return entry;
}

function tarNumber(bytes) {
  const text = bytes.toString('ascii').replace(/\0.*$/, '').trim();
  if (bytes[0] & 0x80 || !/^[0-7]*$/.test(text)) throw fail('ARCHIVE_NUMBER_UNSUPPORTED');
  const value = parseInt(text || '0', 8);
  if (!Number.isSafeInteger(value) || value < 0) throw fail('ARCHIVE_NUMBER_INVALID');
  return value;
}

function tarString(bytes) { return bytes.subarray(0, bytes.indexOf(0) === -1 ? bytes.length : bytes.indexOf(0)).toString('utf8'); }

function parsePax(bytes) {
  const result = {};
  let offset = 0;
  while (offset < bytes.length) {
    const separator = bytes.indexOf(32, offset);
    if (separator < 0 || !/^\d+$/.test(bytes.subarray(offset, separator).toString('ascii'))) throw fail('ARCHIVE_PAX_INVALID');
    const length = Number(bytes.subarray(offset, separator).toString('ascii'));
    if (!Number.isSafeInteger(length) || length <= separator - offset + 2 || offset + length > bytes.length || bytes[offset + length - 1] !== 10) throw fail('ARCHIVE_PAX_INVALID');
    const record = bytes.subarray(separator + 1, offset + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals < 1) throw fail('ARCHIVE_PAX_INVALID');
    const key = record.slice(0, equals);
    if (key.includes('sparse') || key === 'size') throw fail('ARCHIVE_PAX_EXTENSION_REQUIRES_REVIEW');
    result[key] = record.slice(equals + 1);
    offset += length;
  }
  return result;
}

// Streaming validation of actual headers, including GNU/PAX path overrides.
// Only public runtime roots, normal files/directories, and internal links are allowed.
export async function inspectArchive(filename) {
  const input = fs.createReadStream(filename);
  const unzip = createGunzip();
  input.on('error', error => unzip.destroy(error));
  input.pipe(unzip);
  const iterator = unzip[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  const read = async (length, retain = true) => {
    const parts = [];
    let remaining = length;
    while (remaining > 0) {
      if (!pending.length) {
        const next = await iterator.next();
        if (next.done) throw fail('ARCHIVE_TRUNCATED');
        pending = next.value;
      }
      const count = Math.min(remaining, pending.length);
      if (retain) parts.push(pending.subarray(0, count));
      pending = pending.subarray(count);
      remaining -= count;
    }
    return retain ? Buffer.concat(parts) : undefined;
  };
  let localPax = {}, globalPax = {}, longName, longLink, count = 0, totalBytes = 0;
  const roots = new Set();
  const entries = new Map();
  try {
    for (;;) {
      const header = await read(512);
      if (header.every(byte => byte === 0)) {
        if (!(await read(512)).every(byte => byte === 0)) throw fail('ARCHIVE_END_MARKER_INVALID');
        if (pending.some(byte => byte !== 0)) throw fail('ARCHIVE_TRAILING_PAYLOAD');
        for (;;) { const next = await iterator.next(); if (next.done) break; if (next.value.some(byte => byte !== 0)) throw fail('ARCHIVE_TRAILING_PAYLOAD'); }
        break;
      }
      const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
      if (checksum !== tarNumber(header.subarray(148, 156))) throw fail('ARCHIVE_HEADER_CHECKSUM_FAILED');
      const size = tarNumber(header.subarray(124, 136));
      const type = String.fromCharCode(header[156]);
      totalBytes += size;
      if (totalBytes > 32 * 1024 ** 3 || ++count > 1_000_000) throw fail('ARCHIVE_LIMIT_EXCEEDED');
      if (['x', 'g', 'L', 'K'].includes(type)) {
        if (size > 2 * 1024 ** 2) throw fail('ARCHIVE_METADATA_TOO_LARGE');
        const metadata = await read(size);
        if (type === 'x') localPax = { ...localPax, ...parsePax(metadata) };
        if (type === 'g') globalPax = { ...globalPax, ...parsePax(metadata) };
        if (type === 'L') longName = tarString(metadata);
        if (type === 'K') longLink = tarString(metadata);
      } else {
        const prefix = tarString(header.subarray(345, 500));
        const base = tarString(header.subarray(0, 100));
        const pax = { ...globalPax, ...localPax };
        const name = pax.path ?? longName ?? (prefix ? `${prefix}/${base}` : base);
        const linkname = pax.linkpath ?? longLink ?? tarString(header.subarray(157, 257));
        const entry = validateArchiveEntry(name, type, linkname);
        if (entries.has(entry) && !(entries.get(entry) === '5' && type === '5')) throw fail('ARCHIVE_DUPLICATE_ENTRY');
        entries.set(entry, type);
        roots.add(entry.split('/')[0]);
        localPax = {}; longName = undefined; longLink = undefined;
        await read(size, false);
      }
      await read((512 - size % 512) % 512, false);
    }
  } finally { input.destroy(); unzip.destroy(); }
  if ([...TOP_LEVEL].some(root => !roots.has(root))) throw fail('ARCHIVE_REQUIRED_ROOT_MISSING');
  return { entries: entries.size, expandedPayloadBytes: totalBytes, roots: [...roots].sort() };
}

async function digest(filename) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

async function command(binary, args) {
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'ignore'], env: commandEnv });
  let result = '';
  child.stdout.on('data', chunk => { result += chunk.toString(); if (result.length > 1024 * 1024) child.kill('SIGTERM'); });
  await new Promise((resolve, reject) => {
    child.once('error', () => reject(fail('STAGE_COMMAND_START_FAILED')));
    child.once('close', code => code === 0 && result.length <= 1024 * 1024 ? resolve() : reject(fail('STAGE_COMMAND_FAILED')));
  });
  return result.trim();
}

export function candidateConfiguration(source, parse) {
  const original = parse(source);
  const changes = { ...FORCED };
  const newRoots = [];
  for (const [key, value] of Object.entries(NEW_ROOTS)) {
    if (original[key] !== undefined && original[key] !== '') continue;
    if (key !== 'LOCAL_STORAGE_DIR' && original.LISTING_SUPPLEMENT_LOCAL_ROOT) {
      if (!path.isAbsolute(original.LISTING_SUPPLEMENT_LOCAL_ROOT)) throw fail('LISTING_SUPPLEMENT_ROOT_REQUIRES_REVIEW');
      // Both current services already fall back to a child of this root.
      // Leave their keys absent/empty so existing files remain reachable.
      continue;
    }
    changes[key] = value;
    newRoots.push(value);
  }
  const text = `${source}${source.endsWith('\n') ? '' : '\n'}\n# Qingdao native release candidate overrides; generated, do not commit.\n${Object.entries(changes).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
  const candidate = parse(text);
  for (const [key, value] of Object.entries(original)) if (!(key in changes) && candidate[key] !== value) throw fail('CONFIGURATION_PRESERVATION_FAILED');
  for (const [key, value] of Object.entries(changes)) if (candidate[key] !== value) throw fail('CONFIGURATION_OVERRIDE_FAILED');
  return { text, changedKeys: Object.keys(changes), newRoots };
}

export function assertNoImplicitLocalObjects(configuration, appDirectory) {
  if (configuration.LOCAL_STORAGE_DIR !== undefined && configuration.LOCAL_STORAGE_DIR !== '') return;
  // The old process resolves its default against WorkingDirectory, not the
  // future release directory. Never silently detach that existing storage.
  try {
    fs.lstatSync(path.join(appDirectory, 'data', 'objects'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw fail('IMPLICIT_LOCAL_STORAGE_REQUIRES_REVIEW');
  }
  throw fail('IMPLICIT_LOCAL_STORAGE_REQUIRES_REVIEW');
}

function verifyExtractedLinks(directory) {
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        let target;
        try { target = fs.realpathSync(full); } catch { throw fail('EXTRACTED_LINK_UNRESOLVED'); }
        if (!target.startsWith(`${directory}/`)) throw fail('EXTRACTED_LINK_OUTSIDE_CANDIDATE');
      } else if (entry.isDirectory()) visit(full);
      else if (!entry.isFile()) throw fail('EXTRACTED_FILE_TYPE_UNEXPECTED');
    }
  };
  visit(directory);
}

function prepareNewDirectory(directory, uid, gid, created) {
  // Do not follow an existing parent alias into old /var/lib/app storage.
  let ancestor = path.parse(directory).root;
  for (const component of directory.slice(ancestor.length).split('/')) {
    ancestor = path.join(ancestor, component);
    try {
      const stat = fs.lstatSync(ancestor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('NEW_STORAGE_ROOT_REQUIRES_REVIEW');
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('NEW_STORAGE_ROOT_REQUIRES_REVIEW');
    return; // Never chmod/chown an existing storage directory.
  }
  const parent = path.dirname(directory);
  if (!fs.existsSync(parent)) prepareNewDirectory(parent, uid, gid, created);
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.chownSync(directory, uid, gid);
  created.push(directory);
}

export async function stageRelease({ archive, expectedHash, commit, stageParent, appDirectory = '/opt/amazon-listing-tool', configPath = '/etc/amazon-listing-tool/runtime.conf' }) {
  for (const value of [archive, stageParent, appDirectory, configPath]) if (!value || !path.isAbsolute(value) || path.normalize(value) !== value) throw fail('ABSOLUTE_NORMALIZED_PATHS_REQUIRED');
  if (!/^[0-9a-f]{64}$/.test(expectedHash || '') || !/^[0-9a-f]{40}$/.test(commit || '')) throw fail('EXACT_HASH_AND_COMMIT_REQUIRED');
  if (process.platform !== 'linux' || process.getuid() !== 0) throw fail('LINUX_ROOT_STAGING_REQUIRED');
  if (fs.realpathSync(stageParent) === fs.realpathSync(appDirectory) || fs.realpathSync(stageParent).startsWith(`${fs.realpathSync(appDirectory)}/`)) throw fail('STAGE_MUST_BE_OUTSIDE_ACTIVE_APP');
  if (await digest(archive) !== expectedHash) throw fail('RUNTIME_ARCHIVE_HASH_MISMATCH');
  const archiveInspection = await inspectArchive(archive);
  const tarVersion = await command('/usr/bin/tar', ['--version']);
  if (!tarVersion.includes('GNU tar')) throw fail('GNU_TAR_REQUIRED');
  const uid = Number(await command('/usr/bin/id', ['-u', 'ecs-user']));
  const gid = Number(await command('/usr/bin/id', ['-g', 'ecs-user']));
  if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid < 0) throw fail('SERVICE_OWNER_INVALID');
  const parse = createRequire(path.join(appDirectory, 'package.json'))('dotenv').parse;
  const sourceConfig = fs.readFileSync(configPath, 'utf8');
  const sourceConfigHash = crypto.createHash('sha256').update(sourceConfig).digest('hex');
  assertNoImplicitLocalObjects(parse(sourceConfig), appDirectory);
  const configuration = candidateConfiguration(sourceConfig, parse);
  const outputDirectory = fs.mkdtempSync(path.join(stageParent, `candidate-${commit.slice(0, 12)}-`));
  fs.chmodSync(outputDirectory, 0o700);
  const candidateApp = path.join(outputDirectory, 'app');
  const candidateConfig = path.join(outputDirectory, 'runtime.candidate.conf');
  const createdStorageDirectories = [];
  try {
    fs.mkdirSync(candidateApp, { mode: 0o700 });
    // A fresh directory, no --keep-directory-symlink, no inherited ownership,
    // no overwriting prior entries. The archive was validated before extraction.
    await command('/usr/bin/tar', ['--extract', '--gzip', '--file', archive, '--directory', candidateApp, '--no-same-owner', '--no-same-permissions', '--keep-old-files', '--delay-directory-restore']);
    verifyExtractedLinks(candidateApp);
    for (const relative of ['package.json', 'dist/index.js', 'dist/aiWorker.js', 'dist/scheduler.js']) if (!fs.statSync(path.join(candidateApp, relative)).isFile()) throw fail('REQUIRED_RUNTIME_FILE_MISSING');
    await command('/usr/bin/chown', ['-R', '-P', '--no-dereference', `${uid}:${gid}`, candidateApp]);
    for (const directory of configuration.newRoots) prepareNewDirectory(directory, uid, gid, createdStorageDirectories);
    fs.writeFileSync(candidateConfig, configuration.text, { flag: 'wx', mode: 0o600 });
    if (await digest(configPath) !== sourceConfigHash) throw fail('ACTIVE_CONFIG_CHANGED_DURING_STAGE');
    const manifest = { status: 'staged_not_deployed', stagedAt: new Date().toISOString(), sourceCommit: commit, archive, archiveSha256: expectedHash, archiveInspection, activeAppUnchanged: appDirectory, activeConfigUnchanged: configPath, candidateApp, candidateConfig, candidateConfigSha256: await digest(candidateConfig), activeConfigSha256: sourceConfigHash, changedConfigurationKeys: configuration.changedKeys, createdStorageDirectories, codeOwner: { user: 'ecs-user', uid, gid }, productionServicesTouched: false, productionDatabaseTouched: false, productTaskStorageTouched: false };
    fs.writeFileSync(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(outputDirectory, 'CUTOVER-AND-ROLLBACK.txt'), `STAGED ONLY — no running service, database, active config, old app, node_modules link, PRODUCT_TASK_LOCAL_ROOT or .storage-id was changed.\n\nCandidate app: ${candidateApp}\nCandidate config: ${candidateConfig}\nCommit label (bound to the provided CI artifact/hash by the operator): ${commit}\n\nBefore any cutover: finish verified DB/config/unit backups and necessary additive schema migration; inspect actual unit ExecStart/EnvironmentFile and Nginx paths; install and verify browser/media dependencies separately; verify native module compatibility on this host. The root-only staging parent intentionally prevents ecs-user access until a reviewed move/permission plan. No new Chromium setting was inserted.\n\nManual reviewed cutover sequence (not executed):\n1. Record exact active app/config paths and prepare timestamped rollback destinations on the SAME filesystem. Preserve the original real app directory and its node_modules symlink to /opt/amz-runtime-candidate-b8f4003/node_modules. Do not delete that target.\n2. Stop scheduler, worker, then web in the planned maintenance window.\n3. Rename the original /opt/amazon-listing-tool to its recorded rollback path; rename candidate app into /opt/amazon-listing-tool. Back up and atomically install candidate runtime config with root ownership and mode 0600. Do not replace /var/lib/app, PRODUCT_TASK_LOCAL_ROOT, .storage-id, OSS configuration, buckets or uploaded objects.\n4. Start web and require /healthz and /readyz; then worker and scheduler, watching logs and real site responses. Keep KNOWLEDGE_CACHE_CLEANUP_ENABLED=false during initial rollout.\n\nIf cutover fails: stop those units, move the failed app aside without deletion, rename the preserved original app back to /opt/amazon-listing-tool, restore the saved config with its recorded ownership/mode, then restart and verify. Additive DB changes should ordinarily remain; restoring the full DB snapshot requires a separate maintenance/reconciliation decision to avoid losing newer writes. Do not run any generic database migration train or automatic full restore.\n\nThis file is guidance only. It deliberately provides no executable stop/switch/rollback automation.\n`, { flag: 'wx', mode: 0o600 });
    return manifest;
  } catch (error) {
    fs.writeFileSync(path.join(outputDirectory, 'FAILED.json'), JSON.stringify({ status: 'staging_incomplete_do_not_deploy', error: error.safeCode || 'STAGING_FAILED', createdStorageDirectories }), { flag: 'wx', mode: 0o600 });
    throw Object.assign(fail(error.safeCode || 'STAGING_FAILED'), { outputDirectory });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const [archive, expectedHash, commit, stageParent, appDirectory, configPath] = process.argv.slice(2);
  try { console.log(JSON.stringify(await stageRelease({ archive, expectedHash, commit, stageParent, appDirectory, configPath }), null, 2)); }
  catch (error) { console.error(JSON.stringify({ error: error.safeCode || 'STAGING_FAILED', outputDirectory: error.outputDirectory })); process.exitCode = 1; }
}
