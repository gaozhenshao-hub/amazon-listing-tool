/**
 * Fast image upload router
 * Accepts multipart/form-data directly, streams to S3 via storagePut.
 * Avoids base64 encoding overhead that slows down tRPC-based uploads.
 */
import { Router, Request, Response } from "express";
import multer from "multer";
import { parse as parseCookieHeader } from "cookie";
import { storagePut } from "./storage";
import { getUserById, getProjectById, getProjectByIdAdmin, getExpressionGroupByProject, insertCompetitorImage, countExpressionGroupImages } from "./repositories";
import { sdk } from "./_core/sdk";
import { createImageAssetReceipt } from "./domains/image/services/imageAssetReceipt";
import { InvalidImageError, validateImageBytes } from "./domains/image/services/validateImageBytes";

// Store file in memory (max 20MB per file)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

export const imageUploadRouter = Router();

function sendUploadError(res: Response, error: unknown, route: string) {
  if (error instanceof InvalidImageError) {
    res.status(400).json({ error: error.message });
    return;
  }
  console.error(`[imageUpload] ${route} error:`, error);
  res.status(500).json({ error: "上传失败，请稍后重试" });
}

// Authenticate via session cookie (mirrors context.ts logic)
async function getAuthUser(req: Request): Promise<{ id: number; role: string; defaultWorkspaceId?: number | null } | null> {
  try {
    const cookies = req.headers.cookie
      ? new Map(Object.entries(parseCookieHeader(req.headers.cookie)))
      : new Map<string, string>();
    const sessionCookie = cookies.get("app_session_id");
    const session = await sdk.verifySession(sessionCookie);
    if (!session) return null;

    if (session.openId.startsWith("pwd_")) {
      const userId = parseInt(session.openId.replace("pwd_", ""), 10);
      if (isNaN(userId)) return null;
      const user = await getUserById(userId);
      if (user && user.status === "active") return user;
      return null;
    } else {
      const user = await sdk.authenticateRequest(req);
      return user && !user.isCron && user.status === "active" ? user : null;
    }
  } catch {
    return null;
  }
}

async function getUploadProject(user: { id: number; role: string; defaultWorkspaceId?: number | null }, projectId: number) {
  const project = user.role === "admin" || user.role === "super_admin"
    ? await getProjectByIdAdmin(projectId)
    : await getProjectById(projectId, user.id);
  // Multipart uploads do not pass through tRPC workspace middleware. Read the
  // authenticated user's current workspace, never a client-supplied field.
  if (!user.defaultWorkspaceId || !project || Number(project.workspaceId) !== Number(user.defaultWorkspaceId)) return null;
  return project;
}

/**
 * POST /api/upload/competitor-image
 * Body: multipart/form-data
 *   - file: image file (required)
 *   - projectId: number (required)
 *   - competitorName: string (required)
 *   - sortOrder: number (optional, default 0)
 */
imageUploadRouter.post(
  "/competitor-image",
  upload.single("file"),
  async (req: Request, res: Response) => {
    const user = await getAuthUser(req);
    if (!user) {
      res.status(401).json({ error: "请先登录" });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "未收到文件" });
      return;
    }

    const projectId = parseInt(req.body.projectId);
    const competitorName = (req.body.competitorName || "").trim();
    const sortOrder = parseInt(req.body.sortOrder || "0");

    if (!projectId || !competitorName) {
      res.status(400).json({ error: "缺少必要参数 projectId / competitorName" });
      return;
    }

    try {
      const project = await getUploadProject(user, projectId);
      if (!project) {
        res.status(404).json({ error: "项目不存在或无权限" });
        return;
      }

      // Upload to S3 directly from buffer (no base64 round-trip)
      const { extension: ext, mimeType: contentType } = await validateImageBytes(file.buffer);
      const safeName = competitorName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "-");
      const key = `image-workflow/${projectId}/step0-competitor/${safeName}-${Date.now()}.${ext}`;
      const { url } = await storagePut(key, file.buffer, contentType);

      // Insert DB record
      const record = await insertCompetitorImage({
        projectId,
        userId: user.id,
        competitorName,
        imageUrl: url,
        sortOrder,
      });

      res.json({ id: record.insertId, url, competitorName });
    } catch (err: unknown) {
      sendUploadError(res, err, "competitor-image");
    }
  }
);

/**
 * POST /api/upload/ref-image
 * Body: multipart/form-data
 *   - file: image file (required)
 *   - projectId: number (required)
 *   - refType: "composition" | "effect" (default "composition")
 *   - imageIndex: number (default 0)
 */
