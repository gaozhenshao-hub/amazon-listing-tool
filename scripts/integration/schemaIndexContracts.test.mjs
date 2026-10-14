// Source index contracts plus in-memory negative controls; no production or
// runtime database validation. No server, dotenv, connector or SQL execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test, { before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectSchemaModule } from "./sourceProjection.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { tsImport } = require("tsx/esm/api");
const { sql } = require("drizzle-orm");
const { mysqlTable, int, varchar, text, uniqueIndex, index } = require("drizzle-orm/mysql-core");
const { generateMySQLDrizzleJson, generateMySQLMigration } = require("drizzle-kit/api");
const repo = fileURLToPath(new URL("../../", import.meta.url));
const evidenceTable = "knowledge_distillation_evidence", scheduledTable = "emperor_scheduled_tasks";
const evidenceIndex = "uq_kdistill_evidence_project_source_claim";
const scheduledUnique = "uk_emperor_scheduled_tasks_external_task_uid";
const scheduledManaged = "idx_emperor_scheduled_tasks_workspace_managed";
const migrationPaths = {
  scheduled: "drizzle/0180_emperor_lingxing_scheduled_task_unification.sql",
  evidence: "drizzle/0187_skill_distillation_foundation.sql",
};
const migrationHashes = {
  scheduled: "86128ad785f71aeaff7c2e47a2646892458aa12d1d86256a036f6e5d89635296",
  evidence: "bf6403bdc8d3d84854f79e4dc51fc4973684db6a7ed3c4853474a2727aa73f54",
};
const history = Object.fromEntries(Object.entries(migrationPaths).map(([key, filename]) => [key, fs.readFileSync(path.join(repo, filename), "utf8")]));
const digest = value => createHash("sha256").update(value).digest("hex");
const expected = {
  [evidenceTable]: {
    [evidenceIndex]: { unique: true, columns: [
      { name: "distillationProjectId", prefix: null }, { name: "sourceKey", prefix: null }, { name: "claim", prefix: 191 },
    ] },
  },
  [scheduledTable]: {
    [scheduledUnique]: { unique: true, columns: [{ name: "externalTaskUid", prefix: null }] },
    [scheduledManaged]: { unique: false, columns: [{ name: "workspaceId", prefix: null }, { name: "systemManaged", prefix: null }] },
  },
};

function parseColumn(value) {
  const match = value.trim().match(/^`?([A-Za-z_][A-Za-z0-9_]*)`?(?:\((\d+)\))?$/);
  assert.ok(match, "Only reviewed column names with optional numeric prefix lengths belong to these contracts");
  return { name: match[1], prefix: match[2] ? Number(match[2]) : null };
}

function indexContract(snapshot, tableName, indexName) {
  const entry = snapshot.tables[tableName]?.indexes[indexName];
  return entry ? { unique: entry.isUnique, columns: entry.columns.map(parseColumn) } : null;
}

function diagnoseIndexContracts(snapshot) {
  return Object.entries(expected).flatMap(([tableName, indexes]) => {
    const differences = Object.entries(indexes).flatMap(([indexName, contract]) => {
      const actual = indexContract(snapshot, tableName, indexName);
      return JSON.stringify(actual) === JSON.stringify(contract) ? [] : [{
        code: actual === null ? "INDEX_MISSING" : "INDEX_CONTRACT_MISMATCH", indexName, expected: contract, actual,
      }];
    });
    return differences.length ? [{ tableName, differences }] : [];
  });
}

function candidateTables({ prefix = 191, uniqueUid = true, managedColumnsReversed = false } = {}) {
  const evidence = mysqlTable(evidenceTable, {
    distillationProjectId: int("distillationProjectId").notNull(),
    sourceKey: varchar("sourceKey", { length: 80 }).notNull(),
    claim: text("claim").notNull(),
  }, table => [uniqueIndex(evidenceIndex).on(table.distillationProjectId, table.sourceKey,
    // Prefix is a literal in the application schema. The alternate
    // branch below exists solely to prove the diagnostic catches a wrong prefix.
    prefix === 191 ? sql`${table.claim}(191)` : sql`${table.claim}(190)`)]);
  const scheduled = mysqlTable(scheduledTable, {
    workspaceId: int("workspaceId"),
    systemManaged: int("systemManaged").default(0).notNull(),
    externalTaskUid: varchar("externalTaskUid", { length: 65 }),
  }, table => [
    (uniqueUid ? uniqueIndex : index)(scheduledUnique).on(table.externalTaskUid),
    index(scheduledManaged).on(...(managedColumnsReversed ? [table.systemManaged, table.workspaceId] : [table.workspaceId, table.systemManaged])),
  ]);
  return { evidence, scheduled };
}

