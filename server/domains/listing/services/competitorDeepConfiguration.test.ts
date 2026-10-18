import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { loadCompetitorDeepConfiguration, authorizeCompetitorDeepAgent } from "./competitorDeepConfiguration";
import { deepFixture, clone, syntheticIdentity } from "./competitorDeepJob.testFixture";
const dialect = new MySqlDialect();
describe("Listing deep same-transaction saved configuration, synthetic SQL only", () => {
  it("reads exact current/history with bounded JSON and locks, without a second rules source", async () => {
    const h = await deepFixture(); h.executor.execute.mockClear();
    const saved = await loadCompetitorDeepConfiguration(h.executor, 7);
    expect(saved).toEqual({ workspaceId: 7, agentKey: "listing", revision: 1, hash: h.configuration.configHash, config: h.config });
    const queries = h.executor.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
    expect(queries).toHaveLength(3); expect(queries[1].sql).toContain("<=524288"); expect(queries[1].sql).toContain("FOR UPDATE");
    expect(queries[2].sql).toContain("FOR SHARE"); expect(queries[2].params).toEqual([7, 1]);
    expect(queries.every(query => query.sql.startsWith("SELECT"))).toBe(true);
    expect(queries.some(query => /rule_memory|assistant_rule|INSERT|UPDATE .*SET/u.test(query.sql))).toBe(false);
  });
  it.each(["missing", "duplicate", "oversized", "other_workspace", "other_agent", "bad_hash", "string_revision", "trimmed_config", "history_missing", "history_changed", "history_revision", "myisam", "metadata_missing"])("fails closed for %s evidence", async problem => {
    const h = await deepFixture(), base = h.executor.execute.getMockImplementation()!;
    h.executor.execute.mockImplementation(async (query: SQL) => {
      const text = dialect.sqlToQuery(query).sql;
      if (text.includes("information_schema.TABLES") && problem === "myisam") return [[{ tableName: "emperor_assistant_configurations", engine: "MyISAM" }]];
      if (text.includes("information_schema.TABLES") && problem === "metadata_missing") return [[]];
      if (text.includes("FROM emperor_assistant_configurations")) {
        if (problem === "missing") return [[]];
        const record = clone(h.configuration);
        if (problem === "duplicate") return [[record, record]];
        if (problem === "oversized") return [[{ ...record, configText: null }]];
        if (problem === "other_workspace") record.workspaceId = 8;
        if (problem === "other_agent") record.agentKey = "finance";
        if (problem === "bad_hash") record.configHash = "f".repeat(64);
        if (problem === "string_revision") return [[{ ...record, revision: "1" }]];
        if (problem === "trimmed_config") record.configText = JSON.stringify({ ...h.config, instructions: ` ${h.config.instructions} ` });
        return [[record]];
      }
      if (text.includes("FROM emperor_assistant_configuration_versions")) {
        if (problem === "history_missing") return [[]];
        if (problem === "history_changed") return [[{ ...h.configurationVersion, configText: JSON.stringify({ ...h.config, rules: [] }) }]];
        if (problem === "history_revision") return [[{ ...h.configurationVersion, revision: 2 }]];
      }
      return base(query);
    });
    await expect(loadCompetitorDeepConfiguration(h.executor, 7)).rejects.toThrow(/^COMPETITOR_DEEP_CONFIG/u);
    expect(h.paid()).toBe(0);
  });
  it("disabled persisted configuration is unavailable, not replaced with defaults", async () => {
    const h = await deepFixture(); h.config.enabled = false; h.saveConfiguration();
    await expect(loadCompetitorDeepConfiguration(h.executor, 7)).rejects.toMatchObject({ code: "CONFIGURATION_DISABLED" });
  });
  it("native JSON formatting/key order does not change the authoritative configuration hash", async () => {
    const h = await deepFixture(); h.configuration.configText = JSON.stringify(Object.fromEntries(Object.entries(h.config).reverse()), null, 2);
    expect((await loadCompetitorDeepConfiguration(h.executor, 7)).hash).toBe(h.configuration.configHash);
  });
  it("does not expose SQL/host or private configuration on storage errors", async () => {
    const h = await deepFixture(); h.executor.execute.mockRejectedValue(new Error("mysql private-host password=synthetic_private rules=private"));
    await expect(loadCompetitorDeepConfiguration(h.executor, 7)).rejects.toMatchObject({ message: "COMPETITOR_DEEP_CONFIGURATION_UNAVAILABLE" });
  });
  it("fresh listing Agent authority uses exact actor and transaction, not config-admin or owner bypass", async () => {
    const h = await deepFixture(), permission = vi.fn(async (_input: unknown) => undefined);
    await authorizeCompetitorDeepAgent(h.executor, syntheticIdentity, permission);
    expect(permission.mock.calls.map(([input]) => input)).toEqual(["read", "run"].map(action => ({
      actor: { id: 3, role: "specialist", defaultWorkspaceId: 7 }, workspaceId: 7, resource: "agent", resourceId: "listing", action,
      authorizationRead: { executor: h.executor, strict: true, lock: true },
    })));
    h.actor.status = "disabled"; permission.mockClear();
    await expect(authorizeCompetitorDeepAgent(h.executor, syntheticIdentity, permission)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(permission).not.toHaveBeenCalled();
  });
});
