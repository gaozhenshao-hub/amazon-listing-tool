import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { AssistantConfiguration } from "../shared/assistantConfigurations";
import { createAssistantConfigurationRepository, type ConfigurationDatabase } from "./domains/ai_os/repositories/assistantConfigurations";
import { configurationHash, createAssistantConfigurationService, skillManifestHash } from "./domains/ai_os/services/assistantConfigurations";

const now = "2026-10-15T00:00:00.000Z";
const manifest = { implementation: { systemPrompt: "PRIVATE SKILL PROMPT", modelPolicy: "synthetic" }, contract: { mode: "sync" } };
const config: AssistantConfiguration = { name: "Listing helper", description: "Synthetic", enabled: true, modelSlug: "model-a", instructions: "PRIVATE PROMPT", rules: ["PRIVATE RULE"], skills: [{ slug: "skill-a", version: 3, manifestSha256: skillManifestHash(manifest), enabled: true, trigger: "manual", instructions: "PRIVATE SKILL OVERRIDE" }] };
type Row = Record<string, unknown>;
type State = { current: Row[]; versions: Row[]; models: Row[]; skills: Row[] };
const dialect = new MySqlDialect();

/** Real service + repository SQL, controlled transactional state only. Not a MySQL
 * locking/commit test: failures after mutations publish no test state. */
function database(options: { fault?: "insert" | "update" | "append" | "cas-zero"; missing?: boolean; noTransaction?: boolean; writesEnabled?: boolean } = {}) {
  let state: State = { current: [], versions: [], models: [{ workspaceId: null, slug: "model-a", name: "Model A", modelId: "model-v1", isActive: 1, capabilityTags: ["vision", "text"], apiKeyRef: "DO NOT RETURN", baseUrl: "https://private.invalid" }], skills: [{ workspaceId: 7, scope: "private", slug: "skill-a", name: "Skill A", version: 3, status: "Released", manifest }] };
  const trace: Array<{ sql: string; params: unknown[]; transaction: boolean }> = [];
  let transactions = 0, fault = options.fault;
  let transactionQueue: Promise<unknown> = Promise.resolve();
  function executor(working: State, inTransaction: boolean) {
    return { async execute(statement: SQL) {
      const built = dialect.sqlToQuery(statement), text = built.sql, p = built.params;
      trace.push({ sql: text, params: p, transaction: inTransaction });
      if (options.missing) throw { cause: { code: "ER_NO_SUCH_TABLE", errno: 1146, sql: "PRIVATE SQL", message: "PRIVATE URI" } };
      if (text.startsWith("SELECT configHash FROM ")) return [[], []];
      if (text.startsWith("SELECT workspaceId,agentKey,revision,config,configHash,updatedBy")) {
        return [structuredClone(working.current.filter(row => row.workspaceId === p[0] && (p.length === 1 || row.agentKey === p[1]))), []];
      }
      if (text.startsWith("SELECT workspaceId,agentKey,revision,config,configHash,sourceRevision")) {
        const rows = working.versions.filter(row => row.workspaceId === p[0] && row.agentKey === p[1]);
        return [structuredClone(text.includes("revision<?") ? rows.filter(row => Number(row.revision) < Number(p[2])).sort((a, b) => Number(b.revision) - Number(a.revision)).slice(0, Number(p[3])) : rows.filter(row => row.revision === p[2])), []];
      }
      if (text.includes("FROM emperor_model_providers")) return [structuredClone(working.models.filter(row => (row.workspaceId === p[0] || row.workspaceId === null) && row.isActive === 1 && (p.length === 1 || row.slug === p[1]))), []];
      if (text.includes("FROM emperor_skills")) return [structuredClone(working.skills.filter(row => (row.workspaceId === p[0] || (row.workspaceId === null && row.scope === "global")) && row.status === "Released" && (p.length === 1 || row.slug === p[1]))), []];
      expect(inTransaction).toBe(true);
      if (text.startsWith("INSERT INTO emperor_assistant_configurations ")) {
        if (working.current.some(row => row.workspaceId === p[0] && row.agentKey === p[1])) throw { errno: 1062 };
        working.current.push({ workspaceId: p[0], agentKey: p[1], revision: 1, config: p[2], configHash: p[3], updatedBy: p[4], createdAt: now, updatedAt: now });
        if (fault === "insert") throw new Error("PRIVATE FAIL AFTER INSERT");
        return [{ affectedRows: 1 }, []];
      }
      if (text.startsWith("UPDATE emperor_assistant_configurations ")) {
        const row = working.current.find(row => row.workspaceId === p[3] && row.agentKey === p[4] && row.revision === p[5]);
        if (!row || fault === "cas-zero") return [{ affectedRows: 0 }, []];
        Object.assign(row, { revision: Number(row.revision) + 1, config: p[0], configHash: p[1], updatedBy: p[2], updatedAt: now });
        if (fault === "update") throw new Error("PRIVATE FAIL AFTER UPDATE");
        return [{ affectedRows: 1 }, []];
      }
      if (text.startsWith("INSERT INTO emperor_assistant_configuration_versions ")) {
        working.versions.push({ workspaceId: p[0], agentKey: p[1], revision: p[2], config: p[3], configHash: p[4], sourceRevision: p[5], createdBy: p[6], createdAt: now });
        if (fault === "append") throw new Error("PRIVATE FAIL AFTER APPEND");
        return [{ affectedRows: 1 }, []];
      }
      throw new Error("UNEXPECTED SQL");
    } };
  }
  const db: ConfigurationDatabase = { ...executor(state, false), transaction: callback => {
    const result = transactionQueue.then(async () => {
      transactions++;
      const draft = structuredClone(state);
      const value = await callback(executor(draft, true));
      state.current = draft.current; state.versions = draft.versions; state.models = draft.models; state.skills = draft.skills;
      return value;
    });
    transactionQueue = result.then(() => undefined, () => undefined);
    return result;
  } };
  if (options.noTransaction) delete db.transaction;
  const repository = createAssistantConfigurationRepository(async () => db);
  // Explicit test admission, never NODE_ENV-based permission.
  const service = createAssistantConfigurationService(repository, () => options.writesEnabled ?? true);
  return { service, repository, trace, state: () => state, transactions: () => transactions, fault(value: typeof fault) { fault = value; } };
}
async function seed(d: ReturnType<typeof database>, patch: Partial<AssistantConfiguration> = {}) {
  return d.service.save(7, 19, { agentKey: "listing", expectedRevision: 0, config: { ...config, ...patch } });
}

