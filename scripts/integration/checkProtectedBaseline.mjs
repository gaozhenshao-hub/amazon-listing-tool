/**
 * Read-only integration guard. It imports no application modules, loads no env,
 * runs no Git/hooks, and never accepts/updates hashes automatically.
 * A reviewed integration may add `reviewed` hashes plus a reviewRef to a record;
 * keep its original `baseline` hashes for comparison and audit.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MANIFEST = 'config/integration/protected-baseline.json';
export const CONTROL_IDS = Object.freeze(Array.from({ length: 10 }, (_, i) => `K${String(i + 1).padStart(2, '0')}`));
const DEFAULT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (algorithm, value) => createHash(algorithm).update(value).digest('hex');
export const fileHashes = bytes => ({
  gitBlobSha1: digest('sha1', Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])),
  sha256: digest('sha256', bytes),
});
export const dependencyProjectionHash = (dependencies, names) => digest('sha256', JSON.stringify(
  Object.fromEntries([...names].sort().map(name => [name, dependencies[name]])),
));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function relativePath(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\') && !value.includes('\0')
    && !path.posix.isAbsolute(value) && !/^[A-Za-z]:/.test(value)
    && value.split('/').every(segment => segment && segment !== '.' && segment !== '..');
}
function validateControls(controls) {
  assert(Array.isArray(controls) && controls.length > 0 && new Set(controls).size === controls.length
    && controls.every(id => CONTROL_IDS.includes(id)), 'Invalid or duplicate protection control');
}
function validateHashes(hashes, dependency = false, reviewed = false) {
  assert(record(hashes) && typeof hashes.sha256 === 'string' && hashes.sha256.length === 64
    && /^[a-f0-9]{64}$/.test(hashes.sha256), 'Invalid SHA256');
  const blobKey = dependency ? 'packageGitBlobSha1' : 'gitBlobSha1';
  // Dependency projection SHA protects selected declarations, not package scripts.
  // packageGitBlobSha1 is the provenance of the package containing that projection.
  assert(typeof hashes[blobKey] === 'string' && hashes[blobKey].length === 40
    && /^[a-f0-9]{40}$/.test(hashes[blobKey]), 'Invalid Git blob provenance');
  if (reviewed) assert(typeof hashes.reviewRef === 'string' && hashes.reviewRef.trim().length > 0
    && hashes.reviewRef.length <= 500, 'Reviewed hashes require a nonempty reviewRef');
}

export function validateManifest(manifest) {
  assert(record(manifest) && manifest.schema === 'protected-baseline/v1', 'Unsupported protected baseline schema');
  assert(/^[a-f0-9]{40}$/.test(manifest.baselineCommit || ''), 'A full baseline commit is required');
  assert(record(manifest.controls) && Object.keys(manifest.controls).length === CONTROL_IDS.length
    && CONTROL_IDS.every(id => typeof manifest.controls[id] === 'string' && manifest.controls[id].trim()), 'All K01-K10 controls are required');
  assert(Array.isArray(manifest.files) && manifest.files.length > 0, 'Protected files cannot be empty');
  const paths = new Set();
  const coverage = new Map(CONTROL_IDS.map(id => [id, new Set()]));
  for (const entry of manifest.files) {
    assert(record(entry) && relativePath(entry.path), 'Protected paths must be canonical repository-relative paths');
    assert(!paths.has(entry.path), `Duplicate protected path: ${entry.path}`);
    paths.add(entry.path);
    validateControls(entry.controls);
    assert(['implementation', 'test'].includes(entry.kind), `Invalid file kind: ${entry.path}`);
    validateHashes(entry.baseline);
    if (own(entry, 'reviewed')) validateHashes(entry.reviewed, false, true);
    for (const id of entry.controls) coverage.get(id).add(entry.kind);
  }
  for (const [id, kinds] of coverage) assert(kinds.has('implementation') && kinds.has('test'), `${id} must protect implementation and regression tests`);
  const dependency = manifest.requiredDependencies;
  assert(record(dependency) && dependency.path === 'package.json', 'Required dependencies must be checked in package.json');
  assert(dependency.section === 'dependencies', 'Safety dependencies must remain production dependencies');
  assert(Array.isArray(dependency.names) && dependency.names.every(name => typeof name === 'string' && name.trim())
    && new Set(dependency.names).size === dependency.names.length
    && ['dompurify', 'sharp'].every(name => dependency.names.includes(name)), 'dompurify and sharp must be protected');
  validateControls(dependency.controls);
  validateHashes(dependency.baseline, true);
  if (own(dependency, 'reviewed')) validateHashes(dependency.reviewed, true, true);
  return manifest;
}

function readRegularFile(root, relative) {
  assert(relativePath(relative), 'Path is not repository-relative');
  let resolved = root;
  const segments = relative.split('/');
  for (let i = 0; i < segments.length; i++) {
    resolved = path.join(resolved, segments[i]);
    const info = fs.lstatSync(resolved);
    assert(!info.isSymbolicLink(), `SYMLINK_NOT_ALLOWED: ${relative}`);
    assert(i === segments.length - 1 ? info.isFile() : info.isDirectory(), `NOT_REGULAR_FILE: ${relative}`);
  }
  return fs.readFileSync(resolved);
}

/** A hash match is change detection, not proof of business/security correctness. */
export function checkProtectedBaseline({ root = DEFAULT_ROOT, manifestPath = DEFAULT_MANIFEST } = {}) {
  const result = { ok: false, baselineCommit: null, checkedFiles: 0, checkedDependencies: 0, reviewedRecords: 0, failures: [] };
  let manifest, repositoryRoot;
  try {
    repositoryRoot = fs.realpathSync(root);
    assert(fs.statSync(repositoryRoot).isDirectory(), 'Repository root must be a directory');
    let parsed;
    try { parsed = JSON.parse(readRegularFile(repositoryRoot, manifestPath).toString('utf8')); }
    catch { throw new Error('Manifest is missing, unsafe, or invalid JSON'); }
    manifest = validateManifest(parsed);
  } catch (error) {
    result.failures.push({ code: 'INVALID_MANIFEST', path: manifestPath, message: error.message });
    return result;
  }
  result.baselineCommit = manifest.baselineCommit;
  for (const entry of manifest.files) {
    const expected = entry.reviewed || entry.baseline;
    try {
      const actual = fileHashes(readRegularFile(repositoryRoot, entry.path));
      result.checkedFiles++;
      if (entry.reviewed) result.reviewedRecords++;
      if (actual.sha256 !== expected.sha256 || actual.gitBlobSha1 !== expected.gitBlobSha1) {
        result.failures.push({ code: 'PROTECTED_FILE_CHANGED', path: entry.path, controls: entry.controls, expected, actual });
      }
    } catch (error) {
      result.failures.push({ code: 'PROTECTED_FILE_UNREADABLE', path: entry.path, controls: entry.controls,
        message: error.code === 'ENOENT' ? 'Missing protected file or parent directory' : error.message });
    }
  }
  const dependency = manifest.requiredDependencies;
  try {
    let pkg;
    try { pkg = JSON.parse(readRegularFile(repositoryRoot, dependency.path).toString('utf8')); }
    catch { throw new Error('Package manifest is missing, unsafe, or invalid JSON'); }
    const declarations = pkg?.[dependency.section];
    assert(record(declarations), 'Production dependency declarations are missing');
    for (const name of dependency.names) {
      assert(own(declarations, name) && typeof declarations[name] === 'string' && declarations[name].trim(), `Required production dependency missing: ${name}`);
    }
    result.checkedDependencies = dependency.names.length;
    const actual = dependencyProjectionHash(declarations, dependency.names);
    const expected = dependency.reviewed || dependency.baseline;
    if (dependency.reviewed) result.reviewedRecords++;
    if (actual !== expected.sha256) result.failures.push({ code: 'DEPENDENCY_DECLARATION_CHANGED', path: dependency.path,
      controls: dependency.controls, expectedSha256: expected.sha256, actualSha256: actual });
  } catch (error) {
    result.failures.push({ code: 'REQUIRED_DEPENDENCY_INVALID', path: dependency.path, controls: dependency.controls, message: error.message });
  }
  result.ok = result.failures.length === 0;
  return result;
}

