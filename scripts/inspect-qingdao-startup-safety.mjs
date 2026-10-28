import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Standalone deployment inspection. Do not import application modules: even a
// lifecycle "dryRun" writes audit rows, and worker imports can start timers.
const fail = code => Object.assign(new Error(code), { safeCode: code });
const PRIVATE_KINDS = [
  'knowledge.image_tagging.v1', 'image.workflow.outline.v1',
  'product.development.market_overview.v1', 'knowledge.qa.v1',
  'video.workflow.configured.v1', 'ops.saihu_report_capture.v1',
  'listing.generation.configured.v1', 'listing.auxiliary.configured.v1',
];
const PRIVATE_ARTIFACTS = [
  'knowledge.image_tagging.source.v1', 'knowledge.image_tagging.candidate.v1',
  'image.workflow.outline.source.v1', 'image.workflow.outline.candidate.v1', 'image.workflow.outline.apply.v1',
  'product.development.market_overview.source.v1', 'product.development.market_overview.candidate.v1', 'product.development.market_overview.apply.v1',
  'knowledge.qa.source.v1', 'knowledge.qa.answer.v1', 'knowledge.qa.thread.v1',
  'video.workflow.source.v1', 'video.workflow.candidate.v1', 'video.workflow.revision.v1',
  'ops.saihu_report.source.v1', 'ops.saihu_report.preview.v1', 'ops.saihu_report.apply.v1', 'ops.saihu_report.schedule_occurrence.v1',
  'listing.generation.source.v1', 'listing.generation.candidate.v1', 'listing.generation.apply.v1',
  'listing.auxiliary.source.v1', 'listing.auxiliary.candidate.v1', 'listing.auxiliary.apply.v1',
];
const literals = values => values.map(value => `'${value}'`).join(',');
const genericArtifactWhere = `a.artifactKey NOT IN (${literals(PRIVATE_ARTIFACTS)})
  AND NOT (COALESCE(a.sourceTable,'') IN ('kb_images','kb_image_sets') AND a.sourceAiJobRunId IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM ai_jobs j WHERE j.runId=a.sourceAiJobRunId AND j.kind IN (${literals(PRIVATE_KINDS)}))`;

function archive(id, table, days, lifecycle, terminal = '', extraColumns = [], alias = '') {
  return {
    id, category: 'archive',
    requires: { [table]: ['createdAt', lifecycle, ...extraColumns] },
    sql: `SELECT COUNT(*) AS candidateCount FROM \`${table}\`${alias ? ` ${alias}` : ''}
      WHERE createdAt < DATE_SUB(NOW(3), INTERVAL ${days} DAY)
      ${terminal ? `AND (${terminal})` : ''}
      AND (${lifecycle} IS NULL OR ${lifecycle} <> '${lifecycle === 'lifecycleState' ? 'archived' : 'archive'}')`,
    scope: 'All archive-eligible rows, not the scheduler batch limit; archive is not deletion.',
  };
}

