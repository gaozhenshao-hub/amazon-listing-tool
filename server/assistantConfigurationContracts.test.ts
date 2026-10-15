import { describe, expect, it } from "vitest";
import {
  ASSISTANT_CONFIGURATION_MAX_BYTES, AssistantConfigurationSchema,
  AssistantHistoryInputSchema, AssistantRollbackInputSchema, AssistantSaveInputSchema,
  AssistantScopePreconditionSchema,
  AssistantRulesSaveInputSchema, AssistantRulesRestoreInputSchema,
} from "../shared/assistantConfigurations";

const binding = () => ({ slug: "listing.example", version: 2, manifestSha256: "a".repeat(64), enabled: false, trigger: "", instructions: "" });
const config = () => ({ name: "专属助手", description: "", enabled: false, modelSlug: "", instructions: "", rules: [], skills: [binding()] });

describe("assistant saved configuration contracts", () => {
  it("requires an explicit version and trusted-content digest even for a disabled binding", () => {
    expect(AssistantConfigurationSchema.parse(config()).skills[0]).toEqual(binding());
    const { manifestSha256: _digest, ...withoutDigest } = binding();
    expect(AssistantConfigurationSchema.safeParse({ ...config(), skills: [withoutDigest] }).success).toBe(false);
    expect(AssistantConfigurationSchema.safeParse({ ...config(), skills: [{ ...binding(), version: 0 }] }).success).toBe(false);
  });
  it("preserves explicit false/empty inheritance instead of enabling defaults", () => {
    const parsed = AssistantConfigurationSchema.parse(config());
    expect(parsed.enabled).toBe(false); expect(parsed.modelSlug).toBe(""); expect(parsed.rules).toEqual([]);
    const { enabled: _enabled, ...missing } = config();
    expect(AssistantConfigurationSchema.safeParse(missing).success).toBe(false);
  });
  it("rejects duplicate bindings, unknown keys and client workspace overrides", () => {
    expect(AssistantConfigurationSchema.safeParse({ ...config(), skills: [binding(), binding()] }).success).toBe(false);
    expect(AssistantSaveInputSchema.safeParse({ expectedWorkspaceId: 7, agentKey: "listing", expectedRevision: 0, config: config(), workspaceId: 99 }).success).toBe(false);
    expect(AssistantConfigurationSchema.safeParse({ ...config(), extra: "not saved" }).success).toBe(false);
  });
  it("bounds the entire UTF-8 configuration rather than only each prompt field", () => {
    const large = { ...config(), skills: Array.from({ length: 20 }, (_, i) => ({ ...binding(), slug: `skill.${i}`, instructions: "中".repeat(4000) })) };
    expect(new TextEncoder().encode(JSON.stringify(large)).length).toBeGreaterThan(ASSISTANT_CONFIGURATION_MAX_BYTES);
    expect(AssistantConfigurationSchema.safeParse(large).success).toBe(false);
  });
  it("uses revision0 only for creation and never as a restored saved version", () => {
    expect(AssistantSaveInputSchema.parse({ expectedWorkspaceId: 7, agentKey: "listing", expectedRevision: 0, config: config() }).expectedRevision).toBe(0);
    expect(AssistantRollbackInputSchema.safeParse({ expectedWorkspaceId: 7, agentKey: "listing", expectedRevision: 2, targetRevision: 0 }).success).toBe(false);
    expect(AssistantSaveInputSchema.safeParse({ expectedWorkspaceId: 7, agentKey: "listing", expectedRevision: 2_147_483_648, config: config() }).success).toBe(false);
  });
  it("bounds sensitive history pagination and disallows workspace or user inputs", () => {
    expect(AssistantHistoryInputSchema.parse({ expectedWorkspaceId: 7, agentKey: "listing" }).limit).toBe(10);
    expect(AssistantHistoryInputSchema.safeParse({ expectedWorkspaceId: 7, agentKey: "listing", limit: 21 }).success).toBe(false);
    expect(AssistantHistoryInputSchema.safeParse({ expectedWorkspaceId: 7, agentKey: "listing", userId: 9 }).success).toBe(false);
  });
  it("requires a bounded workspace freshness precondition, never a target override", () => {
    expect(AssistantScopePreconditionSchema.parse({ expectedWorkspaceId: 7 })).toEqual({ expectedWorkspaceId: 7 });
    for (const expectedWorkspaceId of [undefined, 0, -1, 1.5, 2_147_483_648]) {
      expect(AssistantScopePreconditionSchema.safeParse({ expectedWorkspaceId }).success).toBe(false);
    }
    expect(AssistantScopePreconditionSchema.safeParse({ expectedWorkspaceId: 7, workspaceId: 99 }).success).toBe(false);
  });
  it("rules-only requests preserve array boundaries and reject hidden configuration or legacy proposal writes", () => {
    const input = { expectedWorkspaceId: 7, agentKey: "tagger", expectedRevision: 2, rules: ["一条规则\n第二段", "另一条\r\n示例"] };
    expect(AssistantRulesSaveInputSchema.parse(input).rules).toEqual(input.rules);
    expect(AssistantRulesSaveInputSchema.parse({ ...input, rules: [] }).rules).toEqual([]);
    for (const extra of [{ modelSlug: "changed" }, { config: config() }, { workspaceId: 99 }, { proposalId: "unowned-proposal" }]) {
      expect(AssistantRulesSaveInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
    expect(AssistantRulesSaveInputSchema.safeParse({ ...input, expectedRevision: undefined }).success).toBe(false);
    expect(AssistantRulesSaveInputSchema.safeParse({ ...input, rules: [{ instruction: "not a string rule" }] }).success).toBe(false);
  });
  it("rules-only restore requires a saved target and the current configuration revision", () => {
    const input = { expectedWorkspaceId: 7, agentKey: "tagger", expectedRevision: 4, targetRevision: 1 };
    expect(AssistantRulesRestoreInputSchema.parse(input)).toEqual(input);
    expect(AssistantRulesRestoreInputSchema.safeParse({ ...input, targetRevision: 0 }).success).toBe(false);
    expect(AssistantRulesRestoreInputSchema.safeParse({ ...input, expectedRevision: undefined }).success).toBe(false);
    expect(AssistantRulesRestoreInputSchema.safeParse({ ...input, rules: ["cannot bypass the stored target"] }).success).toBe(false);
  });
});
