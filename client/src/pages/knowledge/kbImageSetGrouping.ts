export type AsinSetGroupBy = "none" | "category" | "brand" | "style" | "primaryColor" | "accentColor" | "status";

export const ASIN_SET_GROUP_OPTIONS: Array<{ value: AsinSetGroupBy; label: string }> = [
  { value: "none", label: "不分组" },
  { value: "category", label: "套图类目" },
  { value: "brand", label: "品牌" },
  { value: "style", label: "推荐风格" },
  { value: "primaryColor", label: "主颜色" },
  { value: "accentColor", label: "提亮色" },
  { value: "status", label: "入库状态" },
];

function groupValue(set: any, groupBy: AsinSetGroupBy): string {
  switch (groupBy) {
    case "category":
      return set.setCategory || set.category || "未分类";
    case "brand":
      return set.brand || "未填写品牌";
    case "style":
      return set.setStyle || "未设置风格";
    case "primaryColor":
      return set.setPrimaryColor || "未设置主色";
    case "accentColor":
      return set.setAccentColor || "未设置提亮色";
    case "status":
      return set.status || "未知状态";
    default:
      return "全部 ASIN";
  }
}

export function groupImageSets<T>(sets: T[], groupBy: AsinSetGroupBy): Array<{ key: string; items: T[] }> {
  if (groupBy === "none") return [{ key: "all", items: sets }];
  const groups = new Map<string, T[]>();
  for (const set of sets) {
    const key = groupValue(set, groupBy);
    const items = groups.get(key) || [];
    items.push(set);
    groups.set(key, items);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => {
      const leftMissing = /^(未|未知)/.test(left);
      const rightMissing = /^(未|未知)/.test(right);
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      return left.localeCompare(right, "zh-CN");
    })
    .map(([key, items]) => ({ key, items }));
}
