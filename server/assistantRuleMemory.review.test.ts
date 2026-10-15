import { describe, expect, it } from "vitest";
import { AssistantConfigurationSchema, type AssistantConfiguration } from "../shared/assistantConfigurations";
import type { AssistantConfigurationRepository, ConfigurationSession } from "./domains/ai_os/repositories/assistantConfigurations";
import { configurationHash, createAssistantConfigurationService, skillManifestHash } from "./domains/ai_os/services/assistantConfigurations";

const workspaceId = 11, actorId = 23, agentKey = "listing" as const;
const now = "2026-10-15T00:00:00.000Z";
const manifest = { implementation: { systemPrompt: "registry-only prompt" } };
const config = (patch: Partial<AssistantConfiguration> = {}): AssistantConfiguration => ({
  name: "Current assistant", description: "Current description", enabled: false,
  modelSlug: "current-model", instructions: "PRIVATE CURRENT PROMPT", rules: ["current rule"],
  skills: [{ slug: "current-skill", version: 4, manifestSha256: skillManifestHash(manifest), enabled: false, trigger: "manual", instructions: "PRIVATE SKILL OVERRIDE" }],
  ...patch,
});
type Row = Record<string, unknown>;
type State = { head: Row | null; versions: Row[] };
function stored(revision: number, value: AssistantConfiguration, sourceRevision: number | null = null): Row {
  return { workspaceId, agentKey, revision, config: JSON.stringify(value), configHash: configurationHash(value),
    sourceRevision, updatedBy: actorId, createdBy: actorId, createdAt: now, updatedAt: now };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** A separately authored service-decision fixture, not a real MySQL lock/commit
 * test. It pauses BEFORE the transaction callback, exposing accidental reads
 * or merges outside the transaction; only fulfilled drafts become observable. */
function fixture(initial: AssistantConfiguration, current = initial) {
  let state: State = { head: stored(1, initial), versions: [stored(1, initial)] };
  let beforeTransaction: () => Promise<void> = async () => {};
  const events: string[] = [], modelRequests: string[] = [], skillRequests: string[] = [];
  const allowedModels = new Set([current.modelSlug]);
  const allowedSkills = new Map(current.skills.map(binding => [binding.slug, binding]));
  const assertScope = (scope: number, key: string) => {
    expect(scope).toBe(workspaceId); expect(key).toBe(agentKey);
  };
  function session(draft: State, locking: boolean): ConfigurationSession {
    return {
      assertSchema: async () => {},
      list: async () => { throw new Error("Unexpected list"); },
      history: async () => { throw new Error("Unexpected history"); },
      current: async (scope, key) => {
        assertScope(scope, key); events.push(locking ? "locked-current" : "read-current");
        return draft.head ? [structuredClone(draft.head)] : [];
      },
      version: async (scope, key, revision) => {
        assertScope(scope, key); events.push(`version:${revision}`);
        return structuredClone(draft.versions.filter(row => row.revision === revision));
      },
      models: async (scope, slug) => {
        expect(scope).toBe(workspaceId); modelRequests.push(String(slug));
        return slug && allowedModels.has(slug) ? [{ workspaceId, slug, name: slug, modelId: "model-id", isActive: 1, capabilityTags: ["text", "vision"] }] : [];
      },
      skills: async (scope, slug) => {
        expect(scope).toBe(workspaceId); skillRequests.push(String(slug));
        const binding = slug && allowedSkills.get(slug);
        return binding ? [{ workspaceId, slug, name: "Released skill", scope: "private", status: "Released", version: binding.version, manifest }] : [];
      },
      insert: async () => { throw new Error("Unexpected initial creation"); },
      update: async (scope, key, expected, text, hash, userId) => {
        assertScope(scope, key); expect(locking).toBe(true); expect(userId).toBe(actorId);
        expect(draft.head?.revision).toBe(expected); events.push("update");
        draft.head = { ...draft.head, revision: expected + 1, config: text, configHash: hash, updatedBy: userId, updatedAt: now };
      },
      append: async (scope, key, revision, text, hash, sourceRevision, userId) => {
        assertScope(scope, key); expect(locking).toBe(true); events.push("append");
        draft.versions.push({ workspaceId: scope, agentKey: key, revision, config: text, configHash: hash, sourceRevision, createdBy: userId, createdAt: now });
      },
    };
  }
  const repository: AssistantConfigurationRepository = {
    async read(scope, callback) { expect(scope).toBe(workspaceId); return callback(session(state, false)); },
    async transaction(scope, callback) {
      expect(scope).toBe(workspaceId); events.push("transaction-requested");
      await beforeTransaction();
      const draft = structuredClone(state), result = await callback(session(draft, true));
      state = draft; events.push("committed"); return result;
    },
  };
  return {
    service: createAssistantConfigurationService(repository, () => true), events, modelRequests, skillRequests,
    pauseBeforeTransaction(promise: Promise<void>) { beforeTransaction = () => promise; },
    installCommitted(revision: number, value: AssistantConfiguration) {
      state.head = stored(revision, value); state.versions.push(stored(revision, value));
    },
    replaceHead(value: Row) { state.head = value; },
    snapshot: () => structuredClone(state),
    currentConfig: () => JSON.parse(state.head!.config as string) as AssistantConfiguration,
  };
}
const restore = (f: ReturnType<typeof fixture>, expectedRevision: number) => f.service.restoreRules(workspaceId, actorId, { agentKey, expectedRevision, targetRevision: 1 });

describe("independent rules-only review boundaries", () => {
  it("reads and merges only after transaction admission, preserving the newly locked current fields", async () => {
    const historical = config({ enabled: true, modelSlug: "retired-model", rules: ["historical rule"], skills: [] });
    const latest = config({ name: "Latest name", description: "Latest description", instructions: "LATEST PRIVATE PROMPT", rules: ["newer rule"] });
    const f = fixture(historical, latest), gate = deferred(); f.pauseBeforeTransaction(gate.promise);
    const pending = restore(f, 2);
    expect(f.events).toEqual(["transaction-requested"]);
    f.installCommitted(2, latest); const historyBefore = f.snapshot().versions;
    gate.resolve();
    expect(await pending).toEqual({ status: "configured", agentKey, revision: 3, rules: historical.rules, updatedAt: now });
    expect(f.currentConfig()).toEqual({ ...latest, rules: historical.rules });
    expect(f.snapshot().versions.slice(0, 2)).toEqual(historyBefore);
    expect(f.snapshot().versions[2].sourceRevision).toBe(1);
    expect(f.events[1]).toBe("locked-current");
    expect(f.events.filter(event => event === "committed")).toHaveLength(1);
  });

  it("a configuration commit while a rules restore waits causes conflict without a history append", async () => {
    const original = config(), latest = config({ instructions: "newly committed prompt", rules: ["newly committed rule"] });
    const f = fixture(original), gate = deferred(); f.pauseBeforeTransaction(gate.promise);
    const pending = restore(f, 1);
    f.installCommitted(2, latest); const before = f.snapshot();
    gate.resolve();
    await expect(pending).rejects.toMatchObject({ code: "CONFLICT", message: "ASSISTANT_REVISION_CONFLICT" });
    expect(f.snapshot()).toEqual(before);
    expect(f.events).not.toContain("update"); expect(f.events).not.toContain("append");
    expect(f.modelRequests).toEqual([]); expect(f.skillRequests).toEqual([]);
  });

  it("does not resolve retired historical model/Skill bindings during a rules-only restore", async () => {
    const historical = config({ modelSlug: "retired-model", rules: ["retained rule"], skills: [{ ...config().skills[0], slug: "retired-skill", version: 1 }] });
    const latest = config({ rules: ["latest rule"] }), f = fixture(historical, latest);
    f.installCommitted(2, latest);
    const result = await restore(f, 2);
    expect(f.modelRequests).toEqual(["current-model"]);
    expect(f.skillRequests).toEqual(["current-skill"]);
    expect(f.currentConfig()).toEqual({ ...latest, rules: ["retained rule"] });
    expect(Object.keys(result).sort()).toEqual(["agentKey", "revision", "rules", "status", "updatedAt"]);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|modelSlug|manifestSha256|instructions|retired-model|retired-skill/);
  });

  it("rules restore validates the combined current payload budget before either write", async () => {
    const historical = config({ rules: Array(19).fill("r".repeat(500)), skills: [] });
    const latest = config({ instructions: "i".repeat(12_000), rules: [], skills: Array.from({ length: 15 }, (_, i) => ({ ...config().skills[0], slug: `current-skill-${i}`, instructions: "s".repeat(7_500) })) });
    expect(AssistantConfigurationSchema.safeParse(historical).success).toBe(true);
    expect(AssistantConfigurationSchema.safeParse(latest).success).toBe(true);
    const f = fixture(historical, latest); f.installCommitted(2, latest); const before = f.snapshot();
    await expect(restore(f, 2)).rejects.toMatchObject({ message: "ASSISTANT_CONFIG_INVALID" });
    expect(f.snapshot()).toEqual(before);
    expect(f.events).not.toContain("update"); expect(f.events).not.toContain("append");
    expect(f.modelRequests).toEqual([]); expect(f.skillRequests).toEqual([]);
  });

  it("a correctly hashed legacy-shaped record with missing rules cannot become an empty rules array", async () => {
    const initial = config(), f = fixture(initial);
    const { rules: _missing, ...malformed } = initial;
    const head = stored(1, malformed as AssistantConfiguration); f.replaceHead(head);
    await expect(f.service.getRules(workspaceId, agentKey)).rejects.toMatchObject({ message: "ASSISTANT_DATA_INVALID" });
    await expect(f.service.saveRules(workspaceId, actorId, { agentKey, expectedRevision: 1, rules: [] })).rejects.toMatchObject({ message: "ASSISTANT_DATA_INVALID" });
    expect(f.snapshot().head).toEqual(head);
    expect(f.events).not.toContain("update"); expect(f.events).not.toContain("append");
  });
});
