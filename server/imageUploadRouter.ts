/**
 * Fast image upload router
 * Accepts multipart/form-data directly, streams to S3 via storagePut.
 * Avoids base64 encoding overhead that slows down tRPC-based uploads.
 */
import { Router, Request, Response } from "express";
import multer from "multer";
import { parse as parseCookieHeader } from "cookie";
import { storagePut } from "./storage";
import { getUserById, getProjectById, getProjectByIdAdmin, insertCompetitorImage, countExpressionGroupImages } from "./repositories";
import { sdk } from "./_core/sdk";

// Store file in memory (max 20MB per file)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

export const imageUploadRouter = Router();

// Authenticate via session cookie (mirrors context.ts logic)
async function getAuthUser(req: Request): Promise<{ id: number; role: string } | null> {
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
      return user || null;
    }
  } catch {
    return null;
  }
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
      // Verify project access (admin can access all, others only their own)
      let project: any = null;
      if ((user as any).role === "admin") {
        project = await getProjectByIdAdmin(projectId);
      } else {
        project = await getProjectById(projectId, user.id);
      }
      if (!project) {
        res.status(404).json({ error: "项目不存在或无权限" });
        return;
      }

      // Upload to S3 directly from buffer (no base64 round-trip)
      const ext = (file.originalname.split(".").pop() || "jpg").toLowerCase();
      const safeName = competitorName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "-");
      const key = `image-workflow/${projectId}/step0-competitor/${safeName}-${Date.now()}.${ext}`;
      const contentType = file.mimetype || `image/${ext}`;
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
    } catch (err: any) {
      console.error("[imageUpload] competitor-image error:", err);
      res.status(500).json({ error: err.message || "上传失败" });
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
      let project: any = null;
      if ((user as any).role === "admin") {
        project = await getProjectByIdAdmin(projectId);
      } else {
        project = await getProjectById(projectId, user.id);
      }
      if (!project) {
        res.status(404).json({ error: "项目不存在或无权限" });
        return;
      }

      const ext = (file.originalname.split(".").pop() || "jpg").toLowerCase();
      const key = `image-workflow/${projectId}/step4-ref/${refType}-${imageIndex}-${Date.now()}.${ext}`;
      const contentType = file.mimetype || `image/${ext}`;
      const { url } = await storagePut(key, file.buffer, contentType);

      res.json({ url });
    } catch (err: any) {
      console.error("[imageUpload] ref-image error:", err);
      res.status(500).json({ error: err.message || "上传失败" });
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
      // Verify project access
      let project: any = null;
      if ((user as any).role === "admin") {
        project = await getProjectByIdAdmin(projectId);
      } else {
        project = await getProjectById(projectId, user.id);
      }
      if (!project) {
        res.status(404).json({ error: "项目不存在或无权限" });
        return;
      }

      // Enforce max 5 images per group
      const count = await countExpressionGroupImages(groupId);
      if (count >= 5) {
        res.status(400).json({ error: "每个表达方向最多上传5张参考图" });
        return;
      }

      // Upload to S3
      const ext = (file.originalname.split(".").pop() || "jpg").toLowerCase();
      const safeName = (competitorName || "img").replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "-");
      const key = `image-workflow/${projectId}/step0-expression/${groupId}-${safeName}-${Date.now()}.${ext}`;
      const contentType = file.mimetype || `image/${ext}`;
      const { url } = await storagePut(key, file.buffer, contentType);

      res.json({ url, competitorName });
    } catch (err: any) {
      console.error("[imageUpload] expression-group-image error:", err);
      res.status(500).json({ error: err.message || "上传失败" });
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

      // Verify project access
      const project = await getProjectByIdAdmin(projectId);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }

      // Upload to S3
      const ext = (file.originalname.split(".").pop() || "jpg").toLowerCase();
      const safeNum = imageNumber.replace(/[^a-zA-Z0-9_-]/g, "-");
      const key = `image-workflow/${projectId}/step5-designer/${safeNum}-${Date.now()}.${ext}`;
      const contentType = file.mimetype || `image/${ext}`;
      const { url } = await storagePut(key, file.buffer, contentType);
      res.json({ url, imageNumber });
    } catch (err: any) {
      console.error("[imageUpload] designer-image error:", err);
      res.status(500).json({ error: err.message || "上传失败" });
    }
  }
);
