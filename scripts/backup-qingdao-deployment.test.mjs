import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { assertNoPersonalMysqlOverrides, databaseOptions, dumpDatabase, fileDigest, mysqlOption } from './backup-qingdao-deployment.mjs';

test('defaults option values cannot inject extra lines or options', () => {
  assert.equal(mysqlOption('abc"\\\npassword=BAD\r\t'), '"abc\\"\\\\\\npassword=BAD\\r\\t"');
  assert.throws(() => mysqlOption('bad\0'), /MYSQL_OPTION_CONTAINS_NUL/);
  const parsed = databaseOptions('mysql://name:p%23%22%5C%0A%3D@localhost:3307/production');
  assert.equal(parsed.database, 'production');
  assert.match(parsed.defaults, /port="3307"/);
  assert.match(parsed.defaults, /password="p#\\"\\\\\\n="/);
  assert.equal(parsed.defaults.split('\n').filter(line => line.startsWith('password=')).length, 1);
});

test('connection settings are not silently downgraded and database is not an option', () => {
  assert.throws(() => databaseOptions('mysql://user:secret@host/db?ssl=true'), /DATABASE_URL_OPTIONS_REQUIRE_REVIEW/);
  assert.throws(() => databaseOptions('mysql://user:secret@host/--all-databases'), /INVALID_DATABASE_NAME/);
  assert.throws(() => databaseOptions('mysql://user:secret@host/'), /INVALID_DATABASE_NAME/);
  assert.throws(() => databaseOptions('https://user:secret@host/db'), /UNSUPPORTED_DATABASE_URL/);
  assert.equal(databaseOptions('mysql://user:secret@[::1]/database?charset=utf8mb4').defaults.includes('host="::1"'), true);
});

test('personal client configuration cannot silently override the private defaults file', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdao-backup-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assertNoPersonalMysqlOverrides([directory]);
  fs.writeFileSync(path.join(directory, '.mylogin.cnf'), 'private mock login data');
  assert.throws(() => assertNoPersonalMysqlOverrides([directory]), /PERSONAL_MYSQL_OPTIONS_REQUIRE_REVIEW/);
});

function mockDump(content, exitCode, seen) {
  return (binary, args, options) => {
    seen.push({ binary, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.end(content);
      child.emit('close', exitCode, null);
    });
    return child;
  };
}

test('streamed full backup checks exit and gzip, uses private files, no credentials in argv/env', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdao-backup-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const seen = [];
  const output = path.join(directory, 'database.sql.gz');
  const result = await dumpDatabase({ defaultsFile: path.join(directory, '.private.cnf'), database: 'app', output, spawnProcess: mockDump('-- Dump complete\nSELECT 1;\n', 0, seen) });
  assert.equal(gunzipSync(fs.readFileSync(output)).toString(), '-- Dump complete\nSELECT 1;\n');
  assert.equal(result.sha256, (await fileDigest(output)).sha256);
  assert.equal(fs.existsSync(`${output}.partial`), false);
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.equal(fs.statSync(`${output}.stderr.log`).mode & 0o777, 0o600);
  assert.equal(seen[0].args[0], `--defaults-extra-file=${directory}/.private.cnf`);
  for (const argument of ['--single-transaction', '--routines', '--triggers', '--events', '--hex-blob', '--no-tablespaces']) assert.ok(seen[0].args.includes(argument));
  assert.equal(seen[0].args.some(argument => argument.includes('password')), false);
  assert.equal(seen[0].options.env.DATABASE_URL, undefined);
  assert.equal(seen[0].options.env.MYSQL_PWD, undefined);
});

test('nonzero dump exit is a failure even when gzip stream completed', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdao-backup-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'database.sql.gz');
  await assert.rejects(dumpDatabase({ defaultsFile: '/private/defaults.cnf', database: 'app', output, spawnProcess: mockDump('partial SQL\n', 2, []) }), /DATABASE_DUMP_INCOMPLETE/);
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.existsSync(`${output}.sha256`), false);
  assert.equal(fs.existsSync(`${output}.partial`), true);
});

test('empty dump cannot be marked complete and schema-only is explicit', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdao-backup-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const seen = [];
  await assert.rejects(dumpDatabase({ defaultsFile: '/private/defaults.cnf', database: 'app', output: path.join(directory, 'schema.sql.gz'), schemaOnly: true, spawnProcess: mockDump('', 0, seen) }), /DATABASE_DUMP_GZIP_INVALID/);
  assert.ok(seen[0].args.includes('--no-data'));
});

test('database dump refuses to overwrite an existing final artifact', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdao-backup-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'database.sql.gz');
  fs.writeFileSync(output, 'keep me');
  await assert.rejects(dumpDatabase({ defaultsFile: '/private/defaults.cnf', database: 'app', output, spawnProcess: mockDump('some SQL', 0, []) }), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(output, 'utf8'), 'keep me');
});
