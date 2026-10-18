import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { CATALOG_SELECTS, EXPECTED_SCHEMA, LIMITS, TABLES, inspectAssistantRegistry, main, parseArguments, validateManagedUri } from "./readAssistantRegistryDiscovery.mjs";

const args = ["--inspect-read-only", "--expected-schema", EXPECTED_SCHEMA];
const options = parseArguments(args);
const uri = "mysql://synthetic:never-real@invalid.test/amz_listing";
const clone = value => structuredClone(value);
const metadataRow = (name, values) => ({ ...Object.fromEntries(CATALOG_SELECTS[name].fields.map(field => [field, null])), ...values });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function snapshot() {
  const columns = {
    emperor_skills: { id: "int", workspaceId: "int", slug: "varchar", scope: "enum", status: "enum", version: "int", manifest: "json" },
    emperor_model_providers: { id: "int", workspaceId: "int", slug: "varchar", modelId: "varchar", isActive: "int", apiKeyRef: "varchar", baseUrl: "varchar" },
    emperor_assistant_configurations: { workspaceId: "int", agentKey: "varchar", revision: "int", configHash: "char", config: "json" },
    emperor_agent_library: { workspaceId: "int", agentKey: "varchar", revision: "int", config: "json" },
  };
  return {
    catalog: {
      schema: [{ schemaName: EXPECTED_SCHEMA }],
      tables: TABLES.map(tableName => ({ tableName, tableType: "BASE TABLE", engine: "InnoDB" })),
      columns: TABLES.flatMap(tableName => Object.entries(columns[tableName]).map(([columnName, dataType], index) => metadataRow("columns", { tableName, columnName, dataType, ordinalPosition: index + 1, nullable: "NO" }))),
      indexes: TABLES.map(tableName => metadataRow("indexes", { tableName, indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "workspaceId", indexType: "BTREE", visible: "YES", expressionPresent: 0 })),
    },
    groups: {
      emperor_skills: [{ workspaceId: null, scope: "global", status: "Released", rowCount: "2" }],
      emperor_model_providers: [{ workspaceId: null, isActive: 1, rowCount: "1" }],
      emperor_assistant_configurations: [{ workspaceId: 11, rowCount: "1" }],
      emperor_agent_library: [{ workspaceId: 17, rowCount: "1" }],
    },
    skills: ["agent.library.route", "agent.library.coach"].map((slug, index) => ({ id: index + 1, workspaceId: null, scope: "global", slug, status: "Released", version: 1, manifestBytes: 100, manifestSha256: "a".repeat(64) })),
    models: [{ id: 1, workspaceId: null, slug: "model-demo", modelId: "provider/demo-v1", isActive: 1, credentialReferenceIsControlled: 1 }],
    configurations: {
      emperor_assistant_configurations: [{ workspaceId: 11, agentKey: "listing", revision: 5, hashPresent: 1 }],
      emperor_agent_library: [{ workspaceId: 17, agentKey: "listing", revision: 0, hashPresent: null }],
    },
  };
}

function fixture(setup = {}) {
  const first = setup.first ?? snapshot(), second = setup.second ?? clone(first);
  let pass = -1, destroyed = 0, loads = 0;
  const calls = [], configs = [];
  const connection = {
    async query(config, values) {
      calls.push({ ...config, values });
      if (setup.onQuery) await setup.onQuery(config.sql);
      if (config.sql === "SELECT DATABASE() AS schemaName,@@version AS version") return [[{ schemaName: EXPECTED_SCHEMA, version: "8.0.44", ...setup.identity }]];
      if (config.sql === "START TRANSACTION READ ONLY") { pass++; return [[]]; }
      if (config.sql === "ROLLBACK") { if (setup.failRollback) throw new Error("private rollback text"); return [[]]; }
      if (config.sql.startsWith("SET SESSION ")) return [[]];
      const current = pass === 0 ? first : second;
      const catalog = Object.entries(CATALOG_SELECTS).find(([, definition]) => definition.sql === config.sql);
      if (catalog) return [clone(current.catalog[catalog[0]])];
      const table = TABLES.find(value => config.sql.includes(`FROM \`${EXPECTED_SCHEMA}\`.\`${value}\``));
      assert.ok(table, `Unexpected query: ${config.sql}`);
      if (config.sql.includes("COUNT(*)")) return [clone(current.groups[table])];
      if (table === "emperor_skills") return [clone(current.skills)];
      if (table === "emperor_model_providers") return [clone(current.models)];
      return [clone(current.configurations[table])];
    },
    destroy() { destroyed++; if (setup.failDestroy) throw new Error("private cleanup text"); },
  };
  return { calls, configs, destroyed: () => destroyed, loads: () => loads,
    dependencies: { environment: { DATABASE_URL: uri }, ...(setup.timeouts ? { timeouts: setup.timeouts } : {}),
      load: async () => { loads++; return async config => { configs.push(config); if (setup.connectionDelay) await sleep(setup.connectionDelay); return connection; }; } },
  };
}

