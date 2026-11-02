import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { parse as parseCookieHeader } from "cookie";
import { sdk } from "./_core/sdk";
import { getUserById } from "./repositories";
import { assertResourceAction, recordSecurityAuditLog, type SecurityActor } from "./services/securityGovernance";
import { preflightProductKnowledgeTransfer } from "./domains/knowledge/productKnowledgeTransferService";
import { PRODUCT_KNOWLEDGE_TRANSFER_MAX_UPLOAD_BYTES } from "./domains/knowledge/productKnowledgeTransferZip";

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, tmpdir()),
    filename: (_req, file, callback) => callback(null, `kb-transfer-upload-${randomUUID()}${extname(file.originalname).toLowerCase() || ".zip"}`),
  }),
  limits: { fileSize: PRODUCT_KNOWLEDGE_TRANSFER_MAX_UPLOAD_BYTES, files: 1, fields: 3 },
  fileFilter: (_req, file, callback) => callback(null, file.originalname.toLowerCase().endsWith(".zip")),
});

export const kbTransferUploadRouter = Router();

async function getAuthActor(req: Request): Promise<SecurityActor | null> {
  try {
    const cookies = req.headers.cookie ? new Map(Object.entries(parseCookieHeader(req.headers.cookie))) : new Map<string, string>();
    const session = await sdk.verifySession(cookies.get("app_session_id"));
    if (!session) return null;
    if (session.openId.startsWith("pwd_")) {
      const userId = Number.parseInt(session.openId.slice(4), 10);
      if (!Number.isSafeInteger(userId)) return null;
      const user = await getUserById(userId);
      if (!user || user.status !== "active") return null;
      return { id: user.id, role: user.role, defaultWorkspaceId: (user as any).defaultWorkspaceId ?? null };
    }
    const user = await sdk.authenticateRequest(req);
    return user ? { id: user.id, role: (user as any).role, defaultWorkspaceId: (user as any).defaultWorkspaceId ?? null } : null;
  } catch {
    return null;
  }
}

kbTransferUploadRouter.post("/preflight", upload.single("file"), async (req: Request, res: Response) => {
  const actor = await getAuthActor(req);
  const file = req.file;
  const workspaceId = Number.parseInt(String(req.body.workspaceId || ""), 10);
  if (!actor) {
    if (file?.path) await rm(file.path, { force: true });
    res.status(401).json({ error: "请先登录" });
    return;
  }
  if (!file || !Number.isSafeInteger(workspaceId) || workspaceId <= 0) {
    if (file?.path) await rm(file.path, { force: true });
    res.status(400).json({ error: "请提供ZIP知识包和有效的工作空间" });
    return;
  }
  try {
    await assertResourceAction({ actor, resource: "knowledge", action: "upload", workspaceId });
    const preview = await preflightProductKnowledgeTransfer(actor.id, workspaceId, file.path, file.originalname);
    await recordSecurityAuditLog({
      actorUserId: actor.id,
      actorRole: actor.role,
      workspaceId,
      action: "knowledge.upload",
      resourceType: "knowledge",
      resourceId: preview.stageId,
      status: "success",
      riskLevel: "high",
      metadata: { itemCount: preview.summary.itemCount, attachmentCount: preview.summary.attachmentCount, packageSha256: preview.packageSha256 },
    });
    res.json(preview);
  } catch (error) {
    const message = error instanceof Error ? error.message : "知识包预检失败";
    await recordSecurityAuditLog({
      actorUserId: actor.id,
      actorRole: actor.role,
      workspaceId,
      action: "knowledge.upload",
      resourceType: "knowledge",
      status: "failed",
      riskLevel: "high",
      reason: message,
      metadata: { fileName: file.originalname, fileSize: file.size },
    });
    res.status(400).json({ error: message });
  } finally {
    await rm(file.path, { force: true });
  }
});
