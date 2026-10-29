import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import dotenv from 'dotenv';
import { archivePath, validateArchiveEntry, inspectArchive, candidateConfiguration, assertNoImplicitLocalObjects, verifyExtractedLinks } from './stage-qingdao-friend-release.mjs';

test('archive paths and link targets cannot leave the six allowed runtime roots', () => {
  assert.equal(archivePath('./dist/index.js'), 'dist/index.js');
  for (const name of ['/dist/index.js', 'dist/../outside', '../dist/index.js', 'uploads/customer.png', 'dist/a\nb', 'dist/a\\b']) assert.throws(() => archivePath(name));
  assert.equal(validateArchiveEntry('node_modules/a', '2', '.pnpm/a/node_modules/a'), 'node_modules/a');
  assert.throws(() => validateArchiveEntry('node_modules/a', '2', '/etc/passwd'));
  assert.throws(() => validateArchiveEntry('node_modules/a', '2', '../../etc/passwd'));
  assert.throws(() => validateArchiveEntry('dist/a', '1', '../outside'));
  assert.throws(() => validateArchiveEntry('dist/a', '3'));
  assert.throws(() => validateArchiveEntry('node_modules', '2', 'dist'));
});

test('candidate appends overrides but preserves secrets, provider, task root and browser settings', () => {
  const source = '# original config\nDATABASE_URL="mysql://user:p%40ss@private/db"\nJWT_SECRET=do-not-print\nHOST=0.0.0.0\nSTORAGE_PROVIDER=oss\nPRODUCT_TASK_LOCAL_ROOT=/var/lib/app/product-task\nLOCAL_STORAGE_DIR=/var/lib/app/objects\nCHROMIUM_EXECUTABLE_PATH=/existing/browser\nEXTRA="a#b c"\n';
  const result = candidateConfiguration(source, dotenv.parse);
  const config = dotenv.parse(result.text);
  assert.ok(result.text.startsWith(source));
  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'STORAGE_PROVIDER', 'PRODUCT_TASK_LOCAL_ROOT', 'LOCAL_STORAGE_DIR', 'CHROMIUM_EXECUTABLE_PATH', 'EXTRA']) assert.equal(config[key], dotenv.parse(source)[key]);
  assert.equal(config.HOST, '127.0.0.1');
  assert.equal(config.AUTH_MODE, 'local');
  assert.equal(config.AI_JOB_IN_PROCESS, 'false');
  assert.equal(config.KNOWLEDGE_CACHE_CLEANUP_ENABLED, 'false');
  assert.equal(config.APP_PUBLIC_URL, 'https://www.kuahaixing.com');
  assert.equal(config.MEETING_AUDIO_PUBLIC_ORIGIN, 'https://www.kuahaixing.com');
  assert.deepEqual(result.newRoots, ['/var/lib/amazon-listing-tool/design-studio', '/var/lib/amazon-listing-tool/meeting-audio']);
  assert.equal(result.changedKeys.includes('PRODUCT_TASK_LOCAL_ROOT'), false);
});

test('design and meeting fallback paths stay under the existing listing supplement root', () => {
  const source = 'LISTING_SUPPLEMENT_LOCAL_ROOT=/var/lib/app/listing-supplements\nMEETING_AUDIO_STORAGE_ROOT=\n';
  const result = candidateConfiguration(source, dotenv.parse);
  const config = dotenv.parse(result.text);
  assert.equal(config.LISTING_SUPPLEMENT_LOCAL_ROOT, '/var/lib/app/listing-supplements');
  assert.equal(config.DESIGN_STUDIO_STORAGE_ROOT, undefined);
  assert.equal(config.MEETING_AUDIO_STORAGE_ROOT, '');
  assert.equal(result.changedKeys.includes('DESIGN_STUDIO_STORAGE_ROOT'), false);
  assert.equal(result.changedKeys.includes('MEETING_AUDIO_STORAGE_ROOT'), false);
  assert.deepEqual(result.newRoots, ['/var/lib/amazon-listing-tool/objects']);
  const explicit = candidateConfiguration(`${source}DESIGN_STUDIO_STORAGE_ROOT=/private/existing-design\n`, dotenv.parse);
  assert.equal(dotenv.parse(explicit.text).DESIGN_STUDIO_STORAGE_ROOT, '/private/existing-design');
  assert.throws(() => candidateConfiguration('LISTING_SUPPLEMENT_LOCAL_ROOT=relative/existing\n', dotenv.parse), /LISTING_SUPPLEMENT_ROOT_REQUIRES_REVIEW/);
});

