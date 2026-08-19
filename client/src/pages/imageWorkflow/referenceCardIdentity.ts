export function getStep4ReferenceCardKey(reference: unknown, index: number): string {
  const imageKey =
    reference && typeof reference === "object" && typeof (reference as { imageKey?: unknown }).imageKey === "string"
      ? (reference as { imageKey: string }).imageKey.trim()
      : "";

  return imageKey || `step4-ref-${index}`;
}

export function getStep4KbReferenceCardKey(parentKey: string, reference: unknown, index: number): string {
  const item = reference && typeof reference === "object" ? reference as { id?: unknown; imageUrl?: unknown } : null;
  const id = typeof item?.id === "number" || typeof item?.id === "string" ? String(item.id).trim() : "";
  const imageUrl = typeof item?.imageUrl === "string" ? item.imageUrl.trim() : "";

  return `${parentKey}:kb:${id || imageUrl || index}`;
}