test("both explicit fixed scope flags required; no guessing or additional flags", async () => {
  assert.deepEqual(parseArguments(args), { inspectReadOnly: true, expectedSchema: EXPECTED_SCHEMA });
  for (const invalid of [[], ["--inspect-read-only"], ["--expected-schema", EXPECTED_SCHEMA], [...args, "--workspace", "11"], [...args, "--inspect-read-only"], [...args, "--expected-schema", EXPECTED_SCHEMA], ["--inspect-read-only", "--expected-schema", "other"], ["--inspect-read-only", "--expected-schema", "AMZ_LISTING"]]) assert.throws(() => parseArguments(invalid));
  for (const invalid of [{ expectedSchema: EXPECTED_SCHEMA }, { ...options, expectedSchema: "other" }]) {
    const fake = fixture(); await assert.rejects(inspectAssistantRegistry(invalid, fake.dependencies)); assert.equal(fake.loads(), 0);
  }
});

test("managed URL rejects driver overrides and scope mismatches before connector loading", async () => {
  for (const suffix of ["?multipleStatements=true", "?debug=true", "?rowsAsArray=true", "?flags=MULTI_STATEMENTS", "?host=other", "?database=other", "?uri=other", "?timezone=private", "?ssl=true", "?charset=utf8mb4&charset=utf8", "#private"]) {
    const fake = fixture(); await assert.rejects(inspectAssistantRegistry(options, { ...fake.dependencies, environment: { DATABASE_URL: uri + suffix } })); assert.equal(fake.loads(), 0);
  }
  for (const value of ["bad", uri.replace("mysql:", "https:"), uri.replace("amz_listing", "other")]) assert.throws(() => validateManagedUri(value));
  for (const suffix of ["", "?charset=utf8mb4", "?timezone=Z", "?ssl=%7B%22rejectUnauthorized%22%3Atrue%7D"]) assert.doesNotThrow(() => validateManagedUri(uri + suffix));
});

test("stable discovery is bounded, four-table-only, two separate read-only transactions", async () => {
  const fake = fixture(), receipt = await inspectAssistantRegistry(options, fake.dependencies);
  assert.equal(receipt.status, "completed"); assert.equal(receipt.stable, true); assert.equal(receipt.hashes.first, receipt.hashes.second);
  assert.equal(receipt.observation.complete, true); assert.equal(fake.destroyed(), 1);
  assert.deepEqual(fake.configs, [{ uri, multipleStatements: false, connectTimeout: 5000, rowsAsArray: false }]);
  assert.deepEqual(fake.calls.filter(call => !call.sql.startsWith("SELECT")).map(call => call.sql), [
    "SET SESSION TRANSACTION READ ONLY", "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ", "SET SESSION MAX_EXECUTION_TIME = 5000", "SET SESSION lock_wait_timeout = 5",
    "START TRANSACTION READ ONLY", "ROLLBACK", "START TRANSACTION READ ONLY", "ROLLBACK",
  ]);
  assert.ok(fake.calls.every(call => call.timeout > 0 && call.timeout <= 5000));
  assert.equal(receipt.observation.registries.emperor_agent_library.hashColumnPresent, false);
  assert.equal(receipt.observation.registries.emperor_agent_library.configurations[0].hashPresent, null);
  assert.equal(receipt.observation.registries.emperor_model_providers.models[0].credentialReferenceIsControlled, true);
  assert.equal(JSON.stringify(receipt).includes(uri), false);
  for (const field of ["writesPerformed", "configBodiesRead", "promptBodiesRead", "credentialValuesRead"]) assert.equal(receipt[field], false);
});

