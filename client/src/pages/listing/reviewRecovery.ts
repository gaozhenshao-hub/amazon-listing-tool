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
