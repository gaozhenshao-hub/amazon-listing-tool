import { protectedProcedure, router } from "../../../_core/trpc";
import { AssistantConversationCreateThreadInputSchema, AssistantConversationThreadsInputSchema, AssistantConversationHistoryInputSchema, AssistantConversationSubmitInputSchema, AssistantConversationOperationInputSchema } from "../../../../shared/assistantConversation";
import { AssistantConversationOptionsInputSchema, AssistantConversationAttachmentInputSchema, AssistantConversationOptionsResultSchema, AssistantConversationThreadResultSchema, AssistantConversationThreadsResultSchema, AssistantConversationHistoryResultSchema, AssistantConversationOperationResultSchema, AssistantConversationAttachmentsResultSchema, AssistantConversationAttachmentResultSchema } from "../../../../shared/assistantConversationRead";
import { assistantConversationService } from "../services/assistantConversations";
import { AssistantRuleProposalInputSchema, AssistantRuleProposalResultSchema, AssistantRuleConfirmationInputSchema, AssistantRuleConfirmationOperationInputSchema, AssistantRuleConfirmationResultSchema } from "../../../../shared/assistantRuleConfirmation";

/** Every handler authorizes the fresh persisted actor inside the private repository transaction. */
export const assistantConversationsRouter = router({
  options: protectedProcedure.input(AssistantConversationOptionsInputSchema).output(AssistantConversationOptionsResultSchema).query(({ ctx, input }) => assistantConversationService.options(ctx, input)),
  createThread: protectedProcedure.input(AssistantConversationCreateThreadInputSchema).output(AssistantConversationThreadResultSchema).mutation(({ ctx, input }) => assistantConversationService.createThread(ctx, input)),
  threads: protectedProcedure.input(AssistantConversationThreadsInputSchema).output(AssistantConversationThreadsResultSchema).query(({ ctx, input }) => assistantConversationService.threads(ctx, input)),
  history: protectedProcedure.input(AssistantConversationHistoryInputSchema).output(AssistantConversationHistoryResultSchema).query(({ ctx, input }) => assistantConversationService.history(ctx, input)),
  submit: protectedProcedure.input(AssistantConversationSubmitInputSchema).output(AssistantConversationOperationResultSchema).mutation(({ ctx, input }) => assistantConversationService.submit(ctx, input)),
  check: protectedProcedure.input(AssistantConversationOperationInputSchema).output(AssistantConversationOperationResultSchema).query(({ ctx, input }) => assistantConversationService.check(ctx, input)),
  cancel: protectedProcedure.input(AssistantConversationOperationInputSchema).output(AssistantConversationOperationResultSchema).mutation(({ ctx, input }) => assistantConversationService.cancel(ctx, input)),
  attachments: protectedProcedure.input(AssistantConversationOperationInputSchema).output(AssistantConversationAttachmentsResultSchema).query(({ ctx, input }) => assistantConversationService.attachments(ctx, input)),
  attachment: protectedProcedure.input(AssistantConversationAttachmentInputSchema).output(AssistantConversationAttachmentResultSchema).query(({ ctx, input }) => assistantConversationService.attachment(ctx, input)),
  ruleProposal: protectedProcedure.input(AssistantRuleProposalInputSchema).output(AssistantRuleProposalResultSchema).query(({ ctx, input }) => assistantConversationService.ruleProposal(ctx, input)),
  confirmRules: protectedProcedure.input(AssistantRuleConfirmationInputSchema).output(AssistantRuleConfirmationResultSchema).mutation(({ ctx, input }) => assistantConversationService.confirmRules(ctx, input)),
  checkRuleConfirmation: protectedProcedure.input(AssistantRuleConfirmationOperationInputSchema).output(AssistantRuleConfirmationResultSchema).query(({ ctx, input }) => assistantConversationService.checkRuleConfirmation(ctx, input)),
  cancelRuleConfirmation: protectedProcedure.input(AssistantRuleConfirmationOperationInputSchema).output(AssistantRuleConfirmationResultSchema).mutation(({ ctx, input }) => assistantConversationService.cancelRuleConfirmation(ctx, input)),
});
