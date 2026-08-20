function getStringField(value: unknown, field: string): string {
  if (!value || typeof value !== "object") return "";
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" || typeof candidate === "number"
    ? String(candidate).trim()
    : "";
}

export function getStep5SecondaryImageCardKey(image: unknown, index: number): string {
  const identity =
    getStringField(image, "id") ||
    getStringField(image, "imageKey") ||
    getStringField(image, "imageNumber") ||
    getStringField(image, "title");

  return `step5-secondary:${identity || index + 1}`;
}

export function getStep5AplusSectionCardKey(section: unknown, index: number): string {
  const identity =
    getStringField(section, "id") ||
    getStringField(section, "sectionKey") ||
    getStringField(section, "moduleNumber") ||
    getStringField(section, "title");

  return `step5-aplus:${identity || index + 1}`;
}
