import { describe, expect, it } from "vitest";
import {
  AGENT_LIBRARY_ACTIONS, AGENT_LIBRARY_KEYS, AGENT_LIBRARY_LIMITS, AGENT_LIBRARY_ROLES,
  AgentLibraryConfigSchema, AgentLibraryConfigRevisionSchema, AgentLibraryKeySchema,
  AgentLibraryRulesSchema, AgentLibraryScopeSchema, agentLibraryModelSupportsVision,
  assertAgentLibraryRevision, createAgentLibraryConfigSnapshot, getAgentLibraryModelPolicy,
  sameAgentLibraryScope, type AgentLibraryConfig, type AgentLibraryConfigRevision,
} from "../shared/agentLibraryContracts";

const binding = (slug = "listing.selling-points.plan", enabled = true) => ({ slug, enabled, trigger: "人工请求时", instructions: "保留证据" });
const config = (patch: Partial<AgentLibraryConfig> = {}): AgentLibraryConfig => ({
  name: "爱分析的小L", description: "竞品研究与 Listing", enabled: true, modelSlug: "",
  instructions: "不能把竞品参数视为本品事实", rules: ["缺失资料应说明"], skills: [binding()], ...patch,
});
const saved = (): AgentLibraryConfigRevision => ({ workspaceId: 7, agentKey: "listing", revision: 3, config: config() });
const scope = { workspaceId: 7, userId: 11, projectId: 13 };