test("exact SQL never selects config, prompt, reference or endpoint bodies and no out-of-scope table", async () => {
  const fake = fixture(); await inspectAssistantRegistry(options, fake.dependencies);
  for (const call of fake.calls.filter(value => value.sql.startsWith("SELECT"))) {
    assert.doesNotMatch(call.sql, /SELECT\s+\*|\bbaseUrl\b|\bconfig\b|\bname\b|systemPrompt|userPrompt|TABLE_COMMENT|COLUMN_COMMENT|COLUMN_DEFAULT|COLUMN_TYPE|CARDINALITY/i);
    if (call.sql.includes("information_schema") && !call.sql.includes("SCHEMATA")) assert.deepEqual(call.values, [EXPECTED_SCHEMA, ...TABLES]);
    if (call.sql.includes("WHERE BINARY slug")) assert.deepEqual(call.values, ["agent.library.route", "agent.library.coach"]);
    if (call.sql.includes("apiKeyRef")) assert.match(call.sql, /CASE WHEN BINARY apiKeyRef=BINARY 'env:EXTERNAL_LLM_API_KEY' THEN 1 ELSE 0 END AS credentialReferenceIsControlled/);
    assert.doesNotMatch(call.sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|USE|FOR SHARE|FOR UPDATE)\b/);
  }
});

test("schema missing is explicitly unavailable and never reads registry rows", async () => {
  const first = snapshot(); first.catalog.schema = [];
  const fake = fixture({ first }), result = await inspectAssistantRegistry(options, fake.dependencies);
  assert.equal(result.status, "unavailable"); assert.equal(result.stable, true); assert.equal(result.observation.complete, false);
  assert.ok(Object.values(result.observation.registries).every(value => value.reason === "schema_not_visible"));
  assert.ok(fake.calls.every(value => !value.sql.includes(`FROM \`${EXPECTED_SCHEMA}\``)));
});

test("missing table, view, nontransactional or incompatible required column skips only that registry with explicit unavailable status", async () => {
  for (const mutate of [
    value => { value.catalog.tables = value.catalog.tables.filter(row => row.tableName !== "emperor_skills"); },
    value => { value.catalog.tables[0].tableType = "VIEW"; },
    value => { value.catalog.tables[0].engine = "MyISAM"; },
    value => { value.catalog.columns = value.catalog.columns.filter(row => !(row.tableName === "emperor_skills" && row.columnName === "manifest")); },
    value => { value.catalog.columns.find(row => row.tableName === "emperor_skills" && row.columnName === "workspaceId").dataType = "varchar"; },
  ]) {
    const first = snapshot(); mutate(first);
    const fake = fixture({ first }), result = await inspectAssistantRegistry(options, fake.dependencies);
    assert.equal(result.status, "unavailable"); assert.equal(result.observation.registries.emperor_skills.status, "unavailable");
    assert.ok(fake.calls.every(value => !value.sql.includes(`FROM \`${EXPECTED_SCHEMA}\`.\`emperor_skills\``)));
  }
});

test("missing modern hash column does not silently pretend it is legacy or read config to recreate hash", async () => {
  const first = snapshot(); first.catalog.columns = first.catalog.columns.filter(row => !(row.tableName === "emperor_assistant_configurations" && row.columnName === "configHash"));
  const fake = fixture({ first }), result = await inspectAssistantRegistry(options, fake.dependencies);
  assert.equal(result.status, "unavailable"); assert.deepEqual(result.observation.registries.emperor_assistant_configurations.columnIssues, ["missing_column:configHash"]);
});

test("schema identity and unsupported server fail before catalog/transaction", async () => {
  for (const identity of [{ schemaName: "other" }, { schemaName: null }, { version: "5.7.44" }, { version: "8.0.44-MariaDB" }]) {
    const fake = fixture({ identity }), result = await inspectAssistantRegistry(options, fake.dependencies);
    assert.equal(result.status, "failed"); assert.equal(result.observation, undefined); assert.equal(fake.calls.length, 1); assert.equal(fake.destroyed(), 1);
  }
});

test("two observations detect catalog/count/config/skill/model drift without returning one partial inventory", async () => {
  for (const mutate of [value => { value.catalog.indexes[0].nonUnique = 1; }, value => { value.groups.emperor_skills[0].rowCount = "3"; }, value => { value.skills[0].manifestSha256 = "b".repeat(64); }, value => { value.models[0].isActive = 0; }, value => { value.configurations.emperor_assistant_configurations[0].revision++; }]) {
    const first = snapshot(), second = clone(first); mutate(second);
    const result = await inspectAssistantRegistry(options, fixture({ first, second }).dependencies);
    assert.equal(result.status, "changed"); assert.equal(result.stable, false); assert.notEqual(result.hashes.first, result.hashes.second); assert.equal(result.observation, undefined);
  }
});

