import { randomBytes, randomUUID } from "node:crypto";
import { Router, type Response, type Request } from "express";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authenticatePasswordCredentials } from "../../services/passwordAuthentication";
import { requireDb } from "../../repositories/dbClient";
import {
  assertResourceAction,
  recordSecurityAuditLog,
} from "../../services/securityGovernance";
import {
  collectResearch,
  researchHash,
  researchRows,
  type ResearchScope,
} from "./researchLibrary";
import {
  researchBookmarkSchema,
  researchIdentity,
} from "../../../shared/researchLibrary";
const rates = new Map<string, { until: number; count: number }>();
// Extension GET requests can omit Origin. Bind every request to its stable
// extension identity as well as the unguessable, scoped bearer token.
export function extensionRequestOrigin(origin: string, extensionId = "") {
  if (extensionId && !/^[a-p]{32}$/.test(extensionId))
    throw new TRPCError({ code: "FORBIDDEN", message: "请通过收藏插件访问" });
  const expected = extensionId ? `chrome-extension://${extensionId}` : "";
  if (
    origin &&
    (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
      (expected && origin !== expected))
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "插件身份不一致，请重新打开插件",
    });
  return origin || expected;
}
function limit(key: string, max: number, window = 60000) {
  const now = Date.now();
  if (rates.size > 5000)
    for (const [k, v] of rates) if (v.until < now) rates.delete(k);
  let rate = rates.get(key);
  if (!rate || rate.until < now) {
    rate = { until: now + window, count: 0 };
    rates.set(key, rate);
  }
  if (++rate.count > max)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "操作较频繁，请稍后再试",
    });
}
async function currentScope(
  userId: number,
  workspaceId: number,
  action: "read" | "create"
) {
  const db = await requireDb("extension account scope"),
    [user] = await researchRows(
      db,
      sql`SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=${userId}`
    );
  if (
    !user ||
    user.status !== "active" ||
    Number(user.defaultWorkspaceId) !== workspaceId
  )
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "登录已失效，请重新连接插件",
    });
  await assertResourceAction({
    actor: { id: userId, role: user.role, defaultWorkspaceId: workspaceId },
    workspaceId,
    resource: "product_development",
    action,
  });
  return { userId, workspaceId, role: String(user.role) };
}
export async function pairingInfo(_scope: ResearchScope, code: string) {
  const [row] = await researchRows(
    await requireDb("extension pairing information"),
    sql`SELECT browser_name,status FROM research_extension_sessions WHERE code_hash=${researchHash(code)} AND status='pending' AND expires_at>NOW()`
  );
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "连接码已失效，请从插件重新发起登录",
    });
  return {
    browserName: String(row.browser_name),
    scope: "仅收藏亚马逊产品和店铺、查看本人收藏状态",
  };
}
export async function approveResearchExtension(
  scope: ResearchScope,
  code: string
) {
  limit(`approve:${scope.userId}`, 30);
  await currentScope(scope.userId, scope.workspaceId, "create");
  const result = await (
    await requireDb("approve research extension")
  ).execute(
    sql`UPDATE research_extension_sessions SET user_id=${scope.userId},workspace_id=${scope.workspaceId},status='approved',code_hash=NULL,expires_at=DATE_ADD(NOW(),INTERVAL 30 DAY) WHERE code_hash=${researchHash(code)} AND status='pending' AND expires_at>NOW()`
  );
  if (!(result[0] as any).affectedRows)
    throw new TRPCError({
      code: "CONFLICT",
      message: "连接码已使用或过期，请重新登录插件",
    });
  void recordSecurityAuditLog({
    actorUserId: scope.userId,
    actorRole: scope.role,
    workspaceId: scope.workspaceId,
    action: "research_extension.connect",
    resourceType: "product_development",
    status: "success",
    metadata: { scope: "collect_own_research" },
  });
  return { ok: true };
}
export async function researchExtensionSessions(scope: ResearchScope) {
  return researchRows(
    await requireDb("research extension sessions"),
    sql`SELECT id,browser_name,created_at,last_used_at,expires_at FROM research_extension_sessions WHERE workspace_id=${scope.workspaceId} AND user_id=${scope.userId} AND status='approved' AND expires_at>NOW() ORDER BY created_at DESC`
  );
}
export async function revokeResearchExtension(
  scope: ResearchScope,
  id: string
) {
  await (
    await requireDb("revoke research extension")
  ).execute(
    sql`UPDATE research_extension_sessions SET status='revoked',expires_at=NOW() WHERE id=${id} AND workspace_id=${scope.workspaceId} AND user_id=${scope.userId}`
  );
  return { ok: true };
}
export async function researchExtensionScope(
  token: string,
  origin: string,
  action: "read" | "create"
) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录收藏插件" });
  const db = await requireDb("research extension authentication"),
    [session] = await researchRows(
      db,
      sql`SELECT id,user_id,workspace_id,extension_origin FROM research_extension_sessions WHERE token_hash=${researchHash(token)} AND status='approved' AND expires_at>NOW()`
    );
  if (
    !session ||
    (session.extension_origin && origin !== session.extension_origin)
  )
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "插件登录已失效，请重新登录",
    });
  const scope = await currentScope(
    Number(session.user_id),
    Number(session.workspace_id),
    action
  );
  limit(`collect:${session.id}`, 120);
  await db.execute(
    sql`UPDATE research_extension_sessions SET last_used_at=NOW() WHERE id=${session.id}`
  );
  return scope;
}
function respondError(res: Response, error: unknown) {
  const e = error as { code?: string };
  const status =
    e.code === "UNAUTHORIZED"
      ? 401
      : e.code === "FORBIDDEN"
        ? 403
        : e.code === "TOO_MANY_REQUESTS"
          ? 429
          : 400;
  res.status(error instanceof z.ZodError ? 400 : status).json({
    code: e.code || "BAD_REQUEST",
    error: [
      "UNAUTHORIZED",
      "FORBIDDEN",
      "TOO_MANY_REQUESTS",
      "BAD_REQUEST",
    ].includes(e.code || "")
      ? (error as Error).message
      : "收藏暂未完成，请重新登录或稍后重试",
  });
}
const handle =
  (fn: (req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      respondError(res, e);
    }
  };
