import { z } from "zod";
import type { MeetingAudioState } from "./meetingAudio";
export const MEETING_ROLES: readonly string[] = [
  "super_admin",
  "admin",
  "ops_manager",
  "ops_specialist",
];

export const meetingDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "请选择有效日期");
export function meetingTitle(date: string, subject?: string) {
  const prefix = `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}号`;
  const text = subject
    ?.trim()
    .replace(/^(?:\d{4}[-/.年])?\d{1,2}[-/.月]\d{1,2}(?:日|号)?\s*/, "")
    .trim();
  return `${prefix}${text || "运营会"}`.slice(0, 200);
}
export const meetingParticipantIdsSchema = z
  .array(z.number().int().positive())
  .min(1, "请选择参会人员")
  .max(200)
  .transform(ids => [...new Set(ids)]);
export const meetingSubjectSchema = z.string().trim().max(150).default("");
export type MeetingParticipant = { id: number; name: string };
export const meetingTaskSuggestionSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(6000).default(""),
  assigneeName: z.string().max(100).nullable(),
  dueDate: meetingDateSchema.nullable(),
  productHint: z.string().max(200).nullable(),
  category: z.enum(["listing优化", "广告优化", "绩效处理", "其他"]),
  evidence: z.string().max(2000),
});
export const meetingAnalysisSchema = z.object({
  title: z.string().trim().max(150).optional(),
  summary: z.string().min(1).max(12000),
  tasks: z.array(meetingTaskSuggestionSchema).max(40),
});
export type MeetingTaskSuggestion = z.infer<typeof meetingTaskSuggestionSchema>;
export type MeetingNotesData = {
  version: 2;
  date: string;
  summary: string;
  tasks: Array<
    MeetingTaskSuggestion & { operationId: string; taskId?: number }
  >;
  tasksExtracted: boolean;
  participants?: MeetingParticipant[];
  titleSource?: "manual" | "auto";
  processingToken?: string;
  audio?: MeetingAudioState;
};
export function readMeetingNotes(value: unknown): MeetingNotesData | null {
  try {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return data?.version === 2 &&
      typeof data.date === "string" &&
      Array.isArray(data.tasks)
      ? data
      : null;
  } catch {
    return null;
  }
}
export function exactMeetingAssignee(
  name: string | null,
  members: { id: number; displayName: string }[],
  participantIds: number[] = []
) {
  const matches = members.filter(
    member => name && member.displayName.trim() === name.trim()
  );
  const preferred = matches.filter(member =>
    participantIds.includes(member.id)
  );
  return preferred.length === 1
    ? preferred[0].id
    : matches.length === 1
      ? matches[0].id
      : null;
}

export function exactMeetingProduct<
  T extends {
    identity: { parentAsin: string; country: string };
    chineseName?: string | null;
    title?: string | null;
  },
>(hint: string | null | undefined, items: T[]): T | undefined {
  const normalized = hint?.trim().toLowerCase();
  if (!normalized) return undefined;
  const matches = items.filter(item =>
    [item.identity.parentAsin, item.chineseName, item.title].some(
      value => value?.trim().toLowerCase() === normalized
    )
  );
  if (matches.length === 1) return matches[0];
  // The business consolidates North America into the US product. Do not guess
  // between different ASINs with the same product name.
  if (
    new Set(matches.map(item => item.identity.parentAsin)).size !== 1 ||
    matches.some(item => !["US", "CA", "MX"].includes(item.identity.country))
  )
    return undefined;
  const us = matches.filter(item => item.identity.country === "US");
  return us.length === 1 ? us[0] : undefined;
}
