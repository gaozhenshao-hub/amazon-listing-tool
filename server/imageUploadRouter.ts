/**
 * Fast image upload router
 * Accepts multipart/form-data directly, streams to S3 via storagePut.
 * Avoids base64 encoding overhead that slows down tRPC-based uploads.
 */
import { Router, Request, Response } from "express";
import multer from "multer";
import { parse as parseCookieHeader } from "cookie";
import { randomUUID } from "node:crypto";
import { PDFParse } from "pdf-parse";
import { assertPrivateEvidenceStorageAvailable, storagePut } from "./storage";
import { getUserById, getProjectById, getProjectByIdAdmin, getExpressionGroupByProject, insertCompetitorImage, countExpressionGroupImages } from "./repositories";
import { sdk } from "./_core/sdk";
import { createImageAssetReceipt } from "./domains/image/services/imageAssetReceipt";
import { InvalidImageError, validateImageBytes } from "./domains/image/services/validateImageBytes";
import {
  ControlledImageLedgerWriteError,
  imageAssetTrustLedgerService,
  recordServerControlledImageUpload,
  type ControlledImageUploadPurpose,
} from "./domains/image/services/imageAssetTrustLedgerService";

// Store file in memory (max 20MB per file)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const MAX_LICENSE_PROOF_BYTES = 5 * 1024 * 1024;
const MAX_LICENSE_PROOF_PAGES = 12;
const MAX_LICENSE_PROOF_TEXT_CHARS = 250_000;
const LICENSE_PROOF_TYPES = new Set([
  "copyright_registration",
  "signed_license",
  "photographer_release",
  "employment_assignment",
  "purchase_invoice",
]);

export const imageUploadRouter = Router();

function sendUploadError(res: Response, error: unknown, route: string) {
  if (error instanceof InvalidImageError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof ControlledImageLedgerWriteError) {
    console.error(`[imageUpload] ${route} trust ledger error:`, error.originalError);
    res.status(error.conflict ? 409 : 503).json({
      error: "可信素材账本暂不可用；上传对象未获制作回执，请勿使用该链接",
      source: error.source,
    });
    return;
  }
  console.error(`[imageUpload] ${route} error:`, error);
  res.status(500).json({ error: "上传失败，请稍后重试" });
}

async function recordReceiptBeforeSigning(input: {
  projectId: number;
  workspaceId: number;
  userId: number;
  userRole: string;
  kind: "step4-ref" | "designer" | "expression-group";
  intendedUse: ControlledImageUploadPurpose;
  expectedKey: string;
  stored: { key: string; storageUri: string };
  bytes: Buffer;
}) {
  // `storagePut` owns canonical key/URI construction. Refuse an inconsistent
  // adapter response rather than producing a receipt for a browser URL alone.
  if (!isExpectedStorageResult(input.stored, input.expectedKey)) {
    throw new ControlledImageLedgerWriteError(new Error("storagePut did not return the expected controlled key/URI"));
  }
  try {
    await recordServerControlledImageUpload({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: input.userId,
      actorRole: input.userRole,
      kind: input.kind,
      intendedUse: input.intendedUse,
      storage: { key: input.stored.key, storageUri: input.stored.storageUri },
      bytes: input.bytes,
    });
  } catch (error) {
    if (error instanceof ControlledImageLedgerWriteError) throw error;
    throw new ControlledImageLedgerWriteError(error);
  }
}

function isExpectedStorageResult(stored: { key: string; storageUri: string }, expectedKey: string) {
  const storageUri = /^storage:\/\/(?:forge|s3|oss)\/(.+)$/u.exec(stored.storageUri || "");
  return stored.key === expectedKey && storageUri?.[1] === expectedKey;
}

function strictPositiveInt(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function optionalProofExpiry(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new InvalidImageError("许可证明到期日必须为 YYYY-MM-DD");
  }
  const expiresAt = new Date(`${value}T23:59:59.999Z`);
  if (Number.isNaN(expiresAt.valueOf()) || expiresAt.valueOf() <= Date.now()) {
    throw new InvalidImageError("许可证明到期日必须是未来日期");
  }
  return expiresAt;
}

/** Parses server-held PDF bytes only. No extracted text is persisted or returned. */
async function validateLicenseProofPdf(file: Express.Multer.File) {
  if (file.mimetype !== "application/pdf" || !/\.pdf$/iu.test(file.originalname || "")) {
    throw new InvalidImageError("许可证明材料仅接受 application/pdf 格式的 PDF 文件");
  }
  if (file.buffer.length < 32 || file.buffer.length > MAX_LICENSE_PROOF_BYTES) {
    throw new InvalidImageError("许可证明材料大小必须在 32 字节至 5 MB 之间");
  }
  const trailer = file.buffer.subarray(Math.max(0, file.buffer.length - 2_048)).toString("latin1");
  if (!file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-")) || !trailer.includes("%%EOF")) {
    throw new InvalidImageError("许可证明材料不是完整的 PDF 文件");
  }
  const parser = new PDFParse({
    data: new Uint8Array(file.buffer),
    stopAtErrors: true,
    disableFontFace: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    maxImageSize: 4_000_000,
  });
  try {
    const info = await parser.getInfo();
    if (!Number.isSafeInteger(info.total) || info.total < 1 || info.total > MAX_LICENSE_PROOF_PAGES) {
      throw new InvalidImageError(`许可证明材料页数必须为 1–${MAX_LICENSE_PROOF_PAGES} 页`);
    }
    const text = await parser.getText({ first: info.total, parseHyperlinks: false, pageJoiner: "" });
    if (text.text.length > MAX_LICENSE_PROOF_TEXT_CHARS) {
      throw new InvalidImageError("许可证明材料文本过大，不能安全处理");
    }
  } catch (error) {
    if (error instanceof InvalidImageError) throw error;
    throw new InvalidImageError("许可证明材料无法由服务器安全解析为 PDF");
  } finally {
    await parser.destroy();
  }
}

