// Catalog discovery only: no application imports, dotenv, seeds, approvals or file output.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const EXPECTED_SCHEMA = "amz_listing";
export const TABLES = Object.freeze(["emperor_skills", "emperor_model_providers", "emperor_assistant_configurations", "emperor_agent_library"]);
export const LIMITS = Object.freeze({ groups: 200, configurations: 200, models: 100, skills: 200, columns: 500, indexes: 1000, queryMs: 5000, runMs: 120000 });
const SLUGS = Object.freeze(["agent.library.route", "agent.library.coach"]);
class DiscoveryError extends Error { constructor(code) { super(code); this.discoveryCode = code; } }
const requireSafe = (condition, code) => { if (!condition) throw new DiscoveryError(code); };
// Never forward driver codes/messages: even an error.code can contain arbitrary data.
const safeError = error => ({ code: error instanceof DiscoveryError ? error.discoveryCode : "REGISTRY_DISCOVERY_FAILED" });
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const tableSql = table => { requireSafe(TABLES.includes(table), "TABLE_OUT_OF_SCOPE"); return `\`${EXPECTED_SCHEMA}\`.\`${table}\``; };
const tableFilter = "BINARY TABLE_SCHEMA = BINARY ? AND TABLE_NAME IN (?,?,?,?)";
const spec = (fields, sql, limit) => Object.freeze({ fields: Object.freeze(fields.split(" ")), sql: `${sql} LIMIT ${limit + 1}`, limit });
export const CATALOG_SELECTS = Object.freeze({
  schema: spec("schemaName", "SELECT SCHEMA_NAME AS schemaName FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME = BINARY ? ORDER BY BINARY SCHEMA_NAME", 1),
  tables: spec("tableName tableType engine", `SELECT TABLE_NAME AS tableName,TABLE_TYPE AS tableType,ENGINE AS engine FROM information_schema.TABLES WHERE ${tableFilter} ORDER BY BINARY TABLE_NAME`, 4),
  columns: spec("tableName columnName ordinalPosition dataType nullable maximumLength precision scale", `SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,ORDINAL_POSITION AS ordinalPosition,DATA_TYPE AS dataType,IS_NULLABLE AS nullable,CHARACTER_MAXIMUM_LENGTH AS maximumLength,NUMERIC_PRECISION AS \`precision\`,NUMERIC_SCALE AS \`scale\` FROM information_schema.COLUMNS WHERE ${tableFilter} ORDER BY BINARY TABLE_NAME,ORDINAL_POSITION`, LIMITS.columns),
  indexes: spec("tableName indexName nonUnique sequence columnName prefixLength indexType visible expressionPresent", `SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS prefixLength,INDEX_TYPE AS indexType,IS_VISIBLE AS visible,CASE WHEN EXPRESSION IS NULL OR EXPRESSION='' THEN 0 ELSE 1 END AS expressionPresent FROM information_schema.STATISTICS WHERE ${tableFilter} ORDER BY BINARY TABLE_NAME,BINARY INDEX_NAME,SEQ_IN_INDEX`, LIMITS.indexes),
});

export function parseArguments(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--inspect-read-only" && !result.inspectReadOnly) result.inspectReadOnly = true;
    else if (args[index] === "--expected-schema" && !Object.hasOwn(result, "expectedSchema")) result.expectedSchema = args[++index];
    else requireSafe(false, "INVALID_ARGUMENTS");
  }
  requireSafe(result.inspectReadOnly === true && result.expectedSchema === EXPECTED_SCHEMA, "EXPLICIT_FIXED_READ_ONLY_SCOPE_REQUIRED");
  return result;
}