// Fixed predicates mirrored from the 90558997 runtime. No arbitrary SQL input.
export const CHECKS = Object.freeze([
  archive('ai_jobs.completed', 'ai_jobs', 180, 'retentionClass', `status IN ('succeeded','failed','canceled') AND kind NOT IN (${literals(PRIVATE_KINDS)})`, ['status', 'kind']),
  archive('tool_runs.completed', 'emperor_tool_runs', 180, 'retentionClass', "status IN ('succeeded','failed','blocked')", ['status']),
  archive('agent_events.stream', 'emperor_agent_events', 90, 'retentionClass'),
  archive('ai_os_metrics.detail', 'emperor_ai_os_metrics', 365, 'retentionClass'),
  archive('project_files.uploads', 'projectFiles', 180, 'lifecycleState', "status IN ('completed','failed')", ['status']),
  {
    ...archive('ai_artifacts.versions', 'ai_artifacts', 365, 'retentionClass', `a.status IN ('final','superseded','archived') AND ${genericArtifactWhere}`, [], 'a'),
    requires: {
      ai_artifacts: ['createdAt', 'status', 'retentionClass', 'artifactKey', 'sourceTable', 'sourceAiJobRunId'],
      ai_jobs: ['runId', 'kind'],
    },
  },
  {
    id: 'meeting_audio.discovery', category: 'queue',
    requires: { meeting_records: ['meeting_status', 'extracted_tasks'] },
    sql: `SELECT COUNT(*) AS candidateCount FROM meeting_records
      WHERE meeting_status IN ('uploading','transcribing')
      AND CASE WHEN JSON_VALID(extracted_tasks) THEN JSON_EXTRACT(extracted_tasks,'$.audio.state') ELSE NULL END IS NOT NULL`,
    scope: 'Exact worker discovery predicate before its limit 20. Nonzero requires review: valid v2 notes, workspace, audio state, lease and poll time further gate execution; queued/transcribed may call paid services. No payload is read.',
  },
  {
    id: 'ai_jobs.recoverable', category: 'queue',
    requires: { ai_jobs: ['status', 'nextRunAt', 'leaseUntil', 'kind'] },
    sql: `SELECT COUNT(*) AS candidateCount FROM ai_jobs
      WHERE ((status='queued' AND (nextRunAt IS NULL OR nextRunAt<NOW(3)))
        OR (status='running' AND (leaseUntil IS NULL OR leaseUntil<NOW(3))))
      AND kind NOT IN (${literals(['listing_competitor_deep_v1', ...PRIVATE_KINDS])})`,
    scope: 'Generic recovery discovery before its batch limit and handler/atomic-claim checks; excludes dedicated private lanes.',
  },
  {
    id: 'agent_checkpoints.timed_out', category: 'queue',
    requires: { emperor_agent_checkpoints: ['status', 'timeoutAt'] },
    sql: "SELECT COUNT(*) AS candidateCount FROM emperor_agent_checkpoints WHERE status='running' AND timeoutAt IS NOT NULL AND timeoutAt<NOW()",
    scope: 'Recovery discovery before its batch limit; missing/canceled/completed/paused parent runs are subsequently skipped.',
  },
  {
    id: 'design_generations.due', category: 'queue',
    requires: { design_generations: ['status', 'nextPollAt', 'leaseUntil', 'deletedAt'] },
    sql: "SELECT COUNT(*) AS candidateCount FROM design_generations WHERE status IN ('queued','submitting','running') AND nextPollAt<=NOW(3) AND (leaseUntil IS NULL OR leaseUntil<NOW(3)) AND deletedAt IS NULL",
    scope: 'Design worker claim candidates, without claiming or locking rows.',
  },
  {
    id: 'design_chat_turns.due', category: 'queue',
    requires: { design_chat_turns: ['status', 'leaseUntil'] },
    sql: "SELECT COUNT(*) AS candidateCount FROM design_chat_turns WHERE status IN ('queued','submitting') AND (leaseUntil IS NULL OR leaseUntil<NOW(3))",
    scope: 'Design chat worker claim candidates, without claiming or locking rows.',
  },
]);

const notChecked = (check, reason, extra = {}) => ({ id: check.id, category: check.category, status: 'not_checked', reason, ...extra });
export function missingSchema(check, columns) {
  return Object.entries(check.requires).flatMap(([table, names]) => {
    const found = columns.get(table);
    if (!found) return [{ table, reason: 'missing_table' }];
    const missingColumns = names.filter(name => !found.has(name));
    return missingColumns.length ? [{ table, reason: 'missing_columns', columns: missingColumns }] : [];
  });
}
function assertSelect(sql) {
  if (!/^SELECT\s/i.test(sql) || /;|\b(?:INTO|OUTFILE|DUMPFILE|FOR\s+UPDATE|LOCK\s+IN)\b/i.test(sql)) throw fail('NON_READ_ONLY_QUERY_REFUSED');
}
function safeCount(rows) {
  const value = rows?.length === 1 ? rows[0].candidateCount : undefined;
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value))) throw fail('INVALID_COUNT_RESULT');
  if (!Number.isSafeInteger(Number(value))) throw fail('COUNT_EXCEEDS_SAFE_INTEGER');
  return Number(value);
}