export function main(args, output = process.stdout, errors = process.stderr) {
  const options = {};
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') {
      output.write('Usage: node scripts/integration/checkProtectedBaseline.mjs [--root DIR] [--manifest RELATIVE_PATH] [--json]\nRead-only. No automatic accept/update mode. Review changes and explicitly record reviewed hashes plus reviewRef.\n');
      return 0;
    }
    if (arg === '--json') { json = true; continue; }
    if ((arg === '--root' || arg === '--manifest') && args[i + 1] && !args[i + 1].startsWith('--')) {
      const key = arg === '--root' ? 'root' : 'manifestPath';
      if (own(options, key)) { errors.write(`Duplicate option: ${arg}\n`); return 2; }
      options[key] = args[++i];
      continue;
    }
    errors.write(`Unknown or incomplete option: ${arg}\n`);
    return 2;
  }
  const result = checkProtectedBaseline(options);
  if (json) output.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    output.write(`${result.ok ? 'PASS' : 'FAIL'} protected baseline: ${result.checkedFiles} files, ${result.checkedDependencies} required dependencies, ${result.reviewedRecords} explicitly reviewed records\n`);
    for (const failure of result.failures) output.write(`- ${failure.code}: ${failure.path}${failure.controls ? ` [${failure.controls.join(',')}]` : ''}${failure.message ? ` (${failure.message})` : ''}\n`);
    if (!result.ok) output.write('Stop and review the drift; this command does not change files or approve integration.\n');
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1]) {
  // realpath handles macOS /var -> /private/var and intentional CLI symlinks.
  try {
    if (fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
  } catch (error) { process.stderr.write(`Protected baseline CLI initialization failed: ${error.message}\n`); process.exitCode = 1; }
}