const authenticate = (req: Request, action: "read" | "create") =>
  researchExtensionScope(
    (req.get("authorization") || "").replace(/^Bearer /, ""),
    extensionRequestOrigin(
      req.get("origin") || "",
      req.get("x-research-extension-id") || ""
    ),
    action
  );
export const researchExtensionHttp = Router();
researchExtensionHttp.use((req, res, next) => {
  const origin = req.get("origin") || "";
  if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))
    return void res.status(403).json({ error: "请通过收藏插件访问" });
  if (origin)
    res
      .set("Access-Control-Allow-Origin", origin)
      .set("Vary", "Origin")
      .set(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Research-Extension-Id"
      )
      .set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return void res.sendStatus(204);
  next();
});
export async function loginResearchExtension(
  req: Pick<Request, "ip" | "body" | "get">
) {
  limit(`login:${researchHash(req.ip || "unknown")}`, 15, 600000);
  const origin = extensionRequestOrigin(
    req.get("origin") || "",
    req.get("x-research-extension-id") || ""
  );
  if (!origin)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "请从浏览器收藏插件登录",
    });
  const input = z
    .object({
      identifier: z.string().trim().min(1).max(200),
      password: z.string().min(1).max(1000),
    })
    .strict()
    .parse(req.body);
  const user = await authenticatePasswordCredentials(input, {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  if (user.mustChangePassword === 1)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "请先在系统中完成首次密码修改，再回到插件登录",
    });
  const scope = await currentScope(
    user.id,
    Number(user.defaultWorkspaceId),
    "create"
  );
  const token = randomBytes(32).toString("hex"),
    expiresAt = new Date(Date.now() + 30 * 86400000).toISOString(),
    browserName = (req.get("user-agent") || "").includes("Edg/")
      ? "Microsoft Edge 收藏插件"
      : "Google Chrome 收藏插件";
  await (
    await requireDb("extension password login")
  ).execute(
    sql`INSERT INTO research_extension_sessions(id,token_hash,code_hash,extension_origin,browser_name,user_id,workspace_id,status,expires_at) VALUES(${randomUUID()},${researchHash(token)},NULL,${origin},${browserName},${scope.userId},${scope.workspaceId},'approved',DATE_ADD(NOW(),INTERVAL 30 DAY))`
  );
  void recordSecurityAuditLog({
    actorUserId: scope.userId,
    actorRole: scope.role,
    workspaceId: scope.workspaceId,
    action: "research_extension.connect",
    resourceType: "product_development",
    status: "success",
    metadata: { scope: "collect_own_research" },
  });
  return { token, name: user.name || "当前用户", expiresAt };
}
researchExtensionHttp.post("/login", handle(loginResearchExtension));
researchExtensionHttp.post(
  "/pair",
  handle(async req => {
    limit(`pair:${researchHash(req.ip || "unknown")}`, 10, 600000);
    const token = randomBytes(32).toString("hex"),
      code = randomBytes(5).toString("hex").toUpperCase(),
      name = String(req.body?.browserName || "Chrome / Edge 收藏插件").slice(
        0,
        100
      ),
      origin = extensionRequestOrigin(
        req.get("origin") || "",
        req.get("x-research-extension-id") || ""
      );
    await (
      await requireDb("create extension pairing")
    ).execute(
      sql`INSERT INTO research_extension_sessions(id,token_hash,code_hash,extension_origin,browser_name,expires_at) VALUES(${randomUUID()},${researchHash(token)},${researchHash(code)},${origin},${name},DATE_ADD(NOW(),INTERVAL 10 MINUTE))`
    );
    return {
      deviceToken: token,
      code,
      verificationPath: `/dev/library/connect?code=${code}`,
      expiresIn: 600,
    };
  })
);
researchExtensionHttp.post(
  "/pair/status",
  handle(async req => {
    const token = String(req.body?.deviceToken || "");
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new TRPCError({ code: "UNAUTHORIZED", message: "请重新发起登录" });
    limit(`poll:${researchHash(token)}`, 40);
    const db = await requireDb("poll extension pairing"),
      [row] = await researchRows(
        db,
        sql`SELECT status,user_id,workspace_id,extension_origin FROM research_extension_sessions WHERE token_hash=${researchHash(token)} AND expires_at>NOW()`
      );
    if (
      !row ||
      (row.extension_origin &&
        row.extension_origin !==
          extensionRequestOrigin(
            req.get("origin") || "",
            req.get("x-research-extension-id") || ""
          ))
    )
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "连接已失效，请重新登录",
      });
    if (row.status === "pending") return { pending: true };
    if (row.status !== "approved")
      throw new TRPCError({ code: "UNAUTHORIZED", message: "插件登录已失效" });
    await currentScope(Number(row.user_id), Number(row.workspace_id), "read");
    const [user] = await researchRows(
      db,
      sql`SELECT name FROM users WHERE id=${row.user_id}`
    );
    return { connected: true, name: String(user.name || "当前用户") };
  })
);
researchExtensionHttp.get(
  "/profile",
  handle(async req => {
    const scope = await authenticate(req, "read"),
      [user] = await researchRows(
        await requireDb("extension profile"),
        sql`SELECT name FROM users WHERE id=${scope.userId}`
      );
    return { name: String(user.name || "当前用户") };
  })
);
researchExtensionHttp.post(
  "/collect",
  handle(async req =>
    collectResearch(
      await authenticate(req, "create"),
      researchBookmarkSchema.parse(req.body)
    )
  )
);
researchExtensionHttp.post(
  "/lookup",
  handle(async req => {
    const scope = await authenticate(req, "read"),
      input = researchBookmarkSchema
        .pick({ kind: true, url: true })
        .parse(req.body),
      identity = researchIdentity(input.kind, input.url);
    const [row] = await researchRows(
      await requireDb("lookup own research bookmark"),
      sql`SELECT id FROM research_bookmarks WHERE workspace_id=${scope.workspaceId} AND user_id=${scope.userId} AND kind=${input.kind} AND identity_hash=${researchHash(identity.key)} AND deleted_at IS NULL`
    );
    return { collected: !!row };
  })
);
researchExtensionHttp.post(
  "/logout",
  handle(async req => {
    const token = (req.get("authorization") || "").replace(/^Bearer /, ""),
      scope = await authenticate(req, "read");
    await (
      await requireDb("logout research extension")
    ).execute(
      sql`UPDATE research_extension_sessions SET status='revoked',expires_at=NOW() WHERE token_hash=${researchHash(token)} AND user_id=${scope.userId} AND workspace_id=${scope.workspaceId}`
    );
    return { ok: true };
  })
);
