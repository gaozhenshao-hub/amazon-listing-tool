import { assertNoCollectionRepair } from "../acquisition/collectionRepairState";
import { readRepairableCollection, assetIsMissing, supplementMissingCollectionVideo } from "../acquisition/missingAssetRepair";
import { Router } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { createContext } from "../../_core/context";
import {
  actorFromContext,
  assertResourceAction,
  workspaceIdFromContext,
} from "../../services/securityGovernance";
import { storagePut } from "../../storage";
import { requireDb } from "../../repositories/dbClient";
import { KNOWLEDGE_VIDEO_LIMIT } from "../../../shared/videoLabels";
import { mediaCommand, prepareUploadedVideo } from "./videoMedia";
import { videoRows, type VideoScope } from "./videoLibrary";
import { enqueueVideoTags } from "./videoTagging";
import { getOwnedImageSet } from "../../kbDb";

export const knowledgeVideoUploadRouter = Router();
const active = new Set<number>();
knowledgeVideoUploadRouter.post("/upload", async (req, res) => {
  let scope: VideoScope;
  try {
    const ctx = await createContext({ req, res } as any),
      workspaceId = workspaceIdFromContext(ctx);
    if (!ctx.user || !workspaceId) throw new Error();
    if (
      req.get("sec-fetch-site") === "cross-site" ||
      (req.get("origin") &&
        new URL(req.get("origin")!).host !== req.get("host"))
    )
      throw new Error();
    await assertResourceAction(
      {
        actor: actorFromContext(ctx),
        resource: "knowledge",
        action: "upload",
        workspaceId,
      },
      ctx
    );
    scope = { userId: ctx.user.id, workspaceId, role: ctx.user.role };
  } catch {
    return void res
      .status(403)
      .json({ error: "请登录有知识库权限的账号后上传" });
  }
  if (active.has(scope.userId) || active.size >= 2)
    return void res
      .status(429)
      .json({ error: "当前有视频正在上传，请稍后再试" });
  let repair: {jobId:number;assetId:number;snapshotId:number;status:string}|null=null;
  if(req.query.collectionJobId || req.query.assetId) {
    const jobId=Number(req.query.collectionJobId),assetId=Number(req.query.assetId);
    try {
      if(!Number.isSafeInteger(jobId)||jobId<1||!Number.isSafeInteger(assetId)||assetId<1||req.query.imageSetId)throw new Error();
      const db=await requireDb("validate video supplementation"),collection=await readRepairableCollection(db,{...scope,jobId});
      await assertNoCollectionRepair(db,{...scope,jobId});
      if(!collection.assets.some(a=>a.id===assetId&&a.role==="video"&&assetIsMissing(a)))throw new Error();
      repair={jobId,assetId,snapshotId:collection.snapshot.id,status:collection.job.status};
    } catch {return void res.status(409).json({error:"该缺失视频不可编辑或正在补采，请刷新后重试"});}
  }
  let imageSetId: number | null = null;
  const role =
    req.query.role === undefined || req.query.role === ""
      ? null
      : String(req.query.role);
  if (role !== null && !["main", "aplus"].includes(role))
    return void res.status(400).json({ error: "请选择主图视频或 A+ 视频" });
  if (req.query.imageSetId) {
    imageSetId = Number(req.query.imageSetId);
    if (
      !Number.isSafeInteger(imageSetId) ||
      !(await getOwnedImageSet(imageSetId, scope.userId, scope.workspaceId))
    )
      return void res
        .status(404)
        .json({ error: "关联的图片集不存在或不可编辑" });
  }
  const folder = await mkdtemp(path.join(tmpdir(), "kb-video-upload-"));
  active.add(scope.userId);
  const upload = multer({
    dest: folder,
    limits: { fileSize: repair ? 200*1024*1024 : KNOWLEDGE_VIDEO_LIMIT, files: 1, fields: 0 },
    fileFilter: (_r, f, cb) =>
      cb(null, /\.(mp4|avi|mov|webm|m4v)$/i.test(f.originalname)),
  });
  upload.single("file")(req, res, async error => {
    try {
      if (error || !req.file)
        throw new Error("请选择 MP4、AVI、MOV 或 WebM 视频，单个不超过 100MB");
      const hash = createHash("sha256");
      for await (const bytes of createReadStream(req.file.path))
        hash.update(bytes);
      const digest = hash.digest("hex"),
        sourceKey = `upload:${scope.userId}:${digest}`;
      const [existing] = await videoRows<{ id: number; recycleId: string | null }>(
        sql`SELECT id,recycleId FROM kb_videos WHERE workspaceId=${scope.workspaceId} AND sourceKey=${sourceKey} AND userId=${scope.userId} AND status<>'archived'`
      );
      if (!repair && existing?.recycleId) throw new Error("请先让管理员从回收站恢复或永久删除这个视频，再上传");
      if (!repair && existing) {
        res.json({ id: existing.id, duplicate: true });
        return;
      }
      const output = path.join(folder, "video.mp4"),
        info = await prepareUploadedVideo(req.file.path, output),
        poster = path.join(folder, "poster.jpg");
      await mediaCommand("ffmpeg", [
        "-nostdin",
        "-v",
        "error",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-ss",
        String(Math.min(0.5, info.duration / 2)),
        "-i",
        output,
        "-frames:v",
        "1",
        "-vf",
        "scale=960:-2",
        "-threads",
        "1",
        poster,
      ]);
      const prefix = repair ? `acquisition/${scope.workspaceId}/snapshots/${repair.snapshotId}/manual-video/${repair.assetId}-${digest}` : `knowledge/${scope.workspaceId}/videos/${scope.userId}/${digest}`;
      const video = await storagePut(
        prefix + ".mp4",
        await readFile(output),
        "video/mp4"
      );
      const cover = await storagePut(
        prefix + ".poster.webp",
        await sharp(await readFile(poster))
          .webp({ quality: 86 })
          .toBuffer(),
        "image/webp"
      );
      if(repair) {
        await supplementMissingCollectionVideo({...scope,jobId:repair.jobId},repair.assetId,{storageKey:video.storageUri,thumbnailStorageKey:cover.storageUri,contentHash:digest,sizeBytes:(await readFile(output)).length},repair.status);
        res.json({saved:true,pending:true});return;
      }
      const decoded = Buffer.from(req.file.originalname, "latin1").toString(
        "utf8"
      );
      const title = path
        .basename(decoded.includes("\ufffd") ? req.file.originalname : decoded)
        .replace(/\.[^.]+$/, "")
        .slice(0, 512);
      const db = await requireDb("upload knowledge video"),
        result =
          await db.execute(sql`INSERT INTO kb_videos (userId,workspaceId,imageSetId,sourceKey,sourceHash,videoUrl,thumbnailUrl,videoTitle,duration,videoRole,status,visibility,origin_instance_id)
        VALUES (${scope.userId},${scope.workspaceId},${imageSetId},${sourceKey},${digest},${video.storageUri},${cover.storageUri},${title},${Math.ceil(info.duration)},${role},'confirmed','team','knowledge_video_v1')`);
      const id = (result[0] as unknown as { insertId: number }).insertId;
      try {
        await enqueueVideoTags(scope, id);
        res.json({ id, duplicate: false, tagging: true });
      } catch {
        await db.execute(
          sql`UPDATE kb_videos SET labelStatus='failed',labelError='视频已保存，自动打标未启动，请点击重新打标' WHERE id=${id} AND workspaceId=${scope.workspaceId}`
        );
        res.json({ id, duplicate: false, tagging: false });
      }
    } catch (e) {
      if (!res.headersSent)
        res
          .status(400)
          .json({
            error:
              e instanceof Error && /^(请|关联)/.test(e.message)
                ? e.message
                : "视频无法处理，请检查文件是否完整后重试",
          });
    } finally {
      active.delete(scope.userId);
      await rm(folder, { recursive: true, force: true });
    }
  });
});
