import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { AGENT_LIBRARY_ROLES } from "../shared/agentLibraryContracts";
import { AssistantConfigurationSchema, type AssistantConfiguration } from "../shared/assistantConfigurations";
import { createAssistantConfigurationRepository, type ConfigurationDatabase } from "./domains/ai_os/repositories/assistantConfigurations";
import { configurationHash, createAssistantConfigurationService, skillManifestHash } from "./domains/ai_os/services/assistantConfigurations";

const now = "2026-10-15T00:00:00.000Z";
const manifest = { implementation: { prompt: "PRIVATE SKILL" } };
const base: AssistantConfiguration = {
  name: "Current name", description: "Current description", enabled: false, modelSlug: "model-a",
  instructions: "PRIVATE CURRENT PROMPT", rules: ["old rule"],
  skills: [{ slug: "skill-a", version: 3, manifestSha256: skillManifestHash(manifest), enabled: false, trigger: "manual", instructions: "PRIVATE OVERRIDE" }],
};
type Row = Record<string, unknown>;
type State = { current: Row[]; versions: Row[]; models: Row[]; skills: Row[] };
type Fault = "insert" | "update" | "append" | "cas-zero" | "bad-readback" | undefined;
const dialect = new MySqlDialect();

/** Real repository SQL + real service, with a controlled transactional database.
 * The cloned draft models rollback and serialization; this is NOT real MySQL
 * isolation, durable history, or HTTP permission acceptance. */
function database(options: { fault?: Fault; missing?: boolean; noTransaction?: boolean; enabled?: boolean } = {}) {
  const state: State = {
    current: [], versions: [],
    models: ["model-a", "model-b"].map(slug => ({ workspaceId: 7, slug, name: slug, modelId: "synthetic", isActive: 1, capabilityTags: ["vision", "text"] })),
    skills: [{ workspaceId: 7, scope: "private", slug: "skill-a", name: "Skill", version: 3, status: "Released", manifest }],
  };
  const trace: Array<{ sql: string; params: unknown[]; transaction: boolean }> = [];
  let transactions = 0, fault = options.fault;
  let queue: Promise<unknown> = Promise.resolve();
  function executor(working: State, transaction: boolean) {
    return { async execute(statement: SQL) {
      const { sql, params: p } = dialect.sqlToQuery(statement);
      trace.push({ sql, params: p, transaction });
      if (options.missing) throw { errno: 1146 };
      if (sql.startsWith("SELECT configHash FROM ")) return [[], []];
      if (sql.startsWith("SELECT workspaceId,agentKey,revision,config,configHash,updatedBy")) {
        return [structuredClone(working.current.filter(row => row.workspaceId === p[0] && row.agentKey === p[1])), []];
      }
      if (sql.startsWith("SELECT workspaceId,agentKey,revision,config,configHash,sourceRevision")) {
        return [structuredClone(working.versions.filter(row => row.workspaceId === p[0] && row.agentKey === p[1] && row.revision === p[2])), []];
      }
      if (sql.includes("FROM emperor_model_providers")) return [structuredClone(working.models.filter(row => row.workspaceId === p[0] && row.slug === p[1] && row.isActive === 1)), []];
      if (sql.includes("FROM emperor_skills")) return [structuredClone(working.skills.filter(row => row.workspaceId === p[0] && row.slug === p[1] && row.status === "Released")), []];
      expect(transaction).toBe(true);
      if (sql.startsWith("INSERT INTO emperor_assistant_configurations ")) {
        if (working.current.some(row => row.workspaceId === p[0] && row.agentKey === p[1])) throw { errno: 1062 };
        working.current.push({ workspaceId: p[0], agentKey: p[1], revision: 1, config: p[2], configHash: p[3], updatedBy: p[4], createdAt: now, updatedAt: now });
        if (fault === "insert") throw new Error("synthetic insert failure");
        return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith("UPDATE emperor_assistant_configurations ")) {
        const row = working.current.find(row => row.workspaceId === p[3] && row.agentKey === p[4] && row.revision === p[5]);
        if (!row || fault === "cas-zero") return [{ affectedRows: 0 }, []];
        Object.assign(row, { revision: Number(row.revision) + 1, config: p[0], configHash: p[1], updatedBy: p[2], updatedAt: now });
        if (fault === "update") throw new Error("synthetic update failure");
        return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith("INSERT INTO emperor_assistant_configuration_versions ")) {
        working.versions.push({ workspaceId: p[0], agentKey: p[1], revision: p[2], config: p[3], configHash: fault === "bad-readback" ? "0".repeat(64) : p[4], sourceRevision: p[5], createdBy: p[6], createdAt: now });
        if (fault === "append") throw new Error("synthetic history failure");
        return [{ affectedRows: 1 }, []];
      }
      throw new Error("UNEXPECTED SQL");
    } };
  }
  const db: ConfigurationDatabase = { ...executor(state, false), transaction: callback => {
    const result = queue.then(async () => {
      transactions++;
      const draft = structuredClone(state);
      const result = await callback(executor(draft, true));
      Object.assign(state, draft);
      return result;
    });
    queue = result.then(() => undefined, () => undefined);
    return result;
  } };
  if (options.noTransaction) delete db.transaction;
  const repository = createAssistantConfigurationRepository(async () => db);
  return {
    service: createAssistantConfigurationService(repository, () => options.enabled ?? true), repository, state, trace,
    transactions: () => transactions, setFault(value: Fault) { fault = value; },
  };
}
type Database = ReturnType<typeof database>;
const save = (d: Database, expectedRevision: number, config = base) => d.service.save(7, 19, { agentKey: "listing", expectedRevision, config });
const rules = (d: Database, expectedRevision: number, value: string[] = ["new rule"]) => d.service.saveRules(7, 19, { agentKey: "listing", expectedRevision, rules: value });
const restore = (d: Database, expectedRevision: number, targetRevision = 1) => d.service.restoreRules(7, 19, { agentKey: "listing", expectedRevision, targetRevision });
const value = (d: Database) => JSON.parse(d.state.current[0].config as string) as AssistantConfiguration;

