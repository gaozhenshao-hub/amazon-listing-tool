import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { inventoryRefreshHash } from "../../../shared/inventorySnapshotRefresh";
import type { InventoryMappingOptions, InventoryScopeBinding } from "../../../shared/inventorySnapshotMapping";
import { decryptToolSecretValue } from "../ai_os/services/toolGateway/governanceCore";

export const INVENTORY_VENDOR_ORIGIN = "https://openapi.sellfox.com";
export const INVENTORY_COLLECTION_MAPPING_VERSION = inventoryRefreshHash({
  rule: "friend383b69e_T14_v2", collection: "saihu-inventory-collection-v1",
  scopeBindings: [], options: { latestShipmentAllocation: { approved: false } },
});
export type InventoryConfigExecutor = { execute(query: SQL): Promise<unknown> };
export type InventoryCollectionConfig = {
  connectionVersion: string; mappingVersion: string;
  scopeBindings: InventoryScopeBinding[]; mappingOptions: InventoryMappingOptions;
};
export type InventoryCollectionCredentials = { workspaceId: number; appId: string; secret: string; connectionVersion: string };
const encrypted = z.object({
  encryptedValue: z.string().min(4).max(16384).regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  iv: z.string().length(16).regex(/^[A-Za-z0-9+/]+$/u),
  authTag: z.string().length(24).regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  keyVersion: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/u).optional(),
}).strict();
const id = z.number().int().positive().max(2_147_483_647);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
function fail(code = "INVENTORY_COLLECTION_CONFIG_INVALID"): never { throw new Error(code); }
function missingTable(error: unknown) {
  let item = error;
  for (let depth = 0; depth < 5 && item && typeof item === "object"; depth++) {
    const e = item as { code?: unknown; errno?: unknown; cause?: unknown };
    if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return true;
    item = e.cause;
  }
  return false;
}
async function readConfig(tx: InventoryConfigExecutor, workspaceId: number) {
  id.parse(workspaceId);
  let result: unknown;
  try {
    const tables = await tx.execute(sql`SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ops_saihu_api_configs'`);
    if (!Array.isArray(tables) || !Array.isArray(tables[0]) || tables[0].length > 1) return fail();
    if (tables[0].length === 0) return null;
    if (tables[0][0]?.engine !== "InnoDB") return fail();
    const indexes = await tx.execute(sql`SELECT INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS prefixLength
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ops_saihu_api_configs' AND NON_UNIQUE=0 ORDER BY INDEX_NAME,SEQ_IN_INDEX`);
    if (!Array.isArray(indexes) || !Array.isArray(indexes[0]) || indexes[0].length > 100 || !indexes[0].some((index: Record<string, unknown>) =>
      index.columnName === "workspace_id" && index.nonUnique === 0 && index.sequence === 1 && index.prefixLength === null && typeof index.indexName === "string"
      && indexes[0].filter((other: Record<string, unknown>) => other.indexName === index.indexName).length === 1)) return fail();
    result = await tx.execute(sql`SELECT workspace_id AS workspaceId,app_id AS appId,api_base_url AS apiBaseUrl,
      IF(OCTET_LENGTH(secret_cipher)<=20000,secret_cipher,NULL) AS secretCipher
      FROM ops_saihu_api_configs WHERE workspace_id=${workspaceId} LIMIT 2 FOR SHARE`);
  } catch (error) {
    if (missingTable(error)) return null;
    return fail("INVENTORY_COLLECTION_CONFIG_READ_FAILED");
  }
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > 1) return fail();
  if (result[0].length === 0) return null;
  const row = result[0][0] as Record<string, unknown>;
  if (!row || typeof row !== "object" || row.workspaceId !== workspaceId || typeof row.appId !== "string"
    || !row.appId.trim() || row.appId !== row.appId.trim() || row.appId.length > 200 || /[\u0000-\u001f\u007f]/u.test(row.appId)
    || typeof row.apiBaseUrl !== "string" || row.apiBaseUrl.length > 500 || typeof row.secretCipher !== "string" || Buffer.byteLength(row.secretCipher) > 20000) return fail();
  let origin: URL, cipher: z.infer<typeof encrypted>;
  try {
    origin = new URL(row.apiBaseUrl || INVENTORY_VENDOR_ORIGIN);
    cipher = encrypted.parse(JSON.parse(row.secretCipher));
  } catch { return fail(); }
  if (origin.origin !== INVENTORY_VENDOR_ORIGIN || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) return fail();
  const connectionVersion = inventoryRefreshHash({ workspaceId, appId: row.appId, origin: INVENTORY_VENDOR_ORIGIN, cipher });
  return { appId: row.appId, cipher, connectionVersion };
}

/** Metadata only. A successful prior connection test or a shop name is not an
 * authorization binding. Live collection independently attests its pagination. */
export async function inventoryCollectionConfig(tx: InventoryConfigExecutor, workspaceId: number): Promise<InventoryCollectionConfig | null> {
  const row = await readConfig(tx, workspaceId);
  return row ? { connectionVersion: row.connectionVersion, mappingVersion: INVENTORY_COLLECTION_MAPPING_VERSION,
    scopeBindings: [], mappingOptions: { latestShipmentAllocation: { approved: false } } } : null;
}

/** Worker-only: credentials never enter an RPC result, job receipt or log. */
export async function inventoryCollectionCredentials(tx: InventoryConfigExecutor, workspaceId: number, expectedVersion: string): Promise<InventoryCollectionCredentials> {
  hash.parse(expectedVersion);
  const row = await readConfig(tx, workspaceId);
  if (!row || row.connectionVersion !== expectedVersion) return fail("INVENTORY_COLLECTION_CONFIG_CHANGED");
  let secret: string;
  try { secret = decryptToolSecretValue(row.cipher); } catch { return fail("INVENTORY_COLLECTION_SECRET_UNAVAILABLE"); }
  if (!secret || secret.length > 4096 || /[\u0000-\u001f\u007f]/u.test(secret)) return fail("INVENTORY_COLLECTION_SECRET_UNAVAILABLE");
  return { workspaceId, appId: row.appId, secret, connectionVersion: row.connectionVersion };
}
