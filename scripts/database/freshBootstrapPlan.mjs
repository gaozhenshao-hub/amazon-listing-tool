// Inert, offline plan/contract helpers. Never load dotenv, a DB driver or execute schema TS.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLiteralRegistry } from "../integration/migrationInventory.mjs";
import { selectFreshLineage } from "../integration/freshHistoricalLineage.mjs";
import { DDL_CATALOG, validateCatalog as validatePhysicalCatalog, validateTableDdl } from "../integration/exportProductionDdl.mjs";
import { bindFreshRunnerEvidence } from "./freshBootstrapSourceEvidence.mjs";

export const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const BOOTSTRAP_VERSION = "amazon-fresh-bootstrap/1";
export const EXPECTED_BOOTSTRAP_PLAN_LENGTH = 178;
export const CONTRACT_VERSION = "amazon-fresh-structure/1";
export const MANIFEST_PATH = "drizzle/bootstrap/manifest.json";
export const RECEIPT_MIGRATION = "bootstrap/0001_scheduled_tasks_prerequisite.sql";
export const MANUAL_FRESH_FILES = Object.freeze([
  "0196_ops_ad_mcp_campaign_metadata_nullable.sql",
  "0197_ops_monthly_financial_profit_scope.sql",
  "0198_unified_amazon_acquisition_foundation.sql",
  "0199_image_competitor_gallery_analysis.sql",
  "0200_image_expression_asset_linkage.sql",
  "0201_amazon_monitor_provider_jobs.sql",
  "0202_competitor_gallery_analysis_scope.sql",
  "0203_external_knowledge_caller_bindings.sql",
]);
export const BOOTSTRAP_FILES = Object.freeze([
  RECEIPT_MIGRATION,
  "bootstrap/0002_kb_tag_definitions.sql",
  "bootstrap/0003_listing_and_image_source_columns.sql",
  "bootstrap/0004_current_source_alignment.sql",
  "bootstrap/0005_offsite_empty_table_alignment.sql",
]);
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const fingerprint = value => sha256(JSON.stringify(canonical(value)));
export const insist = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const safeName = value => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value);
const hashPattern = /^[a-f0-9]{64}$/;

export function readPublicFile(root, path) {
  insist(typeof path === "string" && /^(drizzle\/|scripts\/|server\/|migrate_update\.mjs$)/.test(path)
    && !path.split("/").some(part => ["..", ".", ""].includes(part)), "PUBLIC_SOURCE_PATH_INVALID");
  const full = join(root, path);
  insist(resolve(full) === full && realpathSync(full) === full && lstatSync(full).isFile(), "PUBLIC_SOURCE_NOT_REGULAR");
  return readFileSync(full, "utf8");
}

// Read the existing runner's literal plan, without importing its dotenv/client.
// Execution always goes through that runner's applyMigrations, never this reader.
export function loadOfflineGeneralPlan(root = REPOSITORY_ROOT) {
  const source = readPublicFile(root, "scripts/run-database-migrations.mjs");
  const journal = JSON.parse(readPublicFile(root, "drizzle/meta/_journal.json"));
  const names = [...journal.entries.map(entry => `${entry.tag}.sql`),
    ...parseLiteralRegistry(source, "supplementalMigrations", true)];
  return names.map((fileName, order) => {
    const sql = readPublicFile(root, `drizzle/${fileName}`);
    return { fileName, sql, checksum: sha256(sql), order, official: order < journal.entries.length };
  });
}

