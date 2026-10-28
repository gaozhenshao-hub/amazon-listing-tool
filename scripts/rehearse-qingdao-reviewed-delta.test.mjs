import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMysqlVersion, nativeLayout, nativeArguments, nativeCommand, assertNativeRuntime, rehearse } from './rehearse-qingdao-reviewed-delta.mjs';

const directory = '/tmp/qingdao-mysql-rehearsal-test123';
const snapshotVersion = '8.0.46-0ubuntu0.24.04.4';

test('requires the reviewed MySQL release, including inspection before native initialization', () => {
  assertMysqlVersion('/usr/sbin/mysqld Ver 8.0.46-0ubuntu0.24.04.4 for Linux on x86_64 ((Ubuntu))', snapshotVersion);
  assertMysqlVersion('8.0.46', snapshotVersion);
  for (const version of ['8.0.45', '8.0.47', '8.4.6', '8.0.460', '8.0.46.1', '8.0.46-MariaDB', 'unavailable']) {
    assert.throws(() => assertMysqlVersion(version, snapshotVersion), /MYSQL_VERSION_MUST_MATCH_8_0_46/);
  }
  assert.throws(() => assertMysqlVersion('8.0.46', '8.0.45'), /MYSQL_VERSION_MUST_MATCH_8_0_46/);
});

test('all native mutable paths stay inside one dedicated temporary directory', () => {
  const layout = nativeLayout(directory);
  assert.equal(layout.data, `${directory}/data`);
  for (const [name, value] of Object.entries(layout)) if (name !== 'directory') assert.ok(value.startsWith(`${directory}/`));
  for (const unsafe of ['/var/lib/mysql', '/tmp', '/tmp/qingdao-mysql-rehearsal-a/../b', '/tmp/other', '/tmp/qingdao-mysql-rehearsal-', '/tmp/qingdao-mysql-rehearsal-a/subdir']) {
    assert.throws(() => nativeLayout(unsafe), /ISOLATED_NATIVE_DIRECTORY_INVALID/);
  }
});

test('both initialize and server command ignore all configs, disable network/events and bound resources', () => {
  for (const initialize of [true, false]) {
    const args = nativeArguments(directory, 0, initialize);
    assert.equal(args[0], '--no-defaults');
    assert.equal(args.includes('--initialize-insecure'), initialize);
    for (const required of ['--skip-networking', '--mysqlx=0', '--event-scheduler=OFF', '--skip-log-bin', '--local-infile=0', '--performance-schema=OFF', '--innodb-buffer-pool-size=128M', '--innodb-redo-log-capacity=64M', '--max-connections=8']) assert.ok(args.includes(required), required);
    for (const option of ['datadir', 'socket', 'pid-file', 'log-error', 'tmpdir', 'secure-file-priv']) assert.ok(args.some(arg => arg.startsWith(`--${option}=${directory}/`)), option);
    assert.equal(args.some(arg => /runtime\.conf|\/var\/lib\/mysql|defaults-file|init-file|3306/.test(arg)), false);
  }
  assert.throws(() => nativeArguments(directory, 1), /NATIVE_CASE_MODE_MISMATCH/);
});

test('root launch drops uid, gid and supplementary groups before nice and mysqld; never runs server as root', () => {
  const command = nativeCommand({ directory, lowerCaseTableNames: 0, uid: 112, gid: 116, privileged: true });
  assert.equal(command.file, '/usr/bin/setpriv');
  assert.deepEqual(command.args.slice(0, 8), ['--reuid=112', '--regid=116', '--clear-groups', '--', '/usr/bin/nice', '-n', '10', '/usr/sbin/mysqld']);
  assert.equal(command.args[8], '--no-defaults');
  const userCommand = nativeCommand({ directory, lowerCaseTableNames: 0, uid: 1000, gid: 1000, privileged: false });
  assert.equal(userCommand.file, '/usr/bin/nice');
  assert.deepEqual(userCommand.args.slice(0, 4), ['-n', '10', '/usr/sbin/mysqld', '--no-defaults']);
  for (const [uid, gid] of [[0, 0], [0, 116], [112, 0], [NaN, 116], [112, -1]]) assert.throws(() => nativeCommand({ directory, lowerCaseTableNames: 0, uid, gid, privileged: true }), /NATIVE_NON_ROOT_IDENTITY_REQUIRED/);
});

test('runtime identity refuses production paths, TCP, active mysqlx and enabled event scheduler', () => {
  const layout = nativeLayout(directory);
  const row = { version: snapshotVersion, dataDirectory: `${layout.data}/`, socketPath: layout.socket, pidPath: layout.pid, skipNetworking: 1, eventScheduler: 'OFF', mysqlxActive: 0 };
  assertNativeRuntime(row, directory, snapshotVersion);
  for (const changed of [{ dataDirectory: '/var/lib/mysql/' }, { socketPath: '/var/run/mysqld/mysqld.sock' }, { pidPath: '/var/run/mysqld/mysqld.pid' }, { skipNetworking: 0 }, { eventScheduler: 'ON' }, { mysqlxActive: 1 }]) assert.throws(() => assertNativeRuntime({ ...row, ...changed }, directory, snapshotVersion), /NATIVE_RUNTIME_ISOLATION_MISMATCH/);
});

test('unknown backends fail before reading a plan or starting a server', async () => {
  await assert.rejects(rehearse({ engine: 'production' }), /REHEARSAL_ENGINE_INVALID/);
});