describe("assistant configurations: persisted scope and immutable revisions", () => {
  it("write gate rejects save and rollback before any repository read; reads stay available", async () => {
    const d = database({ writesEnabled: false });
    await expect(seed(d)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "ASSISTANT_WRITES_DISABLED" });
    await expect(d.service.rollback(7, 19, { agentKey: "listing", expectedRevision: 1, targetRevision: 1 })).rejects.toMatchObject({ message: "ASSISTANT_WRITES_DISABLED" });
    expect(d.trace).toEqual([]); expect(d.transactions()).toBe(0);
    expect((await d.service.options(7)).writeEnabled).toBe(false);
    expect((await d.service.listMetadata(7)).items.every(row => row.status === "not-configured")).toBe(true);
  });
  it.each([undefined, "false", "1", "TRUE", " true "])("default write gate does not admit %s", async value => {
    const d = database(); vi.stubEnv("ENABLE_ASSISTANT_CONFIGURATION_WRITES", value);
    try {
      const service = createAssistantConfigurationService(d.repository);
      await expect(service.save(7, 19, { agentKey: "listing", expectedRevision: 0, config })).rejects.toMatchObject({ message: "ASSISTANT_WRITES_DISABLED" });
      expect(d.trace).toEqual([]);
    } finally { vi.unstubAllEnvs(); }
  });
  it("default write gate admits only the separately enabled server flag", async () => {
    const d = database(); vi.stubEnv("ENABLE_ASSISTANT_CONFIGURATION_WRITES", "true");
    try { expect((await createAssistantConfigurationService(d.repository).save(7, 19, { agentKey: "listing", expectedRevision: 0, config })).revision).toBe(1); }
    finally { vi.unstubAllEnvs(); }
  });
  it("empty reads never create/seed; seven metadata roles are explicitly unconfigured", async () => {
    const d = database();
    expect((await d.service.listMetadata(7)).items).toHaveLength(7);
    expect((await d.service.listMetadata(7)).items.every(row => row.status === "not-configured" && row.revision === null)).toBe(true);
    expect(await d.service.get(7, "listing")).toEqual({ status: "not-configured", agentKey: "listing" });
    expect(await d.service.history(7, { agentKey: "listing", limit: 10 })).toEqual({ versions: [], nextBeforeRevision: null });
    expect(d.trace.every(row => row.sql.startsWith("SELECT "))).toBe(true); expect(d.transactions()).toBe(0);
  });
  it("first save is revision 1 and current/history are committed together in one transaction", async () => {
    const d = database(), record = await seed(d);
    expect(record).toEqual({ agentKey: "listing", revision: 1, config, updatedAt: now });
    expect(d.transactions()).toBe(1); expect(d.state().versions).toHaveLength(1);
    expect(d.state().versions[0]).toMatchObject({ revision: 1, sourceRevision: null, createdBy: 19, configHash: configurationHash(config) });
    expect(d.trace.filter(row => !row.sql.startsWith("SELECT")).every(row => row.transaction)).toBe(true);
    expect(d.trace.some(row => row.sql.includes("FOR UPDATE"))).toBe(true);
    expect(d.trace.filter(row => row.sql.includes("FROM emperor_skills") || row.sql.includes("FROM emperor_model_providers")).every(row => row.sql.endsWith("FOR SHARE"))).toBe(true);
  });
  it("update uses expected revision; rollback copies old configuration into a new revision", async () => {
    const d = database(); await seed(d);
    const original = structuredClone(d.state().versions[0]);
    await d.service.save(7, 20, { agentKey: "listing", expectedRevision: 1, config: { ...config, rules: ["new rule"] } });
    expect((await d.service.rollback(7, 21, { agentKey: "listing", expectedRevision: 2, targetRevision: 1 })).config).toEqual(config);
    expect(d.state().current[0].revision).toBe(3); expect(d.state().versions[0]).toEqual(original);
    expect(d.state().versions[2]).toMatchObject({ revision: 3, sourceRevision: 1, createdBy: 21 });
    expect(d.trace.some(row => /UPDATE emperor_assistant_configuration_versions|DELETE|CREATE TABLE|tag_memory/i.test(row.sql))).toBe(false);
  });
  it("metadata and options are explicit credential/prompt-free projections", async () => {
    const d = database(); await seed(d);
    const metadata = await d.service.listMetadata(7), options = await d.service.options(7);
    expect(JSON.stringify({ metadata, options })).not.toMatch(/PRIVATE|apiKeyRef|baseUrl|systemPrompt|trigger|instructions|rules/);
    expect(options.skills[0]).toEqual({ slug: "skill-a", name: "Skill A", version: 3, manifestSha256: skillManifestHash(manifest) });
    expect(metadata.items.find(row => row.agentKey === "listing")).toMatchObject({ revision: 1, skillCount: 1, ruleCount: 1 });
  });
  it("history pagination is stable and sensitive configuration requires separate getVersion", async () => {
    const d = database(); await seed(d);
    await d.service.save(7, 19, { agentKey: "listing", expectedRevision: 1, config });
    const page = await d.service.history(7, { agentKey: "listing", limit: 1 });
    expect(page).toEqual({ versions: [{ revision: 2, sourceRevision: null, createdAt: now, createdBy: 19 }], nextBeforeRevision: 2 });
    expect((await d.service.history(7, { agentKey: "listing", limit: 1, beforeRevision: 2 })).versions[0].revision).toBe(1);
    expect(await d.service.getVersion(7, "listing", 1)).toEqual({ agentKey: "listing", revision: 1, config, createdAt: now, sourceRevision: null });
  });
  it("other workspace sees no current or history; every configuration SELECT binds exact scope", async () => {
    const d = database(); await seed(d); d.trace.length = 0;
    expect(await d.service.get(8, "listing")).toEqual({ status: "not-configured", agentKey: "listing" });
    await expect(d.service.getVersion(8, "listing", 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(d.trace.every(row => row.params[0] === 8 && !row.sql.includes("IS NULL"))).toBe(true);
  });
  it.each(["insert", "append"] as const)("failure after %s leaves no half-created current/history", async fault => {
    const d = database({ fault }), before = structuredClone(d.state());
    await expect(seed(d)).rejects.toMatchObject({ message: "ASSISTANT_STORAGE_FAILED" });
    expect(d.state()).toEqual(before);
  });
  it.each(["update", "append", "cas-zero"] as const)("failure at %s rolls back complete saved state", async fault => {
    const d = database(); await seed(d); const before = structuredClone(d.state()); d.fault(fault);
    await expect(d.service.save(7, 19, { agentKey: "listing", expectedRevision: 1, config: { ...config, name: "changed" } })).rejects.toThrow();
    expect(d.state()).toEqual(before);
  });
  it("stale revision and nonexistent rollback cannot write", async () => {
    const d = database(); await seed(d); const before = structuredClone(d.state());
    await expect(d.service.save(7, 19, { agentKey: "listing", expectedRevision: 0, config })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(d.service.rollback(7, 19, { agentKey: "listing", expectedRevision: 1, targetRevision: 2 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(d.state()).toEqual(before);
  });
  it("two saves observing the controlled serialized lock cannot both consume revision 0", async () => {
    const d = database();
    const outcomes = await Promise.allSettled([seed(d), seed(d, { name: "second writer" })]);
    expect(outcomes.map(row => row.status)).toEqual(["fulfilled", "rejected"]);
    expect((outcomes[1] as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });
    expect(d.state().current).toHaveLength(1); expect(d.state().versions).toHaveLength(1);
    expect(d.state().current[0].revision).toBe(1);
  });
  it("prompt punctuation stays a bind value, never SQL text or an additional statement", async () => {
    const d = database(), instructions = "quote '?'; DROP TABLE synthetic; --";
    await seed(d, { instructions });
    expect(d.trace.every(row => !row.sql.includes("DROP TABLE") && !row.sql.includes(instructions))).toBe(true);
    expect(d.trace.some(row => row.params.some(value => typeof value === "string" && value.includes(instructions)))).toBe(true);
  });
  it("requires a real transaction method instead of fallback writes", async () => {
    const d = database({ noTransaction: true });
    await expect(seed(d)).rejects.toMatchObject({ message: "ASSISTANT_TRANSACTION_REQUIRED" });
    expect(d.trace).toEqual([]);
  });
  it("missing tables are not mistaken for absent configuration and SQL errors are sanitized", async () => {
    const d = database({ missing: true });
    await expect(d.service.get(7, "listing")).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "ASSISTANT_SCHEMA_UNAVAILABLE" });
    await expect(d.service.options(7)).rejects.toMatchObject({ message: "ASSISTANT_SCHEMA_UNAVAILABLE" });
  });
  it.each([null, 0, -1, 1.2, NaN] as const)("invalid scope %s never reads", async value => {
    const d = database(); await expect(d.service.listMetadata(value as number)).rejects.toThrow(); expect(d.trace).toEqual([]);
  });
  it.each([
    { config: "{" }, { revision: 0 }, { revision: "01" }, { configHash: "0".repeat(64) }, { updatedAt: "bad" },
    { config: JSON.stringify({ ...config, instructions: " padded " }) },
  ])("corrupt persisted data fails closed: %j", async patch => {
    const d = database(); await seed(d); Object.assign(d.state().current[0], patch);
    await expect(d.service.get(7, "listing")).rejects.toMatchObject({ message: "ASSISTANT_DATA_INVALID" });
  });
  it("missing/mismatched immutable history refuses reads and saves", async () => {
    const d = database(); await seed(d); d.state().versions.length = 0;
    await expect(d.service.listMetadata(7)).rejects.toMatchObject({ message: "ASSISTANT_DATA_INVALID" });
    await expect(d.service.save(7, 19, { agentKey: "listing", expectedRevision: 1, config })).rejects.toMatchObject({ message: "ASSISTANT_DATA_INVALID" });
  });
  it.each([{ workspaceId: 8 }, { workspaceId: null, scope: "private" }, { status: "Draft" }, { version: 4 }])("rejects foreign/private/draft/version-drift Skill %j, including disabled binding", async patch => {
    const d = database(); Object.assign(d.state().skills[0], patch);
    await expect(seed(d, { skills: [{ ...config.skills[0], enabled: false }] })).rejects.toThrow(); expect(d.state().current).toEqual([]);
  });
  it("allows global Released exact-version Skill and refuses same-version content drift on rollback", async () => {
    const d = database(); Object.assign(d.state().skills[0], { workspaceId: null, scope: "global" }); await seed(d);
    d.state().skills[0].manifest = { ...manifest, added: "changed" }; const before = structuredClone(d.state());
    await expect(d.service.rollback(7, 19, { agentKey: "listing", expectedRevision: 1, targetRevision: 1 })).rejects.toMatchObject({ message: "ASSISTANT_SKILL_CONTENT_CHANGED" });
    expect(d.state()).toEqual(before);
  });
  it.each([{ workspaceId: 8 }, { isActive: 0 }, { capabilityTags: "bad json" }, { capabilityTags: null }, { capabilityTags: ["vision", 1] }])("rejects invalid/inactive/foreign model %j", async patch => {
    const d = database(); Object.assign(d.state().models[0], patch);
    await expect(seed(d)).rejects.toThrow(); expect(d.state().current).toEqual([]);
  });
  it("vision roles require trusted vision metadata; model names never infer capability", async () => {
    const d = database(); d.state().models[0].capabilityTags = ["text"]; d.state().models[0].name = "Vision Model";
    await expect(d.service.save(7, 19, { agentKey: "images", expectedRevision: 0, config })).rejects.toMatchObject({ message: "ASSISTANT_MODEL_VISION_REQUIRED" });
  });
  it("empty model policy is only inheritance, never a model/provider call", async () => {
    const d = database(); expect((await seed(d, { modelSlug: "" })).config.modelSlug).toBe("");
    expect(d.trace.some(row => row.sql.includes("FROM emperor_model_providers"))).toBe(false);
  });
  it("canonical configuration and manifest hashes ignore object-key insertion order", () => {
    expect(configurationHash({ ...config })).toBe(configurationHash(Object.fromEntries(Object.entries(config).reverse()) as AssistantConfiguration));
    expect(skillManifestHash(JSON.stringify(manifest))).toBe(skillManifestHash({ contract: manifest.contract, implementation: manifest.implementation }));
  });
});