describe("Agent library shared contracts (no DB, model or runtime registration)", () => {
  it("defines exactly seven unique roles without automatically enabling or binding them", () => {
    expect(AGENT_LIBRARY_KEYS).toHaveLength(7);
    expect(AGENT_LIBRARY_ROLES.map(role => role.key).sort()).toEqual([...AGENT_LIBRARY_KEYS].sort());
    expect(new Set(AGENT_LIBRARY_ROLES.map(role => role.key)).size).toBe(7);
    expect(AgentLibraryKeySchema.safeParse("new-agent").success).toBe(false);
    expect(AGENT_LIBRARY_ROLES.every(role => !("enabled" in role) && !("skills" in role))).toBe(true);
    expect(AGENT_LIBRARY_ACTIONS).toEqual(["view", "configure", "execute"]);
  });

  it("normalizes text while preserving explicit disabled config and bindings", () => {
    const parsed = AgentLibraryConfigSchema.parse(config({ name: "  自定义助手  ", modelSlug: "  model-a  ", enabled: false,
      rules: ["  人工规则  "], skills: [binding("  skill.a  ", false)] }));
    expect(parsed).toMatchObject({ name: "自定义助手", modelSlug: "model-a", enabled: false,
      rules: ["人工规则"], skills: [{ slug: "skill.a", enabled: false }] });
  });

  it("requires explicit enable/model/rule/binding values instead of implicit defaults", () => {
    for (const key of ["enabled", "modelSlug", "rules", "skills"] as const) {
      const input: Record<string, unknown> = config(); delete input[key];
      expect(AgentLibraryConfigSchema.safeParse(input).success, key).toBe(false);
    }
    expect(AgentLibraryConfigSchema.safeParse(config({ enabled: "false" as unknown as boolean })).success).toBe(false);
  });

  it("rejects unknown fields rather than accepting permission, model credentials or rule status", () => {
    expect(AgentLibraryConfigSchema.safeParse({ ...config(), permissions: ["admin"] }).success).toBe(false);
    expect(AgentLibraryConfigSchema.safeParse({ ...config(), apiKey: "not-a-real-key" }).success).toBe(false);
    expect(AgentLibraryConfigSchema.safeParse(config({ skills: [{ ...binding(), confirmed: true } as never] })).success).toBe(false);
  });

  it("rejects duplicate skill bindings, including trimmed or disabled duplicates", () => {
    for (const duplicate of [binding(), binding(" listing.selling-points.plan "), binding(undefined, false)]) {
      const parsed = AgentLibraryConfigSchema.safeParse(config({ skills: [binding(), duplicate] }));
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues[0].path).toEqual(["skills", 1, "slug"]);
    }
    expect(AgentLibraryConfigSchema.safeParse(config({ skills: [binding("skill.a"), binding("skill.b", false)] })).success).toBe(true);
  });

  it("bounds binding count and every configurable prompt field", () => {
    expect(AgentLibraryConfigSchema.safeParse(config({ skills: Array.from({ length: 80 }, (_, i) => binding(`skill.${i}`)) })).success).toBe(true);
    expect(AgentLibraryConfigSchema.safeParse(config({ skills: Array.from({ length: 81 }, (_, i) => binding(`skill.${i}`)) })).success).toBe(false);
    for (const patch of [{ name: " " }, { name: "x".repeat(61) }, { description: "x".repeat(501) },
      { modelSlug: "x".repeat(129) }, { instructions: "x".repeat(12_001) },
      { skills: [{ ...binding(), trigger: "x".repeat(501) }] },
      { skills: [{ ...binding(), instructions: "x".repeat(8_001) }] }]) {
      expect(AgentLibraryConfigSchema.safeParse(config(patch)).success).toBe(false);
    }
  });

  it("accepts empty rules but rejects blank entries, long rules and excess rule count", () => {
    expect(AgentLibraryRulesSchema.parse([])).toEqual([]);
    expect(AgentLibraryRulesSchema.parse(["x".repeat(500)])).toHaveLength(1);
    for (const input of [[" "], ["x".repeat(501)], Array(31).fill("短规则")]) {
      expect(AgentLibraryRulesSchema.safeParse(input).success).toBe(false);
    }
    expect(AgentLibraryRulesSchema.parse(Array(30).fill("短规则"))).toHaveLength(30);
  });

  it("counts rule separators in the 10000-character total and does not silently rewrite rules", () => {
    const exact = [...Array(19).fill("中".repeat(500)), "文".repeat(481)];
    expect(exact.join("\n")).toHaveLength(AGENT_LIBRARY_LIMITS.totalRuleCharacters);
    expect(AgentLibraryRulesSchema.parse(exact)).toEqual(exact);
    expect(AgentLibraryRulesSchema.safeParse([...exact.slice(0, 19), "文".repeat(482)]).success).toBe(false);
    expect(AgentLibraryRulesSchema.parse(["同一规则", "同一规则"])).toEqual(["同一规则", "同一规则"]);
  });

  it("uses explicit workspace/user/project IDs; thread names cannot create project identity", () => {
    expect(AgentLibraryScopeSchema.parse({ ...scope, projectId: null })).toEqual({ ...scope, projectId: null });
    expect(AgentLibraryScopeSchema.safeParse({ workspaceId: 7, userId: 11, threadName: "项目13" }).success).toBe(false);
    expect(AgentLibraryScopeSchema.safeParse({ ...scope, projectId: "13" }).success).toBe(false);
    expect(AgentLibraryScopeSchema.safeParse({ ...scope, title: "公开项目" }).success).toBe(false);
    for (const id of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      for (const key of ["workspaceId", "userId", "projectId"]) {
        expect(AgentLibraryScopeSchema.safeParse({ ...scope, [key]: id }).success).toBe(false);
      }
    }
  });

  it("does not conflate users, workspaces or unbound/bound projects", () => {
    expect(sameAgentLibraryScope(scope, { ...scope })).toBe(true);
    for (const other of [{ ...scope, workspaceId: 8 }, { ...scope, userId: 12 },
      { ...scope, projectId: 14 }, { ...scope, projectId: null }]) expect(sameAgentLibraryScope(scope, other)).toBe(false);
  });

  it("rejects unsaved revision snapshots and validates expected revisions without coercion", () => {
    expect(() => assertAgentLibraryRevision(0, 0)).not.toThrow();
    expect(() => assertAgentLibraryRevision(3, 3)).not.toThrow();
    expect(() => assertAgentLibraryRevision(3, 2)).toThrow("AGENT_CONFIG_REVISION_CONFLICT");
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "3"]) {
      expect(() => assertAgentLibraryRevision(3, value as number)).toThrow();
    }
    expect(AgentLibraryConfigRevisionSchema.safeParse({ ...saved(), revision: 0 }).success).toBe(false);
  });

  it("copies and deeply freezes the saved revision, rules, bindings and execution scope", () => {
    const original = saved(), context = { ...scope };
    original.config.skills.push(binding("skill.disabled", false));
    const snapshot = createAgentLibraryConfigSnapshot(original, context);
    original.revision = 4; original.config.modelSlug = "new-model"; original.config.rules[0] = "new-rule";
    original.config.skills[0].instructions = "new-instructions"; context.projectId = 99;
    expect(snapshot).toMatchObject({ revision: 3, scope, config: { modelSlug: "", rules: ["缺失资料应说明"],
      skills: [binding(), binding("skill.disabled", false)] } });
    for (const item of [snapshot, snapshot.scope, snapshot.config, snapshot.config.rules,
      snapshot.config.skills, ...snapshot.config.skills]) expect(Object.isFrozen(item)).toBe(true);
    expect(Reflect.set(snapshot.config.skills[0], "enabled", false)).toBe(false);
    expect(Reflect.set(snapshot.config.rules, "0", "changed")).toBe(false);
  });

  it("rejects cross-workspace snapshots even when user and project IDs match", () => {
    expect(() => createAgentLibraryConfigSnapshot(saved(), { ...scope, workspaceId: 8 })).toThrow("AGENT_CONFIG_WORKSPACE_MISMATCH");
  });

  it("disabled Agents block either purpose rather than silently inheriting a model", () => {
    for (const purpose of ["business", "conversation"] as const) {
      for (const modelSlug of ["", "model-a"]) expect(getAgentLibraryModelPolicy("listing", config({ enabled: false, modelSlug }), purpose))
        .toEqual({ kind: "blocked", reason: "agent_disabled" });
    }
  });

  it("blank model inherits only for business; chat requires a configured model", () => {
    expect(getAgentLibraryModelPolicy("listing", config({ modelSlug: "  " }), "business"))
      .toEqual({ kind: "inherit_business_policy", requiresVision: false });
    expect(getAgentLibraryModelPolicy("listing", config(), "conversation"))
      .toEqual({ kind: "blocked", reason: "conversation_model_required" });
    expect(getAgentLibraryModelPolicy("listing", config({ modelSlug: "chosen-model" }), "conversation"))
      .toEqual({ kind: "configured", modelSlug: "chosen-model", requiresVision: false });
  });

  it("never turns invalid config or rules into an empty-rule / inherited-model fallback", () => {
    for (const invalid of [config({ rules: [" "] }), config({ rules: ["x".repeat(501)] }),
      config({ skills: [binding(), binding()] })]) {
      expect(() => getAgentLibraryModelPolicy("listing", invalid, "business")).toThrow();
      expect(() => createAgentLibraryConfigSnapshot({ ...saved(), config: invalid }, scope)).toThrow();
    }
    // A configured slug stays explicit; registry availability is not guessed here.
    expect(getAgentLibraryModelPolicy("listing", config({ modelSlug: "missing-model" }), "business"))
      .toEqual({ kind: "configured", modelSlug: "missing-model", requiresVision: false });
  });

  it("retains vision requirements even when business routing is inherited", () => {
    for (const key of ["tagger", "images", "video"] as const) expect(getAgentLibraryModelPolicy(key, config(), "business"))
      .toEqual({ kind: "inherit_business_policy", requiresVision: true });
    expect(getAgentLibraryModelPolicy("listing", config({ modelSlug: "text-sounding-name" }), "conversation", true))
      .toEqual({ kind: "configured", modelSlug: "text-sounding-name", requiresVision: true });
    expect(() => getAgentLibraryModelPolicy("listing", config(), "unknown" as "business")).toThrow();
    expect(() => getAgentLibraryModelPolicy("tagger", config(), "business", "false" as unknown as boolean)).toThrow();
  });

  it("uses exact configured vision capability, not familiar model names or substrings", () => {
    expect(agentLibraryModelSupportsVision({ slug: "gpt-4o", isActive: true, capabilityTags: ["text"] })).toBe(false);
    expect(agentLibraryModelSupportsVision({ slug: "arbitrary-private-model", isActive: true, capabilityTags: ["vision", "text"] })).toBe(true);
    for (const capabilityTags of [[], ["vision-disabled"], ["revision"], ["VISION"], "vision", null]) {
      expect(agentLibraryModelSupportsVision({ slug: "gemini-vision", isActive: true, capabilityTags })).toBe(false);
    }
  });

  it("fails closed for inactive, missing, malformed or credential-bearing descriptors", () => {
    for (const model of [undefined, null, {}, { slug: "m", isActive: false, capabilityTags: ["vision"] },
      { slug: "m", isActive: 1, capabilityTags: ["vision"] },
      { slug: "m", isActive: true, capabilityTags: ["vision"], apiKey: "not-a-real-key" }]) {
      expect(agentLibraryModelSupportsVision(model)).toBe(false);
    }
  });
});
