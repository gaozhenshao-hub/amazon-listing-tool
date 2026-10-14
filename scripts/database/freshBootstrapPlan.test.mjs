// Pure source/contract tests. No database, model, HTTP or executable schema import.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { BOOTSTRAP_FILES, MANUAL_FRESH_FILES, RECEIPT_MIGRATION, assertCatalogMatches,
  fingerprint, loadFreshBootstrapPlan, loadStructureContract, readPublicFile, sha256, validateCatalog,
  validateStructureContract } from "./freshBootstrapPlan.mjs";
import { catalogFixture, contractFixture } from "./freshBootstrapFixtures.test-helper.mjs";

const bundle = loadFreshBootstrapPlan();
const code = expected => error => error.code === expected;

test("plan is inert under an inherited database URL and never loads an execution dependency", () => {
  const result = spawnSync(process.execPath, ["scripts/bootstrap-fresh-database.mjs", "--plan"], {
    cwd: bundle.root, encoding: "utf8", timeout: 15_000,
    env: { PATH: process.env.PATH, DATABASE_URL: "must-not-connect", FRESH_BOOTSTRAP_DATABASE_URL: "must-not-connect" },
  });
  assert.equal(result.status, 0); assert.equal(result.stderr, "");
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.databaseConnected, false); assert.equal(plan.migrationCount, 176);
  assert.equal(plan.structureContractBound, Boolean(bundle.manifest.structureContract));
  assert.equal(plan.sourcesSha256, bundle.sourcesSha256);
});

test("176 real entries retain the 165 lineage, insert 0196–0203 exactly after 0195, and exclude alternatives/drafts", () => {
  const names = bundle.plan.map(item => item.fileName), index = names.indexOf("0195_parent_asin_weekly_mcp_emperor_projection.sql");
  assert.equal(names[0], RECEIPT_MIGRATION);
  assert.deepEqual(names.slice(index + 1, index + 9), MANUAL_FRESH_FILES);
  assert.equal(names[index + 9], "0204_listing_revision_governance.sql");
  assert.deepEqual(names.slice(-2), BOOTSTRAP_FILES.slice(1));
  assert.equal(bundle.excluded.length, 3);
  assert.ok(names.every(name => !/^019[123]_|^020[67]_/.test(name)));
  assert.equal(fingerprint(bundle.plan.map(item => [item.fileName, sha256(item.sql)])), bundle.planSha256);
  assert.ok(bundle.plan.every((item, index) => item.order === index));
});

test("bootstrap SQL has strict prerequisite/table/20-column operations without seeds or silent skip", () => {
  const newSql = bundle.plan.filter(item => item.fileName.startsWith("bootstrap/"));
  assert.equal(newSql.length, 3);
  for (const item of newSql) assert.doesNotMatch(item.sql.replace(/^--.*$/gm, ""), /\b(?:IF NOT EXISTS|INSERT INTO|REPLACE INTO|DROP TABLE)\b/i);
  assert.equal([...newSql[2].sql.matchAll(/ADD COLUMN/g)].length, 20);
  assert.doesNotMatch(newSql[0].sql, /`workspaceId`|`triggerMode`|`lastBatchId`/);
  for (const source of bundle.manifest.sources) assert.equal(sha256(readPublicFile(bundle.root, source.path)), source.sha256);
  assert.equal(bundle.manifest.skillSeeds.find(seed => seed.slug.endsWith("gallery.summary")).version, 2);
});

test("unapproved structure is a pre-connection blocker, not a fabricated complete catalog", () => {
  const unapproved = { ...bundle, manifest: { ...bundle.manifest, structureContract: null } };
  assert.throws(() => loadStructureContract(unapproved), code("FULL_STRUCTURE_CONTRACT_NOT_APPROVED"));
  for (const path of ["../secrets", "drizzle/../secret", "/tmp/a", "drizzle//schema.ts"])
    assert.throws(() => readPublicFile(bundle.root, path), code("PUBLIC_SOURCE_PATH_INVALID"));
});

