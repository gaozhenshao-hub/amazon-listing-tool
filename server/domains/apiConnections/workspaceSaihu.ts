import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { requireDb, type DbExecutor } from "../../repositories/dbClient";
import {
  decryptToolSecretValue,
  encryptToolSecretValue,
} from "../ai_os/services/toolGateway/governanceCore";
import {
  SAIHU_ORIGIN,
  fetchSaihuToken,
  fetchSaihuShopSummary,
  SaihuApiError,
} from "../ops/saihuClient";
type Actor = { workspaceId: number; userId: number };
const rows = async (tx: DbExecutor, query: ReturnType<typeof sql>) =>
  (await tx.execute(query))[0] as any[];
const version = (row: any) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        row
          ? {
              workspaceId: row.workspace_id,
              appId: row.app_id,
              origin: row.api_base_url,
              cipher: row.secret_cipher,
            }
          : null
      )
    )
    .digest("hex");
const conflict = () =>
  new TRPCError({ code: "CONFLICT", message: "接口配置已更新，请刷新后重试" });
const read = (tx: DbExecutor, workspace: number, lock = false) =>
  rows(
    tx,
    lock
      ? sql`SELECT workspace_id,app_id,api_base_url,secret_cipher,updated_by FROM ops_saihu_api_configs WHERE workspace_id=${workspace} FOR UPDATE`
      : sql`SELECT workspace_id,app_id,api_base_url,secret_cipher,updated_by FROM ops_saihu_api_configs WHERE workspace_id=${workspace}`
  );
async function workspaceLock(tx: DbExecutor, actor: Actor) {
  const found = await rows(
    tx,
    sql`SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=${actor.userId} FOR UPDATE`
  );
  if (
    found.length !== 1 ||
    !["admin", "super_admin"].includes(found[0].role) ||
    found[0].status !== "active" ||
    Number(found[0].defaultWorkspaceId) !== actor.workspaceId
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "仅当前工作空间管理员可以管理接口配置",
    });
}
export const saihuSettingsInput = z
  .object({
    expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
    appId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\u0000-\u001f\u007f]+$/),
    secret: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .regex(/^[^\u0000-\u001f\u007f]+$/)
      .optional(),
  })
  .strict();
export async function readWorkspaceSaihu(actor: Actor) {
  const tx = await requireDb("read workspace API settings"),
    [row] = await read(tx, actor.workspaceId),
    [check] = await rows(
      tx,
      sql`SELECT connection_version,status,checked_at,shop_count,message FROM system_api_connection_checks WHERE workspace_id=${actor.workspaceId} AND connection_code='saihu'`
    );
  const currentVersion = version(row),
    activeCheck = check?.connection_version === currentVersion ? check : null;
  return {
    configured: !!row?.secret_cipher,
    appId: row?.app_id || "",
    origin: SAIHU_ORIGIN,
    version: currentVersion,
    hasSecret: !!row?.secret_cipher,
    check: activeCheck
      ? {
          status: String(activeCheck.status),
          checkedAt: Number(activeCheck.checked_at),
          shopCount:
            activeCheck.shop_count === null
              ? null
              : Number(activeCheck.shop_count),
          message: String(activeCheck.message),
        }
      : null,
  };
}
export async function saveWorkspaceSaihu(
  actor: Actor,
  input: z.infer<typeof saihuSettingsInput>
) {
  await (
    await requireDb("save workspace API settings")
  ).transaction(async tx => {
    await workspaceLock(tx, actor);
    const [current] = await read(tx, actor.workspaceId, true);
    if (version(current) !== input.expectedVersion) throw conflict();
    if ((!current || current.app_id !== input.appId) && !input.secret)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "首次配置或更换应用ID时，请填写对应的应用密钥",
      });
    if (
      current &&
      current.app_id === input.appId &&
      !input.secret &&
      current.api_base_url === SAIHU_ORIGIN
    )
      return;
    const cipher = input.secret
      ? JSON.stringify(encryptToolSecretValue(input.secret))
      : current.secret_cipher;
    if (current)
      await tx.execute(
        sql`UPDATE ops_saihu_api_configs SET app_id=${input.appId},secret_cipher=${cipher},api_base_url=${SAIHU_ORIGIN},token_cipher=NULL,token_expires_at=NULL,updated_by=${actor.userId} WHERE workspace_id=${actor.workspaceId}`
      );
    else
      await tx.execute(
        sql`INSERT INTO ops_saihu_api_configs(workspace_id,app_id,secret_cipher,api_base_url,updated_by) VALUES(${actor.workspaceId},${input.appId},${cipher},${SAIHU_ORIGIN},${actor.userId})`
      );
    await tx.execute(
      sql`DELETE FROM system_api_connection_checks WHERE workspace_id=${actor.workspaceId} AND connection_code='saihu'`
    );
  });
  return readWorkspaceSaihu(actor);
}
export async function testWorkspaceSaihu(
  actor: Actor,
  expectedVersion: string
) {
  const db = await requireDb("test workspace API settings"),
    row = await db.transaction(async tx => {
      await workspaceLock(tx, actor);
      const [value] = await read(tx, actor.workspaceId, true);
      return value;
    });
  if (!row?.secret_cipher)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "请先保存赛狐应用ID和密钥",
    });
  if (version(row) !== expectedVersion) throw conflict();
  let status = "failed",
    message = "连接失败，请检查赛狐配置后重试",
    shopCount: number | null = null,
    token: { token: string; expiresAt: number } | null = null;
  try {
    const cipher =
        typeof row.secret_cipher === "string"
          ? JSON.parse(row.secret_cipher)
          : row.secret_cipher,
      secret = decryptToolSecretValue(cipher);
    token = await fetchSaihuToken(row.app_id, secret);
    const summary = await fetchSaihuShopSummary(
      row.app_id,
      secret,
      token.token
    );
    status = "connected";
    shopCount = summary.shopCount;
    message = `连接成功，可读取 ${shopCount} 个店铺`;
  } catch (error) {
    message =
      error instanceof SaihuApiError
        ? error.message
        : "连接失败，请核对应用ID、密钥、赛狐授权和服务器白名单后重试";
  }
  await db.transaction(async tx => {
    await workspaceLock(tx, actor);
    const [current] = await read(tx, actor.workspaceId, true);
    if (version(current) !== expectedVersion) throw conflict();
    if (status === "connected" && token)
      await tx.execute(
        sql`UPDATE ops_saihu_api_configs SET token_cipher=${JSON.stringify(encryptToolSecretValue(token.token))},token_expires_at=${token.expiresAt} WHERE workspace_id=${actor.workspaceId}`
      );
    await tx.execute(
      sql`INSERT INTO system_api_connection_checks(workspace_id,connection_code,connection_version,status,checked_at,shop_count,message) VALUES(${actor.workspaceId},'saihu',${expectedVersion},${status},${Date.now()},${shopCount},${message}) ON DUPLICATE KEY UPDATE connection_version=VALUES(connection_version),status=VALUES(status),checked_at=VALUES(checked_at),shop_count=VALUES(shop_count),message=VALUES(message)`
    );
  });
  return readWorkspaceSaihu(actor);
}