function sendLicenseProofError(res: Response, error: unknown) {
  if (error instanceof InvalidImageError) {
    res.status(400).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Private evidence preview requires") || message.includes("Private evidence preview TTL")) {
    res.status(503).json({
      error: "许可证明需要私有S3/OSS桶和短期授权预览配置；当前环境未就绪，文件未存储",
      source: "private_evidence_storage",
    });
    return;
  }
  if (message.includes("账本所需数据表尚未就绪") || message.includes("可信素材账本")) {
    res.status(503).json({
      error: "可信素材账本所需数据表尚未就绪或不可用；许可证明未登记，不能用于制作",
      source: "trust_ledger",
    });
    return;
  }
  if (message.includes("许可证明") || message.includes("受控上传") || message.includes("图片素材")) {
    res.status(400).json({ error: message.slice(0, 300) });
    return;
  }
  console.error("[imageUpload] license-evidence error:", error);
  res.status(500).json({ error: "许可证明上传失败，请稍后重试" });
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
 * POST /api/upload/license-evidence
 * A proof PDF is private audit material. The response intentionally contains no
 * object URL/key, byte hash, proof text, or signed material reference.
 */
imageUploadRouter.post(
  "/license-evidence",
  upload.single("file"),
  async (req: Request, res: Response) => {
    const user = await getAuthUser(req);
    if (!user) {
      res.status(401).json({ error: "请先登录" });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "未收到许可证明 PDF" });
      return;
    }
    const projectId = strictPositiveInt(req.body.projectId);
    const originKind = req.body.originKind === "own_product" || req.body.originKind === "designer_upload"
      ? req.body.originKind
      : null;
    const receiptReference = typeof req.body.receiptReference === "string" ? req.body.receiptReference : "";
    const proofType = typeof req.body.proofType === "string" ? req.body.proofType.trim() : "";
    const authorizationStatement = typeof req.body.authorizationStatement === "string"
      ? req.body.authorizationStatement.trim()
      : "";

    if (!projectId || !originKind || !receiptReference || !LICENSE_PROOF_TYPES.has(proofType) || !authorizationStatement) {
      res.status(400).json({ error: "缺少或不支持的许可证明关联信息" });
      return;
    }
    if (authorizationStatement.length > 4_096) {
      res.status(400).json({ error: "授权声明过长" });
      return;
    }

    try {
      const project = await getUploadProject(user, projectId);
      if (!project) {
        res.status(404).json({ error: "项目不存在或无权限" });
        return;
      }
      assertPrivateEvidenceStorageAvailable();
      await validateLicenseProofPdf(file);
      const expiresAt = optionalProofExpiry(req.body.expiresAt);
      const key = `image-license-evidence/${projectId}/${randomUUID()}.pdf`;
      const stored = await storagePut(key, file.buffer, "application/pdf");
      if (!isExpectedStorageResult(stored, key)) {
        throw new Error("storagePut did not return the expected controlled key/URI");
      }
      const evidence = await imageAssetTrustLedgerService.createPendingLicenseEvidence({
        workspaceId: Number(project.workspaceId),
        projectId,
        actorId: user.id,
        actorRole: user.role,
        originKind,
        receiptReference,
        proofType,
        authorizationStatement,
        proofMaterial: { storageKey: stored.key, storageUri: stored.storageUri, bytes: file.buffer },
        expiresAt,
      });
      res.status(201).json({
        evidenceRecordId: evidence.evidenceRecordId,
        version: evidence.version,
        status: evidence.status,
        expiresAt: evidence.expiresAt,
      });
    } catch (error) {
      sendLicenseProofError(res, error);
    }
  }
);

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
      const stored = await storagePut(key, file.buffer, contentType);
      await recordReceiptBeforeSigning({
        projectId,
        workspaceId: Number(project.workspaceId),
        userId: user.id,
        userRole: user.role,
        kind: "step4-ref",
        intendedUse: "step4_reference",
        expectedKey: key,
        stored,
        bytes: file.buffer,
      });
      const { url } = stored;
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
      const stored = await storagePut(key, file.buffer, contentType);
      await recordReceiptBeforeSigning({
        projectId,
        workspaceId: Number(project.workspaceId),
        userId: user.id,
        userRole: user.role,
        kind: "expression-group",
        intendedUse: "expression_group_research",
        expectedKey: key,
        stored,
        bytes: file.buffer,
      });
      const { url } = stored;
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
      const stored = await storagePut(key, file.buffer, contentType);
      await recordReceiptBeforeSigning({
        projectId,
        workspaceId: Number(project.workspaceId),
        userId: user.id,
        userRole: user.role,
        kind: "designer",
        intendedUse: "designer_attachment",
        expectedKey: key,
        stored,
        bytes: file.buffer,
      });
      const { url } = stored;
      const receipt = createImageAssetReceipt({ url, key, kind: "designer", projectId, userId: user.id });
      res.json({ url: receipt.url, imageNumber });
    } catch (err: unknown) {
      sendUploadError(res, err, "designer-image");
    }
  }
);