test("every per-query +1 sentinel and aggregate budget rejects the entire result rather than truncating", async () => {
  const mutations = [
    value => { value.catalog.tables = Array(5).fill(value.catalog.tables[0]); },
    value => { value.catalog.columns = Array(501).fill(value.catalog.columns[0]); },
    value => { value.catalog.indexes = Array(1001).fill(value.catalog.indexes[0]); },
    value => { value.groups.emperor_skills = Array(201).fill(value.groups.emperor_skills[0]); },
    value => { value.groups.emperor_skills = Array(199).fill(value.groups.emperor_skills[0]); },
    value => { value.skills = Array(201).fill(value.skills[0]); },
    value => { value.models = Array(101).fill(value.models[0]); },
    value => { value.configurations.emperor_assistant_configurations = Array(201).fill(value.configurations.emperor_assistant_configurations[0]); },
    value => { value.configurations.emperor_assistant_configurations = Array(200).fill(value.configurations.emperor_assistant_configurations[0]); },
  ];
  for (const mutate of mutations) {
    const first = snapshot(); mutate(first); const fake = fixture({ first });
    const result = await inspectAssistantRegistry(options, fake.dependencies);
    assert.equal(result.status, "failed"); assert.equal(result.observation, undefined); assert.equal(result.hashes, undefined); assert.equal(result.stable, null);
    assert.equal(fake.calls.at(-1).sql, "ROLLBACK"); assert.equal(fake.destroyed(), 1);
  }
});

test("exact aggregate/model limits are complete and inactive/uncontrolled models remain explicit", async () => {
  const first = snapshot();
  first.groups.emperor_skills = Array.from({ length: 197 }, (_, index) => ({ workspaceId: index + 1, scope: "private", status: "Released", rowCount: 1 }));
  first.models = Array.from({ length: 100 }, (_, index) => ({ ...first.models[0], id: index + 1, slug: `model-${index}`, isActive: 0, credentialReferenceIsControlled: 0 }));
  first.configurations.emperor_assistant_configurations = Array.from({ length: 199 }, (_, index) => ({ workspaceId: index + 1, agentKey: "listing", revision: 1, hashPresent: 1 }));
  const result = await inspectAssistantRegistry(options, fixture({ first }).dependencies);
  assert.equal(result.status, "completed");
  assert.equal(Object.values(result.observation.registries).reduce((sum, value) => sum + value.groups.length, 0), 200);
  assert.equal(result.observation.registries.emperor_model_providers.models.length, 100);
  assert.ok(result.observation.registries.emperor_model_providers.models.every(value => value.isActive === false && value.credentialReferenceIsControlled === false));
  assert.equal(result.observation.registries.emperor_assistant_configurations.configurations.length + result.observation.registries.emperor_agent_library.configurations.length, 200);
});

test("redacts unexpected driver columns and rejects malformed/out-of-scope metadata or unsafe model identifiers", async () => {
  const first = snapshot();
  first.models[0].apiKeyRef = "synthetic-secret"; first.models[0].baseUrl = "https://private/?key=synthetic-secret";
  first.skills[0].manifest = { systemPrompt: "synthetic-secret" }; first.configurations.emperor_agent_library[0].config = "synthetic-secret";
  const result = await inspectAssistantRegistry(options, fixture({ first }).dependencies);
  assert.equal(result.status, "completed"); assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
  for (const mutate of [value => { value.models[0].modelId = "https://private/?key=synthetic-secret"; }, value => { value.catalog.tables[0].tableName = "business_orders"; }, value => { delete value.models[0].credentialReferenceIsControlled; }, value => { value.skills[0].slug = "listing.private"; }, value => { value.configurations.emperor_agent_library[0].revision = "9007199254740993"; }]) {
    const changed = snapshot(); mutate(changed); const failed = await inspectAssistantRegistry(options, fixture({ first: changed }).dependencies);
    assert.equal(failed.status, "failed"); assert.equal(failed.observation, undefined); assert.equal(JSON.stringify(failed).includes("synthetic-secret"), false);
  }
});

test("raw driver errors including hostile codes never escape; failure always rolls back/destroys", async () => {
  const fake = fixture({ onQuery(sql) { if (sql === CATALOG_SELECTS.columns.sql) throw Object.assign(new Error(`private SQL ${uri}`), { code: "PRIVATE_SECRET", discoveryCode: "PRIVATE_SECRET", sql }); } });
  const result = await inspectAssistantRegistry(options, fake.dependencies);
  assert.deepEqual(result.error, { code: "REGISTRY_DISCOVERY_FAILED" }); assert.equal(result.observation, undefined); assert.equal(fake.calls.at(-1).sql, "ROLLBACK"); assert.equal(fake.destroyed(), 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET|mysql:|private SQL/);
});

