import { Router } from "express";
import multer from "multer";
import { mkdir, realpath, lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createContext } from "../../_core/context";
import { validateImageBytes } from "../image/services/validateImageBytes";
import { authorizeDesign } from "./access";
import { execute, ownAsset, type Scope } from "./repository";

export async function assetDirectory() {
  const base =
    process.env.DESIGN_STUDIO_STORAGE_ROOT ||
    (process.env.LISTING_SUPPLEMENT_LOCAL_ROOT
      ? path.join(process.env.LISTING_SUPPLEMENT_LOCAL_ROOT, "design-studio")
      : "");
  if (!base || !path.isAbsolute(base)) throw new Error("美工图片存储尚未配置");
  await mkdir(base, { recursive: true, mode: 0o700 });
  if ((await lstat(base)).isSymbolicLink())
    throw new Error("图片存储目录不可使用软链接");
  return realpath(base);
}
export async function saveAsset(
  scope: Scope,
  buffer: Buffer,
  name: string,
  kind: "reference" | "generated"
) {
  const format = await validateImageBytes(buffer);
  const id = randomUUID();
  const fileName = `${id}.${format.extension}`;
  await writeFile(path.join(await assetDirectory(), fileName), buffer, {
    flag: "wx",
    mode: 0o600,
  });
  await execute(
    "INSERT INTO design_assets(id,workspaceId,userId,kind,name,mime,bytes,sha256,fileName) VALUES(?,?,?,?,?,?,?,?,?)",
    [
      id,
      scope.workspaceId,
      scope.userId,
      kind,
      name.slice(0, 180),
      format.mimeType,
      buffer.length,
      createHash("sha256").update(buffer).digest("hex"),
      fileName,
    ]
  );
  return { id, name: name.slice(0, 180), bytes: buffer.length };
}
export async function assetBytes(asset: any) {
  if (!/^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/.test(asset.fileName))
    throw new Error("图片存储记录无效");
  const file = path.join(await assetDirectory(), asset.fileName);
  if ((await lstat(file)).isSymbolicLink()) throw new Error("图片文件无效");
  const data = await readFile(file);
  if (
    data.length !== Number(asset.bytes) ||
    createHash("sha256").update(data).digest("hex") !== asset.sha256
  )
    throw new Error("图片完整性校验失败");
  return data;
}
export const designAssetsRouter = Router();
const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
});
designAssetsRouter.use(async (req, res, next) => {
  try {
    const ctx = await createContext({ req, res } as any);
    res.locals.designScope = await authorizeDesign(
      ctx.user,
      req.method === "GET" ? "read" : "edit",
      req.path.startsWith("/prompt-examples/")
        ? "design_prompts"
        : "design_images"
    );
    if (req.method !== "GET") {
      const origin = req.get("origin");
      if (origin && new URL(origin).host !== req.get("host"))
        return void res.status(403).json({ error: "不接受跨站上传" });
    }
    next();
  } catch {
    res.status(403).json({ error: "请登录并确认美工板块权限" });
  }
});

// Only an explicitly shared example is public to the design team. Private
// asset IDs and conversation history retain their original owner checks.
designAssetsRouter.get("/prompt-examples/:id", async (req, res) => {
  try {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return void res.sendStatus(404);
    const s = res.locals.designScope;
    const asset = (
      await execute(
        "SELECT a.* FROM design_prompt_library p JOIN design_assets a ON a.id=p.exampleAssetId AND a.workspaceId=p.workspaceId AND a.userId=p.userId WHERE p.id=? AND p.workspaceId=? AND p.deletedAt IS NULL",
        [req.params.id, s.workspaceId]
      )
    )[0];
    if (!asset) return void res.sendStatus(404);
    const bytes = await assetBytes(asset);
    res
      .set("Content-Type", asset.mime)
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff")
      .send(bytes);
  } catch {
    res.status(404).json({ error: "示例图暂时无法读取" });
  }
});
designAssetsRouter.post("/upload", (req, res) => {
  uploader.single("image")(req, res, async error => {
    if (error || !req.file)
      return void res
        .status(400)
        .json({ error: "请选择图片，每张不超过 10MB" });
    try {
      res.json(
        await saveAsset(
          res.locals.designScope,
          req.file.buffer,
          req.file.originalname,
          "reference"
        )
      );
    } catch {
      res.status(400).json({
        error:
          "图片无法保存，请使用有效 PNG、JPEG、WebP 或 GIF 图片；若仍失败请检查存储配置",
      });
    }
  });
});
designAssetsRouter.get("/assets/:id", async (req, res) => {
  try {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return void res.sendStatus(404);
    const asset = await ownAsset(req.params.id, res.locals.designScope);
    if (!asset) return void res.sendStatus(404);
    const bytes = await assetBytes(asset);
    res.set("Content-Type", asset.mime);
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    if (req.query.download === "1")
      res.set(
        "Content-Disposition",
        `attachment; filename="${asset.fileName}"`
      );
    res.send(bytes);
  } catch {
    res.status(404).json({ error: "图片暂时无法读取" });
  }
});
