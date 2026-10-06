/**
 * kbExternalApi.ts — 知识库对外 REST API
 *
 * External callers must authenticate with a one-time provisioned caller token.
 * Each token is bound to exactly one workspace and read-only scopes server-side;
 * caller-supplied workspace headers and environment-wide fallback keys are ignored.
 */
import { Router, type Request, type Response } from "express";
import * as kbDb from "./kbDb";
import { rawExecute } from "./domains/ai_os/routerContext";
import {
  EXTERNAL_KNOWLEDGE_CALLER_KIND,
  hashExternalKnowledgeCallerToken,
} from "./domains/ai_os/services/externalKnowledgeCaller";

export const kbExternalApiRouter = Router();

type ExternalKnowledgeCaller = {
  workspaceId: number;
  userId: number;
  scopes: string[];
  connectorId: number;
};

function getBearerToken(value: unknown) {
  const authorization = String(value || "").trim();
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
}

async function resolveCaller(req: Request, res: Response, requiredScope: string): Promise<ExternalKnowledgeCaller | null> {
  const token = getBearerToken(req.header("authorization"));
  if (!token) {
    res.status(401).json({ error: "AUTH_REQUIRED" });
    return null;
  }

  const rows = await rawExecute(
    `SELECT caller.connectorId, caller.workspaceId, caller.createdByUserId, caller.scopes
       FROM emperor_external_knowledge_callers AS caller
       INNER JOIN emperor_mcp_connectors AS connector ON connector.id = caller.connectorId
      WHERE caller.tokenHash = ?
        AND caller.revokedAt IS NULL
        AND connector.isActive = 1
        AND JSON_UNQUOTE(JSON_EXTRACT(connector.config, '$.kind')) = ?
      LIMIT 1`,
    [hashExternalKnowledgeCallerToken(token), EXTERNAL_KNOWLEDGE_CALLER_KIND],
  );
  const row = rows[0];
  if (!row) {
    res.status(403).json({ error: "CALLER_BINDING_INVALID" });
    return null;
  }

  let scopes: unknown = row.scopes;
  if (typeof scopes === "string") {
    try {
      scopes = JSON.parse(scopes);
    } catch {
      scopes = [];
    }
  }
  if (!Array.isArray(scopes) || !scopes.includes(requiredScope)) {
    res.status(403).json({ error: "CALLER_SCOPE_DENIED" });
    return null;
  }

  await rawExecute(
    "UPDATE emperor_external_knowledge_callers SET lastUsedAt = NOW() WHERE connectorId = ?",
    [row.connectorId],
  );
  return {
    workspaceId: Number(row.workspaceId),
    userId: Number(row.createdByUserId),
    scopes: scopes.filter((scope): scope is string => typeof scope === "string"),
    connectorId: Number(row.connectorId),
  };
}

kbExternalApiRouter.get("/stats", async (req, res, next) => {
  try {
    const caller = await resolveCaller(req, res, "stats");
    if (!caller) return;
    const stats = await kbDb.getKbStats(caller.userId, caller.workspaceId, "shared");
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

kbExternalApiRouter.post("/search", async (req, res, next) => {
  try {
    const caller = await resolveCaller(req, res, "search");
    if (!caller) return;
    const query = String(req.body?.query || "").trim();
    if (!query) return res.status(400).json({ error: "QUERY_REQUIRED" });
    const results = await kbDb.searchKnowledgeBase(caller.userId, caller.workspaceId, query, "shared");
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

kbExternalApiRouter.post("/rag", async (req, res, next) => {
  try {
    const caller = await resolveCaller(req, res, "rag");
    if (!caller) return;
    const query = String(req.body?.query || "").trim();
    const type = String(req.body?.type || "").trim();
    if (!query || !type) return res.status(400).json({ error: "QUERY_AND_TYPE_REQUIRED" });
    const results = await kbDb.searchKnowledgeBase(caller.userId, caller.workspaceId, query, "shared");
    res.json({ results: results.filter((item: any) => item.type === type && item.status === "confirmed") });
  } catch (error) {
    next(error);
  }
});

kbExternalApiRouter.get("/collections", async (req, res, next) => {
  try {
    const caller = await resolveCaller(req, res, "stats");
    if (!caller) return;
    res.json({
      success: true,
      collections: [
        { slug: "kb-product", name: "产品创新知识库", type: "product", description: "已确认的产品创意案例" },
        { slug: "kb-listing", name: "Listing文案知识库", type: "listing", description: "已确认的Listing文案案例" },
        { slug: "kb-image", name: "图片知识库", type: "image", description: "已确认的图片集案例" },
        { slug: "kb-skill", name: "运营技巧知识库", type: "skill", description: "已确认的运营经验和最佳实践" },
        { slug: "kb-video", name: "视频知识库", type: "video", description: "已确认的视频案例" },
      ],
    });
  } catch (error) {
    next(error);
  }
});
