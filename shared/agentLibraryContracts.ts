import { z } from "zod";

/** Pure contracts only: importing this module never registers or enables an Agent. */
export const AGENT_LIBRARY_KEYS = ["tagger", "listing", "images", "knowledge", "development", "video", "finance"] as const;
export const AgentLibraryKeySchema = z.enum(AGENT_LIBRARY_KEYS);
export type AgentLibraryKey = z.infer<typeof AgentLibraryKeySchema>;

export const AGENT_LIBRARY_ROLES = [
  { key: "finance", name: "爱看数据的小金", stages: ["月度利润变化分析"], requiresVision: false },
  { key: "tagger", name: "打标签的小酷", stages: ["图片打标签", "视频打标签"], requiresVision: true },
  { key: "listing", name: "爱分析的小L", stages: ["竞品分析", "竞品对比", "Listing文案"], requiresVision: false },
  { key: "images", name: "图片策划助手", stages: ["图片策划"], requiresVision: true },
  { key: "knowledge", name: "知识问答助手", stages: ["知识问答"], requiresVision: false },
  { key: "development", name: "产品开发助手", stages: ["市场研究", "竞品研究", "产品机会"], requiresVision: false },
  { key: "video", name: "视频脚本助手", stages: ["视频分析", "章节策划", "分镜脚本"], requiresVision: true },
] as const satisfies readonly { key: AgentLibraryKey; name: string; stages: readonly string[]; requiresVision: boolean }[];

// Operation intents, NOT permission grants or a replacement for existing RBAC.
export const AGENT_LIBRARY_ACTIONS = ["view", "configure", "execute"] as const;
export type AgentLibraryAction = (typeof AGENT_LIBRARY_ACTIONS)[number];

export const AGENT_LIBRARY_LIMITS = {
  rules: 30, ruleCharacters: 500, totalRuleCharacters: 10_000, skillBindings: 80,
} as const;

const identifier = z.string().trim().min(1).max(128);
const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const AgentLibraryRulesSchema = z.array(z.string().trim().min(1).max(AGENT_LIBRARY_LIMITS.ruleCharacters))
  .max(AGENT_LIBRARY_LIMITS.rules)
  // Include separators in the same 10k budget used by the source tagging rules.
  .refine(rules => rules.join("\n").length <= AGENT_LIBRARY_LIMITS.totalRuleCharacters, "长期规则总长度不能超过 10000 字符");

export const AgentLibrarySkillBindingSchema = z.object({
  slug: identifier,
  enabled: z.boolean(),
  trigger: z.string().trim().max(500),
  instructions: z.string().trim().max(8_000),
}).strict();
export type AgentLibrarySkillBinding = z.infer<typeof AgentLibrarySkillBindingSchema>;

export const AgentLibraryConfigSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500),
  enabled: z.boolean(),
  // Empty means inherit the business model policy; it never enables chat by itself.
  modelSlug: z.string().trim().max(128),
  instructions: z.string().trim().max(12_000),
  rules: AgentLibraryRulesSchema,
  skills: z.array(AgentLibrarySkillBindingSchema).max(AGENT_LIBRARY_LIMITS.skillBindings),
}).strict().superRefine((config, context) => {
  const seen = new Set<string>();
  config.skills.forEach((binding, index) => {
    if (seen.has(binding.slug)) context.addIssue({
      code: "custom", path: ["skills", index, "slug"], message: "同一 Skill 不能重复绑定（包括停用绑定）",
    });
    seen.add(binding.slug);
  });
});
export type AgentLibraryConfig = z.infer<typeof AgentLibraryConfigSchema>;

/** IDs come from authenticated context and checked project ownership, not a thread title. */
export const AgentLibraryScopeSchema = z.object({
  workspaceId: positiveId,
  userId: positiveId,
  // Explicit null means no project binding. A numeric ID still requires an access check.
  projectId: positiveId.nullable(),
}).strict();
export type AgentLibraryScope = z.infer<typeof AgentLibraryScopeSchema>;

export function sameAgentLibraryScope(left: AgentLibraryScope, right: AgentLibraryScope): boolean {
  const a = AgentLibraryScopeSchema.parse(left), b = AgentLibraryScopeSchema.parse(right);
  return a.workspaceId === b.workspaceId && a.userId === b.userId && a.projectId === b.projectId;
}

