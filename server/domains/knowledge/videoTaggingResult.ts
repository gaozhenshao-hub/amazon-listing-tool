import { z } from "zod";
import { validateVideoLabels } from "../../../shared/videoLabels";
import { parseKnowledgeAnalysisJson } from "./legacyImageAnalysis";

const ConversationEnvelope = z.object({
  reply: z.string(),
  result: z.unknown(),
  improvement: z.unknown().optional(),
}).strict();

/** Accept the skill's two response shapes; an envelope never applies shared improvements. */
export function parseVideoTaggingResult(content: string, duration: number) {
  const raw = parseKnowledgeAnalysisJson(content);
  const envelope = ConversationEnvelope.safeParse(raw);
  return validateVideoLabels(envelope.success ? envelope.data.result : raw, duration);
}
