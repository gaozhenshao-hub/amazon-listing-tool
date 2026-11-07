import type { PickCompetitor, PickSheetData } from "./productSelection";

type Units = number | null;
export const PICK_SALES_LEVELS = ["头部", "中上", "中下", "尾部"] as const;
export type PickRow = PickCompetitor & {
  number: number;
  parentBrand: string;
  monthSales: Units;
  trend: Units[];
  salesLevel: string;
  priceLevel: string;
  age: string;
  tagIds: string[];
  manualSales: boolean;
};

export function completePickMonths(asOf: string) {
  const [year, month] = asOf.split("-").map(Number);
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (12 - index), 1));
    return date.toISOString().slice(0, 7);
  });
}

export function pickAge(listedOn: string | null, asOf: string) {
  if (!listedOn || listedOn > asOf) return "未知";
  const [year, month, day] = listedOn.split("-").map(Number);
  const atMostMonths = (count: number) => {
    const boundary = new Date(Date.UTC(year, month - 1 + count, 1));
    const lastDay = new Date(
      Date.UTC(boundary.getUTCFullYear(), boundary.getUTCMonth() + 1, 0)
    ).getUTCDate();
    boundary.setUTCDate(Math.min(day, lastDay));
    return asOf <= boundary.toISOString().slice(0, 10);
  };
  for (const [months, label] of [
    [3, "纯新"],
    [6, "新"],
    [12, "半新"],
    [24, "老品"],
  ] as const)
    if (atMostMonths(months)) return label;
  return "很老";
}

const sumKnown = (values: readonly Units[]) => {
  const known = values.filter((value): value is number => value !== null);
  return {
    total: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
    known: known.length,
    missing: values.length - known.length,
  };
};
const maxKnown = (before: Units, after: Units) =>
  after === null ? before : Math.max(before ?? after, after);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
function comparableSpec(row: PickCompetitor) {
  const sku = row.sku
    .normalize("NFKC")
    .toLowerCase()
    .split("|")
    .map(part => part.trim())
    .filter(part => part && !/^(?:color|colour|颜色)\s*:/u.test(part))
    .sort()
    .join("|");
  return row.category && sku ? row.category.toLowerCase() + "|" + sku : "";
}

export function pickAnalysis(
  sheet: Pick<PickSheetData, "imported" | "manualSales" | "rowTags">,
  today: string
) {
  const { imported } = sheet;
  const months = completePickMonths(
    imported.history?.asOf ?? imported.snapshot?.asOf ?? today
  );
  const history = new Map(imported.historyRows.map(row => [row.asin, row]));
  const parents = new Map<
    string,
    { number: number; brand: string; sales: Units; trend: Units[] }
  >();
  const pricePeers = new Map<string, Map<string, number[]>>();
  let matchedChildren = 0,
    conflictingParents = 0;
  for (const row of imported.rows) {
    const parent = parents.get(row.parentAsin) ?? {
      number: parents.size + 1,
      brand: "",
      sales: null,
      trend: months.map(() => null),
    };
    parent.brand ||= row.brand;
    parent.sales = maxKnown(parent.sales, row.parentSales);
    const candidate = history.get(row.asin);
    if (candidate) {
      if (
        candidate.parentAsin &&
        candidate.parentAsin !== row.parentAsin &&
        row.parentAsin !== row.asin
      )
        conflictingParents++;
      else {
        matchedChildren++;
        months.forEach((month, index) => {
          parent.trend[index] = maxKnown(
            parent.trend[index],
            candidate.values[month] ?? null
          );
        });
      }
    }
    parents.set(row.parentAsin, parent);
    const specification = comparableSpec(row);
    if (specification && row.price !== null && row.price > 0) {
      const peers =
        pricePeers.get(specification) ?? new Map<string, number[]>();
      const parentPrices = peers.get(row.parentAsin) ?? [];
      parentPrices.push(row.price);
      peers.set(row.parentAsin, parentPrices);
      pricePeers.set(specification, peers);
    }
  }
  const baselines = new Map(
    [...pricePeers]
      .filter(([, peers]) => peers.size >= 3)
      .map(([spec, peers]) => [spec, median([...peers.values()].map(median))])
  );
  const sales = [
    ...new Set(
      [...parents.values()].flatMap(parent =>
        parent.sales === null ? [] : [parent.sales]
      )
    ),
  ].sort((a, b) => b - a);
  const levels = new Map(
    sales.map((value, index) => [
      value,
      PICK_SALES_LEVELS[Math.floor((4 * index) / sales.length)],
    ])
  );
  const rows: PickRow[] = imported.rows.map(row => {
    const parent = parents.get(row.parentAsin)!;
    const benchmark = baselines.get(comparableSpec(row));
    const manualSales = Object.hasOwn(sheet.manualSales, row.asin);
    return {
      ...row,
      number: parent.number,
      parentBrand: parent.brand || row.brand,
      monthSales: parent.sales,
      trend: parent.trend,
      salesLevel: parent.sales === null ? "待评级" : levels.get(parent.sales)!,
      priceLevel:
        !benchmark || row.price === null || row.price <= 0
          ? "待评级"
          : row.price < benchmark * 0.85
            ? "低价"
            : row.price > benchmark * 1.15
              ? "高价"
              : "中价",
      age: pickAge(row.listedOn, imported.snapshot?.asOf ?? today),
      childSales: manualSales ? sheet.manualSales[row.asin] : row.childSales,
      tagIds: sheet.rowTags[row.asin] ?? [],
      manualSales,
    };
  });
  return {
    months,
    rows,
    matchedChildren,
    conflictingParents,
    parentCount: parents.size,
  };
}

export function summarizePickRows(
  rows: readonly PickRow[],
  scope: "parent" | "child"
) {
  const parents = new Map(rows.map(row => [row.parentAsin, row]));
  const children = [...new Map(rows.map(row => [row.asin, row])).values()];
  const sales = sumKnown(
    scope === "parent"
      ? [...parents.values()].map(row => row.monthSales)
      : children.map(row => row.childSales)
  );
  const average = (values: Units[]) => {
    const { total, known } = sumKnown(values);
    return { value: total === null ? null : total / known, known };
  };
  return {
    sales,
    parents: parents.size,
    children: children.length,
    price: average(children.map(row => row.price)),
    reviews: average(children.map(row => row.reviews)),
    rating: average(children.map(row => row.rating)),
  };
}

export function chartPickParents(
  rows: readonly PickRow[],
  months: readonly string[]
) {
  const parents = [...new Map(rows.map(row => [row.parentAsin, row])).values()];
  const brandTotals = new Map<string, { brand: string; sales: number }>();
  for (const row of parents) {
    if (row.monthSales === null) continue;
    const brand = row.parentBrand || "未知品牌",
      key = brand.normalize("NFKC").toLowerCase();
    const previous = brandTotals.get(key);
    brandTotals.set(key, {
      brand: previous?.brand ?? brand,
      sales: (previous?.sales ?? 0) + row.monthSales,
    });
  }
  return {
    trend: months.map((month, index) => ({
      month,
      ...sumKnown(parents.map(row => row.trend[index])),
    })),
    brands: [...brandTotals.values()].sort(
      (left, right) => right.sales - left.sales
    ),
    parentCount: parents.length,
    missing: parents.filter(row => row.monthSales === null).length,
  };
}
