/** Registry-row context projection shared by pure source admission and the
 * private context builder. Type-only leaf: no service, repository or runtime
 * initialization belongs here. The projection itself grants no authorization. */
export type AssistantConversationContextSkill = {
  workspaceId: number | null; scope: string; slug: string; name: string;
  version: number; status: string; manifest: unknown;
};