test('implicit local object storage must be absent before assigning a new root', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdao-stage-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assertNoImplicitLocalObjects({}, directory);
  fs.mkdirSync(path.join(directory, 'data', 'objects'), { recursive: true });
  assert.throws(() => assertNoImplicitLocalObjects({}, directory), /IMPLICIT_LOCAL_STORAGE_REQUIRES_REVIEW/);
  assert.throws(() => assertNoImplicitLocalObjects({ LOCAL_STORAGE_DIR: '' }, directory), /IMPLICIT_LOCAL_STORAGE_REQUIRES_REVIEW/);
  // An already explicit root is preserved and does not depend on the fallback.
  assertNoImplicitLocalObjects({ LOCAL_STORAGE_DIR: '/private/existing-objects' }, directory);
});

test('implicit object files and even dangling symlinks also require review', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdao-stage-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fileApp = path.join(directory, 'file-app');
  fs.mkdirSync(path.join(fileApp, 'data'), { recursive: true });
  fs.writeFileSync(path.join(fileApp, 'data', 'objects'), 'existing');
  assert.throws(() => assertNoImplicitLocalObjects({}, fileApp), /IMPLICIT_LOCAL_STORAGE_REQUIRES_REVIEW/);
  const linkApp = path.join(directory, 'link-app');
  fs.mkdirSync(path.join(linkApp, 'data'), { recursive: true });
  fs.symlinkSync(path.join(directory, 'missing-target'), path.join(linkApp, 'data', 'objects'));
  assert.throws(() => assertNoImplicitLocalObjects({}, linkApp), /IMPLICIT_LOCAL_STORAGE_REQUIRES_REVIEW/);
});

function linkCandidate(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qingdao-stage-test-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'node_modules', '.pnpm', 'node_modules'), { recursive: true });
  const production = path.join(directory, 'node_modules', '.pnpm', 'production@1.0.0', 'node_modules', 'production');
  fs.mkdirSync(production, { recursive: true });
  fs.writeFileSync(path.join(production, 'package.json'), JSON.stringify({ name: 'production', version: '1.0.0' }));
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ dependencies: { production: '1.0.0' } }));
  fs.symlinkSync('.pnpm/production@1.0.0/node_modules/production', path.join(directory, 'node_modules', 'production'));
  return directory;
}

test('only missing hidden-hoist virtual-store aliases are allowed and recorded', t => {
  const directory = linkCandidate(t);
  const hoist = path.join(directory, 'node_modules', '.pnpm', 'node_modules');
  fs.symlinkSync('../old-dev@1.0.0/node_modules/old-dev', path.join(hoist, 'old-dev'));
  fs.mkdirSync(path.join(hoist, '@test'));
  fs.symlinkSync('../../@test+dev@1.0.0/node_modules/@test/dev', path.join(hoist, '@test', 'dev'));
  const result = verifyExtractedLinks(directory);
  assert.equal(result.allowedPrunedHoistAliasCount, 2);
  assert.deepEqual(result.validatedProductionDependencies, ['production']);
  assert.equal(result.validatedProductionDependencyCount, 1);
  assert.deepEqual(result.allowedPrunedHoistAliases.find(alias => alias.path.endsWith('/old-dev')), {
    path: 'node_modules/.pnpm/node_modules/old-dev', target: '../old-dev@1.0.0/node_modules/old-dev', missingVirtualStorePath: 'node_modules/.pnpm/old-dev@1.0.0',
  });
  assert.ok(fs.lstatSync(path.join(hoist, 'old-dev')).isSymbolicLink());
});

test('broken direct production and retained-package dependency links remain rejected', t => {
  const direct = linkCandidate(t);
  fs.symlinkSync('.pnpm/missing@1/node_modules/missing', path.join(direct, 'node_modules', 'missing'));
  assert.throws(() => verifyExtractedLinks(direct), /EXTRACTED_LINK_UNRESOLVED/);
  const transitive = linkCandidate(t);
  fs.symlinkSync('../../missing@1/node_modules/missing', path.join(transitive, 'node_modules', '.pnpm', 'production@1.0.0', 'node_modules', 'missing'));
  assert.throws(() => verifyExtractedLinks(transitive), /EXTRACTED_LINK_UNRESOLVED/);
});

test('hoist aliases cannot hide missing contents of retained packages or point elsewhere', t => {
  const retained = linkCandidate(t);
  fs.symlinkSync('../production@1.0.0/node_modules/absent', path.join(retained, 'node_modules', '.pnpm', 'node_modules', 'absent'));
  assert.throws(() => verifyExtractedLinks(retained), /EXTRACTED_LINK_UNRESOLVED/);
  const wrongRoot = linkCandidate(t);
  fs.symlinkSync('../../../missing', path.join(wrongRoot, 'node_modules', '.pnpm', 'node_modules', 'missing'));
  assert.throws(() => verifyExtractedLinks(wrongRoot), /EXTRACTED_LINK_UNRESOLVED/);
  const outside = linkCandidate(t);
  fs.symlinkSync('/definitely-missing-outside-candidate', path.join(outside, 'node_modules', '.pnpm', 'node_modules', 'outside'));
  assert.throws(() => verifyExtractedLinks(outside), /EXTRACTED_LINK_UNRESOLVED/);
});