export async function inspectDatabase(connection) {
  const results = [];
  let started = false;
  try {
    await connection.query({ sql: 'START TRANSACTION READ ONLY', timeout: 10000 });
    started = true;
    const select = async sql => {
      assertSelect(sql);
      // MySQL enforces a server-side SELECT deadline as well as the driver's
      // socket deadline. A timeout is not a zero result and ends this run.
      return connection.query({ sql: sql.replace(/^SELECT /, 'SELECT /*+ MAX_EXECUTION_TIME(15000) */ '), timeout: 20000 });
    };
    const [identity] = await select('SELECT DATABASE() AS databaseName, @@server_uuid AS serverUuid, NOW(3) AS observedAt');
    if (!identity[0]?.databaseName || !identity[0]?.serverUuid) throw fail('DATABASE_IDENTITY_UNAVAILABLE');
    const [metadata] = await select('SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()');
    const columns = new Map();
    for (const row of metadata) {
      if (!columns.has(row.tableName)) columns.set(row.tableName, new Set());
      columns.get(row.tableName).add(row.columnName);
    }
    for (const check of CHECKS) {
      const missing = missingSchema(check, columns);
      if (missing.length) { results.push(notChecked(check, 'schema_missing', { missing })); continue; }
      try {
        const [rows] = await select(check.sql);
        results.push({ id: check.id, category: check.category, status: 'checked', candidateCount: safeCount(rows), scope: check.scope });
      } catch {
        results.push(notChecked(check, 'query_failed_or_timed_out'));
        break; // Do not reuse a possibly timed-out connection or print SQL errors.
      }
    }
    return { status: results.length === CHECKS.length && results.every(item => item.status === 'checked') ? 'checked' : 'not_checked', identity: identity[0], checks: completeChecks(results, 'inspection_stopped') };
  } finally {
    if (started) await connection.query({ sql: 'ROLLBACK', timeout: 5000 }).catch(() => {});
  }
}
function completeChecks(results, reason) {
  return CHECKS.map(check => results.find(result => result.id === check.id) || notChecked(check, reason));
}

export const ENV_KEYS = Object.freeze(['APP_PROCESS_ROLE', 'NODE_ENV', 'AI_JOB_RUNNER_MODE', 'AI_JOB_IN_PROCESS', 'KNOWLEDGE_CACHE_CLEANUP_ENABLED']);
export const UNITS = Object.freeze(['amazon-listing-web.service', 'amazon-listing-worker.service', 'amazon-listing-scheduler.service']);
export function filteredEnvironment(bytes) {
  const values = Object.fromEntries(ENV_KEYS.map(key => [key, null]));
  for (const item of bytes.toString('utf8').split('\0')) {
    const separator = item.indexOf('=');
    const key = item.slice(0, separator);
    if (!ENV_KEYS.includes(key)) continue;
    const value = item.slice(separator + 1);
    // No arbitrary long/newline values can be smuggled into the report.
    values[key] = /^[a-zA-Z0-9_-]{0,48}$/.test(value) ? value : '[unrecognized_value_redacted]';
  }
  return values;
}
function processStartTime(stat) {
  const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  if (!/^\d+$/.test(fields[19] || '')) throw fail('PROCESS_STAT_UNREADABLE');
  return fields[19]; // /proc/<pid>/stat field 22, not the potentially spaced comm.
}
function showUnit(unit) {
  const output = execFileSync('/usr/bin/systemctl', ['show', '--no-pager', '--property=MainPID,ActiveState', unit], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'ignore'],
    env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', LC_ALL: 'C' },
  });
  return Object.fromEntries(output.trim().split('\n').map(line => line.split('=')));
}
export function inspectService(unit, { show = showUnit, read = fs.readFileSync } = {}) {
  if (!UNITS.includes(unit)) throw fail('UNIT_OUT_OF_SCOPE');
  try {
    const before = show(unit);
    if (before.ActiveState !== 'active' || !/^[1-9]\d*$/.test(before.MainPID || '')) return { unit, status: 'not_checked', reason: 'no_active_main_process' };
    const pid = Number(before.MainPID);
    if (!Number.isSafeInteger(pid)) throw fail('INVALID_MAIN_PID');
    const stat = `/proc/${pid}/stat`;
    const start = processStartTime(read(stat, 'utf8'));
    const environment = filteredEnvironment(read(`/proc/${pid}/environ`));
    const end = processStartTime(read(stat, 'utf8'));
    const after = show(unit);
    if (after.MainPID !== before.MainPID || after.ActiveState !== 'active' || start !== end) return { unit, status: 'not_checked', reason: 'process_changed_during_read' };
    return { unit, status: 'checked', pid, environment, note: 'Linux /proc exposes exec-time environment, not later in-process env assignments. Null means unset; fallback role flags and code-mutated values are not inferred.' };
  } catch { return { unit, status: 'not_checked', reason: 'process_environment_unreadable' }; }
}