let current, candidate, currentDdl, candidateDdl;
const sourceHashes = new Map();
before(async () => {
  // Direct modules import only approved Drizzle builders. Audit before loading, and
  // deliberately do not import the schema index (which has other dependencies).
  const loaded = {};
  for (const filename of ["drizzle/schema/skillDistillation.ts", "drizzle/schema/ai_os.ts"]) {
    const source = fs.readFileSync(path.join(repo, filename), "utf8");
    sourceHashes.set(filename, digest(source));
    assert.deepEqual(inspectSchemaModule(source, filename, ts), []);
    loaded[filename] = await tsImport(pathToFileURL(path.join(repo, filename)).href, { parentURL: import.meta.url, tsconfig: false });
  }
  current = await generateMySQLDrizzleJson({
    evidence: loaded["drizzle/schema/skillDistillation.ts"].knowledgeDistillationEvidence,
    scheduled: loaded["drizzle/schema/ai_os.ts"].emperorScheduledTasks,
  });
  candidate = await generateMySQLDrizzleJson(candidateTables());
  const empty = await generateMySQLDrizzleJson({});
  currentDdl = await generateMySQLMigration(empty, current);
  candidateDdl = await generateMySQLMigration(empty, candidate);
});

test("0180/0187 historical migration bytes remain exactly unchanged", () => {
  for (const key of Object.keys(migrationPaths)) assert.equal(digest(history[key]), migrationHashes[key], migrationPaths[key]);
});

test("historical SQL establishes prefix191, exact index names/order/uniqueness, TEXT and nullable UID", () => {
  const historicalEvidence = history.evidence.match(/UNIQUE KEY `uq_kdistill_evidence_project_source_claim` \((.+)\),/);
  assert.ok(historicalEvidence);
  assert.deepEqual({ unique: true, columns: historicalEvidence[1].split(",").map(parseColumn) }, expected[evidenceTable][evidenceIndex]);
  for (const [name, unique] of [[scheduledUnique, true], [scheduledManaged, false]]) {
    const found = history.scheduled.match(new RegExp(`CREATE ${unique ? "UNIQUE " : ""}INDEX ${name} ON emperor_scheduled_tasks \\(([^;]+)\\);`));
    assert.ok(found, name);
    assert.deepEqual({ unique, columns: found[1].split(",").map(parseColumn) }, expected[scheduledTable][name]);
  }
  assert.match(history.evidence, /`claim` text NOT NULL/);
  assert.match(history.scheduled, /ADD COLUMN externalTaskUid VARCHAR\(65\) NULL/);
});

test("current source indexes match all historical contracts", () => {
  assert.deepEqual(diagnoseIndexContracts(current), []);
});

test("diagnostic still detects the original two gaps when deliberately reintroduced in memory", () => {
  const previousDrift = structuredClone(current);
  previousDrift.tables[evidenceTable].indexes[evidenceIndex].columns[2] = "claim";
  delete previousDrift.tables[scheduledTable].indexes[scheduledUnique];
  delete previousDrift.tables[scheduledTable].indexes[scheduledManaged];
  const diagnostics = diagnoseIndexContracts(previousDrift);
  assert.deepEqual(diagnostics, [
    { tableName: evidenceTable, differences: [{ code: "INDEX_CONTRACT_MISMATCH", indexName: evidenceIndex,
      expected: expected[evidenceTable][evidenceIndex], actual: { unique: true, columns: [
        { name: "distillationProjectId", prefix: null }, { name: "sourceKey", prefix: null }, { name: "claim", prefix: null },
      ] } }] },
    { tableName: scheduledTable, differences: [
      { code: "INDEX_MISSING", indexName: scheduledUnique, expected: expected[scheduledTable][scheduledUnique], actual: null },
      { code: "INDEX_MISSING", indexName: scheduledManaged, expected: expected[scheduledTable][scheduledManaged], actual: null },
    ] },
  ]);
});

test("current empty-to-schema SQL includes claim prefix191 and both exact scheduled indexes", () => {
  const evidence = currentDdl.find(statement => statement.startsWith(`CREATE TABLE \`${evidenceTable}\``));
  assert.match(evidence, /UNIQUE\(`distillationProjectId`,`sourceKey`,`claim`\(191\)\)/);
  assert.equal(currentDdl.filter(statement => statement.includes(scheduledUnique)).length, 1);
  assert.ok(currentDdl.includes("CREATE INDEX `idx_emperor_scheduled_tasks_workspace_managed` ON `emperor_scheduled_tasks` (`workspaceId`,`systemManaged`);"));
});

