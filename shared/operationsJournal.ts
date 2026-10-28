import { z } from "zod";

export function shiftJournalDate(day: string, offset: number) {
  const value = new Date(`${day}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
export function journalMonday(day: string) {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  if (!Number.isFinite(weekday)) return "";
  return shiftJournalDate(day, -(weekday === 0 ? 6 : weekday - 1));
}
export function journalToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const date = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "请选择有效日期");
const id = z.number().int().positive().max(2147483647);
export const JournalContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), completed: z.string().max(5000), issues: z.string().max(3000), next: z.string().max(3000) }).strict(),
  z.object({ kind: z.literal("weekly"), days: z.array(z.string().max(3000)).length(7) }).strict(),
]);
export type JournalContent = z.infer<typeof JournalContentSchema>;
export const JournalReadSchema = z.object({ expectedWorkspaceId: id, ownerId: id, from: date, to: date, week: date })
  .strict().refine(input => Number.isFinite(Date.parse(`${input.from}T00:00:00Z`)) && input.from <= input.to && input.to <= shiftJournalDate(input.from, 6), "日报范围最多七天")
  .refine(input => journalMonday(input.week) === input.week, "周计划从周一开始");
export const JournalSaveSchema = z.object({ expectedWorkspaceId: id, ownerId: id, date, content: JournalContentSchema,
  expectedRevision: z.number().int().nonnegative(), requestId: z.string().uuid() }).strict()
  .refine(input => input.content.kind !== "weekly" || journalMonday(input.date) === input.date, "周计划从周一开始");
export type JournalRecord = { date: string; revision: number; content: JournalContent; updatedAt: string };
export type JournalReadResult = { ownerId: number; canEdit: boolean; daily: JournalRecord[]; weekly: JournalRecord | null };