export function validateManagedUri(uri) {
  let parsed;
  try { parsed = new URL(uri); } catch { requireSafe(false, "MANAGED_DATABASE_URL_INVALID"); }
  requireSafe(parsed.protocol === "mysql:" && parsed.hostname && !parsed.hash, "MANAGED_DATABASE_URL_INVALID");
  let database;
  try { database = decodeURIComponent(parsed.pathname.slice(1)); } catch { requireSafe(false, "MANAGED_DATABASE_URL_INVALID"); }
  requireSafe(database === EXPECTED_SCHEMA, "MANAGED_DATABASE_URL_SCHEMA_MISMATCH");
  const seen = new Set();
  for (const [key, value] of parsed.searchParams) {
    requireSafe(["ssl", "charset", "timezone"].includes(key) && !seen.has(key), "MANAGED_DATABASE_URL_OPTIONS_UNSUPPORTED");
    seen.add(key);
    let decoded = value;
    try { decoded = JSON.parse(value); } catch { /* Plain charset/timezone values are valid mysql2 options. */ }
    if (key === "charset") requireSafe(typeof decoded === "string" && /^[A-Za-z0-9_]+$/.test(decoded), "MANAGED_DATABASE_URL_OPTIONS_UNSUPPORTED");
    if (key === "timezone") requireSafe(typeof decoded === "string" && /^(?:local|Z|[ +-]\d\d:\d\d)$/.test(decoded), "MANAGED_DATABASE_URL_OPTIONS_UNSUPPORTED");
    if (key === "ssl") requireSafe(decoded === null || decoded === false || decoded === "Amazon RDS"
      || (decoded && typeof decoded === "object" && !Array.isArray(decoded)), "MANAGED_DATABASE_URL_OPTIONS_UNSUPPORTED");
  }
}

function project(rows, fields, limit) {
  requireSafe(Array.isArray(rows) && rows.length <= limit, "RESULT_LIMIT_OR_SHAPE_INVALID");
  return rows.map(row => {
    requireSafe(row && typeof row === "object" && !Array.isArray(row), "RESULT_ROW_INVALID");
    return Object.fromEntries(fields.map(field => {
      requireSafe(Object.hasOwn(row, field), "RESULT_FIELD_MISSING");
      const value = row[field];
      requireSafe(value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)
        || typeof value === "string" && value.length <= 512 && ![...value].some(character => character.codePointAt(0) < 32 || character.codePointAt(0) === 127), "RESULT_VALUE_INVALID");
      return [field, value];
    }));
  });
}
const int = (value, nullable = false) => {
  requireSafe(nullable && value === null || (typeof value === "number" || typeof value === "string") && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)), "RESULT_INTEGER_INVALID");
  return value === null ? null : Number(value);
};
const bool = (value, nullable = false) => {
  requireSafe(nullable && value === null || [true, false, 0, 1, "0", "1"].includes(value), "RESULT_BOOLEAN_INVALID");
  return value === null ? null : value === true || value === 1 || value === "1";
};
const token = (value, nullable = false) => {
  requireSafe(nullable && value === null || typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value), "RESULT_IDENTIFIER_INVALID");
  return value;
};
const integerTypes = new Set(["int", "integer", "smallint", "tinyint", "mediumint", "bigint"]);
const textTypes = new Set(["varchar", "char", "text", "mediumtext", "longtext", "enum"]);
const payloadTypes = new Set(["json", "text", "mediumtext", "longtext"]);
const REQUIREMENTS = Object.freeze({
  emperor_skills: { id: integerTypes, workspaceId: integerTypes, slug: textTypes, scope: textTypes, status: textTypes, version: integerTypes, manifest: payloadTypes },
  emperor_model_providers: { id: integerTypes, workspaceId: integerTypes, slug: textTypes, modelId: textTypes, isActive: integerTypes, apiKeyRef: textTypes },
  emperor_assistant_configurations: { workspaceId: integerTypes, agentKey: textTypes, revision: integerTypes, configHash: textTypes },
  emperor_agent_library: { workspaceId: integerTypes, agentKey: textTypes, revision: integerTypes },
});