test("full contract supports a fixed public-derived catalog and binds both plan and all sources", () => {
  const contract = contractFixture();
  assert.deepEqual(validateStructureContract(contract, bundle), contract);
  assert.equal(contract.catalog.tables.length, 303); assert.equal(contract.catalog.columns.length, 303);
  assert.equal(assertCatalogMatches(catalogFixture(), contract, bundle).tables, 303);
  for (const field of ["planSha256", "sourcesSha256", "catalogSha256"]) {
    const bad = structuredClone(contract); bad[field] = "0".repeat(64);
    assert.throws(() => validateStructureContract(bad, bundle));
  }
  for (const flag of ["candidateDatabaseUsed", "productionDdlUsed"]) {
    const bad = structuredClone(contract); bad.derivation[flag] = true;
    assert.throws(() => validateStructureContract(bad, bundle), code("STRUCTURE_DERIVATION_INVALID"));
  }
  const missing = structuredClone(contract); missing.derivation.tables.pop();
  assert.throws(() => validateStructureContract(missing, bundle), code("STRUCTURE_DERIVATION_INCOMPLETE"));
});

test("approved fixed JSON contract actually loads; byte tampering or invalid binding is refused", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "fresh-contract-unit-"));
  try {
    mkdirSync(join(root, "drizzle/bootstrap"), { recursive: true });
    const path = "drizzle/bootstrap/structure-contract.json", contract = contractFixture(), bytes = JSON.stringify(contract);
    writeFileSync(join(root, path), bytes);
    const pinned = { ...bundle, root, manifest: { ...bundle.manifest, structureContract: { path, sha256: sha256(bytes) } } };
    assert.deepEqual(loadStructureContract(pinned), contract);
    writeFileSync(join(root, path), bytes + "\n");
    assert.throws(() => loadStructureContract(pinned), code("STRUCTURE_CONTRACT_FILE_CHANGED"));
    writeFileSync(join(root, path), bytes);
    assert.throws(() => loadStructureContract({ ...pinned, planSha256: "0".repeat(64) }), code("STRUCTURE_CONTRACT_BINDING_MISMATCH"));
  } finally { rmSync(root, { recursive: true }); }
});

test("equal table counts cannot conceal missing/extra tables or column/index/FK/table-option drift", () => {
  const contract = contractFixture();
  for (const change of [catalog => catalog.tables[0].tableName = "unexpected_table",
    catalog => catalog.columns[0].columnDefault = "changed", catalog => catalog.columns[0].isNullable = "YES",
    catalog => catalog.columns[0].extra = "", catalog => catalog.indexes[0].nonUnique = 1,
    catalog => catalog.indexes[0].prefixLength = 8, catalog => catalog.indexes[0].indexName = "different",
    catalog => catalog.tables[0].collationName = "utf8mb4_bin", catalog => catalog.tables[0].createOptions = "ROW_FORMAT=COMPACT",
    catalog => catalog.tables[0].tableComment = "changed", catalog => catalog.constraints.pop(),
    catalog => catalog.foreignKeys.push({ tableName: catalog.tables[0].tableName, constraintName: "fk_new",
      uniqueConstraintSchema: "amazon_listing_ci", uniqueConstraintName: "PRIMARY", referencedTableName: catalog.tables[1].tableName,
      matchOption: "NONE", updateRule: "RESTRICT", deleteRule: "CASCADE" })]) {
    const actual = catalogFixture(); change(actual);
    assert.throws(() => assertCatalogMatches(actual, contract, bundle));
  }
});

test("only schema identity and valid dynamic counter values normalize; extra fields/objects are refused", () => {
  const contract = contractFixture(), actual = catalogFixture("amazon_fresh_0123456789abcdef_synthetic");
  actual.tables[0].autoIncrement = 200;
  assert.equal(assertCatalogMatches(actual, contract, bundle).catalogSha256, contract.catalogSha256);
  for (const change of [catalog => catalog.tables[0].autoIncrement = null, catalog => catalog.tables[0].autoIncrement = 0,
    catalog => catalog.columns[0].extra = "", catalog => catalog.columns[0].newUnknownField = "x",
    catalog => catalog.views.push({ tableName: "new_view" }), catalog => catalog.events.push({ eventName: "new_event" }),
    catalog => delete catalog.foreignKeys]) {
    const bad = catalogFixture(); change(bad);
    assert.throws(() => validateCatalog(bad, [...bundle.manifest.requiredBusinessTables, "app_schema_migrations"]));
  }
});