describe("single-authority rules memory: same configuration CAS and immutable history", () => {
  it.each(AGENT_LIBRARY_ROLES)("%s reads do not initialize; explicit first write creates disabled directory defaults", async role => {
    const d = database();
    expect(await d.service.getRules(7, role.key)).toEqual({ status: "not-configured", agentKey: role.key });
    expect(d.transactions()).toBe(0); expect(d.state.current).toEqual([]);
    expect(d.trace.every(row => row.sql.startsWith("SELECT "))).toBe(true);
    const result = await d.service.saveRules(7, 19, { agentKey: role.key, expectedRevision: 0, rules: [] });
    expect(result).toEqual({ status: "configured", agentKey: role.key, revision: 1, rules: [], updatedAt: now });
    expect(value(d)).toEqual({ name: role.name, description: "", enabled: false, modelSlug: "", instructions: "", rules: [], skills: [] });
    expect(d.state.versions[0]).toMatchObject({ workspaceId: 7, agentKey: role.key, revision: 1, sourceRevision: null, createdBy: 19 });
    expect(d.transactions()).toBe(1);
  });
  it("rules update makes a stale model-only full configuration draft conflict", async () => {
    const d = database(); await save(d, 0); const before = structuredClone(value(d));
    const result = await rules(d, 1, ["new line one\nnew line two"]);
    expect(result).toEqual({ status: "configured", agentKey: "listing", revision: 2, rules: ["new line one\nnew line two"], updatedAt: now });
    expect(value(d)).toEqual({ ...before, rules: ["new line one\nnew line two"] });
    await expect(save(d, 1, { ...base, modelSlug: "model-b" })).rejects.toMatchObject({ code: "CONFLICT", message: "ASSISTANT_REVISION_CONFLICT" });
    expect(d.state.versions).toHaveLength(2);
  });
  it("a full configuration update invalidates a stale rules draft", async () => {
    const d = database(); await save(d, 0); await save(d, 1, { ...base, modelSlug: "model-b" });
    const before = structuredClone(d.state);
    await expect(rules(d, 1)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(d.state).toEqual(before);
  });
  it("rules restore takes only historical rules and keeps all latest fields and bindings", async () => {
    const d = database(); await save(d, 0, { ...base, enabled: true });
    d.state.skills[0].version = 4;
    const latest: AssistantConfiguration = { ...base, name: "New name", description: "New description", modelSlug: "model-b", instructions: "CURRENT INSTRUCTIONS", rules: ["current rule"], skills: [{ ...base.skills[0], version: 4, trigger: "current trigger", instructions: "current override" }] };
    await save(d, 1, latest);
    const result = await restore(d, 2);
    expect(result).toEqual({ status: "configured", agentKey: "listing", revision: 3, rules: base.rules, updatedAt: now });
    expect(value(d)).toEqual({ ...latest, rules: base.rules });
    expect(d.state.versions[2]).toMatchObject({ revision: 3, sourceRevision: 1, createdBy: 19, configHash: configurationHash(value(d)) });
    expect(JSON.parse(d.state.versions[0].config as string)).toEqual({ ...base, enabled: true });
    expect(await d.service.getRules(7, "listing")).toEqual(result);
  });
  it("empty rules are an explicit versioned clear, not unconfigured or a reset", async () => {
    const d = database(); await save(d, 0); await rules(d, 1, []);
    expect(value(d)).toEqual({ ...base, rules: [] });
    await restore(d, 2, 2);
    expect(value(d).rules).toEqual([]); expect(d.state.versions[2].sourceRevision).toBe(2);
  });
  it("each rules write uses exactly one locking transaction and existing scoped binding checks", async () => {
    const d = database(); await save(d, 0); d.trace.length = 0;
    await rules(d, 1);
    expect(d.transactions()).toBe(2);
    expect(d.trace.every(row => row.transaction)).toBe(true);
    expect(d.trace.filter(row => row.sql.includes("updatedBy,createdAt,updatedAt FROM")).every(row => row.sql.endsWith("FOR UPDATE"))).toBe(true);
    expect(d.trace.filter(row => /FROM emperor_(skills|model_providers)/.test(row.sql)).every(row => row.sql.endsWith("FOR SHARE"))).toBe(true);
    expect(d.trace.find(row => row.sql.startsWith("UPDATE "))?.params.slice(3)).toEqual([7, "listing", 1]);
    expect(d.trace.filter(row => !row.sql.startsWith("SELECT "))).toHaveLength(2);
  });
  it("serialized concurrent full/rules writes using one revision allow exactly one winner", async () => {
    const d = database(); await save(d, 0);
    const results = await Promise.allSettled([rules(d, 1), save(d, 1, { ...base, modelSlug: "model-b" })]);
    expect(results.map(row => row.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find(row => row.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "CONFLICT" });
    expect(d.state.current[0].revision).toBe(2); expect(d.state.versions).toHaveLength(2);
  });
  it("same key in another workspace is never read or updated", async () => {
    const d = database(); await rules(d, 0);
    expect(await d.service.getRules(8, "listing")).toEqual({ status: "not-configured", agentKey: "listing" });
    await expect(d.service.saveRules(8, 19, { agentKey: "listing", expectedRevision: 1, rules: [] })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(d.state.current).toHaveLength(1);
    expect(d.trace.filter(row => row.sql.startsWith("SELECT ")).every(row => row.params[0] === 7 || row.params[0] === 8)).toBe(true);
  });
  it.each([0, -1, 1.5, NaN, 2_147_483_648])("invalid authenticated workspace %s does no storage I/O", async workspaceId => {
    const d = database();
    await expect(d.service.getRules(workspaceId, "listing")).rejects.toBeDefined();
    await expect(d.service.saveRules(workspaceId, 19, { agentKey: "listing", expectedRevision: 0, rules: [] })).rejects.toBeDefined();
    await expect(d.service.restoreRules(workspaceId, 19, { agentKey: "listing", expectedRevision: 0, targetRevision: 1 })).rejects.toBeDefined();
    expect(d.trace).toEqual([]); expect(d.transactions()).toBe(0);
  });
  it.each([undefined, "false", "1", "TRUE", " true "])("default write switch %s rejects both mutations before any I/O", async flag => {
    const d = database(); vi.stubEnv("ENABLE_ASSISTANT_CONFIGURATION_WRITES", flag);
    try {
      const service = createAssistantConfigurationService(d.repository);
      await expect(service.saveRules(7, 19, { agentKey: "listing", expectedRevision: 0, rules: [] })).rejects.toMatchObject({ message: "ASSISTANT_WRITES_DISABLED" });
      await expect(service.restoreRules(7, 19, { agentKey: "listing", expectedRevision: 1, targetRevision: 1 })).rejects.toMatchObject({ message: "ASSISTANT_WRITES_DISABLED" });
      expect(d.trace).toEqual([]); expect(d.transactions()).toBe(0);
      expect(await service.getRules(7, "listing")).toEqual({ status: "not-configured", agentKey: "listing" });
    } finally { vi.unstubAllEnvs(); }
  });
  it.each(["insert", "append", "bad-readback"] as const)("first rules creation is atomic when %s fails", async fault => {
    const d = database({ fault });
    await expect(rules(d, 0)).rejects.toBeDefined();
    expect(d.state.current).toEqual([]); expect(d.state.versions).toEqual([]);
  });
  it.each(["update", "append", "cas-zero", "bad-readback"] as const)("rules update and restore roll back current/history together on %s", async fault => {
    const d = database(); await save(d, 0); const before = structuredClone(d.state); d.setFault(fault);
    await expect(rules(d, 1)).rejects.toBeDefined(); expect(d.state).toEqual(before);
    await expect(restore(d, 1)).rejects.toBeDefined(); expect(d.state).toEqual(before);
  });
  it("no real transaction API means hard refusal, never an unprotected fallback", async () => {
    const d = database({ noTransaction: true });
    await expect(rules(d, 0)).rejects.toMatchObject({ message: "ASSISTANT_TRANSACTION_REQUIRED" });
    await expect(restore(d, 0)).rejects.toMatchObject({ message: "ASSISTANT_TRANSACTION_REQUIRED" });
    expect(d.trace).toEqual([]);
  });
  it("missing tables are schema-unavailable, not an empty memory or auto-create", async () => {
    const d = database({ missing: true });
    for (const call of [() => d.service.getRules(7, "listing"), () => rules(d, 0), () => restore(d, 0)]) {
      await expect(call()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "ASSISTANT_SCHEMA_UNAVAILABLE" });
    }
    expect(d.trace.every(row => row.sql.startsWith("SELECT "))).toBe(true);
  });
  it.each(["current-hash", "history-missing", "history-config"])("rules reads and writes reject corrupt %s", async corruption => {
    const d = database(); await save(d, 0);
    if (corruption === "current-hash") d.state.current[0].configHash = "f".repeat(64);
    if (corruption === "history-missing") d.state.versions.length = 0;
    if (corruption === "history-config") {
      const different = { ...base, instructions: "other prompt" };
      Object.assign(d.state.versions[0], { config: JSON.stringify(different), configHash: configurationHash(different) });
    }
    await expect(d.service.getRules(7, "listing")).rejects.toMatchObject({ message: "ASSISTANT_DATA_INVALID" });
    await expect(rules(d, 1)).rejects.toMatchObject({ message: "ASSISTANT_DATA_INVALID" });
  });
  it("rules restore validates historical content/hash and cannot restore a missing version", async () => {
    const d = database(); await save(d, 0); await rules(d, 1); d.state.versions[0].configHash = "f".repeat(64);
    await expect(restore(d, 2)).rejects.toMatchObject({ message: "ASSISTANT_DATA_INVALID" });
    await expect(restore(d, 2, 3)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const empty = database(); await expect(restore(empty, 0)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rules changes revalidate current model and fixed Skill contents even when disabled", async () => {
    const d = database(); await save(d, 0); d.state.models[0].isActive = 0;
    await expect(rules(d, 1)).rejects.toMatchObject({ message: "ASSISTANT_MODEL_UNAVAILABLE" });
    d.state.models[0].isActive = 1; d.state.skills[0].manifest = { different: true };
    await expect(restore(d, 1)).rejects.toMatchObject({ message: "ASSISTANT_SKILL_CONTENT_CHANGED" });
    expect(d.state.versions).toHaveLength(1);
  });
  it.each([
    { rules: [""] }, { rules: ["x".repeat(501)] }, { rules: Array(31).fill("rule") },
    { rules: Array(21).fill("x".repeat(500)) }, { rules: ["ok"], config: base },
    { rules: ["ok"], expectedRevision: "0" }, { rules: ["ok"], workspaceId: 8 }, { rules: ["ok"], agentKey: "unknown" },
  ])("direct service calls validate rules and reject unknown/invalid request fields: %j", async patch => {
    const d = database();
    await expect(d.service.saveRules(7, 19, { agentKey: "listing", expectedRevision: 0, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(d.trace).toEqual([]);
  });
  it("direct restore rejects unknown keys, revision zero and exhausted revisions", async () => {
    const d = database();
    await expect(d.service.restoreRules(7, 19, { agentKey: "listing", expectedRevision: 0, targetRevision: 1, rules: [] } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(restore(d, 0, 0)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(rules(d, 2_147_483_647)).rejects.toMatchObject({ message: "ASSISTANT_REVISION_EXHAUSTED" });
    expect(d.trace).toEqual([]);
  });
  it("merged rules retain the whole-configuration 128KiB budget", async () => {
    const d = database();
    const large: AssistantConfiguration = { ...base, instructions: "i".repeat(12_000), rules: [], skills: Array.from({ length: 15 }, (_, i) => ({ ...base.skills[0], slug: `skill-${i}`, instructions: "s".repeat(7_500) })) };
    d.state.skills = large.skills.map(binding => ({ ...d.state.skills[0], slug: binding.slug }));
    expect(AssistantConfigurationSchema.safeParse(large).success).toBe(true);
    await save(d, 0, large); const before = structuredClone(d.state);
    await expect(rules(d, 1, Array(19).fill("r".repeat(500)))).rejects.toMatchObject({ message: "ASSISTANT_CONFIG_INVALID" });
    expect(d.state).toEqual(before);
  });
});