async function collect(query) {
  const catalog = {};
  for (const [name, definition] of Object.entries(CATALOG_SELECTS)) {
    const [rows] = await query(definition.sql, name === "schema" ? [EXPECTED_SCHEMA] : [EXPECTED_SCHEMA, ...TABLES]);
    catalog[name] = project(rows, definition.fields, definition.limit);
    if (name !== "schema") requireSafe(catalog[name].every(row => TABLES.includes(row.tableName)), "CATALOG_OUT_OF_SCOPE");
  }
  requireSafe(catalog.schema.length === 0 || catalog.schema.length === 1 && catalog.schema[0].schemaName === EXPECTED_SCHEMA, "CATALOG_SCHEMA_INVALID");
  const available = catalog.schema.length === 1;
  const registries = {};
  let groupsRead = 0, configurationsRead = 0;
  for (const table of TABLES) {
    const tableRows = catalog.tables.filter(row => row.tableName === table);
    requireSafe(tableRows.length <= 1, "CATALOG_TABLE_DUPLICATE");
    const columns = catalog.columns.filter(row => row.tableName === table);
    requireSafe(new Set(columns.map(row => row.columnName)).size === columns.length, "CATALOG_COLUMN_DUPLICATE");
    const column = name => columns.find(row => row.columnName === name);
    const issues = Object.entries(REQUIREMENTS[table]).flatMap(([name, allowed]) => !column(name) ? [`missing_column:${name}`]
      : !allowed.has(column(name).dataType) ? [`unsupported_column_type:${name}`] : []);
    const reason = !available ? "schema_not_visible" : !tableRows.length ? "table_not_visible" : tableRows[0].tableType !== "BASE TABLE" ? "not_base_table"
      : tableRows[0].engine !== "InnoDB" ? "nontransactional_engine" : issues.length ? "column_prerequisites_unavailable" : null;
    if (reason) { registries[table] = { status: "unavailable", reason, columnIssues: issues }; continue; }
    const groupBy = table === "emperor_skills" ? ["workspaceId", "scope", "status"] : table === "emperor_model_providers" ? ["workspaceId", "isActive"] : ["workspaceId"];
    const groupFields = [...groupBy, "rowCount"];
    const [groupRows] = await query(`SELECT ${groupBy.map(name => `\`${name}\``).join(",")},COUNT(*) AS rowCount FROM ${tableSql(table)} GROUP BY ${groupBy.map(name => `\`${name}\``).join(",")} ORDER BY ${groupBy.map(name => `\`${name}\``).join(",")} LIMIT 201`);
    const groups = project(groupRows, groupFields, LIMITS.groups).map(row => ({ ...row, workspaceId: int(row.workspaceId, true), rowCount: int(row.rowCount),
      ...(table === "emperor_skills" ? { scope: token(row.scope), status: token(row.status) } : {}),
      ...(table === "emperor_model_providers" ? { isActive: bool(row.isActive) } : {}) }));
    groupsRead += groups.length;
    requireSafe(groupsRead <= LIMITS.groups, "TOTAL_GROUP_LIMIT_EXCEEDED");
    const result = { status: "available", groupingColumns: groupBy, groups };
    if (table === "emperor_skills") {
      const [rows] = await query(`SELECT id,workspaceId,scope,slug,status,version,OCTET_LENGTH(CAST(manifest AS CHAR CHARACTER SET utf8mb4)) AS manifestBytes,SHA2(CAST(manifest AS CHAR CHARACTER SET utf8mb4),256) AS manifestSha256 FROM ${tableSql(table)} WHERE BINARY slug IN (BINARY ?,BINARY ?) ORDER BY workspaceId,BINARY scope,BINARY slug,id LIMIT 201`, SLUGS);
      result.exactSkills = project(rows, ["id", "workspaceId", "scope", "slug", "status", "version", "manifestBytes", "manifestSha256"], LIMITS.skills).map(row => {
        requireSafe(SLUGS.includes(row.slug) && (row.manifestSha256 === null || /^[a-f0-9]{64}$/.test(row.manifestSha256)), "SKILL_METADATA_INVALID");
        return { ...row, id: int(row.id), workspaceId: int(row.workspaceId, true), version: int(row.version), scope: token(row.scope), status: token(row.status), manifestBytes: int(row.manifestBytes, true) };
      });
    } else if (table === "emperor_model_providers") {
      const [rows] = await query(`SELECT id,workspaceId,slug,modelId,isActive,CASE WHEN BINARY apiKeyRef=BINARY 'env:EXTERNAL_LLM_API_KEY' THEN 1 ELSE 0 END AS credentialReferenceIsControlled FROM ${tableSql(table)} ORDER BY workspaceId,BINARY slug,id LIMIT 101`);
      result.models = project(rows, ["id", "workspaceId", "slug", "modelId", "isActive", "credentialReferenceIsControlled"], LIMITS.models).map(row => ({ id: int(row.id), workspaceId: int(row.workspaceId, true), slug: token(row.slug), modelId: token(row.modelId), isActive: bool(row.isActive), credentialReferenceIsControlled: bool(row.credentialReferenceIsControlled) }));
    } else {
      const hashColumn = column("configHash");
      requireSafe(!hashColumn || textTypes.has(hashColumn.dataType), "CONFIG_HASH_COLUMN_TYPE_INVALID");
      result.hashColumnPresent = Boolean(hashColumn);
      const [rows] = await query(`SELECT workspaceId,agentKey,revision,${hashColumn ? "CASE WHEN configHash IS NOT NULL AND OCTET_LENGTH(configHash)>0 THEN 1 ELSE 0 END" : "NULL"} AS hashPresent FROM ${tableSql(table)} ORDER BY workspaceId,BINARY agentKey,revision LIMIT 201`);
      result.configurations = project(rows, ["workspaceId", "agentKey", "revision", "hashPresent"], LIMITS.configurations).map(row => ({ workspaceId: int(row.workspaceId), agentKey: token(row.agentKey), revision: int(row.revision), hashPresent: bool(row.hashPresent, !hashColumn) }));
      configurationsRead += result.configurations.length;
      requireSafe(configurationsRead <= LIMITS.configurations, "TOTAL_CONFIGURATION_LIMIT_EXCEEDED");
    }
    registries[table] = result;
  }
  return { catalog, registries, complete: available && Object.values(registries).every(row => row.status === "available") };
}

async function loadConnector() { return (await import("mysql2/promise")).createConnection; }

export async function inspectAssistantRegistry(options, { environment = process.env, load = loadConnector, timeouts = LIMITS } = {}) {
  requireSafe(options?.inspectReadOnly === true && options.expectedSchema === EXPECTED_SCHEMA, "EXPLICIT_FIXED_READ_ONLY_SCOPE_REQUIRED");
  requireSafe(typeof environment.DATABASE_URL === "string" && environment.DATABASE_URL.trim().length > 0, "MANAGED_DATABASE_ENV_REQUIRED");
  validateManagedUri(environment.DATABASE_URL);
  const queryMs = timeouts.queryMs, runMs = timeouts.runMs;
  requireSafe(Number.isInteger(queryMs) && queryMs > 0 && queryMs <= LIMITS.queryMs && Number.isInteger(runMs) && runMs > 0 && runMs <= LIMITS.runMs, "INVALID_TIMEOUTS");
  const receipt = { formatVersion: 1, mode: "read-only-assistant-registry-discovery", expectedSchema: EXPECTED_SCHEMA, startedAt: new Date().toISOString(),
    status: "running", stable: null, writesPerformed: false, configBodiesRead: false, promptBodiesRead: false, credentialValuesRead: false,
    limitations: ["This is registry discovery, not migration, source approval, model authorization or runtime enablement.",
      "Only the four named tables visible to the existing managed account are inspected; no workspace is inferred or selected.",
      "Manifest SHA-256 hashes database UTF-8 CAST rendering, not the application's canonical manifest or runtime approval hash.",
      "Credential-reference equality is computed by SQL; it does not test key presence, provider connectivity, model capability, pricing or endpoint validity.",
      "Configuration bodies, rules, prompts, actual credential references and base URLs are not returned; hashPresent only reports a stored hash's presence.",
      "Two independent read-only observations compare visible redacted content, not an atomic DDL snapshot or all unreported registry fields."] };
  let raw, inTransaction = false, finished = false, destroyed = false;
  const deadline = Date.now() + runMs;
  const destroy = () => { if (raw && !destroyed) { destroyed = true; raw.destroy(); } };
  const bounded = (factory, ms, code) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { destroy(); } catch { /* Original timeout remains the useful safe reason. */ } reject(new DiscoveryError(code)); }, ms);
    Promise.resolve().then(factory).then(resolve, reject).finally(() => clearTimeout(timer));
  });
  const query = async (sql, values = []) => {
    const remaining = deadline - Date.now();
    requireSafe(remaining > 0, "DISCOVERY_DEADLINE_EXCEEDED");
    const timeout = Math.min(queryMs, remaining);
    return bounded(() => raw.query({ sql, timeout }, values), timeout, remaining <= queryMs ? "DISCOVERY_DEADLINE_EXCEEDED" : "QUERY_TIMEOUT");
  };
  try {
    const createConnection = await bounded(load, Math.min(queryMs, runMs), "CONNECTOR_LOAD_TIMEOUT");
    raw = await bounded(async () => {
      const connection = await createConnection({ uri: environment.DATABASE_URL, multipleStatements: false, connectTimeout: queryMs, rowsAsArray: false });
      if (finished) { try { connection.destroy(); } catch { /* Do not leak late connection errors. */ } requireSafe(false, "CONNECTION_ARRIVED_LATE"); }
      return connection;
    }, Math.min(queryMs, Math.max(1, deadline - Date.now())), "CONNECTION_TIMEOUT");
    const [identity] = await query("SELECT DATABASE() AS schemaName,@@version AS version");
    requireSafe(identity?.length === 1 && identity[0].schemaName === EXPECTED_SCHEMA, "CONNECTED_SCHEMA_MISMATCH");
    requireSafe(/^8\.\d+\.\d+(?:[-+.][A-Za-z0-9_.-]+)?$/.test(String(identity[0].version)) && !/mariadb/i.test(identity[0].version), "MYSQL_8_REQUIRED");
    await query("SET SESSION TRANSACTION READ ONLY");
    await query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await query("SET SESSION MAX_EXECUTION_TIME = 5000");
    await query("SET SESSION lock_wait_timeout = 5");
    const snapshots = [];
    for (let pass = 0; pass < 2; pass++) {
      inTransaction = true;
      await query("START TRANSACTION READ ONLY");
      snapshots.push(await collect(query));
      await query("ROLLBACK");
      inTransaction = false;
    }
    receipt.hashes = { first: hash(snapshots[0]), second: hash(snapshots[1]) };
    receipt.stable = receipt.hashes.first === receipt.hashes.second;
    receipt.status = !receipt.stable ? "changed" : snapshots[1].complete ? "completed" : "unavailable";
    // An unstable/failed/over-limit observation never publishes a partial inventory.
    if (receipt.stable) receipt.observation = snapshots[1];
  } catch (error) { receipt.status = "failed"; receipt.error = safeError(error); }
  finally {
    finished = true;
    if (raw && inTransaction && !destroyed) {
      const cleanupMs = Math.min(queryMs, Math.max(1, deadline - Date.now()));
      try { await bounded(() => raw.query({ sql: "ROLLBACK", timeout: cleanupMs }, []), cleanupMs, "ROLLBACK_TIMEOUT"); }
      catch { receipt.cleanupError = { code: "ROLLBACK_FAILED" }; receipt.status = "failed"; }
    }
    try { destroy(); } catch { receipt.cleanupError = { code: "CONNECTION_CLEANUP_FAILED" }; receipt.status = "failed"; }
    if (receipt.status === "failed") { delete receipt.observation; delete receipt.hashes; receipt.stable = null; }
    receipt.finishedAt = new Date().toISOString();
  }
  return receipt;
}

export async function main(args, { dependencies, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const receipt = await inspectAssistantRegistry(parseArguments(args), dependencies);
    stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return receipt.status === "completed" ? 0 : receipt.status === "changed" ? 2 : 1;
  } catch (error) { stderr.write(`${JSON.stringify({ status: "refused_or_failed", error: safeError(error) })}\n`); return 1; }
}

function invokedDirectly() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (invokedDirectly()) process.exitCode = await main(process.argv.slice(2));
