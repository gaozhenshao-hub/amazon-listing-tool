/**
 * Formats legacy MySQL audit timestamps for display in the China operations UI.
 *
 * `data_imports.createdAt` is a MySQL TIMESTAMP whose database clock is already
 * Asia/Shanghai. mysql2/Drizzle materialises its wall-clock components as a
 * JavaScript Date and tRPC serialises that Date as UTC. Re-applying the browser
 * offset therefore adds eight hours. Preserve the original UTC components,
 * which represent the stored Asia/Shanghai wall-clock time, for this legacy
 * audit display only. Business report-date strings are deliberately untouched.
 */
export function formatAsiaShanghaiAuditTime(value: Date | string | null | undefined): string {
  if (!value) return "-";

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";

  const parts = [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ];
  const time = [
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
  ];
  return `${parts.join("/")} ${time.join(":")}`;
}