test("hard query and total timeouts destroy a hung connection without waiting for the driver", async () => {
  const hung = fixture({ timeouts: { queryMs: 15, runMs: 1000 }, onQuery(sql) { if (sql === CATALOG_SELECTS.columns.sql) return new Promise(() => {}); } });
  const result = await inspectAssistantRegistry(options, hung.dependencies);
  assert.equal(result.error.code, "QUERY_TIMEOUT"); assert.equal(hung.destroyed(), 1); assert.equal(result.observation, undefined);
  const deadline = fixture({ timeouts: { queryMs: 50, runMs: 20 }, onQuery: async () => sleep(6) });
  const expired = await inspectAssistantRegistry(options, deadline.dependencies);
  assert.equal(expired.error.code, "DISCOVERY_DEADLINE_EXCEEDED"); assert.equal(deadline.destroyed(), 1);
});

test("late connector resolution cannot leave a live connection after timeout", async () => {
  const fake = fixture({ timeouts: { queryMs: 10, runMs: 100 }, connectionDelay: 30 });
  const result = await inspectAssistantRegistry(options, fake.dependencies);
  assert.equal(result.error.code, "CONNECTION_TIMEOUT"); assert.equal(fake.calls.length, 0);
  await sleep(45); assert.equal(fake.destroyed(), 1);
});

test("cleanup errors remove otherwise completed observations and disclose no raw error", async () => {
  for (const setup of [{ failRollback: true }, { failDestroy: true }]) {
    const result = await inspectAssistantRegistry(options, fixture(setup).dependencies);
    assert.equal(result.status, "failed"); assert.equal(result.observation, undefined); assert.equal(result.hashes, undefined); assert.equal(result.stable, null);
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
});

test("main exit codes and missing env are explicit and sanitized", async () => {
  const first = snapshot(), changed = clone(first); changed.skills[0].version++;
  const missing = snapshot(); missing.catalog.schema = [];
  for (const [fake, expected] of [[fixture(), 0], [fixture({ second: changed }), 2], [fixture({ first: missing }), 1], [fixture({ failDestroy: true }), 1]]) {
    let output = ""; const exit = await main(args, { dependencies: fake.dependencies, stdout: { write: value => { output += value; } }, stderr: { write: value => { output += value; } } });
    assert.equal(exit, expected); assert.doesNotThrow(() => JSON.parse(output)); assert.equal(output.includes(uri), false);
  }
  let error = "";
  assert.equal(await main(args, { dependencies: { environment: {} }, stderr: { write: value => { error += value; } } }), 1);
  assert.equal(JSON.parse(error).error.code, "MANAGED_DATABASE_ENV_REQUIRED");
});

test("module import remains inert; no application/credential loading or file writes", () => {
  const target = new URL("./readAssistantRegistryDiscovery.mjs", import.meta.url);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(target.href)});`], { env: { DATABASE_URL: "invalid-never-connect" }, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  const source = readFileSync(target, "utf8");
  assert.doesNotMatch(source, /(?:import|from)\s*\(?\s*["'](?:dotenv|.*dbClient|.*routerContext|.*teamorouterCatalog)/);
  assert.doesNotMatch(source, /writeFile|readFile|process\.env\.[A-Z_]+KEY|applyMigrations|FOR UPDATE|FOR SHARE/);
  assert.equal(LIMITS.groups, 200); assert.equal(LIMITS.configurations, 200); assert.equal(LIMITS.models, 100);
});

test("compressed inline entry uses injected connector and never writes a deployed file", () => {
  const payload = gzipSync(readFileSync(new URL("./readAssistantRegistryDiscovery.mjs", import.meta.url))).toString("base64");
  const inline = `import {gunzipSync} from 'node:zlib';
    const source=gunzipSync(Buffer.from(${JSON.stringify(payload)},'base64'));
    const probe=await import('data:text/javascript;base64,'+source.toString('base64'));
    process.exitCode=await probe.main(${JSON.stringify(args)}, {dependencies:{environment:{DATABASE_URL:${JSON.stringify(uri)}},
      load:async()=>{throw new Error('synthetic-private-import-failure')}}});`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", inline], { env: {}, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 1); assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).error.code, "REGISTRY_DISCOVERY_FAILED");
  assert.doesNotMatch(result.stdout, /synthetic-private|mysql:/);
});