test("in-memory candidate matches all three historical index contracts without changing TEXT/NULL semantics", () => {
  assert.deepEqual(diagnoseIndexContracts(candidate), []);
  for (const snapshot of [current, candidate]) {
    assert.equal(snapshot.tables[evidenceTable].columns.claim.type, "text");
    assert.equal(snapshot.tables[evidenceTable].columns.claim.notNull, true);
    assert.equal(snapshot.tables[evidenceTable].columns.sourceKey.type, "varchar(80)");
    assert.equal(snapshot.tables[evidenceTable].columns.sourceKey.notNull, true);
    assert.equal(snapshot.tables[evidenceTable].columns.distillationProjectId.notNull, true);
    assert.equal(snapshot.tables[scheduledTable].columns.externalTaskUid.type, "varchar(65)");
    assert.equal(snapshot.tables[scheduledTable].columns.externalTaskUid.notNull, false);
    assert.equal(snapshot.tables[scheduledTable].columns.workspaceId.notNull, false);
    assert.equal(snapshot.tables[scheduledTable].columns.systemManaged.notNull, true);
    assert.equal(Number(snapshot.tables[scheduledTable].columns.systemManaged.default), 0);
  }
});

test("actual and candidate tagged SQL emit historical prefix syntax, not LEFT/hash/truncation or a qualified column", () => {
  const historyShape = history.evidence.match(/UNIQUE KEY `uq_kdistill_evidence_project_source_claim` \((.+)\),/)[1];
  for (const ddl of [currentDdl, candidateDdl]) {
    const evidence = ddl.find(statement => statement.startsWith(`CREATE TABLE \`${evidenceTable}\``));
    const shape = evidence.match(/CONSTRAINT `uq_kdistill_evidence_project_source_claim` UNIQUE\((.+)\)/);
    assert.ok(shape);
    assert.equal(shape[1], historyShape);
    assert.match(evidence, /`claim` text NOT NULL/);
    assert.doesNotMatch(evidence, /LEFT\(|(?:MD5|SHA\d*)\(|`claim` varchar|`knowledge_distillation_evidence`\.`claim`|\(\(`claim`/i);
  }
});

test("candidate scheduled indexes retain original names and order; unique folds into CREATE TABLE", () => {
  const scheduled = candidateDdl.find(statement => statement.startsWith(`CREATE TABLE \`${scheduledTable}\``));
  assert.match(scheduled, /CONSTRAINT `uk_emperor_scheduled_tasks_external_task_uid` UNIQUE\(`externalTaskUid`\)/);
  assert.match(scheduled, /`externalTaskUid` varchar\(65\),/);
  assert.equal(candidateDdl.filter(statement => statement.startsWith("CREATE INDEX")).length, 1);
  assert.ok(candidateDdl.includes("CREATE INDEX `idx_emperor_scheduled_tasks_workspace_managed` ON `emperor_scheduled_tasks` (`workspaceId`,`systemManaged`);"));
  assert.equal(candidateDdl.length, 3); // Two table CREATEs plus one non-unique index.
});

test("diagnostics also reject wrong prefix, lost uniqueness and reversed managed index order", async () => {
  for (const [settings, tableName, indexName] of [
    [{ prefix: 190 }, evidenceTable, evidenceIndex],
    [{ uniqueUid: false }, scheduledTable, scheduledUnique],
    [{ managedColumnsReversed: true }, scheduledTable, scheduledManaged],
  ]) {
    const changed = await generateMySQLDrizzleJson(candidateTables(settings));
    const diagnostics = diagnoseIndexContracts(changed);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].tableName, tableName);
    assert.equal(diagnostics[0].differences.length, 1);
    assert.equal(diagnostics[0].differences[0].indexName, indexName);
    assert.equal(diagnostics[0].differences[0].code, "INDEX_CONTRACT_MISMATCH");
  }
});

test("read-only test leaves both source files and migrations unchanged and makes no production validation claim", () => {
  for (const key of Object.keys(migrationPaths)) assert.equal(digest(fs.readFileSync(path.join(repo, migrationPaths[key]))), migrationHashes[key]);
  // Re-audit direct declarations; no runtime import of server/schema-index paths.
  for (const filename of ["drizzle/schema/skillDistillation.ts", "drizzle/schema/ai_os.ts"]) {
    const source = fs.readFileSync(path.join(repo, filename), "utf8");
    assert.equal(digest(source), sourceHashes.get(filename));
    assert.deepEqual(inspectSchemaModule(source, filename, ts), []);
  }
  assert.deepEqual(diagnoseIndexContracts(current), []);
});
