import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHECKS, ENV_KEYS, UNITS, missingSchema, inspectDatabase, filteredEnvironment, inspectService, connectionOptions, writePrivateReport } from './inspect-qingdao-startup-safety.mjs';

function metadata() {
  const found = new Map();
  for (const check of CHECKS) for (const [table, columns] of Object.entries(check.requires)) {
    if (!found.has(table)) found.set(table, new Set());
    for (const column of columns) found.get(table).add(column);
  }
  return [...found].flatMap(([tableName, columns]) => [...columns].map(columnName => ({ tableName, columnName })));
}
function fakeDatabase({ columns = metadata(), counts = [], failCountAt = -1, failStart = false } = {}) {
  const calls = [];
  let countIndex = 0;
  return {
    calls,
    async query(options) {
      const sql = options.sql;
      calls.push(sql);
      if (sql === 'START TRANSACTION READ ONLY') {
        if (failStart) throw new Error('private-password-must-not-escape');
        return [[]];
      }
      if (sql === 'ROLLBACK') return [[]];
      assert.match(sql, /^SELECT \/\*\+ MAX_EXECUTION_TIME\(15000\) \*\//);
      assert.equal(options.timeout, 20000);
      if (sql.includes('DATABASE() AS databaseName')) return [[{ databaseName: 'test_only', serverUuid: 'test-server', observedAt: 'test-time' }]];
      if (sql.includes('information_schema.COLUMNS')) return [columns];
      assert.match(sql, /COUNT\(\*\) AS candidateCount/);
      if (countIndex === failCountAt) throw new Error('password=private-password-must-not-escape');
      return [[{ candidateCount: counts[countIndex++] ?? '0' }]];
    },
  };
}

test('inspection enters read-only transaction before any SELECT and always rolls it back', async () => {
  const connection = fakeDatabase({ counts: ['0', '2'] });
  const result = await inspectDatabase(connection);
  assert.equal(connection.calls[0], 'START TRANSACTION READ ONLY');
  assert.equal(connection.calls.at(-1), 'ROLLBACK');
  assert.equal(result.status, 'checked');
  assert.equal(result.checks.length, 11);
  assert.equal(result.checks[1].candidateCount, 2);
  assert.equal(connection.calls.filter(sql => /COUNT\(\*\)/.test(sql)).length, 11);
  for (const sql of connection.calls.slice(1, -1)) {
    assert.match(sql, /^SELECT /);
    assert.doesNotMatch(sql, /;|\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|CALL|OUTFILE|DUMPFILE|GET_LOCK)\b/);
  }
});

test('missing table/column is explicitly not_checked, never a zero/pass', async () => {
  const columns = metadata().filter(row => row.tableName !== 'design_chat_turns' && !(row.tableName === 'ai_jobs' && row.columnName === 'retentionClass'));
  const connection = fakeDatabase({ columns });
  const result = await inspectDatabase(connection);
  assert.equal(result.status, 'not_checked');
  const archive = result.checks.find(item => item.id === 'ai_jobs.completed');
  assert.deepEqual(archive.missing, [{ table: 'ai_jobs', reason: 'missing_columns', columns: ['retentionClass'] }]);
  assert.equal('candidateCount' in archive, false);
  assert.equal(result.checks.find(item => item.id === 'ai_jobs.recoverable').status, 'checked');
  const chat = result.checks.find(item => item.id === 'design_chat_turns.due');
  assert.deepEqual(chat.missing, [{ table: 'design_chat_turns', reason: 'missing_table' }]);
  assert.equal(connection.calls.some(sql => /FROM design_chat_turns/.test(sql)), false);
  assert.deepEqual(missingSchema(CHECKS[5], new Map()), [{ table: 'ai_artifacts', reason: 'missing_table' }, { table: 'ai_jobs', reason: 'missing_table' }]);
});