export function loadFreshBootstrapPlan(root = REPOSITORY_ROOT) {
  let manifest = JSON.parse(readPublicFile(root, MANIFEST_PATH));
  let sourceEvidence = null;
  const runnerSource = readPublicFile(root, "scripts/run-database-migrations.mjs");
  if (manifest.sources?.find(item => item.path === "scripts/run-database-migrations.mjs")?.sha256 !== sha256(runnerSource)) {
    // Keep the historical manifest/approval file intact. Only a byte-proved,
    // non-executable draft classification may produce current source metadata.
    const rebound = bindFreshRunnerEvidence(manifest, runnerSource);
    manifest = rebound.manifest; sourceEvidence = rebound.proof;
  }
  insist(manifest.version === BOOTSTRAP_VERSION && manifest.executionScope === "local-or-ci-only", "BOOTSTRAP_MANIFEST_VERSION_INVALID");
  insist(Array.isArray(manifest.sources) && manifest.sources.length > 168, "BOOTSTRAP_SOURCE_PINS_MISSING");
  const pins = new Map();
  for (const item of manifest.sources) {
    insist(!pins.has(item.path) && hashPattern.test(item.sha256), "BOOTSTRAP_SOURCE_PIN_INVALID");
    insist(sha256(readPublicFile(root, item.path)) === item.sha256, "BOOTSTRAP_SOURCE_CHANGED");
    pins.set(item.path, item.sha256);
  }
  const selected = selectFreshLineage(loadOfflineGeneralPlan(root));
  const entries = names => names.map(fileName => {
    const path = `drizzle/${fileName}`, sql = readPublicFile(root, path), checksum = sha256(sql);
    insist(pins.get(path) === checksum, "BOOTSTRAP_MIGRATION_NOT_PINNED");
    return { fileName, sql, checksum, official: false };
  });
  const insertion = selected.plan.findIndex(item => item.fileName === "0195_parent_asin_weekly_mcp_emperor_projection.sql") + 1;
  insist(insertion > 0 && selected.plan[insertion]?.fileName === "0204_listing_revision_governance.sql", "BOOTSTRAP_INSERTION_POINT_CHANGED");
  const [prerequisite, ...tail] = entries(BOOTSTRAP_FILES);
  const plan = [prerequisite, ...selected.plan.slice(0, insertion), ...entries(MANUAL_FRESH_FILES),
    ...selected.plan.slice(insertion), ...tail].map((item, order) => ({ ...item, order }));
  insist(plan.length === EXPECTED_BOOTSTRAP_PLAN_LENGTH && new Set(plan.map(item => item.fileName)).size === plan.length, "BOOTSTRAP_PLAN_INVALID");
  for (const entry of plan) insist(pins.get(`drizzle/${entry.fileName}`) === entry.checksum, "BOOTSTRAP_MIGRATION_NOT_PINNED");
  const planSha256 = fingerprint(plan.map(item => [item.fileName, item.checksum]));
  insist(planSha256 === manifest.planSha256, "BOOTSTRAP_PLAN_CHANGED");
  insist(Array.isArray(manifest.requiredBusinessTables) && manifest.requiredBusinessTables.length === 302
    && new Set(manifest.requiredBusinessTables).size === 302 && manifest.requiredBusinessTables.every(safeName)
    && !manifest.requiredBusinessTables.includes("app_schema_migrations"), "BOOTSTRAP_TABLE_INVENTORY_INVALID");
  return { version: BOOTSTRAP_VERSION, plan, planSha256, sourcesSha256: fingerprint(manifest.sources),
    manifest, excluded: selected.excluded, root, sourceEvidence };
}

const exactKeys = (object, keys) => object && !Array.isArray(object)
  && JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...keys].sort());
const CONTRACT_SCHEMA = "__fresh_contract__";
const AUTO_INCREMENT = "__dynamic_positive_auto_increment__";

// Catalogs contain ALL physical fields, including raw-SQL indexes/FKs absent
// from Drizzle. A table count or the source projection alone is not a contract.
export function validateCatalog(catalog, expectedNames) {
  insist(exactKeys(catalog, Object.keys(DDL_CATALOG)), "STRUCTURE_CATALOG_INVALID");
  for (const [collection, definition] of Object.entries(DDL_CATALOG)) {
    insist(Array.isArray(catalog[collection]) && catalog[collection].length <= 100_000, "STRUCTURE_CATALOG_INVALID");
    for (const row of catalog[collection]) insist(exactKeys(row, definition.fields)
      && Object.values(row).every(value => value === null || typeof value === "string"
        || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)), "STRUCTURE_CATALOG_FIELD_INVALID");
  }
  const names = catalog.tables.map(table => table.tableName);
  insist(JSON.stringify([...names].sort()) === JSON.stringify([...expectedNames].sort()), "STRUCTURE_TABLE_SET_MISMATCH");
  const normalized = structuredClone(catalog), schema = normalized.schema[0]?.schemaName;
  insist(typeof schema === "string" && safeName(schema), "STRUCTURE_SCHEMA_INVALID");
  const sortFields = { schema: ["schemaName"], tables: ["tableName"], columns: ["tableName", "ordinalPosition"],
    indexes: ["tableName", "indexName", "sequence"], constraints: ["tableName", "constraintName"],
    keyColumns: ["tableName", "constraintName", "ordinalPosition"], foreignKeys: ["tableName", "constraintName"],
    checks: ["tableName", "constraintName"], partitions: ["tableName", "partitionName"], views: ["tableName"],
    triggers: ["triggerName", "tableName"], routines: ["routineName", "routineType"], events: ["eventName"] };
  for (const [name, rows] of Object.entries(normalized)) rows.sort((a, b) => {
    for (const key of sortFields[name]) {
      const difference = ["ordinalPosition", "sequence"].includes(key) ? Number(a[key]) - Number(b[key])
        : String(a[key]).localeCompare(String(b[key]));
      if (difference) return difference;
    }
    return 0;
  });
  validatePhysicalCatalog(normalized, schema);
  normalized.schema[0].schemaName = CONTRACT_SCHEMA;
  for (const row of normalized.keyColumns) if (row.referencedTableSchema !== null) row.referencedTableSchema = CONTRACT_SCHEMA;
  for (const row of normalized.foreignKeys) row.uniqueConstraintSchema = CONTRACT_SCHEMA;
  // Seed INSERTs legitimately advance counters. Preserve the auto_increment
  // column property and require a positive counter; normalize ONLY its value.
  for (const table of normalized.tables) {
    const auto = normalized.columns.filter(column => column.tableName === table.tableName && /\bauto_increment\b/.test(column.extra));
    insist(auto.length <= 1 && (auto.length === 1
      ? table.autoIncrement === AUTO_INCREMENT || /^[1-9][0-9]*$/.test(String(table.autoIncrement))
      : table.autoIncrement === null), "STRUCTURE_AUTO_INCREMENT_INVALID");
    if (auto.length) table.autoIncrement = AUTO_INCREMENT;
  }
  return canonical(normalized);
}

