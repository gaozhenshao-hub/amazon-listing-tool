export type ListingChecklistKind =
  | "bullets"
  | "title"
  | "description"
  | "searchterms"
  | "qa";

export type ChecklistScore = {
  pass: boolean;
  notes: string;
};

export type ChecklistResult = {
  checkListScores: Record<string, ChecklistScore>;
  aiSemanticRelations: Record<string, string | null> | null;
};

export const LISTING_CHECKLIST_DIMENSIONS: Record<ListingChecklistKind, readonly string[]> = {
  bullets: [
    "readability", "formatting", "layout", "sellingPointFocus", "subtitle",
    "fabe", "structured", "psychology", "faqCoverage", "quantifiedData",
    "scenes", "trustSignals", "warranty", "trafficKeywords", "aiReadability",
  ],
  title: [
    "readability", "formatting", "characterCount", "contentCoverage", "coreKeywords",
    "wordOrder", "noRepetition", "trafficKeywords", "brand", "seasonal",
  ],
  description: [
    "readability", "characterLimit", "hookOpening", "sellingPointCoverage", "keywordIntegration",
    "htmlFormatting", "specsParameters", "trustClosing",
  ],
  searchterms: [
    "byteLimit", "noTitleDuplication", "formatCompliance", "prohibitedWords", "longTailPriority",
  ],
  qa: [
    "questionNaturalness", "answerProfessionalism", "painPointCoverage", "differentiationCoverage",
    "categoryStandard", "dataQuantification", "semanticRelation", "priorityOrder",
  ],
};

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * A checklist is only persisted and rendered when each declared dimension is a
 * typed model judgment. This prevents an empty or schema-drifted model reply
 * from being misrepresented as a red 0/N scorecard.
 */
export function parseCompleteListingChecklist(
  raw: unknown,
  kind: ListingChecklistKind,
): ChecklistResult | null {
  const root = toObject(raw);
  const candidateScores = toObject(root?.checkListScores);
  if (!candidateScores) return null;

  const scores: Record<string, ChecklistScore> = {};
  for (const key of LISTING_CHECKLIST_DIMENSIONS[kind]) {
    const candidate = toObject(candidateScores[key]);
    if (!candidate || typeof candidate.pass !== "boolean" || typeof candidate.notes !== "string") {
      return null;
    }
    scores[key] = { pass: candidate.pass, notes: candidate.notes.trim() };
  }

  const semanticSource = toObject(root?.aiSemanticRelations);
  const aiSemanticRelations = semanticSource
    ? Object.fromEntries(
      ["purpose", "capability", "identity", "causation"].map((key) => {
        const value = semanticSource[key];
        return [key, typeof value === "string" ? value.trim() || null : null];
      }),
    )
    : null;

  return { checkListScores: scores, aiSemanticRelations };
}

export function isCompleteBulletChecklist(raw: unknown): boolean {
  const result = parseCompleteListingChecklist({ checkListScores: raw }, "bullets");
  return Boolean(result);
}
