// Pure synthetic snapshots/statements and pinned public bytes; no Drizzle CLI or DB.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { EXCLUDED_TABLES, PROJECTION_VERSION, selectProjectionTables } from "./sourceProjection.mjs";
import {
  ASSISTANT_PARTITION_TABLES, ASSISTANT_PROJECTION_PINS, buildAssistantProjectionPartition,
  exportAssistantProjectionPartition, main, selectAssistantProjectionExports,
  validateAssistantProjectionSources, validateAssistantStatementPartition,
} from "./assistantProjectionPartition.mjs";

const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
const sha256 = value => createHash("sha256").update(value).digest("hex");
const code = value => error => error.code === `ASSISTANT_PARTITION_${value}`;
const clone = value => structuredClone(value);
const sources = Object.fromEntries(["dedicatedSql", "assistantSchema", "indexSource"].map(name => [name, readFileSync(join(root, ASSISTANT_PROJECTION_PINS[name].path), "utf8")]));
const manifest = JSON.parse(readFileSync(join(root, "drizzle/bootstrap/manifest.json"), "utf8"));
const sourcePaths = [...new Set([...manifest.sources.filter(item => item.path.startsWith("drizzle/schema/") || item.path === "server/domains/ops/workspaceContext.ts").map(item => item.path), ASSISTANT_PROJECTION_PINS.assistantSchema.path])];
const sourceFiles = sourcePaths.map(path => ({ path, sha256: sha256(readFileSync(join(root, path))) })).sort((a, b) => a.path.localeCompare(b.path));
const table = name => ({ table: true, name });
const isTable = value => value.table === true;
const getTableName = value => value.name;
function inputs() {
  const namespace = Object.create(null); namespace.hidden = table("not_a_direct_export");
  return {
    exports: {
      ...Object.fromEntries(Array.from({ length: ASSISTANT_PROJECTION_PINS.baseTableCount }, (_, index) => [`base${index}`, table(`base_${index}`)])),
      arbitraryAssistantAlias: table("emperor_assistant_configurations"),
      anotherAssistantAlias: table("emperor_assistant_configuration_versions"),
      ...Object.fromEntries(EXCLUDED_TABLES.map((name, index) => [`draft${index}`, table(name)])),
      namespace, nonTable: "ignored",
    },
    isTable, getTableName, sourceFiles: clone(sourceFiles), versions: { node: "synthetic", drizzleKit: "synthetic" },
    generateSnapshot: async tables => ({ tables }),
    generateMigration: async () => ["CREATE TABLE `synthetic` (`id` int)"],
    assertUnchanged: () => {},
  };
}
const unique = {
  emperor_assistant_configurations: "CONSTRAINT `uq_assistant_configuration_scope` UNIQUE(`workspaceId`,`agentKey`)",
  emperor_assistant_configuration_versions: "CONSTRAINT `uq_assistant_configuration_version_scope` UNIQUE(`workspaceId`,`agentKey`,`revision`)",
};
function deltaCreate(name) {
  return `CREATE TABLE \`${name}\` (\n\t\`id\` int NOT NULL,\n\t\`workspaceId\` int NOT NULL,\n\t\`agentKey\` varchar(32) NOT NULL,\n\t\`revision\` int NOT NULL,\n\tCONSTRAINT \`${name}_id\` PRIMARY KEY(\`id\`),\n\t${unique[name]}\n)`;
}
function projection(statements, override = {}) {
  const sql = "-- SOURCE-DERIVED PROJECTION ONLY; NOT A PRODUCTION CLONE OR MIGRATION LEDGER.\n"
    + `-- ${PROJECTION_VERSION}; excludes dedicated 0206/0207 tables; no business data or seeds.\n`
    + `${statements.join(";\n\n")};\n`;
  const tableNames = [...new Set(statements.flatMap(statement => /^CREATE TABLE `([^`]+)`/.exec(statement)?.[1] ?? []))].sort();
  return { sql, metadata: { sqlSha256: sha256(sql), tableNames, tableCount: tableNames.length, ddlCount: statements.length, excludedTables: EXCLUDED_TABLES, ...override } };
}
function fixture({ baseStatements, deltaStatements, fullStatements } = {}) {
  const base = baseStatements ?? ["CREATE TABLE `users` (`id` int NOT NULL)", "CREATE TABLE `projects` (`id` int NOT NULL)", "CREATE INDEX `idx_users_id` ON `users` (`id`)"];
  const delta = deltaStatements ?? ASSISTANT_PARTITION_TABLES.map(deltaCreate);
  const full = fullStatements ?? [...base.slice(0, 1), ...delta.slice(0, 1), ...base.slice(1), ...delta.slice(1)];
  return { full: projection(full), base: projection(base), delta: projection(delta) };
}

test("binds all three reviewed public source pins and proves only the explicit source-vector ancestry", () => {
  const identity = validateAssistantProjectionSources(sourceFiles, sources);
  assert.equal(sourceFiles.length, 19);
  assert.equal(identity.actualSourceSha256, sha256(JSON.stringify(sourceFiles)));
  assert.equal(identity.historicalSourceSha256, ASSISTANT_PROJECTION_PINS.historicalSourceSha256);
  assert.notEqual(identity.actualSourceSha256, identity.historicalSourceSha256);
  assert.ok(sourceFiles.some(item => item.path === ASSISTANT_PROJECTION_PINS.assistantSchema.path));
});

test("rejects changed dedicated SQL, schema or index bytes before any projection generation", async () => {
  for (const name of ["dedicatedSql", "assistantSchema", "indexSource"]) {
    let generated = 0;
    await assert.rejects(buildAssistantProjectionPartition({ ...inputs(), generateSnapshot: async () => { generated++; return {}; } }, { ...sources, [name]: `${sources[name]}\n` }), code("SOURCE_PIN_CHANGED"));
    assert.equal(generated, 0);
  }
});

test("rejects truncated, duplicate, reordered, unsafe or repinned source vectors", () => {
  assert.throws(() => validateAssistantProjectionSources(sourceFiles.slice(1), sources), code("SOURCE_VECTOR_INVALID"));
  const duplicate = clone(sourceFiles); duplicate[1] = clone(duplicate[0]);
  assert.throws(() => validateAssistantProjectionSources(duplicate, sources), code("SOURCE_VECTOR_INVALID"));
  const reordered = clone(sourceFiles); [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(() => validateAssistantProjectionSources(reordered, sources), code("SOURCE_VECTOR_ORDER_CHANGED"));
  const unsafe = clone(sourceFiles); unsafe[0].path = "../private-input";
  assert.throws(() => validateAssistantProjectionSources(unsafe, sources), code("SOURCE_VECTOR_INVALID"));
  const changed = clone(sourceFiles); changed[0].sha256 = "0".repeat(64);
  assert.throws(() => validateAssistantProjectionSources(changed, sources), code("HISTORICAL_SOURCE_VECTOR_CHANGED"));
  for (const pin of [ASSISTANT_PROJECTION_PINS.assistantSchema, ASSISTANT_PROJECTION_PINS.indexSource]) {
    const wrongPin = clone(sourceFiles); wrongPin.find(item => item.path === pin.path).sha256 = "0".repeat(64);
    assert.throws(() => validateAssistantProjectionSources(wrongPin, sources), code("SOURCE_VECTOR_PIN_CHANGED"));
  }
});

test("partitions actual physical assistant exports and retains all five real excluded definitions for every build", () => {
  const input = inputs(), selected = selectAssistantProjectionExports(input);
  for (const [member, expected] of [["full", 289], ["base", 287], ["delta", 2]]) {
    const result = selectProjectionTables(selected[member], isTable, getTableName);
    assert.equal(result.tableNames.length, expected);
    assert.deepEqual(result.excludedTables, EXCLUDED_TABLES);
  }
  assert.ok(!Object.hasOwn(selected.base, "arbitraryAssistantAlias"));
  assert.ok(Object.hasOwn(selected.delta, "arbitraryAssistantAlias"));
  assert.equal(Object.isFrozen(EXCLUDED_TABLES), true);
  assert.deepEqual(selectProjectionTables(selected.delta, isTable, getTableName).tableNames, ASSISTANT_PARTITION_TABLES);
});

test("rejects new, missing and duplicate physical table exports instead of broad exclusions", () => {
  const extra = inputs(); extra.exports.unreviewed = table("additional_feature");
  assert.throws(() => selectAssistantProjectionExports(extra), code("TABLE_SET_CHANGED"));
  const missing = inputs(); delete missing.exports.arbitraryAssistantAlias;
  assert.throws(() => selectAssistantProjectionExports(missing), code("TABLE_SET_CHANGED"));
  const duplicate = inputs(); duplicate.exports.duplicate = table("emperor_assistant_configurations");
  assert.throws(() => selectAssistantProjectionExports(duplicate), /DUPLICATE_TABLE_EXPORT/);
  const missingExcluded = inputs(); delete missingExcluded.exports.draft0;
  assert.throws(() => selectAssistantProjectionExports(missingExcluded), /DRAFT_EXCLUSION_SOURCE_CHANGED/);
});

test("synthetic SQL can never override the production base whole-byte identity", async () => {
  let snapshots = 0;
  await assert.rejects(buildAssistantProjectionPartition({ ...inputs(), generateSnapshot: async tables => { snapshots++; return { tables }; } }, sources), code("BASE_BYTES_CHANGED"));
  assert.equal(snapshots, 6);
  assert.equal(ASSISTANT_PROJECTION_PINS.baseTableCount, 287);
  assert.equal(ASSISTANT_PROJECTION_PINS.baseDdlCount, 406);
  assert.equal(ASSISTANT_PROJECTION_PINS.baseSqlSha256, "c2ea534b048427e7b3b464dd37ec442524cf5e8dd1ec80fac3e514259957a6aa");
});

test("a loader freshness failure stops before source processing or generation", async () => {
  let generated = false;
  await assert.rejects(buildAssistantProjectionPartition({ ...inputs(), assertUnchanged: () => { throw new Error("changed-source"); }, generateSnapshot: async () => { generated = true; return {}; } }, sources), /changed-source/);
  assert.equal(generated, false);
});

test("proves exact raw executable statement bytes and each partition's relative order", () => {
  const input = fixture(), vectors = validateAssistantStatementPartition(input);
  assert.equal(vectors.full.length, vectors.base.length + vectors.delta.length);
  assert.equal(vectors.delta.length, 2);
  assert.deepEqual(vectors.full.filter(item => ASSISTANT_PARTITION_TABLES.includes(item.tableName)).map(item => item.sql), vectors.delta.map(item => item.sql));
  assert.ok(vectors.full.every(item => item.sha256 === sha256(item.sql)));
  assert.ok(vectors.full.every(item => !item.sql.includes("Synthetic statements")));
});

test("refuses whitespace changes and order changes even when SQL remains semantically equivalent", () => {
  const base = ["CREATE TABLE `users` (`id` int NOT NULL)", "CREATE TABLE `projects` (`id` int NOT NULL)"];
  const delta = ASSISTANT_PARTITION_TABLES.map(deltaCreate);
  assert.throws(() => validateAssistantStatementPartition(fixture({ baseStatements: base, deltaStatements: delta, fullStatements: [base[0].replace("int NOT", "int  NOT"), ...delta, base[1]] })), code("STATEMENT_PARTITION_CHANGED"));
  assert.throws(() => validateAssistantStatementPartition(fixture({ baseStatements: base, deltaStatements: delta, fullStatements: [base[1], ...delta, base[0]] })), code("STATEMENT_PARTITION_CHANGED"));
});

test("rejects body comments instead of erasing raw statement byte differences", () => {
  const base = ["CREATE TABLE `users` (`id` int NOT NULL)"], delta = ASSISTANT_PARTITION_TABLES.map(deltaCreate);
  for (const comment of ["/* removed by comparison */", "/*! executable */", "/*+ hint */", "-- removed by comparison\n", "# removed by comparison\n"]) {
    const changed = base[0].replace("int NOT", `int${comment}NOT`);
    assert.throws(() => validateAssistantStatementPartition(fixture({ baseStatements: base, deltaStatements: delta, fullStatements: [changed, ...delta] })), code("GENERATED_BODY_COMMENT"));
  }
  const literal = "CREATE TABLE `users` (`id/* literal */` int COMMENT '/* literal */ -- literal # literal', `name-- literal #` varchar(20) DEFAULT 'it''s /* data */')";
  assert.doesNotThrow(() => validateAssistantStatementPartition(fixture({ baseStatements: [literal] })));
  const changedHeader = fixture(); changedHeader.full.sql = changedHeader.full.sql.replace("-- SOURCE-DERIVED", "-- Changed SOURCE-DERIVED");
  changedHeader.full.metadata.sqlSha256 = sha256(changedHeader.full.sql);
  assert.throws(() => validateAssistantStatementPartition(changedHeader), code("GENERATED_FRAMING_CHANGED"));
});