/** Only persisted versions can be snapshotted. Expected revision 0 is reserved for creation. */
export const AgentLibraryConfigRevisionSchema = z.object({
  workspaceId: positiveId,
  agentKey: AgentLibraryKeySchema,
  revision: revision.refine(value => value > 0, "配置快照必须对应已保存的版本"),
  config: AgentLibraryConfigSchema,
}).strict();
export type AgentLibraryConfigRevision = z.infer<typeof AgentLibraryConfigRevisionSchema>;

/** A pure comparison; the eventual repository must enforce this atomically when saving. */
export function assertAgentLibraryRevision(actual: number, expected: number): void {
  if (revision.parse(actual) !== revision.parse(expected)) throw new Error("AGENT_CONFIG_REVISION_CONFLICT");
}

export type AgentLibraryConfigSnapshot = {
  readonly scope: Readonly<AgentLibraryScope>;
  readonly agentKey: AgentLibraryKey;
  readonly revision: number;
  readonly config: Readonly<Omit<AgentLibraryConfig, "rules" | "skills">> & {
    readonly rules: readonly string[];
    readonly skills: readonly Readonly<AgentLibrarySkillBinding>[];
  };
};

/**
 * Copies and freezes the exact saved configuration, including disabled bindings.
 * This is NOT an execution approval or complete task receipt: future integration
 * must separately record the resolved Skill version, actual model and input hash.
 */
export function createAgentLibraryConfigSnapshot(
  input: AgentLibraryConfigRevision,
  executionScope: AgentLibraryScope,
): AgentLibraryConfigSnapshot {
  const saved = AgentLibraryConfigRevisionSchema.parse(input);
  const scope = AgentLibraryScopeSchema.parse(executionScope);
  if (saved.workspaceId !== scope.workspaceId) throw new Error("AGENT_CONFIG_WORKSPACE_MISMATCH");
  return Object.freeze({
    scope: Object.freeze(scope), agentKey: saved.agentKey, revision: saved.revision,
    config: Object.freeze({ ...saved.config,
      rules: Object.freeze(saved.config.rules),
      skills: Object.freeze(saved.config.skills.map(binding => Object.freeze(binding))),
    }),
  });
}

export type AgentLibraryModelPolicy =
  | { kind: "blocked"; reason: "agent_disabled" | "conversation_model_required" }
  | { kind: "inherit_business_policy"; requiresVision: boolean }
  | { kind: "configured"; modelSlug: string; requiresVision: boolean };

/**
 * Describes a requested policy only. Existing Skill version / explicit-task /
 * fallback governance must resolve the actual model; this helper never overrides it.
 */
export function getAgentLibraryModelPolicy(
  key: AgentLibraryKey,
  input: AgentLibraryConfig,
  purpose: "business" | "conversation",
  inputRequiresVision = false,
): AgentLibraryModelPolicy {
  const agentKey = AgentLibraryKeySchema.parse(key), config = AgentLibraryConfigSchema.parse(input);
  const mode = z.enum(["business", "conversation"]).parse(purpose);
  const hasImageInput = z.boolean().parse(inputRequiresVision);
  const requiresVision = AGENT_LIBRARY_ROLES.find(role => role.key === agentKey)!.requiresVision
    || hasImageInput;
  if (!config.enabled) return { kind: "blocked", reason: "agent_disabled" };
  if (config.modelSlug) return { kind: "configured", modelSlug: config.modelSlug, requiresVision };
  if (mode === "conversation") return { kind: "blocked", reason: "conversation_model_required" };
  return { kind: "inherit_business_policy", requiresVision };
}

/** Credential-free projection of the existing model registry fields. */
export const AgentLibraryModelDescriptorSchema = z.object({
  slug: identifier,
  isActive: z.boolean(),
  capabilityTags: z.array(z.string().trim().min(1).max(128)).max(100),
}).strict();
export type AgentLibraryModelDescriptor = z.infer<typeof AgentLibraryModelDescriptorSchema>;

/** Capability metadata must come from the trusted registry, never a client/model name. */
export function agentLibraryModelSupportsVision(model: unknown): boolean {
  const parsed = AgentLibraryModelDescriptorSchema.safeParse(model);
  return parsed.success && parsed.data.isActive && parsed.data.capabilityTags.includes("vision");
}
