import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  CONTROL_IDS, DEFAULT_MANIFEST, checkProtectedBaseline,
  dependencyProjectionHash, fileHashes, main,
} from './checkProtectedBaseline.mjs';

const rootOfRepository = fileURLToPath(new URL('../../', import.meta.url));
const cli = fileURLToPath(new URL('./checkProtectedBaseline.mjs', import.meta.url));
const put = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const json = (file, value) => put(file, `${JSON.stringify(value, null, 2)}\n`);
const bytes = value => Buffer.from(value, 'utf8');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'protected-baseline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = { name: 'isolated-fixture', scripts: { test: 'node --test' }, dependencies: { dompurify: '^3.4.16', sharp: '0.35.5' } };
  const files = [
    { path: 'src/critical.mjs', kind: 'implementation', content: 'export const safe = true;\n' },
    { path: 'test/critical.test.mjs', kind: 'test', content: '// immutable regression fixture\n' },
  ];
  for (const entry of files) put(path.join(root, entry.path), entry.content);
  json(path.join(root, 'package.json'), pkg);
  const manifest = {
    schema: 'protected-baseline/v1', baselineCommit: 'a'.repeat(40),
    controls: Object.fromEntries(CONTROL_IDS.map(id => [id, `Guard ${id}`])),
    files: files.map(({ path: filename, kind, content }) => ({ path: filename, kind, controls: [...CONTROL_IDS], baseline: fileHashes(bytes(content)) })),
    requiredDependencies: {
      path: 'package.json', section: 'dependencies', names: ['dompurify', 'sharp'], controls: ['K06'],
      baseline: { packageGitBlobSha1: fileHashes(fs.readFileSync(path.join(root, 'package.json'))).gitBlobSha1,
        sha256: dependencyProjectionHash(pkg.dependencies, ['dompurify', 'sharp']) },
    },
  };
  const saveManifest = () => json(path.join(root, DEFAULT_MANIFEST), manifest);
  const savePackage = () => json(path.join(root, 'package.json'), pkg);
  saveManifest();
  return { root, manifest, pkg, saveManifest, savePackage, check: () => checkProtectedBaseline({ root }) };
}
function snapshot(directory) {
  const result = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const filename = path.join(directory, name), stat = fs.lstatSync(filename);
    result.push([filename, stat.mode, stat.mtimeMs, stat.isFile() ? fileHashes(fs.readFileSync(filename)).sha256 : null]);
    if (stat.isDirectory()) result.push(...snapshot(filename));
  }
  return result;
}

test('current committed protection set covers K01-K10 and passes without application imports', () => {
  const result = checkProtectedBaseline({ root: rootOfRepository });
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.equal(result.baselineCommit, '927a5d71f43e6a35e04c1fbd7a82a48244ab4141');
  assert.ok(result.checkedFiles >= 100);
  assert.equal(result.checkedDependencies, 2);
});

test('unchanged bytes pass and checker never writes files', t => {
  const f = fixture(t), before = snapshot(f.root);
  assert.equal(f.check().ok, true);
  assert.deepEqual(snapshot(f.root), before);
});

test('unlisted new files and unrelated package scripts are allowed', t => {
  const f = fixture(t);
  put(path.join(f.root, 'new-module/new-file.ts'), 'new implementation\n');
  f.pkg.scripts.integration = 'node scripts/integration/checkProtectedBaseline.mjs';
  f.pkg.dependencies.newDependency = '1.0.0';
  f.savePackage();
  assert.equal(f.check().ok, true);
});

for (const filename of ['src/critical.mjs', 'test/critical.test.mjs']) {
  test(`missing protected ${filename} is rejected`, t => {
    const f = fixture(t);
    fs.unlinkSync(path.join(f.root, filename));
    assert.equal(f.check().failures[0].code, 'PROTECTED_FILE_UNREADABLE');
  });
  test(`changed protected ${filename} is rejected with control IDs`, t => {
    const f = fixture(t);
    fs.appendFileSync(path.join(f.root, filename), '// changed\n');
    const result = f.check();
    assert.equal(result.ok, false);
    assert.equal(result.failures[0].code, 'PROTECTED_FILE_CHANGED');
    assert.deepEqual(result.failures[0].controls, CONTROL_IDS);
  });
}

test('Git blob mismatch also fails even when SHA256 matches', t => {
  const f = fixture(t);
  f.manifest.files[0].baseline.gitBlobSha1 = '0'.repeat(40);
  f.saveManifest();
  assert.equal(f.check().failures[0].code, 'PROTECTED_FILE_CHANGED');
});

for (const type of ['file', 'parent']) test(`protected ${type} symlinks are rejected`, t => {
  const f = fixture(t);
  if (type === 'file') {
    const source = path.join(f.root, 'src/critical.mjs');
    fs.renameSync(source, path.join(f.root, 'same-bytes.mjs'));
    fs.symlinkSync('../same-bytes.mjs', source);
  } else {
    fs.renameSync(path.join(f.root, 'src'), path.join(f.root, 'real-src'));
    fs.symlinkSync('real-src', path.join(f.root, 'src'));
  }
  assert.match(f.check().failures[0].message, /SYMLINK_NOT_ALLOWED/);
});

test('directory cannot stand in for protected file', t => {
  const f = fixture(t), filename = path.join(f.root, 'src/critical.mjs');
  fs.unlinkSync(filename); fs.mkdirSync(filename);
  assert.match(f.check().failures[0].message, /NOT_REGULAR_FILE/);
});

