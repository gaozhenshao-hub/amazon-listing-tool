import { describe, expect, it } from "vitest";
import { AssistantRuleConfirmationInputSchema, AssistantRuleConfirmationOperationInputSchema, AssistantRuleConfirmationResultSchema, AssistantRuleProposalResultSchema } from "../shared/assistantRuleConfirmation";

const threadId = "a0000000-0000-4000-8000-000000000001", operationId = "a0000000-0000-4000-8000-000000000002", confirmationId = "a0000000-0000-4000-8000-000000000003";
const hash = "a".repeat(64), identity = { workspaceId: 1, userId: 2, agentKey: "listing" as const };
const scope = { expectedWorkspaceId: 1, agentKey: "listing" as const, threadId, operationId, confirmationId };
const input = { ...scope, expectedProposalHash: hash, expectedConfigurationRevision: 3, expectedConfigurationHash: hash, rules: ["Use confirmed facts"], confirmSharedScope: true, confirmClearAll: false };
const result = { identity, threadId, operationId, confirmationId, status: "committed", requestHash: hash, proposalHash: hash, configurationRevision: 4, configurationHash: hash, reasonCode: null };
const proposal = { identity, threadId, operationId, proposalHash: hash, proposedRules: ["Keep all confirmed rules"], baseConfiguration: { revision: 3, hash }, currentConfiguration: { revision: 3, hash }, capability: { available: true, reasonCode: null }, sharedScope: "workspace_agent" };

describe("private full-rule confirmation protocol", () => {
  it("requires distinct fixed confirmation identity and explicit shared replacement consent", () => {
    expect(AssistantRuleConfirmationInputSchema.parse(input)).toEqual(input);
    expect(AssistantRuleConfirmationInputSchema.safeParse({ ...input, confirmSharedScope: false }).success).toBe(false);
    expect(AssistantRuleConfirmationInputSchema.safeParse({ ...input, confirmationId: operationId }).success).toBe(false);
  });
  it("permits deliberate empty complete replacement only with clear-all consent", () => {
    expect(AssistantRuleConfirmationInputSchema.safeParse({ ...input, rules: [] }).success).toBe(false);
    expect(AssistantRuleConfirmationInputSchema.parse({ ...input, rules: [], confirmClearAll: true }).rules).toEqual([]);
  });
  it("normalizes identity UUID and each rule before logical hashing", () => {
    expect(AssistantRuleConfirmationInputSchema.parse({ ...input, confirmationId: confirmationId.toUpperCase(), rules: ["  Keep this rule  "] })).toMatchObject({ confirmationId, rules: ["Keep this rule"] });
  });
  it.each(["expectedProposalHash", "expectedConfigurationHash", "expectedConfigurationRevision", "confirmSharedScope", "confirmClearAll"])("does not default missing %s", field => {
    const missing: Record<string, unknown> = { ...input }; delete missing[field];
    expect(AssistantRuleConfirmationInputSchema.safeParse(missing).success).toBe(false);
  });
  it.each([{ userId: 9 }, { workspaceId: 9 }, { append: true }, { skipConfirmation: true }])("rejects caller-supplied authority or alternate write semantics %j", extra => {
    expect(AssistantRuleConfirmationInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });
  it.each([0, -1, 1.5, 2147483648])("rejects invalid configuration revision %s", revision => {
    expect(AssistantRuleConfirmationInputSchema.safeParse({ ...input, expectedConfigurationRevision: revision }).success).toBe(false);
  });
  it("recovery needs only immutable identities, never plaintext rules or a new mutable base", () => {
    expect(AssistantRuleConfirmationOperationInputSchema.parse(scope)).toEqual(scope);
    expect(AssistantRuleConfirmationOperationInputSchema.safeParse(input).success).toBe(false);
    expect(AssistantRuleConfirmationOperationInputSchema.safeParse({ ...scope, confirmationId: operationId }).success).toBe(false);
  });
  it("permits complete or intentionally empty proposal with matching current/base configuration", () => {
    expect(AssistantRuleProposalResultSchema.parse(proposal)).toEqual(proposal);
    expect(AssistantRuleProposalResultSchema.safeParse({ ...proposal, proposedRules: [] }).success).toBe(true);
  });
  it.each([null, { revision: 4, hash }, { revision: 3, hash: "b".repeat(64) }])("stale/missing current configuration cannot claim an available write %j", currentConfiguration => {
    expect(AssistantRuleProposalResultSchema.safeParse({ ...proposal, currentConfiguration }).success).toBe(false);
    expect(AssistantRuleProposalResultSchema.safeParse({ ...proposal, currentConfiguration, capability: { available: false, reasonCode: "CONFIGURATION_CONFLICT" } }).success).toBe(true);
  });
  it("requires explicit unavailability reason and forbids a false success reason", () => {
    expect(AssistantRuleProposalResultSchema.safeParse({ ...proposal, capability: { available: false, reasonCode: null } }).success).toBe(false);
    expect(AssistantRuleProposalResultSchema.safeParse({ ...proposal, capability: { available: true, reasonCode: "UNAVAILABLE" } }).success).toBe(false);
  });
  it("accepts committed metadata with no secret/plaintext fields", () => {
    expect(AssistantRuleConfirmationResultSchema.parse(result)).toEqual(result);
    expect(AssistantRuleConfirmationResultSchema.safeParse({ ...result, rules: input.rules }).success).toBe(false);
    expect(AssistantRuleConfirmationResultSchema.safeParse({ ...result, message: "private" }).success).toBe(false);
  });
  it.each(["requestHash", "proposalHash", "configurationRevision", "configurationHash"])("committed must bind %s", field => {
    expect(AssistantRuleConfirmationResultSchema.safeParse({ ...result, [field]: null }).success).toBe(false);
  });
  it.each(["unknown", "canceled"] as const)("%s is not a successful configuration write", status => {
    const recovery = { ...result, status, requestHash: null, proposalHash: null, configurationRevision: null, configurationHash: null, reasonCode: status === "unknown" ? "CONFIRMATION_UNKNOWN" : "CONFIRMATION_CANCELED" };
    expect(AssistantRuleConfirmationResultSchema.parse(recovery)).toEqual(recovery);
    expect(AssistantRuleConfirmationResultSchema.safeParse({ ...recovery, configurationRevision: 4 }).success).toBe(false);
    expect(AssistantRuleConfirmationResultSchema.safeParse({ ...recovery, reasonCode: null }).success).toBe(false);
  });
  it("rejects success-with-unknown-reason and mixed original/confirmation identity", () => {
    expect(AssistantRuleConfirmationResultSchema.safeParse({ ...result, reasonCode: "CONFIRMATION_UNKNOWN" }).success).toBe(false);
    expect(AssistantRuleConfirmationResultSchema.safeParse({ ...result, confirmationId: operationId }).success).toBe(false);
  });
});