export async function readFreshCatalog(connection, schema) {
  insist(safeName(schema), "STRUCTURE_SCHEMA_INVALID");
  const [names] = await connection.execute("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME", [schema]);
  insist(names.length > 0 && names.length <= 1_000 && names.every(row => safeName(row.tableName)), "STRUCTURE_TABLE_NAMES_INVALID");
  for (const { tableName } of names) {
    const [rows] = await connection.query(`SHOW CREATE TABLE \`${schema}\`.\`${tableName}\``);
    insist(rows.length === 1 && rows[0].Table === tableName, "STRUCTURE_SHOW_CREATE_IDENTITY_INVALID");
    validateTableDdl(rows[0]["Create Table"], tableName);
  }
  await connection.query("SET SESSION information_schema_stats_expiry=0");
  const snapshots = [];
  for (let pass = 0; pass < 2; pass++) {
    const catalog = {};
    for (const [name, definition] of Object.entries(DDL_CATALOG)) {
      const [rows] = await connection.execute(definition.sql, Array((definition.sql.match(/\?/g) ?? []).length).fill(schema));
      catalog[name] = rows;
    }
    snapshots.push(validateCatalog(catalog, names.map(row => row.tableName)));
  }
  insist(fingerprint(snapshots[0]) === fingerprint(snapshots[1]), "STRUCTURE_CHANGED_DURING_VERIFICATION");
  return snapshots[1];
}

// Construction is deliberately separate from approval. The returned JSON must
// be independently reviewed and pinned in manifest.structureContract before it
// can admit execution. Never call this with the candidate bootstrap DB as oracle.
export function buildStructureContract({ bundle, catalog, derivation, platform }) {
  const tableNames = [...bundle.manifest.requiredBusinessTables, "app_schema_migrations"].sort();
  const checked = validateCatalog(catalog, tableNames);
  insist(derivation?.kind === "public-source-projection-plus-reviewed-history" && derivation.candidateDatabaseUsed === false
    && derivation.productionDdlUsed === false && Array.isArray(derivation.tables), "STRUCTURE_DERIVATION_INVALID");
  insist(JSON.stringify(derivation.tables.map(table => table.name).sort()) === JSON.stringify(tableNames), "STRUCTURE_DERIVATION_INCOMPLETE");
  const pins = new Map(bundle.manifest.sources.map(source => [source.path, source.sha256]));
  for (const table of derivation.tables) insist(Array.isArray(table.sources) && table.sources.length > 0
    && table.sources.every(source => pins.get(source.path) === source.sha256), "STRUCTURE_DERIVATION_NOT_PINNED");
  insist(platform?.mysqlMajorMinor === "8.0" && platform.lowerCaseTableNames === 0
    && platform.schemaCharacterSet === "utf8mb4" && ["utf8mb4_bin", "utf8mb4_0900_ai_ci"].includes(platform.schemaCollation),
  "STRUCTURE_PLATFORM_INVALID");
  return canonical({ version: CONTRACT_VERSION, planSha256: bundle.planSha256, sourcesSha256: bundle.sourcesSha256,
    platform, catalog: checked, catalogSha256: fingerprint(checked), derivation });
}

export function loadStructureContract(bundle) {
  const pin = bundle.manifest.structureContract;
  insist(pin?.path === "drizzle/bootstrap/structure-contract.json" && hashPattern.test(pin.sha256), "FULL_STRUCTURE_CONTRACT_NOT_APPROVED");
  const bytes = readPublicFile(bundle.root, pin.path);
  insist(sha256(bytes) === pin.sha256, "STRUCTURE_CONTRACT_FILE_CHANGED");
  return validateStructureContract(JSON.parse(bytes), bundle);
}

export function validateStructureContract(contract, bundle) {
  insist(contract.version === CONTRACT_VERSION && contract.planSha256 === bundle.planSha256
    && contract.sourcesSha256 === bundle.sourcesSha256, "STRUCTURE_CONTRACT_BINDING_MISMATCH");
  const rebuilt = buildStructureContract({ bundle, catalog: contract.catalog, derivation: contract.derivation, platform: contract.platform });
  insist(fingerprint(contract) === fingerprint(rebuilt), "STRUCTURE_CONTRACT_INVALID");
  return rebuilt;
}

export function assertCatalogMatches(actual, contract, bundle) {
  const checked = validateCatalog(actual, [...bundle.manifest.requiredBusinessTables, "app_schema_migrations"]);
  insist(fingerprint(checked) === contract.catalogSha256, "FULL_STRUCTURE_CONTRACT_MISMATCH");
  return { catalogSha256: contract.catalogSha256, tables: checked.tables.length,
    columns: checked.columns.length, indexParts: checked.indexes.length, foreignKeys: checked.foreignKeys.length };
}