test("refuses extra, unknown, missing, duplicate or overlapping DDL", () => {
  const base = ["CREATE TABLE `users` (`id` int NOT NULL)"];
  const delta = ASSISTANT_PARTITION_TABLES.map(deltaCreate);
  assert.throws(() => validateAssistantStatementPartition(fixture({ baseStatements: base, fullStatements: [...base, ...delta, "DROP TABLE `users`"] })), code("UNKNOWN_DDL"));
  assert.throws(() => validateAssistantStatementPartition(fixture({ baseStatements: base, fullStatements: [...base, ...delta, "CREATE INDEX `extra` ON `foreign_table` (`id`)"] })), code("UNKNOWN_TABLE_DDL"));
  assert.throws(() => validateAssistantStatementPartition(fixture({ baseStatements: base, fullStatements: [...base, ...delta, "CREATE INDEX `extra` ON `users` (`id`)"] })), code("STATEMENT_PARTITION_CHANGED"));
  assert.throws(() => validateAssistantStatementPartition(fixture({ baseStatements: base, fullStatements: [...base, ...delta, delta[0]] })), code("DUPLICATE_DDL"));
  assert.throws(() => validateAssistantStatementPartition(fixture({ baseStatements: [...base, delta[0]] })), code("DELTA_TABLE_SET_CHANGED"));
  const missing = fixture({ baseStatements: base });
  missing.base = projection([], { tableNames: ["users"], tableCount: 1, ddlCount: 1 });
  assert.throws(() => validateAssistantStatementPartition(missing), code("PROJECTION_IDENTITY_INVALID"));
  const missingCreate = fixture({ baseStatements: ["CREATE TABLE `users` (`id` int NOT NULL)"] });
  missingCreate.base = projection(["CREATE INDEX `only_index` ON `users` (`id`)"], { tableNames: ["users"], tableCount: 1 });
  assert.throws(() => validateAssistantStatementPartition(missingCreate), code("MISSING_TABLE_DDL"));
});

