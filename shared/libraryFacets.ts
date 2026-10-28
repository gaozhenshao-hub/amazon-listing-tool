export type FacetRow = Record<string, string | string[] | null | undefined>;
export type FacetSelection = Record<string, string | undefined>;
export type LibraryFacets = {
  total: number;
  counts: Record<string, Record<string, number>>;
  totals: Record<string, number>;
  groups: Record<string, number>;
};
const values = (value: FacetRow[string], key: string) =>
  Array.isArray(value)
    ? [...new Set(value)]
    : [value === "" && key === "accentColor" ? "__none" : (value ?? "")];
/** Rows are already scoped and searched. Each facet excludes only its own selection. */
export function libraryFacets(
  rows: FacetRow[],
  selection: FacetSelection,
  keys: readonly string[],
  groupBy?: string
): LibraryFacets {
  const result: LibraryFacets = {
    total: 0,
    counts: Object.fromEntries(keys.map(k => [k, {}])),
    totals: Object.fromEntries(keys.map(k => [k, 0])),
    groups: {},
  };
  for (const row of rows) {
    const mismatches = keys.filter(
      key => selection[key] && !values(row[key], key).includes(selection[key]!)
    );
    if (!mismatches.length) {
      result.total++;
      if (groupBy && groupBy !== "none") {
        const group = String(row[groupBy] || "待设置");
        result.groups[group] = (result.groups[group] || 0) + 1;
      }
    }
    for (const key of keys) {
      if (mismatches.some(k => k !== key)) continue;
      result.totals[key]++;
      for (const value of values(row[key], key))
        if (value)
          result.counts[key][value] = (result.counts[key][value] || 0) + 1;
    }
  }
  return result;
}
