import { canReadMeeting, validateMeetingParticipants } from "./meetingAccess";
import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { createReadStream } from "node:fs";
import { chmod, rename, unlink } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createContext } from "../../_core/context";
import {
  actorFromContext,
  assertResourceAction,
  workspaceIdFromContext,
} from "../../services/securityGovernance";

import {
  MEETING_ROLES,
  meetingDateSchema,
  meetingParticipantIdsSchema,
  meetingSubjectSchema,
  meetingTitle,
  readMeetingNotes,
  type MeetingNotesData,
} from "../../../shared/meetingNotes";
import { meetingAudioLimit } from "../../../shared/meetingAudio";
import { meetingRecords, users } from "../../../drizzle/schema";
import { getDb } from "../../repositories/dbClient";
import { paraformerConfig } from "./paraformer";
import {
  audioTokenValid,
  identifyAudio,
  meetingAudioDirectory,
  meetingAudioPath,
  normalizeMeetingAudio,
  signedAudioUrl,
} from "./meetingAudioStorage";

export const meetingAudioHttpRouter = Router();
// Only this short-lived, single-record bearer URL can be read by the ASR provider.
meetingAudioHttpRouter.get("/provider/:id", async (req, res) => {
  try {
    const id = Number(req.params.id),
      expires = Number(req.query.expires);
    if (!audioTokenValid(id, expires, String(req.query.token || "")))
      return void res.sendStatus(404);
    const db = await getDb();
    if (!db) return void res.sendStatus(503);
    const [row] = await db
      .select()
      .from(meetingRecords)
      .where(eq(meetingRecords.id, id))
      .limit(1);
    const audio = readMeetingNotes(row?.extractedTasks)?.audio;
    if (!audio || !["submitting", "polling"].includes(audio.state))
      return void res.sendStatus(404);
    res
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff")
      .set("Content-Type", "audio/flac");
    res.sendFile(await meetingAudioPath(audio.providerFileName));
  } catch {
    if (!res.headersSent) res.sendStatus(404);
  }
});
meetingAudioHttpRouter.use(async (req, res, next) => {
  try {
    const ctx = await createContext({ req, res } as any),
      workspaceId = workspaceIdFromContext(ctx);
    if (!ctx.user || !workspaceId || !MEETING_ROLES.includes(ctx.user.role))
      throw Error("Forbidden");
    await assertResourceAction(
      {
        actor: actorFromContext(ctx),
        resource: "ops_data",
        action: "read",
        workspaceId,
      },
      ctx
    );
    await assertResourceAction(
      {
        actor: actorFromContext(ctx),
        resource: "ops_task",
        action: req.method === "GET" ? "read" : "create",
        workspaceId,
      },
      ctx
    );
    if (
      req.method !== "GET" &&
      (req.get("sec-fetch-site") === "cross-site" ||
        (req.get("origin") &&
          new URL(req.get("origin")!).host !== req.get("host")))
    )
      throw Error("Cross-site");
    res.locals.scope = {
      userId: ctx.user.id,
      role: ctx.user.role,
      workspaceId,
    };
    next();
  } catch {
    res.status(403).json({ error: "请登录有权限的运营账号后操作会议录音" });
  }
});
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      void meetingAudioDirectory().then(
        d => cb(null, d),
        e => cb(e, "")
      );
    },
    filename: (_req, _file, cb) => cb(null, randomUUID() + ".upload"),
  }),
  limits: { files: 1, fields: 0, fileSize: meetingAudioLimit },
});
const activeUploads = new Set<number>();
meetingAudioHttpRouter.post("/upload", async (req, res) => {
  const scope = res.locals.scope;
  let input: {
    date: string;
    operationId: string;
    title: string;
    participantIds: number[];
  };
  let participants: Awaited<ReturnType<typeof validateMeetingParticipants>>;
  try {
    input = z
      .object({
        date: meetingDateSchema,
        operationId: z.string().uuid(),
        title: meetingSubjectSchema,
        participantIds: z
          .string()
          .transform(value => JSON.parse(value))
          .pipe(meetingParticipantIdsSchema),
      })
      .parse(req.query);
    participants = await validateMeetingParticipants(
      scope.workspaceId,
      input.participantIds
    );
    await paraformerConfig(scope.workspaceId);
    signedAudioUrl(1);
    await meetingAudioDirectory();
  } catch {
    return void res.status(400).json({
      error: "请确认会议日期和参会人员已填写，并已配置 Paraformer-v2",
    });
  }
  if (activeUploads.has(scope.userId))
    return void res.status(409).json({ error: "已有录音正在上传，请等待完成" });
  if (activeUploads.size >= 2)
    return void res.status(429).json({ error: "录音处理繁忙，请稍后上传" });
  activeUploads.add(scope.userId);
  upload.single("audio")(req, res, async error => {
    let keep = false;
    const files: string[] = [];
    try {
      if (error || !req.file) throw Error("请选择完整音频，单个不超过100MB");
      files.push(req.file.path);
      await chmod(req.file.path, 0o600);
      const format = await identifyAudio(req.file.path),
        id = randomUUID();
      const fileName = id + "." + format.extension,
        providerFileName = randomUUID() + ".flac";
      const root = await meetingAudioDirectory(),
        target = path.join(root, fileName),
        normalized = path.join(root, providerFileName);
      await rename(req.file.path, target);
      files.push(target, normalized);
      const duration = await normalizeMeetingAudio(target, normalized);
      await chmod(normalized, 0o600);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(target)) hash.update(chunk);
      const sha256 = hash.digest("hex"),
        db = await getDb();
      if (!db) throw Error("会议服务暂不可用");
      // Keep durable bytes if the database commit acknowledgement is lost.
      keep = true;
      const result = await db.transaction(async tx => {
        // Serialize retries from the same uploader, including across Web replicas.
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, scope.userId))
          .limit(1)
          .for("update");
        const [existing] = await tx
          .select()
          .from(meetingRecords)
          .where(
            and(
              eq(meetingRecords.workspaceId, scope.workspaceId),
              eq(meetingRecords.userId, scope.userId),
              sql`CASE WHEN JSON_VALID(${meetingRecords.extractedTasks}) THEN JSON_UNQUOTE(JSON_EXTRACT(${meetingRecords.extractedTasks}, '$.audio.operationId')) ELSE NULL END = ${input.operationId}`
            )
          )
          .limit(1);
        if (existing) {
          if (
            readMeetingNotes(existing.extractedTasks)?.audio?.sha256 !== sha256
          )
            throw Error("上传内容已变化，请重新选择录音");
          return { id: existing.id, duplicate: true };
        }
        const data: MeetingNotesData = {
          version: 2,
          date: input.date,
          participants,
          titleSource: input.title ? "manual" : "auto",
          summary: "",
          tasks: [],
          tasksExtracted: false,
          audio: {
            operationId: input.operationId,
            fileName,
            providerFileName,
            mime: format.mime,
            bytes: req.file!.size,
            sha256,
            state: "queued",
          },
        };
        const [created] = await tx.insert(meetingRecords).values({
          workspaceId: scope.workspaceId,
          userId: scope.userId,
          title: meetingTitle(input.date, input.title),
          duration,
          audioUrl: `meeting-audio:${fileName}`,
          status: "uploading",
          extractedTasks: JSON.stringify(data),
        });
        return { id: created.insertId, duplicate: false };
      });
      keep = !result.duplicate;
      res.json(result);
    } catch (e) {
      const message =
        e instanceof Error && /请选择|会议服务|上传内容/.test(e.message)
          ? e.message
          : "录音无法保存或格式不支持，请保留本地录音后重试";
      if (!res.headersSent) res.status(400).json({ error: message });
    } finally {
      activeUploads.delete(scope.userId);
      if (!keep) for (const file of files) await unlink(file).catch(() => {});
    }
  });
});
meetingAudioHttpRouter.get("/:id", async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return void res.sendStatus(503);
    const [row] = await db
      .select()
      .from(meetingRecords)
      .where(
        and(
          eq(meetingRecords.id, Number(req.params.id)),
          eq(meetingRecords.workspaceId, res.locals.scope.workspaceId)
        )
      )
      .limit(1);
    const audio = readMeetingNotes(row?.extractedTasks)?.audio;
    if (
      !row ||
      !audio ||
      !canReadMeeting(
        { id: res.locals.scope.userId, role: res.locals.scope.role },
        row
      )
    )
      return void res.sendStatus(404);
    res
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff")
      .set("Content-Type", audio.mime);
    if (req.query.download === "1") res.attachment(audio.fileName);
    res.sendFile(await meetingAudioPath(audio.fileName));
  } catch {
    if (!res.headersSent) res.sendStatus(404);
  }
});