test('existing outside links and declared packages with missing manifests remain rejected', t => {
  const outside = linkCandidate(t);
  fs.symlinkSync(os.tmpdir(), path.join(outside, 'node_modules', 'external'));
  assert.throws(() => verifyExtractedLinks(outside), /EXTRACTED_LINK_OUTSIDE_CANDIDATE/);
  const missing = linkCandidate(t);
  fs.writeFileSync(path.join(missing, 'package.json'), JSON.stringify({ dependencies: { absent: '1' } }));
  assert.throws(() => verifyExtractedLinks(missing), /PRODUCTION_DEPENDENCY_INVALID/);
  const invalid = linkCandidate(t);
  fs.mkdirSync(path.join(invalid, 'node_modules', 'invalid'));
  fs.writeFileSync(path.join(invalid, 'package.json'), JSON.stringify({ dependencies: { invalid: '1' } }));
  assert.throws(() => verifyExtractedLinks(invalid), /PRODUCTION_DEPENDENCY_INVALID/);
});

function header(name, body = Buffer.alloc(0), type = '0', linkname = '') {
  const bytes = Buffer.alloc(512);
  bytes.write(name, 0, 100, 'utf8');
  bytes.write('0000700\0', 100, 'ascii');
  bytes.write('0000000\0', 108, 'ascii');
  bytes.write('0000000\0', 116, 'ascii');
  bytes.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
  bytes.write('00000000000\0', 136, 'ascii');
  bytes.fill(32, 148, 156);
  bytes.write(type, 156, 'ascii');
  bytes.write(linkname, 157, 100, 'utf8');
  bytes.write('ustar\0', 257, 'ascii');
  bytes.write('00', 263, 'ascii');
  const sum = [...bytes].reduce((total, byte) => total + byte, 0);
  bytes.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return Buffer.concat([bytes, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}

const minimal = () => [header('package.json', Buffer.from('{}')), ...['node_modules', 'dist', 'drizzle', 'scripts', 'config'].map(name => header(`${name}/`, Buffer.alloc(0), '5'))];
const writeArchive = (directory, chunks) => {
  const filename = path.join(directory, `archive-${fs.readdirSync(directory).length}.tar.gz`);
  fs.writeFileSync(filename, gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)])));
  return filename;
};

test('streaming header validation accepts a complete minimal runtime and internal links', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdao-stage-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = await inspectArchive(writeArchive(directory, [...minimal(), header('dist/index.js', Buffer.from('export {};')), header('node_modules/a', Buffer.alloc(0), '2', '../dist')]));
  assert.equal(result.entries, 8);
  assert.deepEqual(result.roots, ['config', 'dist', 'drizzle', 'node_modules', 'package.json', 'scripts']);
});

test('GNU long-name overrides and PAX overrides are validated rather than ignored', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdao-stage-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const long = writeArchive(directory, [...minimal(), header('././@LongLink', Buffer.from('../escape\0'), 'L'), header('dist/safe.js', Buffer.from('bad'))]);
  await assert.rejects(inspectArchive(long), /ARCHIVE_PATH_OUT_OF_SCOPE/);
  const payload = 'path=../../escape\n';
  let length = payload.length + 2;
  for (;;) { const next = String(length).length + 1 + payload.length; if (next === length) break; length = next; }
  const pax = writeArchive(directory, [...minimal(), header('PaxHeader', Buffer.from(`${length} ${payload}`), 'x'), header('dist/safe.js', Buffer.from('bad'))]);
  await assert.rejects(inspectArchive(pax), /ARCHIVE_PATH_OUT_OF_SCOPE/);
});

test('truncated/duplicate/out-of-scope tar members are rejected before extraction', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdao-stage-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await assert.rejects(inspectArchive(writeArchive(directory, [...minimal(), header('package.json', Buffer.from('again'))])), /ARCHIVE_DUPLICATE_ENTRY/);
  await assert.rejects(inspectArchive(writeArchive(directory, [...minimal(), header('data/customer.txt', Buffer.from('private'))])), /ARCHIVE_PATH_OUT_OF_SCOPE/);
  const filename = path.join(directory, 'truncated.tar.gz');
  fs.writeFileSync(filename, gzipSync(Buffer.concat(minimal())));
  await assert.rejects(inspectArchive(filename), /ARCHIVE_TRUNCATED/);
});
