export type ReviewedCoreRecovery = {
  id: number;
  coreId: string;
  sellingPointIndex: number;
  buyerReason: string;
  factRevisionIdsJson: unknown;
  status: string;
  revision: number;
  inputHash: string;
  confirmedBy?: number | null;
  confirmedAt?: Date | string | null;
};

export type RestoredSellingPointCore = {
  index: number;
  theme: string;
  description: string;
  fabeDirection: Record<string, string>;
  targetKeywords: string[];
  addressesGap: string;
  isRestored: true;
  serverCoreId: string;
  restoredBuyerReason: string;
};

export type SellingPointPlanMetadata = {
  overallStrategy: string;
  checkListCoverage: Record<string, string>;
  researchLimitations: string[];
  missingPlanningMetadata: boolean;
  hasReviewedEdits: boolean;
};

export function emptySellingPointPlanMetadata(): SellingPointPlanMetadata {
  return { overallStrategy: "", checkListCoverage: {}, researchLimitations: [], missingPlanningMetadata: false, hasReviewedEdits: false };
}

export function sellingPointBuyerReason(point: any): string {
  return String(point?.restoredBuyerReason || `${String(point?.theme || "").trim()}: ${String(point?.description || "").trim()}`).trim();
}

export function findSuccessfulSellingPointPlan(currentRun: any, history: any[], projectId: number) {
  return [currentRun, ...history].filter(Boolean).sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    return Number.isFinite(leftTime) && Number.isFinite(rightTime) ? rightTime - leftTime : 0;
  }).find((job) => {
    if (!job || job.projectId !== projectId || job.status !== "succeeded" || job.output?.skipped) return false;
    if (job.input?.operation !== "sellingPoints" || (job.input?.scopeKey || "main") !== "main") return false;
    const output = job.output;
    const points = output?.sellingPoints ?? output?.selling_points ?? output?.points ?? output?.bulletCores ?? output?.cores ?? output?.themes;
    return Array.isArray(points) && points.length > 0;
  }) || null;
}

/** A successful job supplies planning context, never authority to replace a reviewed buying reason. */
export function recoverSellingPointPlan(output: any, reviewedCores: ReviewedCoreRecovery[]) {
  const rawPoints = output?.sellingPoints ?? output?.selling_points ?? output?.points ?? output?.bulletCores ?? output?.cores ?? output?.themes;
  const points: Array<any | null> = Array.isArray(rawPoints) ? rawPoints.map((point) => point ? { ...point } : null) : [];
  const reviewed = buildRestoredSellingPointCores(reviewedCores);
  let hasReviewedEdits = false;
  for (let index = 0; index < reviewed.length; index += 1) {
    const core = reviewed[index];
    if (!core) continue;
    const generated = points[index];
    if (generated && sellingPointBuyerReason(generated) === core.restoredBuyerReason.trim()) {
      // Keep bilingual explanations/FABE/research from the same direction, and
      // retain the exact reviewed reason/id for server-side confirmation checks.
      points[index] = { ...generated, isRestored: true, serverCoreId: core.serverCoreId, restoredBuyerReason: core.restoredBuyerReason };
    } else {
      hasReviewedEdits ||= Boolean(generated);
      points[index] = core;
    }
  }
  const overallStrategy = output?.overallStrategy ?? output?.overall_strategy ?? output?.strategy ?? output?.summary;
  const coverage = output?.checkListCoverage;
  const limitations = output?.researchLimitations;
  const metadata: SellingPointPlanMetadata = {
    overallStrategy: typeof overallStrategy === "string" ? overallStrategy : "",
    checkListCoverage: coverage && typeof coverage === "object" && !Array.isArray(coverage)
      ? Object.fromEntries(Object.entries(coverage).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {},
    researchLimitations: (Array.isArray(limitations) ? limitations : typeof limitations === "string" ? [limitations] : [])
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    missingPlanningMetadata: reviewed.some(Boolean) && !Array.isArray(rawPoints),
    hasReviewedEdits,
  };
  return { points: points.length ? Array.from({ length: points.length }, (_, index) => points[index] ?? null) : null, metadata };
}

export function factRevisionIdsForCore(core: Pick<ReviewedCoreRecovery, "factRevisionIdsJson">): number[] {
  if (!Array.isArray(core.factRevisionIdsJson)) return [];
  return core.factRevisionIdsJson.filter((id): id is number => Number.isInteger(id) && id > 0);
}

/**
 * Recreate only the current, user-reviewed core cards.  The server is the
 * authority for confirmation; this mapper deliberately does not assign a
 * local `confirmed` flag or convert draft/rejected history into confirmation.
 */
export function buildRestoredSellingPointCores(cores: ReviewedCoreRecovery[]): Array<RestoredSellingPointCore | null> {
  const current = cores
    .filter((core) => (core.status === "draft" || core.status === "confirmed")
      && Number.isInteger(core.sellingPointIndex) && core.sellingPointIndex >= 0 && core.sellingPointIndex <= 8)
    .sort((left, right) => left.sellingPointIndex - right.sellingPointIndex || right.revision - left.revision);
  const highestIndex = current.reduce((highest, core) => Math.max(highest, core.sellingPointIndex), -1);
  if (highestIndex < 0) return [];

  const restored: Array<RestoredSellingPointCore | null> = Array.from({ length: highestIndex + 1 }, () => null);
  for (const core of current) {
    if (restored[core.sellingPointIndex]) continue;
    const separator = core.buyerReason.indexOf(": ");
    const theme = separator > 0 ? core.buyerReason.slice(0, separator) : "已审核核心";
    const description = separator > 0 ? core.buyerReason.slice(separator + 2) : core.buyerReason;
    restored[core.sellingPointIndex] = {
      index: core.sellingPointIndex + 1,
      theme,
      description,
      fabeDirection: {},
      targetKeywords: [],
      addressesGap: "",
      isRestored: true,
      serverCoreId: core.coreId,
      // Preserve the exact reviewed value until an operator explicitly edits it.
      restoredBuyerReason: core.buyerReason,
    };
  }
  return restored;
}

/** A candidate can be displayed for audit, but only current confirmed facts unlock review actions. */
export function hasCurrentConfirmedEvidence(
  core: Pick<ReviewedCoreRecovery, "factRevisionIdsJson">,
  confirmedFactIds: ReadonlySet<number>,
): boolean {
  const factIds = factRevisionIdsForCore(core);
  return factIds.length > 0 && factIds.every((id) => confirmedFactIds.has(id));
}
