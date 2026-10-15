import { z } from "zod";
import {
  AGENT_LIBRARY_LIMITS, AgentLibraryConfigSchema, AgentLibraryKeySchema,
  AgentLibrarySkillBindingSchema, type AgentLibraryKey,
} from "./agentLibraryContracts";

/** Configuration only: importing this module never enables or dispatches an Agent. */
export const ASSISTANT_CONFIGURATION_MAX_BYTES = 128 * 1024;
export const ASSISTANT_CONFIGURATION_MAX_REVISION = 2_147_483_647;
export const AssistantRevisionSchema = z.number().int().min(1).max(ASSISTANT_CONFIGURATION_MAX_REVISION);
export const AssistantExpectedRevisionSchema = z.number().int().min(0).max(ASSISTANT_CONFIGURATION_MAX_REVISION);
export const AssistantDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const AssistantSkillBindingSchema = AgentLibrarySkillBindingSchema.extend({
  version: AssistantRevisionSchema,
  // The server recomputes this from the authorized registry manifest at save.
  // A mutable registry version number alone does not identify exact contents.
  manifestSha256: AssistantDigestSchema,
}).strict();

export const AssistantConfigurationSchema = AgentLibraryConfigSchema.safeExtend({
  skills: z.array(AssistantSkillBindingSchema).max(AGENT_LIBRARY_LIMITS.skillBindings),
}).strict().superRefine((config, context) => {
  if (new TextEncoder().encode(JSON.stringify(config)).byteLength > ASSISTANT_CONFIGURATION_MAX_BYTES) {
    context.addIssue({ code: "custom", message: "专属配置总大小不能超过128KiB（UTF-8）" });
  }
});
export type AssistantConfiguration = z.infer<typeof AssistantConfigurationSchema>;

// A request freshness precondition only. Authorization and the actual target
// workspace always come from the authenticated server context.
export const AssistantScopePreconditionSchema = z.object({
  expectedWorkspaceId: AssistantRevisionSchema,
}).strict();
export const AssistantKeyInputSchema = AssistantScopePreconditionSchema.extend({ agentKey: AgentLibraryKeySchema }).strict();
export const AssistantSaveInputSchema = AssistantKeyInputSchema.extend({
  expectedRevision: AssistantExpectedRevisionSchema,
  config: AssistantConfigurationSchema,
}).strict();
export const AssistantRollbackInputSchema = AssistantKeyInputSchema.extend({
  expectedRevision: AssistantExpectedRevisionSchema,
  targetRevision: AssistantRevisionSchema,
}).strict();
export const AssistantVersionInputSchema = AssistantKeyInputSchema.extend({ revision: AssistantRevisionSchema }).strict();
export const AssistantHistoryInputSchema = AssistantKeyInputSchema.extend({
  beforeRevision: AssistantRevisionSchema.optional(),
  limit: z.number().int().min(1).max(20).default(10),
}).strict();

export type AssistantConfigurationRecord = {
  agentKey: AgentLibraryKey;
  revision: number;
  config: AssistantConfiguration;
  updatedAt: string;
};
export type AssistantConfigurationRead =
  | { status: "not-configured"; agentKey: AgentLibraryKey }
  | { status: "configured"; record: AssistantConfigurationRecord };

type MetadataBase = { agentKey: AgentLibraryKey; skillCount: number; ruleCount: number };
export type AssistantConfigurationMetadata = MetadataBase & (
  | {
    status: "not-configured"; revision: null; name: null; description: null;
    enabled: null; modelSlug: null; updatedAt: null;
  }
  | {
    status: "configured"; revision: number; name: string; description: string;
    enabled: boolean; modelSlug: string; updatedAt: string;
  }
);
export type AssistantModelOption = {
  slug: string; name: string; modelId: string; capabilityTags: string[];
};
export type AssistantSkillOption = {
  slug: string; name: string; version: number; manifestSha256: string;
};
export type AssistantConfigurationOptions = {
  models: AssistantModelOption[]; skills: AssistantSkillOption[];
  /** Server switch, independent of frontend navigation and permission grants. */
  writeEnabled: boolean;
};
export type AssistantConfigurationHistoryItem = {
  revision: number; sourceRevision: number | null; createdAt: string; createdBy: number;
};
export type AssistantConfigurationHistory = {
  versions: AssistantConfigurationHistoryItem[]; nextBeforeRevision: number | null;
};
export type AssistantConfigurationVersion = {
  agentKey: AgentLibraryKey; revision: number; config: AssistantConfiguration;
  createdAt: string; sourceRevision: number | null;
};
