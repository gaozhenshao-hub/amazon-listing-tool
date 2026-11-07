import { imageOutlineSchema, type ImageOutline } from "./imagePlanning";
export const outlineEditableFields = [
  "title",
  "content",
  "width",
  "height",
  "mobileWidth",
  "mobileHeight",
  "featureIds",
  "benefitIds",
  "reviewIds",
  "questionIds",
] as const;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export const hasOutlineResult = (data: ImageOutline) =>
  data.groups.some(
    g =>
      !!g.brief?.trim() ||
      !!g.title.trim() ||
      !!g.manualFields?.length ||
      g.items.some(
        i => !!i.content.trim() || !!i.title?.trim() || !!i.manualFields?.length
      )
  );
/** Human changes are tracked by stable image IDs; reference selection is always preserved. */
export function recordManualOutline(
  previous: ImageOutline,
  incoming: ImageOutline
) {
  const next = structuredClone(incoming),
    old = new Map(previous.groups.flatMap(g => g.items).map(i => [i.id, i]));
  for (const group of next.groups) {
    const before = previous.groups.find(g => g.id === group.id);
    const meaningful =
      !!before ||
      !!group.brief?.trim() ||
      !!group.title.trim() ||
      group.items.some(i => !!i.title?.trim() || !!i.content.trim());
    const changed = meaningful
      ? [
          "brief",
          "title",
          "family",
          "moduleType",
          "moduleNumbers",
          "mergedParts",
        ].filter(k => !same((before as any)?.[k], (group as any)[k]))
      : [];
    if (
      before &&
      !same(
        before.items.map(i => i.id),
        group.items.map(i => i.id)
      )
    )
      changed.push("structure");
    const fields = [
      ...new Set([
        ...(before?.manualFields || []),
        ...(group.manualFields || []),
        ...changed,
      ]),
    ];
    if (fields.length) group.manualFields = fields;
  }
  for (const item of next.groups.flatMap(g => g.items)) {
    const before = old.get(item.id),
      changed = outlineEditableFields.filter(k =>
        before
          ? !same(before[k], item[k])
          : !!item.content.trim() || !!item.title?.trim()
      );
    const fields = [
      ...new Set([
        ...(before?.manualFields || []),
        ...(item.manualFields || []),
        ...changed,
      ]),
    ];
    if (fields.length) item.manualFields = fields;
    if (changed.length) item.manualChangedAt = new Date().toISOString();
    else if (before?.manualChangedAt)
      item.manualChangedAt = before.manualChangedAt;
  }
  next.manualTrackingVersion = 1;
  return imageOutlineSchema.parse(next);
}
export function outlineRefinementFields(data: ImageOutline) {
  const fields: Record<string, { value: unknown; protected: boolean }> = {};
  for (const group of data.groups) {
    fields[`group:${group.id}:brief`] = {
      value: group.brief || "",
      protected: !!group.manualFields?.includes("brief"),
    };
    // Group identity, layout, order and slots are deliberately outside the patch protocol.
    for (const item of group.items)
      for (const key of outlineEditableFields) {
        const value = item[key];
        if (value !== undefined)
          fields[`item:${item.id}:${key}`] = {
            value,
            protected: !!item.manualFields?.includes(key),
          };
      }
  }
  return fields;
}
export function applyOutlineRefinement(
  data: ImageOutline,
  changes: Array<{ key: string; original: unknown; value: unknown }>
) {
  const fields = outlineRefinementFields(data),
    next = structuredClone(data),
    seen = new Set<string>();
  let protectedCount = 0;
  for (const change of changes) {
    const field = fields[change.key];
    if (!field || seen.has(change.key) || !same(field.value, change.original))
      throw new Error("大纲字段已变化，请基于当前大纲重新改进");
    seen.add(change.key);
    if (field.protected) {
      protectedCount++;
      continue;
    }
    const [, id, key] = change.key.split(":"),
      item = change.key.startsWith("group:")
        ? next.groups.find(g => g.id === id)!
        : next.groups.flatMap(g => g.items).find(i => i.id === id)!;
    (item as any)[key] = change.value;
  }
  return { data: imageOutlineSchema.parse(next), protectedCount };
}