export function connectionOptions(databaseUrl) {
  let url;
  try { url = new URL(databaseUrl); } catch { throw fail('DATABASE_URL_INVALID'); }
  if (!['mysql:', 'mysql2:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2 || url.hash) throw fail('DATABASE_URL_INVALID');
  // Preserve supported driver TLS/timezone settings; never accept URL overrides
  // for multipleStatements, local-file loading, or arbitrary driver options.
  if ([...url.searchParams.keys()].some(key => !['charset', 'timezone', 'ssl'].includes(key))) throw fail('DATABASE_OPTIONS_REQUIRE_REVIEW');
  return { uri: databaseUrl, multipleStatements: false, connectTimeout: 10000, supportBigNumbers: true, bigNumberStrings: true };
}
export function writePrivateReport(parent, report) {
  const directory = fs.mkdtempSync(path.join(parent, 'startup-safety-'));
  fs.chmodSync(directory, 0o700);
  const reportPath = path.join(directory, 'report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return reportPath;
}
export async function inspectStartup({ outputParent, appDirectory = '/opt/amazon-listing-tool', configPath = '/etc/amazon-listing-tool/runtime.conf' }) {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw fail('LINUX_ROOT_INSPECTION_REQUIRED');
  for (const value of [outputParent, appDirectory, configPath]) if (!value || !path.isAbsolute(value) || path.normalize(value) !== value) throw fail('ABSOLUTE_NORMALIZED_PATH_REQUIRED');
  if (!fs.statSync(outputParent).isDirectory()) throw fail('OUTPUT_PARENT_NOT_DIRECTORY');
  const report = {
    formatVersion: 1, startedAt: new Date().toISOString(), predicatesForRuntime: '90558997',
    readOnly: true, applicationImported: false, modelCalled: false,
    configPath, appDirectory, services: UNITS.map(unit => inspectService(unit)),
    limitations: 'Point-in-time counts; running services can change rows and schema must not change during inspection. No tasks are claimed/canceled, no sweeps or application dry-runs run, and this is not permission to start paid queues. Preserve existing scheduler behavior; nonzero archive counts require operator review, not an automatic scheduler stop.',
  };
  let connection;
  try {
    const requireApp = createRequire(path.join(appDirectory, 'package.json'));
    const configBytes = fs.readFileSync(configPath);
    report.configurationSha256 = crypto.createHash('sha256').update(configBytes).digest('hex');
    const config = requireApp('dotenv').parse(configBytes);
    connection = await requireApp('mysql2/promise').createConnection(connectionOptions(config.DATABASE_URL));
    report.database = await inspectDatabase(connection);
  } catch {
    report.database = { status: 'not_checked', reason: 'database_connection_or_inspection_failed', checks: completeChecks([], 'database_unavailable') };
  } finally {
    // No write transaction to commit; destroy also releases any failed SELECT.
    if (connection) connection.destroy();
  }
  report.finishedAt = new Date().toISOString();
  report.status = report.database.status === 'checked' && report.services.every(item => item.status === 'checked') ? 'inspection_complete' : 'inspection_incomplete';
  report.nonzeroChecks = report.database.checks.filter(item => item.status === 'checked' && item.candidateCount > 0).map(item => item.id);
  const reportPath = writePrivateReport(outputParent, report);
  return {
    status: report.status, reportPath, nonzeroChecks: report.nonzeroChecks,
    notChecked: report.database.checks.filter(item => item.status === 'not_checked').map(item => item.id),
    servicesNotChecked: report.services.filter(item => item.status === 'not_checked').map(item => item.unit),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  try {
    if (process.argv.length < 3 || process.argv.length > 5) throw fail('USAGE_OUTPUT_PARENT_OPTIONAL_APP_DIRECTORY_CONFIG_PATH');
    const [outputParent, appDirectory, configPath] = process.argv.slice(2);
    const result = await inspectStartup({ outputParent, appDirectory, configPath });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'inspection_complete') process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ status: 'inspection_failed', error: error.safeCode || 'INSPECTION_FAILED' }));
    process.exitCode = 1;
  }
}
