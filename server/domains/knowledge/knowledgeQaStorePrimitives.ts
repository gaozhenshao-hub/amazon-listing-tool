import { sql, type SQL } from "drizzle-orm";
import { getTableConfig, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { z } from "zod";
import { aiJobs, aiArtifacts } from "../../../drizzle/schema/ai_os";
import { assertAssistantRuleConfirmationJournalSchema } from "../ai_os/repositories/assistantRuleConfirmationJournal";
import { assertResourceAction } from "../../services/securityGovernance";
import { ROLE_MODULE_ACCESS } from "../../../shared/const";
import { KnowledgeQaIdentitySchema, KnowledgeQaIdSchema, knowledgeQaCanonical, type KnowledgeQaIdentity } from "../../../shared/knowledgeQa";
import type { DbExecutor } from "../../repositories/dbClient";

export class KnowledgeQaError extends Error { readonly retryable = false; constructor(readonly code: string) { super(`KNOWLEDGE_QA_${code}`); this.name = "KnowledgeQaError"; } }
export function knowledgeQaFail(code: string): never { throw new KnowledgeQaError(code); }
export interface KnowledgeQaExecutor { execute(query: SQL): Promise<unknown> }
export function knowledgeQaStatement(text: string, params: unknown[] = []) {
  const parts = text.split("?"); if (parts.length !== params.length + 1) return knowledgeQaFail("STATEMENT_INVALID");
  return sql.join(parts.flatMap((part, i) => i < params.length ? [sql.raw(part), sql`${params[i]}`] : [sql.raw(part)]), sql.raw(""));
}
export async function knowledgeQaRows(tx: KnowledgeQaExecutor, text: string, params: unknown[], limit: number): Promise<Record<string, unknown>[]> {
  const value = await tx.execute(knowledgeQaStatement(text, params));
  if (!Array.isArray(value) || !Array.isArray(value[0]) || value[0].length > limit || value[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) return knowledgeQaFail("READ_INVALID");
  return value[0];
}
export function knowledgeQaJson(value: unknown, limit = 4194304): unknown {
  try { const text = typeof value === "string" ? value : knowledgeQaCanonical(value); if (Buffer.byteLength(text) > limit) return knowledgeQaFail("CONTENT_LIMIT"); return JSON.parse(text); }
  catch { return knowledgeQaFail("CONTENT_INVALID"); }
}
export async function knowledgeQaWrite(tx: KnowledgeQaExecutor, text: string, params: unknown[]) {
  const packet = await knowledgeQaRows(tx, "SELECT @@max_allowed_packet AS maximumPacket", [], 1);
  if (packet.length !== 1 || !Number.isSafeInteger(Number(packet[0].maximumPacket)) || Number(packet[0].maximumPacket) < 4096 + Buffer.byteLength(text)
    + params.reduce<number>((sum, value) => sum + (typeof value === "string" ? Buffer.byteLength(value) : 64), 0)) return knowledgeQaFail("PACKET_LIMIT");
  const result = await tx.execute(knowledgeQaStatement(text, params));
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object" || result[0].affectedRows !== 1 || result[0].warningStatus !== 0) return knowledgeQaFail("WRITE_UNCONFIRMED");
}
export type KnowledgeQaAuthority = { role: string; directories: Set<string> };
export async function authorizeKnowledgeQa(tx: KnowledgeQaExecutor, raw: KnowledgeQaIdentity, action: "read" | "run" | "cancel" | "update" | "delete", permission = assertResourceAction): Promise<KnowledgeQaAuthority> {
  const identity = KnowledgeQaIdentitySchema.parse(raw), id = KnowledgeQaIdSchema;
  // Actor lock also serializes this actor's thread creation, sends and terminal publication.
  const spaces = await knowledgeQaRows(tx, "SELECT id,status FROM workspaces WHERE id=? FOR SHARE", [identity.workspaceId], 1);
  const users = await knowledgeQaRows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR UPDATE", [identity.userId], 1), user = users[0];
  const memberships = await knowledgeQaRows(tx, "SELECT id,workspaceId,userId,status FROM workspace_memberships WHERE workspaceId=? AND userId=? ORDER BY id LIMIT 2 FOR SHARE", [identity.workspaceId, identity.userId], 2);
  if (spaces.length !== 1 || spaces[0].id !== identity.workspaceId || spaces[0].status !== "active" || !user || user.id !== identity.userId || user.status !== "active"
    || user.defaultWorkspaceId !== identity.workspaceId || typeof user.role !== "string" || !user.role || memberships.length !== 1 || !id.safeParse(memberships[0].id).success
    || memberships[0].workspaceId !== identity.workspaceId || memberships[0].userId !== identity.userId || memberships[0].status !== "active") return knowledgeQaFail("ACCESS_DENIED");
  const allDirectories = ["kb_bot", "kb_products", "kb_listings", "kb_images", "kb_skills", "kb_videos"], directories = new Set<string>();
  if (user.role === "super_admin") allDirectories.forEach(value => directories.add(value));
  else {
    const records = await knowledgeQaRows(tx, "SELECT id,workspaceId,role,IF(OCTET_LENGTH(modules)<=65536,modules,NULL) AS modules,IF(detailedPermissions IS NULL OR OCTET_LENGTH(detailedPermissions)<=65536,detailedPermissions,NULL) AS detailedPermissions FROM role_permissions WHERE role=? AND (workspaceId=? OR workspaceId IS NULL) ORDER BY workspaceId IS NULL,id LIMIT 3 FOR SHARE", [user.role, identity.workspaceId], 2);
    if (records.some(row => !id.safeParse(row.id).success || row.role !== user.role || row.workspaceId !== null && row.workspaceId !== identity.workspaceId) || new Set(records.map(row => row.workspaceId)).size !== records.length) return knowledgeQaFail("ACCESS_DENIED");
    const record = records.find(row => row.workspaceId === identity.workspaceId) ?? records.find(row => row.workspaceId === null);
    const modules = record ? z.array(z.string()).max(100).parse(knowledgeQaJson(record.modules, 65536)) : ROLE_MODULE_ACCESS[user.role] ?? [];
    if (!modules.includes("knowledge") || action === "run" && !modules.includes("emperor")) return knowledgeQaFail("ACCESS_DENIED");
    if (record?.detailedPermissions != null) {
      const operations = z.array(z.enum(["read", "edit", "delete"])).max(3), details = z.array(z.object({ moduleId: z.string(), operations,
        subModules: z.array(z.object({ subModuleId: z.string(), operations }).strict()).max(100).optional() }).strict()).max(100).parse(knowledgeQaJson(record.detailedPermissions, 65536));
      if (new Set(details.map(row => row.moduleId)).size !== details.length || details.some(row => row.subModules && new Set(row.subModules.map(sub => sub.subModuleId)).size !== row.subModules.length)) return knowledgeQaFail("ACCESS_DENIED");
      const allowed = (moduleId: string, subModuleId: string) => { const module = details.find(row => row.moduleId === moduleId); return module?.subModules?.length ? module.subModules.find(row => row.subModuleId === subModuleId)?.operations : module?.operations; };
      for (const directory of allDirectories) if (allowed("knowledge", directory)?.includes("read")) directories.add(directory);
      if (!directories.has("kb_bot") || action !== "read" && !allowed("knowledge", "kb_bot")?.includes(action === "delete" ? "delete" : "edit")
        || action === "run" && (!allowed("emperor", "emperor_agents")?.includes("read") || !allowed("emperor", "emperor_agents")?.includes("edit"))) return knowledgeQaFail("ACCESS_DENIED");
    } else allDirectories.forEach(value => directories.add(value));
  }
  const common = { actor: { id: identity.userId, role: user.role, defaultWorkspaceId: identity.workspaceId }, workspaceId: identity.workspaceId,
    authorizationRead: { executor: tx as DbExecutor, strict: true as const, lock: true as const, lockMode: "share" as const } };
  try { await permission({ ...common, resource: "knowledge", action: "read" });
    if (action !== "read") await permission({ ...common, resource: "knowledge", action });
    if (action === "run") { await permission({ ...common, resource: "agent", resourceId: "knowledge", action: "read" }); await permission({ ...common, resource: "agent", resourceId: "knowledge", action: "run" }); }
  } catch { return knowledgeQaFail("ACCESS_DENIED"); }
  return { role: user.role, directories };
}
export const KNOWLEDGE_QA_SOURCE_TABLES = ["kb_product_innovations", "kb_listing_copywriting", "kb_image_sets", "kb_images", "kb_operation_skills", "kb_videos"] as const;
export async function assertKnowledgeQaSchema(tx: KnowledgeQaExecutor) {
  const writes = [aiJobs, aiArtifacts] as AnyMySqlTable[], names = [...writes.map(table => getTableConfig(table).name), "users", "workspaces", "workspace_memberships", "role_permissions", "security_access_policies", ...KNOWLEDGE_QA_SOURCE_TABLES];
  const tables = await knowledgeQaRows(tx, `SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(() => "?").join(",")}) LIMIT ${names.length + 1}`, names, names.length);
  if (tables.length !== names.length || new Set(tables.map(row => row.name)).size !== names.length || tables.some(row => !names.includes(String(row.name)) || row.engine !== "InnoDB")) return knowledgeQaFail("SCHEMA_UNAVAILABLE");
  for (const table of writes) {
    const config = getTableConfig(table), columns = await knowledgeQaRows(tx, "SELECT COLUMN_NAME AS name,COLUMN_TYPE AS columnType,IS_NULLABLE AS nullable,EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION LIMIT 201", [config.name], 200);
    const normalize = (value: string) => value.toLowerCase().replace(/int\(\d+\)/gu, "int").replace(/,\s+/gu, ",");
    if (columns.length !== config.columns.length || new Set(columns.map(row => row.name)).size !== columns.length) return knowledgeQaFail("SCHEMA_UNAVAILABLE");
    for (const column of config.columns) { const actual = columns.find(row => row.name === column.name);
      if (!actual || typeof actual.columnType !== "string" || normalize(actual.columnType) !== normalize(column.getSQLType()) || actual.nullable !== (column.notNull ? "NO" : "YES") || typeof actual.extra !== "string" || /(?:virtual|stored)\s+generated/iu.test(actual.extra)) return knowledgeQaFail("SCHEMA_UNAVAILABLE"); }
    const indexes = await knowledgeQaRows(tx, "SELECT INDEX_NAME AS name,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS subPart FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX LIMIT 257", [config.name], 256);
    const groups = new Map<string, Record<string, unknown>[]>(); for (const row of indexes) { if (typeof row.name !== "string" || ![0, 1].includes(Number(row.nonUnique)) || row.subPart !== null || typeof row.columnName !== "string") return knowledgeQaFail("SCHEMA_UNAVAILABLE"); groups.set(row.name, [...(groups.get(row.name) ?? []), row]); }
    const keys = [...groups.values()].filter(group => Number(group[0].nonUnique) === 0).map(group => { if (group.some((row, i) => Number(row.sequence) !== i + 1 || Number(row.nonUnique) !== 0)) return knowledgeQaFail("SCHEMA_UNAVAILABLE"); return group.map(row => row.columnName).join(","); });
    if (keys.length !== 2 || !keys.includes("id") || !keys.includes(config.name === "ai_jobs" ? "runId" : "artifactId")) return knowledgeQaFail("SCHEMA_UNAVAILABLE");
  }
  await assertAssistantRuleConfirmationJournalSchema(tx);
  if ((await knowledgeQaRows(tx, "SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN ('ai_jobs','ai_artifacts','security_audit_logs') LIMIT 1", [], 1)).length) return knowledgeQaFail("SCHEMA_UNAVAILABLE");
}
