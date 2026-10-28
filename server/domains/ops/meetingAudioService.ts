import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { meetingRecords } from "../../../drizzle/schema";
import {
  readMeetingNotes,
  type MeetingNotesData,
} from "../../../shared/meetingNotes";
import { getDb } from "../../repositories/dbClient";
import {
  paraformerConfig,
  pollSpeech,
  submitSpeech,
  SpeechServiceError,
} from "./paraformer";
import { signedAudioUrl } from "./meetingAudioStorage";
import { analyzeMeetingNotes } from "./meetingNotes";

export async function resumeMeetingAudio(workspaceId: number, id: number) {
  const db = await getDb();
  if (!db) throw Error("会议服务暂不可用");
  return db.transaction(async tx => {
    const where = and(
      eq(meetingRecords.id, id),
      eq(meetingRecords.workspaceId, workspaceId)
    );
    const [row] = await tx
      .select()
      .from(meetingRecords)
      .where(where)
      .limit(1)
      .for("update");
    const data = readMeetingNotes(row?.extractedTasks),
      audio = data?.audio;
    if (!row || !data || !audio)
      throw new TRPCError({ code: "NOT_FOUND", message: "录音不存在" });
    if (audio.state === "unknown")
      throw new TRPCError({
        code: "CONFLICT",
        message: "提交结果未确认，请先由管理员核对百炼任务，避免重复计费",
      });
    if (["complete", "transcribed"].includes(audio.state) || row.transcript)
      return { id };
    if (audio.state !== "failed") return { id };
    // A known provider task is never replaced by a new task on retry.
    if (
      audio.taskId &&
      Date.now() - (audio.submittedAt || 0) > 23 * 3600 * 1000
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "语音结果已过保存期，请下载原录音后重新上传",
      });
    data.audio = {
      ...audio,
      state: audio.taskId ? "polling" : "queued",
      nextPollAt: 0,
      leaseUntil: 0,
    };
    await tx
      .update(meetingRecords)
      .set({
        status: "transcribing",
        errorMessage: null,
        extractedTasks: JSON.stringify(data),
      })
      .where(where);
    return { id };
  });
}

export async function processMeetingAudio(id: number) {
  const db = await getDb();
  if (!db) return;
  const token = randomUUID();
  const captured = await db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(meetingRecords)
      .where(eq(meetingRecords.id, id))
      .limit(1)
      .for("update");
    const data = readMeetingNotes(row?.extractedTasks),
      audio = data?.audio;
    if (
      !row ||
      !data ||
      !audio ||
      !row.workspaceId ||
      !["queued", "submitting", "polling", "transcribed"].includes(audio.state)
    )
      return null;
    const now = Date.now();
    if ((audio.leaseUntil || 0) > now || (audio.nextPollAt || 0) > now)
      return null;
    if (audio.state === "submitting") {
      data.audio = { ...audio, state: "unknown" };
      await tx
        .update(meetingRecords)
        .set({
          status: "error",
          errorMessage: "提交结果未确认，请联系管理员核对百炼任务，勿重复上传",
          extractedTasks: JSON.stringify(data),
        })
        .where(eq(meetingRecords.id, id));
      return null;
    }
    const previous = audio.state;
    data.audio = {
      ...audio,
      state: previous === "queued" ? "submitting" : previous,
      token,
      leaseUntil: now + 240000,
    };
    await tx
      .update(meetingRecords)
      .set({ status: "transcribing", extractedTasks: JSON.stringify(data) })
      .where(eq(meetingRecords.id, id));
    return { row, data, previous };
  });
  if (!captured?.data.audio) return;
  const { row, data, previous } = captured;
  const audio = data.audio!;
  const where = and(
    eq(meetingRecords.id, id),
    eq(meetingRecords.workspaceId, row.workspaceId!),
    sql`JSON_UNQUOTE(JSON_EXTRACT(${meetingRecords.extractedTasks}, '$.audio.token')) = ${token}`
  );
  async function save(patch: Partial<typeof meetingRecords.$inferInsert> = {}) {
    audio.leaseUntil = 0;
    await db!
      .update(meetingRecords)
      .set({ extractedTasks: JSON.stringify(data), ...patch })
      .where(where);
  }
  let submitted = false;
  try {
    if (previous === "transcribed") {
      // Claim one automatic summary attempt durably; a crash leaves the retry button, not another charge.
      audio.state = "complete";
      await save({ status: "done", errorMessage: null });
      await analyzeMeetingNotes(
        { userId: row.userId, workspaceId: row.workspaceId! },
        id,
        "summary"
      );
      return;
    }
    const config = await paraformerConfig(row.workspaceId!, audio.providerId);
    if (previous === "queued") {
      const url = signedAudioUrl(id);
      submitted = true;
      audio.taskId = await submitSpeech(config, url);
      audio.providerId = config.id;
      audio.state = "polling";
      audio.submittedAt = Date.now();
      audio.nextPollAt = Date.now() + 10000;
      await save({ status: "transcribing", errorMessage: null });
      return;
    }
    if (!audio.taskId)
      throw new SpeechServiceError("语音任务记录缺失，请联系管理员核对", true);
    if (Date.now() - (audio.submittedAt || 0) > 23 * 3600 * 1000)
      throw new SpeechServiceError(
        "语音处理超时，录音已保留，请联系管理员核对",
        true
      );
    const result = await pollSpeech(config, audio.taskId);
    audio.nextPollAt = Date.now() + 15000;
    if (!result) {
      await save();
      return;
    }
    audio.state = "transcribed";
    audio.nextPollAt = 0;
    audio.billableSeconds = result.duration;
    await save({
      transcript: result.text,
      status: "transcribing",
      errorMessage: null,
    });
  } catch (e) {
    if (previous === "transcribed") return; // analyzeMeetingNotes preserves its own error state.
    if (submitted && audio.taskId) return; // Never overwrite a possibly committed task id after a DB acknowledgement failure.
    const definitive = e instanceof SpeechServiceError && e.definitive;
    if (submitted && !definitive) audio.state = "unknown";
    else if (previous === "polling" && !definitive) {
      audio.state = "polling";
      audio.nextPollAt = Date.now() + 60000;
    } else audio.state = "failed";
    const message =
      audio.state === "unknown"
        ? "提交结果未确认，请联系管理员核对百炼任务，勿重复上传"
        : e instanceof SpeechServiceError
          ? e.message
          : previous === "queued"
            ? "语音配置或存储不可用，请在大模型管理中检查 Paraformer-v2"
            : "语音服务连接暂时中断，稍后自动继续";
    await save({
      status: audio.state === "polling" ? "transcribing" : "error",
      errorMessage: message,
    });
  }
}

export function startMeetingAudioWorker() {
  let stopped = false,
    active: Promise<void> | null = null;
  const tick = async () => {
    const db = await getDb();
    if (!db || stopped) return;
    const rows = await db
      .select({ id: meetingRecords.id })
      .from(meetingRecords)
      .where(
        and(
          inArray(meetingRecords.status, ["uploading", "transcribing"]),
          sql`CASE WHEN JSON_VALID(${meetingRecords.extractedTasks}) THEN JSON_EXTRACT(${meetingRecords.extractedTasks}, '$.audio.state') ELSE NULL END IS NOT NULL`
        )
      )
      .limit(20);
    for (const row of rows) {
      if (stopped) break;
      await processMeetingAudio(row.id);
    }
  };
  const timer = setInterval(() => {
    if (stopped || active) return;
    active = tick()
      .catch(() => console.warn("[MeetingAudio] background check deferred"))
      .finally(() => {
        active = null;
      });
  }, 5000);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await active;
  };
}
