import { Router } from "express";
import multer from "multer";
import {
  mkdir,
  lstat,
  realpath,
  readFile,
  unlink,
  chmod,
  rename,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { createContext } from "../../_core/context";
import {
  materialExtensions,
  materialFileLimit,
  materialName,
  materialTarget,
} from "../../../shared/designMaterials";
import { authorizeDesign } from "./access";
import { assetDirectory } from "./assets";
import { transaction } from "./repository";
import {
  requireMaterialProject,
  visibleMaterial,
  insertMaterial,
} from "./materialsRepository";
import { validateImageBytes } from "../image/services/validateImageBytes";

export async function materialDirectory() {
  const dir = path.join(await assetDirectory(), "materials");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await lstat(dir)).isSymbolicLink()) throw Error("素材存储目录无效");
  return realpath(dir);
}
export function uploadedMaterialName(raw: string) {
  const decoded = Buffer.from(raw, "latin1").toString("utf8");
  const name = materialName.parse(decoded.includes("\ufffd") ? raw : decoded);
  if (!materialExtensions.includes(name.split(".").pop()!.toLowerCase()))
    throw Error("不支持此文件格式");
  return name;
}
export const designMaterialsHttpRouter = Router();
designMaterialsHttpRouter.use(async (req, res, next) => {
  try {
    const ctx = await createContext({ req, res } as any);
    res.locals.scope = await authorizeDesign(
      ctx.user,
      req.method === "GET" ? "read" : "edit",
      "design_materials"
    );
    if (req.method !== "GET") {
      const origin = req.get("origin");
      if (origin && new URL(origin).host !== req.get("host"))
        return void res.status(403).json({ error: "不接受跨站上传" });
    }
    next();
  } catch {
    res.status(403).json({ error: "请登录并确认素材库权限" });
  }
});
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      materialDirectory().then(
        d => cb(null, d),
        e => cb(e, "")
      );
    },
    filename: (_req, _file, cb) => cb(null, randomUUID() + ".upload"),
  }),
  limits: { fileSize: materialFileLimit, files: 1, fields: 0 },
  fileFilter: (_req, file, cb) => {
    try {
      uploadedMaterialName(file.originalname);
      cb(null, true);
    } catch {
      cb(Error("不支持此文件格式"));
    }
  },
});
designMaterialsHttpRouter.post("/upload", async (req, res) => {
  let projectId: string | null;
  try {
    projectId = materialTarget.parse({
      projectId: req.query.projectId || null,
    }).projectId;
    await requireMaterialProject(projectId, res.locals.scope);
  } catch {
    return void res.status(404).json({ error: "项目不存在或无权访问" });
  }
  upload.single("file")(req, res, async error => {
    if (error || !req.file)
      return void res
        .status(400)
        .json({ error: "上传失败，请选择支持的文件，单个不超过 100MB" });
    const temp = req.file.path;
    let finalPath = temp,
      keep = false;
    try {
      await chmod(temp, 0o600);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(temp)) hash.update(chunk);
      let mime = "application/octet-stream";
      if (
        req.file.size <= 20 * 1024 * 1024 &&
        /\.(png|jpe?g|gif|webp)$/i.test(req.file.originalname)
      ) {
        mime = (await validateImageBytes(await readFile(temp))).mimeType;
      }
      const id = randomUUID(),
        storageName = id + ".blob";
      finalPath = path.join(await materialDirectory(), storageName);
      await rename(temp, finalPath);
      const result = await transaction(tx =>
        insertMaterial(
          res.locals.scope,
          {
            id,
            name: uploadedMaterialName(req.file!.originalname),
            mime,
            bytes: req.file!.size,
            sha256: hash.digest("hex"),
            storageName,
          },
          projectId,
          tx
        )
      );
      keep = !result.duplicate;
      res.json(result);
    } catch (e) {
      res
        .status(400)
        .json({
          error:
            e instanceof Error && /空间不足/.test(e.message)
              ? e.message
              : "文件无法保存，请检查格式后重试",
        });
    } finally {
      if (!keep) {
        await unlink(temp).catch(() => {});
        if (finalPath !== temp) await unlink(finalPath).catch(() => {});
      }
    }
  });
});
designMaterialsHttpRouter.get("/files/:id", async (req, res) => {
  try {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return void res.sendStatus(404);
    const file = await visibleMaterial(req.params.id, res.locals.scope);
    if (file.deletedAt || !/^[0-9a-f-]{36}\.blob$/.test(file.storageName))
      return void res.sendStatus(404);
    const local = path.join(await materialDirectory(), file.storageName),
      stat = await lstat(local);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== Number(file.bytes)
    )
      return void res.sendStatus(404);
    const preview =
      /^image\/(png|jpeg|webp|gif)$/.test(file.mime) &&
      req.query.download !== "1";
    res
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff")
      .set("Content-Security-Policy", "default-src 'none'; sandbox")
      .set("Content-Type", preview ? file.mime : "application/octet-stream")
      .set("Content-Length", String(stat.size));
    if (!preview)
      res.set(
        "Content-Disposition",
        `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, c => "%" + c.charCodeAt(0).toString(16))}`
      );
    await pipeline(createReadStream(local), res);
  } catch {
    if (!res.headersSent) res.status(404).json({ error: "素材暂时无法读取" });
  }
});