for (const name of ['dompurify', 'sharp']) {
  test(`${name} must remain a production dependency`, t => {
    const f = fixture(t);
    f.pkg.devDependencies = { [name]: f.pkg.dependencies[name] };
    delete f.pkg.dependencies[name]; f.savePackage();
    assert.equal(f.check().failures[0].code, 'REQUIRED_DEPENDENCY_INVALID');
  });
  test(`${name} version drift is not silently accepted`, t => {
    const f = fixture(t);
    f.pkg.dependencies[name] = 'changed-version'; f.savePackage();
    assert.equal(f.check().failures[0].code, 'DEPENDENCY_DECLARATION_CHANGED');
  });
}

test('explicit reviewed bytes pass while original baseline remains intact', t => {
  const f = fixture(t), entry = f.manifest.files[0], original = { ...entry.baseline };
  const modified = bytes('export const safe = "reviewed integration";\n');
  put(path.join(f.root, entry.path), modified);
  entry.reviewed = { ...fileHashes(modified), reviewRef: 'local-review/K01/2026-10-13' };
  f.saveManifest();
  const result = f.check();
  assert.equal(result.ok, true);
  assert.equal(result.reviewedRecords, 1);
  assert.deepEqual(entry.baseline, original);
});

test('reviewed dependency changes require the exact projection and retain provenance', t => {
  const f = fixture(t);
  f.pkg.dependencies.sharp = 'reviewed-version'; f.savePackage();
  f.manifest.requiredDependencies.reviewed = {
    packageGitBlobSha1: fileHashes(fs.readFileSync(path.join(f.root, 'package.json'))).gitBlobSha1,
    sha256: dependencyProjectionHash(f.pkg.dependencies, ['sharp', 'dompurify']), reviewRef: 'review/K06/dependency',
  };
  f.saveManifest();
  assert.equal(f.check().ok, true);
  f.pkg.dependencies.sharp = 'unreviewed-next-version'; f.savePackage();
  assert.equal(f.check().ok, false);
});

for (const [name, mutate] of [
  ['unknown schema', m => { m.schema = 'unknown'; }],
  ['no files', m => { m.files = []; }],
  ['duplicate protected path', m => { m.files.push(m.files[0]); }],
  ['missing K10 definition', m => { delete m.controls.K10; }],
  ['no regression coverage', m => { m.files[1].controls = ['K01']; }],
  ['unknown control', m => { m.files[0].controls = ['K99']; }],
  ['invalid hash', m => { m.files[0].baseline.sha256 = 'not-a-hash'; }],
  ['hash with trailing newline', m => { m.files[0].baseline.sha256 += '\n'; }],
  ['unreviewed override', m => { m.files[0].reviewed = { ...m.files[0].baseline }; }],
  ['blank review reference', m => { m.files[0].reviewed = { ...m.files[0].baseline, reviewRef: '  ' }; }],
  ['dependency protection removed', m => { m.requiredDependencies.names = ['sharp']; }],
  ['dependency redirected to another file', m => { m.requiredDependencies.path = 'alternate-package.json'; }],
  ['dev-only dependency policy', m => { m.requiredDependencies.section = 'devDependencies'; }],
]) test(`invalid manifest fails closed: ${name}`, t => {
  const f = fixture(t); mutate(f.manifest); f.saveManifest();
  const result = f.check();
  assert.equal(result.ok, false);
  assert.equal(result.checkedFiles, 0);
  assert.equal(result.failures[0].code, 'INVALID_MANIFEST');
});

for (const filename of ['/absolute', '../escape', 'src/../../escape', 'src//empty', './relative', 'src\\escape', 'C:/escape']) {
  test(`unsafe path rejected: ${filename}`, t => {
    const f = fixture(t); f.manifest.files[0].path = filename; f.saveManifest();
    assert.equal(f.check().failures[0].code, 'INVALID_MANIFEST');
  });
}

test('malformed JSON is rejected without echoing file contents', t => {
  const f = fixture(t);
  put(path.join(f.root, DEFAULT_MANIFEST), '{private marker-not-for-output');
  const result = f.check();
  assert.equal(result.failures[0].code, 'INVALID_MANIFEST');
  assert.equal(JSON.stringify(result).includes('marker-not-for-output'), false);
});

test('CLI emits JSON and meaningful status without env or service access', t => {
  const f = fixture(t), before = snapshot(f.root);
  const args = [cli, '--root', f.root, '--json'];
  const options = { encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'intentionally-invalid', HTTP_PROXY: 'http://127.0.0.1:1' } };
  const pass = spawnSync(process.execPath, args, options);
  assert.equal(pass.status, 0, pass.stderr);
  assert.equal(JSON.parse(pass.stdout).ok, true);
  assert.deepEqual(snapshot(f.root), before);
  fs.appendFileSync(path.join(f.root, 'src/critical.mjs'), 'drift');
  const fail = spawnSync(process.execPath, args, options);
  assert.equal(fail.status, 1);
  assert.equal(JSON.parse(fail.stdout).ok, false);
});

test('no automatic accept/update option exists; invalid CLI exits 2', () => {
  const messages = [], stream = { write: text => messages.push(text) };
  assert.equal(main(['--accept'], stream, stream), 2);
  assert.equal(main(['--root'], stream, stream), 2);
  assert.equal(main(['--root', '/tmp', '--root', '/tmp'], stream, stream), 2);
  assert.equal(main(['--help'], stream, stream), 0);
  assert.ok(messages.some(text => text.includes('Read-only')));
});
