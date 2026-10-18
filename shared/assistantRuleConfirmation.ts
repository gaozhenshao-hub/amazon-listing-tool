import { z } from "zod";
import { AgentLibraryRulesSchema } from "./agentLibraryContracts";
import { AssistantDigestSchema, AssistantRevisionSchema } from "./assistantConfigurations";
import { AssistantConversationOperationInputSchema, AssistantConversationConfirmRulesInputSchema } from "./assistantConversation";
import { AssistantConversationCapabilitySchema, AssistantConversationPublicIdentitySchema } from "./assistantConversationRead";

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const configuration = z.object({ revision: AssistantRevisionSchema, hash: AssistantDigestSchema }).strict();
export const AssistantRuleProposalInputSchema = AssistantConversationOperationInputSchema;
export const AssistantRuleConfirmationInputSchema = AssistantConversationConfirmRulesInputSchema;
export const AssistantRuleConfirmationOperationInputSchema = AssistantConversationOperationInputSchema.extend({
  confirmationId: uuid,
}).strict().refine(value => value.operationId !== value.confirmationId, { path: ["confirmationId"], message: "Confirmation UUID must differ from turn UUID" });

/** A proposal is a complete replacement draft. This projection never grants
 * authority to save and never silently rebases it on a later configuration. */
export const AssistantRuleProposalResultSchema = z.object({
  identity: AssistantConversationPublicIdentitySchema,
  threadId: uuid,
  operationId: uuid,
  proposalHash: AssistantDigestSchema,
  proposedRules: AgentLibraryRulesSchema,
  baseConfiguration: configuration,
  currentConfiguration: configuration.nullable(),
  capability: AssistantConversationCapabilitySchema,
  sharedScope: z.literal("workspace_agent"),
}).strict().superRefine((value, context) => {
  if (value.capability.available !== (value.capability.reasonCode === null)) {
    context.addIssue({ code: "custom", path: ["capability"], message: "Capability must explain its unavailable state" });
  }
  if (value.capability.available && (!value.currentConfiguration
    || value.baseConfiguration.revision !== value.currentConfiguration.revision
    || value.baseConfiguration.hash !== value.currentConfiguration.hash)) {
    context.addIssue({ code: "custom", path: ["capability"], message: "A stale proposal cannot be available for confirmation" });
  }
});

/** Only metadata: body/rules are owned by the single configuration/version store.
 * An absent receipt is unknown, never evidence that a write did not happen. */
export const AssistantRuleConfirmationResultSchema = z.object({
  identity: AssistantConversationPublicIdentitySchema,
  threadId: uuid,
  operationId: uuid,
  confirmationId: uuid,
  status: z.enum(["committed", "canceled", "unknown"]),
  requestHash: AssistantDigestSchema.nullable(),
  proposalHash: AssistantDigestSchema.nullable(),
  configurationRevision: AssistantRevisionSchema.nullable(),
  configurationHash: AssistantDigestSchema.nullable(),
  reasonCode: z.enum(["CONFIRMATION_UNKNOWN", "CONFIRMATION_CANCELED"]).nullable(),
}).strict().superRefine((value, context) => {
  if (value.confirmationId === value.operationId) context.addIssue({ code: "custom", path: ["confirmationId"], message: "Confirmation UUID must differ from turn UUID" });
  const committed = value.status === "committed";
  if (committed ? value.requestHash === null || value.proposalHash === null || value.configurationRevision === null || value.configurationHash === null || value.reasonCode !== null
    : value.requestHash !== null || value.proposalHash !== null || value.configurationRevision !== null || value.configurationHash !== null
      || value.reasonCode !== (value.status === "canceled" ? "CONFIRMATION_CANCELED" : "CONFIRMATION_UNKNOWN")) {
    context.addIssue({ code: "custom", message: "Invalid confirmation receipt state" });
  }
});

export type AssistantRuleProposalResult = z.infer<typeof AssistantRuleProposalResultSchema>;
export type AssistantRuleConfirmationInput = z.infer<typeof AssistantRuleConfirmationInputSchema>;
export type AssistantRuleConfirmationOperationInput = z.infer<typeof AssistantRuleConfirmationOperationInputSchema>;
export type AssistantRuleConfirmationResult = z.infer<typeof AssistantRuleConfirmationResultSchema>;