test('query failure stops inspection, marks the remainder unchecked and does not leak errors', async () => {
  const connection = fakeDatabase({ failCountAt: 1 });
  const result = await inspectDatabase(connection);
  assert.equal(result.status, 'not_checked');
  assert.equal(result.checks[0].status, 'checked');
  assert.equal(result.checks[1].reason, 'query_failed_or_timed_out');
  assert.equal(result.checks[2].reason, 'inspection_stopped');
  assert.equal(result.checks.length, 11);
  assert.equal(connection.calls.at(-1), 'ROLLBACK');
  assert.doesNotMatch(JSON.stringify(result), /password/);
  const badCount = await inspectDatabase(fakeDatabase({ counts: ['9007199254740993'] }));
  assert.equal(badCount.checks[0].status, 'not_checked');
  const refused = fakeDatabase({ failStart: true });
  await assert.rejects(inspectDatabase(refused));
  assert.deepEqual(refused.calls, ['START TRANSACTION READ ONLY']);
});

test('six archive predicates preserve runtime windows, lifecycle values and private exclusions', () => {
  const archive = CHECKS.filter(item => item.category === 'archive');
  assert.deepEqual(archive.map(item => item.id), ['ai_jobs.completed', 'tool_runs.completed', 'agent_events.stream', 'ai_os_metrics.detail', 'project_files.uploads', 'ai_artifacts.versions']);
  [180, 180, 90, 365, 180, 365].forEach((days, index) => assert.ok(archive[index].sql.includes(`INTERVAL ${days} DAY`)));
  assert.match(archive[4].sql, /lifecycleState <> 'archived'/);
  assert.match(archive[0].sql, /status IN \('succeeded','failed','canceled'\)/);
  assert.match(archive[1].sql, /status IN \('succeeded','failed','blocked'\)/);
  assert.doesNotMatch(archive.map(item => item.sql).join('\n'), /isCurrent|LIMIT|FOR UPDATE/);
  const source = fs.readFileSync(new URL('../server/repositories/ai_os/dedicatedJobPolicy.ts', import.meta.url), 'utf8');
  const privateKinds = [...source.matchAll(/export const PRIVATE_\w+_JOB_KIND = "([^"]+)"/g)].map(match => match[1]);
  assert.equal(privateKinds.length, 8);
  for (const kind of privateKinds) {
    assert.ok(archive[0].sql.includes(`'${kind}'`));
    assert.ok(archive[5].sql.includes(`'${kind}'`));
    assert.ok(CHECKS.find(item => item.id === 'ai_jobs.recoverable').sql.includes(`'${kind}'`));
  }
  const artifactSource = source.slice(source.indexOf('export const PRIVATE_IMAGE_TAGGING_ARTIFACT_KEYS'), source.indexOf('/** Fixed server SQL only.'));
  for (const [, key] of artifactSource.matchAll(/"([^"]+\.v1)"/g)) assert.ok(archive[5].sql.includes(`'${key}'`), key);
  assert.match(archive[5].sql, /NOT EXISTS \(SELECT 1 FROM ai_jobs j WHERE j.runId=a.sourceAiJobRunId/);
  assert.match(archive[5].sql, /COALESCE\(a.sourceTable,''\) IN \('kb_images','kb_image_sets'\)/);
});

test('queue counts match physical names and discovery predicates, with no payload hydration', () => {
  const meeting = CHECKS.find(item => item.id === 'meeting_audio.discovery');
  assert.deepEqual(meeting.requires, { meeting_records: ['meeting_status', 'extracted_tasks'] });
  assert.match(meeting.sql, /CASE WHEN JSON_VALID\(extracted_tasks\) THEN JSON_EXTRACT\(extracted_tasks,'\$\.audio.state'\) ELSE NULL END IS NOT NULL/);
  assert.match(meeting.scope, /paid services/);
  assert.match(CHECKS.find(item => item.id === 'ai_jobs.recoverable').sql, /listing_competitor_deep_v1/);
  assert.match(CHECKS.find(item => item.id === 'design_generations.due').sql, /nextPollAt<=NOW\(3\).*deletedAt IS NULL/);
  assert.match(CHECKS.find(item => item.id === 'agent_checkpoints.timed_out').sql, /timeoutAt IS NOT NULL AND timeoutAt<NOW\(\)/);
  for (const check of CHECKS) assert.match(check.sql, /^SELECT COUNT\(\*\) AS candidateCount /);
});

test('only the five requested environment keys are exposed; absent/unsafe values are explicit', () => {
  const result = filteredEnvironment(Buffer.from('DATABASE_URL=mysql://secret\0JWT_SECRET=do-not-print\0APP_PROCESS_ROLE=web\0NODE_ENV=production\0AI_JOB_IN_PROCESS=false\0KNOWLEDGE_CACHE_CLEANUP_ENABLED=bad\nsecret\0'));
  assert.deepEqual(Object.keys(result), ENV_KEYS);
  assert.equal(result.APP_PROCESS_ROLE, 'web');
  assert.equal(result.AI_JOB_RUNNER_MODE, null);
  assert.equal(result.KNOWLEDGE_CACHE_CLEANUP_ENABLED, '[unrecognized_value_redacted]');
  assert.doesNotMatch(JSON.stringify(result), /mysql|do-not-print|bad|secret/);
});

function procStat(start = '1234') {
  return `101 (node worker) ${['S', ...Array(18).fill('0'), start, '0'].join(' ')}`;
}
test('process environment uses stable active MainPID and rejects races/inactive/inaccessible units', () => {
  const unit = UNITS[0];
  const show = () => ({ ActiveState: 'active', MainPID: '101' });
  const read = filename => filename.endsWith('/stat') ? procStat() : Buffer.from('APP_PROCESS_ROLE=web\0DATABASE_URL=secret\0');
  const valid = inspectService(unit, { show, read });
  assert.equal(valid.status, 'checked');
  assert.equal(valid.pid, 101);
  assert.equal(valid.environment.APP_PROCESS_ROLE, 'web');
  assert.match(valid.note, /exec-time environment/);
  assert.doesNotMatch(JSON.stringify(valid), /secret/);
  assert.equal(inspectService(unit, { show: () => ({ ActiveState: 'inactive', MainPID: '0' }), read }).reason, 'no_active_main_process');
  assert.equal(inspectService(unit, { show, read: () => { throw new Error('private'); } }).reason, 'process_environment_unreadable');
  let reads = 0;
  assert.equal(inspectService(unit, { show, read: filename => filename.endsWith('/stat') ? procStat(String(++reads)) : Buffer.alloc(0) }).reason, 'process_changed_during_read');
  let shows = 0;
  assert.equal(inspectService(unit, { show: () => ({ ActiveState: 'active', MainPID: ++shows === 1 ? '101' : '102' }), read }).reason, 'process_changed_during_read');
  assert.throws(() => inspectService('other.service'), /UNIT_OUT_OF_SCOPE/);
});

test('DB settings reject unrelated driver overrides and never format credentials as errors', () => {
  const url = 'mysql://user:private-password@localhost/example?charset=utf8mb4';
  const options = connectionOptions(url);
  assert.equal(options.uri, url);
  assert.equal(options.multipleStatements, false);
  assert.equal(options.connectTimeout, 10000);
  for (const value of [undefined, 'not-a-url', 'https://user:secret@example/db', 'mysql://user:secret@host/', 'mysql://user:secret@host/db?multipleStatements=true', 'mysql://user:secret@host/db?infileStreamFactory=x']) {
    assert.throws(() => connectionOptions(value), error => Boolean(error.safeCode) && !error.message.includes('secret'));
  }
});

test('reports are private and separate invocations never overwrite previous reports', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdao-readonly-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const first = writePrivateReport(parent, { status: 'inspection_incomplete' });
  const second = writePrivateReport(parent, { status: 'inspection_complete' });
  assert.notEqual(first, second);
  assert.equal(fs.statSync(first).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(first)).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(fs.readFileSync(first)), { status: 'inspection_incomplete' });
});

test('standalone CLI does not import app modules or invoke lifecycle/worker functions', () => {
  const source = fs.readFileSync(new URL('./inspect-qingdao-startup-safety.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .*? from '([^']+)'/gm)].map(match => match[1]);
  assert.ok(imports.length > 0 && imports.every(value => value.startsWith('node:')));
  assert.doesNotMatch(source, /requireApp\('(?!dotenv|mysql2\/promise)[^']+'/);
  assert.doesNotMatch(source, /\b(?:runDataLifecycleArchive|startMeetingAudioWorker|startDesignWorker|startScheduler)\s*\(/);
  assert.doesNotMatch(source, /systemctl[^\n]*(?:stop|start|restart|enable)/);
});