imageUploadRouter.post(
  "/ref-image",
  upload.single("file"),
  async (req: Request, res: Response) => {
    const user = await getAuthUser(req);
    if (!user) {
      res.status(401).json({ error: "请先登录" });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "未收到文件" });
      return;
    }

    const projectId = parseInt(req.body.projectId);
    const refType = req.body.refType || "composition";
    const imageIndex = parseInt(req.body.imageIndex || "0");

    if (!projectId) {
      res.status(400).json({ error: "缺少必要参数 projectId" });
      return;
    }

    try {
      const project = await getUploadProject(user, projectId);
      if (!project) {
        res.status(404).json({ error: "项目不存在或无权限" });
        return;
      }

      const { extension: ext, mimeType: contentType } = await validateImageBytes(file.buffer);
      const key = `image-workflow/${projectId}/step4-ref/${refType}-${imageIndex}-${Date.now()}.${ext}`;
      const { url } = await storagePut(key, file.buffer, contentType);
      const receipt = createImageAssetReceipt({ url, key, kind: "step4-ref", projectId, userId: user.id });

      res.json({ url: receipt.url });
    } catch (err: unknown) {
      sendUploadError(res, err, "ref-image");
    }
  }
);

/**
 * POST /api/upload/expression-group-image
 * Body: multipart/form-data
 *   - file: image file (required)
 *   - projectId: number (required)
 *   - groupId: number (required)
 *   - competitorName: string (optional)
 * Returns: { url } — caller then calls trpc.imageWorkflow.addImageToGroup to persist
 */
imageUploadRouter.post(
  "/expression-group-image",
  upload.single("file"),
  async (req: Request, res: Response) => {
    const user = await getAuthUser(req);
    if (!user) {
      res.status(401).json({ error: "请先登录" });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "未收到文件" });
      return;
    }

    const projectId = parseInt(req.body.projectId);
    const groupId = parseInt(req.body.groupId);
    const competitorName = (req.body.competitorName || "").trim();

    if (!projectId || !groupId) {
      res.status(400).json({ error: "缺少必要参数 projectId / groupId" });
      return;
    }

    try {
      const project = await getUploadProject(user, projectId);
      if (!project) {
        res.status(404).json({ error: "项目不存在或无权限" });
        return;
      }
      if (!await getExpressionGroupByProject(groupId, projectId)) {
        res.status(404).json({ error: "表达方式组不存在或不属于该项目" });
        return;
      }

      // Enforce max 5 images per group
      const count = await countExpressionGroupImages(groupId);
      if (count >= 5) {
        res.status(400).json({ error: "每个表达方向最多上传5张参考图" });
        return;
      }

      // Upload to S3
      const { extension: ext, mimeType: contentType } = await validateImageBytes(file.buffer);
      const safeName = (competitorName || "img").replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "-");
      const key = `image-workflow/${projectId}/step0-expression/${groupId}-${safeName}-${Date.now()}.${ext}`;
      const { url } = await storagePut(key, file.buffer, contentType);
      const receipt = createImageAssetReceipt({ url, key, kind: "expression-group", projectId, userId: user.id });

      res.json({ url: receipt.url, competitorName });
    } catch (err: unknown) {
      sendUploadError(res, err, "expression-group-image");
    }
  }
);

// ─── POST /api/upload/designer-image ────────────────────────────────────────
// Upload designer artwork image for Step 5 right panel
imageUploadRouter.post(
  "/designer-image",
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

      const file = req.file;
      if (!file) { res.status(400).json({ error: "No file provided" }); return; }

      const projectId = parseInt(req.body.projectId || "0");
      const imageNumber = (req.body.imageNumber || "unknown").trim();
      if (!projectId) { res.status(400).json({ error: "projectId required" }); return; }

      // Mirror the other upload routes: only administrators may cross project ownership.
      const project = await getUploadProject(user, projectId);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }

      // Upload to S3
      const { extension: ext, mimeType: contentType } = await validateImageBytes(file.buffer);
      const safeNum = imageNumber.replace(/[^a-zA-Z0-9_-]/g, "-");
      const key = `image-workflow/${projectId}/step5-designer/${safeNum}-${Date.now()}.${ext}`;
      const { url } = await storagePut(key, file.buffer, contentType);
      const receipt = createImageAssetReceipt({ url, key, kind: "designer", projectId, userId: user.id });
      res.json({ url: receipt.url, imageNumber });
    } catch (err: unknown) {
      sendUploadError(res, err, "designer-image");
    }
  }
);
