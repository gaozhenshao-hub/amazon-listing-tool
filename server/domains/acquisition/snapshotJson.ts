/**
 * Reads a persisted JSON field across Drizzle's camelCase property shape and
 * the physical snake_case shape seen in selected historical Worker bundles.
 * It never treats malformed JSON as usable acquisition evidence.
 */
export function readAcquisitionSnapshotJsonField(snapshot: unknown, camelCaseKey: string, snakeCaseKey: string) {
  const row = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown>
    : {};
  const value = row[camelCaseKey] ?? row[snakeCaseKey];
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`snapshot ${camelCaseKey} JSON is invalid`);
  }
}