test("rejects cross-partition and unknown references, while preserving literal text mentioning references", () => {
  const literals = fixture({ baseStatements: ["CREATE TABLE `users` (`id` int COMMENT 'REFERENCES foreign_table(id)')"] });
  assert.doesNotThrow(() => validateAssistantStatementPartition(literals));
  for (const target of ["emperor_assistant_configurations", "foreign_table"]) {
    assert.throws(() => validateAssistantStatementPartition(fixture({ baseStatements: [`CREATE TABLE \`users\` (\`id\` int, FOREIGN KEY (\`id\`) REFERENCES \`${target}\` (\`id\`))`] })), code("CROSS_OR_UNKNOWN_REFERENCE"));
  }
  const delta = ASSISTANT_PARTITION_TABLES.map(deltaCreate);
  delta[0] = delta[0].replace(/\n\)$/, ",\nFOREIGN KEY (`id`) REFERENCES `users` (`id`)\n)");
  assert.throws(() => validateAssistantStatementPartition(fixture({ deltaStatements: delta })), code("CROSS_OR_UNKNOWN_REFERENCE"));
});

test("requires the exact delta unique indexes with their columns and rejects duplicate or unknown constraints", () => {
  const name = ASSISTANT_PARTITION_TABLES[0], original = deltaCreate(name);
  for (const changed of [
    original.replace(unique[name], unique[name].replace("`workspaceId`,`agentKey`", "`agentKey`,`workspaceId`")),
    original.replace(unique[name], unique[name].replace("uq_assistant_configuration_version_scope", "unreviewed_index")),
    original.replace(`,\n\t${unique[name]}`, ""),
    original.replace(unique[name], `${unique[name]},\n\t${unique[name]}`),
    original.replace(unique[name], `${unique[name]},\n\tUNIQUE(\`revision\`)`),
    original.replace(unique[name], `${unique[name]},\n\tKEY \`unreviewed\` (\`revision\`)`),
  ]) {
    const delta = [changed, deltaCreate(ASSISTANT_PARTITION_TABLES[1])];
    assert.throws(() => validateAssistantStatementPartition(fixture({ deltaStatements: delta })), error => /ASSISTANT_PARTITION_DELTA_INDEX_/.test(error.code));
  }
});

