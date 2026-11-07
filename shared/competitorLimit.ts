/** A project may hold at most five distinct competitors, including in-flight captures. */
export const MAX_PROJECT_COMPETITORS = 5;

export function hasCompetitorCapacity(existing: readonly string[], incoming: string): boolean {
  const asins = new Set(existing.map(value => value.trim().toUpperCase()).filter(Boolean));
  const asin = incoming.trim().toUpperCase();
  return asins.has(asin) || asins.size < MAX_PROJECT_COMPETITORS;
}