test("attributes separately emitted unique indexes without hardcoding a delta DDL count", () => {
  const delta = ASSISTANT_PARTITION_TABLES.map(name => deltaCreate(name).replace(`,\n\t${unique[name]}`, ""));
  delta.push("CREATE UNIQUE INDEX `uq_assistant_configuration_scope` ON `emperor_assistant_configurations` (`workspaceId`,`agentKey`)");
  delta.push("CREATE UNIQUE INDEX `uq_assistant_configuration_version_scope` ON `emperor_assistant_configuration_versions` (`workspaceId`,`agentKey`,`revision`)");
  assert.equal(validateAssistantStatementPartition(fixture({ deltaStatements: delta })).delta.length, 4);
});

test("does not accept changed inherited exclusions or forged SQL metadata", () => {
  const exclusions = fixture(); exclusions.base.metadata.excludedTables = [...EXCLUDED_TABLES, ...ASSISTANT_PARTITION_TABLES];
  assert.throws(() => validateAssistantStatementPartition(exclusions), code("EXCLUSIONS_CHANGED"));
  const forged = fixture(); forged.full.metadata.sqlSha256 = "0".repeat(64);
  assert.throws(() => validateAssistantStatementPartition(forged), code("PROJECTION_IDENTITY_INVALID"));
});

test("CLI arguments provide no exclude/apply/database escape and help stays inert", async () => {
  for (const args of [["--exclude", "users"], ["--apply"], ["--database-url", "synthetic-secret"], ["--repo-root", root, "--out-dir", "/tmp/synthetic", "--socket", "/tmp/socket"]]) {
    const result = await main(args);
    assert.equal(result.exitCode, 1);
    assert.equal(result.output.error, "CLI_ARGUMENTS_INVALID");
    assert.equal(result.output.DBExecutions, 0);
    assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
  }
  const result = await main(["--help"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.approvedForExecution, false);
  assert.equal(result.output.databaseConnected, false);
});

test("rejects another checkout or an output inside this checkout before loading real projection inputs", async () => {
  await assert.rejects(exportAssistantProjectionPartition({ repoRoot: dirname(root), outputDirectory: "/tmp/not-created" }), /REPO_MUST_MATCH_TOOL_CHECKOUT/);
  await assert.rejects(exportAssistantProjectionPartition({ repoRoot: root, outputDirectory: join(root, "must-not-create") }), /OUTPUT_MUST_BE_OUTSIDE_CHECKOUT/);
});
