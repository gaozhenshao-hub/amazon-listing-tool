import { sql, type SQL } from "drizzle-orm";
import { getTableConfig, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { z } from "zod";
import { aiJobs, aiArtifacts } from "../../../../drizzle/schema/ai_os";
import { devProjects, devProducts, devProductTags, devPanoramaStatus, devPanoramaVersions, devAnalysisStages } from "../../../../drizzle/schema/project";
import { developmentMarketCanonical, developmentMarketHash, DevelopmentMarketIdentitySchema, type DevelopmentMarketIdentity } from "../../../../shared/developmentMarket";
import { ROLE_MODULE_ACCESS } from "../../../../shared/const";
import { assertResourceAction } from "../../../services/securityGovernance";
import { assertAssistantRuleConfirmationJournalSchema } from "../../ai_os/repositories/assistantRuleConfirmationJournal";
export interface DevelopmentMarketExecutor { execute(statement: SQL): Promise<unknown> }
export interface DevelopmentMarketDatabase { transaction<T>(body: (tx: DevelopmentMarketExecutor) => Promise<T>): Promise<T> }
export class DevelopmentMarketError extends Error { constructor(readonly code: string, readonly outcomeUnknown = false) { super(`DEVELOPMENT_MARKET_${code}`); this.name = "DevelopmentMarketError"; } }
export function refuse(code: string): never { throw new DevelopmentMarketError(code); }
export function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) refuse("DATA_INVALID"); return result.data; }
export function decoded(value: unknown): unknown { try { return JSON.parse(typeof value === "string" ? (Buffer.byteLength(value) <= 4 * 1024 * 1024 ? value : refuse("DATA_LIMIT")) : developmentMarketCanonical(value)); } catch { return refuse("DATA_INVALID"); } }
export const equal = (a: unknown, b: unknown) => developmentMarketCanonical(a) === developmentMarketCanonical(b);
export const digest = developmentMarketHash;
export function statement(text: string, args: unknown[] = []): SQL { const parts = text.split("?"); if (parts.length !== args.length + 1) refuse("SQL_INVALID"); return sql.join(parts.flatMap((part, index) => index < args.length ? [sql.raw(part), sql`${args[index]}`] : [sql.raw(part)]), sql.raw("")); }
export async function rows(tx: DevelopmentMarketExecutor, text: string, args: unknown[] = [], maximum = 1): Promise<Record<string, unknown>[]> { const result = await tx.execute(statement(text, args)); if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > maximum || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) refuse("READ_INVALID"); return result[0]; }
export async function write(tx: DevelopmentMarketExecutor, text: string, args: unknown[] = []) { const packet = await rows(tx, "SELECT @@max_allowed_packet AS maximumPacket"), bytes = Buffer.byteLength(text) + 4096 + args.reduce<number>((total, value) => total + (typeof value === "string" ? Buffer.byteLength(value) : 64), 0); if (packet.length !== 1 || !Number.isSafeInteger(Number(packet[0].maximumPacket)) || Number(packet[0].maximumPacket) < bytes) refuse("PACKET_LIMIT"); const result = await tx.execute(statement(text, args)); if (!Array.isArray(result) || !result[0] || result[0].affectedRows !== 1 || result[0].warningStatus !== 0) refuse("WRITE_UNCONFIRMED"); }
export function rowFingerprint(table: AnyMySqlTable) { return `LOWER(SHA2(CAST(JSON_ARRAY(${getTableConfig(table).columns.map(column => `\`${column.name}\``).join(",")}) AS CHAR CHARACTER SET utf8mb4),256))`; }
/** Stable JSON archival, including every old raw/edited body and all timestamps.
 * Driver Date conversion must not silently alter or drop prior-stage evidence. */
export function archivalProjection(table: AnyMySqlTable) { return getTableConfig(table).columns.map(column => /^(?:timestamp|datetime)/iu.test(column.getSQLType())
  ? `DATE_FORMAT(\`${column.name}\`,'%Y-%m-%dT%H:%i:%s.%f') AS \`${column.name}\`` : `\`${column.name}\``).join(","); }
const tables = [aiJobs, aiArtifacts, devProjects, devProducts, devProductTags, devPanoramaStatus, devPanoramaVersions, devAnalysisStages] as AnyMySqlTable[];
/** Physical existing schema admission only. No migration, fallback table or
 * unknown nullable source columns omitted from row fingerprints. */
export async function assertDevelopmentMarketSchema(tx: DevelopmentMarketExecutor) {
  const names = [...tables.map(table => getTableConfig(table).name), "users", "workspaces", "workspace_memberships", "role_permissions", "security_access_policies"];
  const engines = await rows(tx, `SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(() => "?").join(",")})`, names, names.length);
  if (engines.length !== names.length || new Set(engines.map(row => row.tableName)).size !== names.length || engines.some(row => !names.includes(String(row.tableName)) || row.engine !== "InnoDB")) refuse("SCHEMA_UNAVAILABLE");
  for (const table of tables) {
    const config = getTableConfig(table), columns = await rows(tx, "SELECT COLUMN_NAME AS name,COLUMN_TYPE AS columnType,IS_NULLABLE AS nullable,EXTRA AS extra,COLUMN_DEFAULT AS defaultValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION LIMIT 129", [config.name], 128);
    const norm = (value: string) => value.replace(/int\(\d+\)/gu, "int").replace(/,\s+/gu, ",").toLowerCase();
    if (columns.length !== config.columns.length || new Set(columns.map(row => row.name)).size !== columns.length) refuse("SCHEMA_UNAVAILABLE");
    for (const field of config.columns) {
      const actual = columns.find(row => row.name === field.name);
      if (!actual || typeof actual.columnType !== "string" || norm(actual.columnType) !== norm(field.getSQLType()) || actual.nullable !== (field.notNull ? "NO" : "YES") || typeof actual.extra !== "string"
        || (field.name === "id" ? actual.extra !== "auto_increment" : field.name === "updatedAt" ? !/^(?:DEFAULT_GENERATED\s*)?(?:on update CURRENT_TIMESTAMP(?:\(\d*\))?)?$/iu.test(actual.extra)
          : field.name === "createdAt" || field.name === "confirmedAt" ? !/^(?:DEFAULT_GENERATED)?$/iu.test(actual.extra) : actual.extra !== "")) refuse("SCHEMA_UNAVAILABLE");
    }
    const indexes = await rows(tx, "SELECT INDEX_NAME AS name,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS subPart FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX", [config.name], 256);
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const entry of indexes) { if (typeof entry.name !== "string" || entry.subPart !== null || ![0, 1].includes(Number(entry.nonUnique))) refuse("SCHEMA_UNAVAILABLE"); groups.set(entry.name, [...groups.get(entry.name) ?? [], entry]); }
    const unique = [...groups.values()].filter(group => Number(group[0].nonUnique) === 0).map(group => { if (group.some((row, index) => Number(row.sequence) !== index + 1 || Number(row.nonUnique) !== 0)) refuse("SCHEMA_UNAVAILABLE"); return group.map(row => row.columnName); });
    const wanted = config.name === "ai_jobs" ? [["id"], ["runId"]] : config.name === "ai_artifacts" ? [["id"], ["artifactId"]] : config.name === "dev_analysis_stages" ? [["id"], ["workspaceId", "projectId", "stageType"], ["projectId", "stageType"]]
      : config.name === "dev_panorama_versions" ? [["id"], ["workspaceId", "projectId", "version"]] : [["id"]];
    if (unique.length !== wanted.length || wanted.some(key => !unique.some(actual => equal(key, actual)))) refuse("SCHEMA_UNAVAILABLE");
  }
  await assertAssistantRuleConfirmationJournalSchema(tx);
  const triggers = await rows(tx, "SELECT TRIGGER_NAME AS triggerName FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN ('ai_jobs','ai_artifacts','dev_analysis_stages','security_audit_logs') LIMIT 1", [], 1);
  if (triggers.length) refuse("SCHEMA_UNAVAILABLE");
}
export async function authorizeDevelopmentMarket(tx: DevelopmentMarketExecutor, rawIdentity: DevelopmentMarketIdentity, devProjectId: number,
  action: "read" | "run" | "apply" | "cancel", permission: typeof assertResourceAction = assertResourceAction) {
  const identity = parse(DevelopmentMarketIdentitySchema, rawIdentity), [workspace] = await rows(tx, "SELECT id,status FROM workspaces WHERE id=? FOR SHARE", [identity.workspaceId]),
    [actor] = await rows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [identity.userId]),
    members = await rows(tx, "SELECT id,workspaceId,userId,status FROM workspace_memberships WHERE workspaceId=? AND userId=? LIMIT 2 FOR SHARE", [identity.workspaceId, identity.userId], 2);
  if (!workspace || workspace.id !== identity.workspaceId || workspace.status !== "active" || !actor || actor.id !== identity.userId || actor.status !== "active"
    || actor.defaultWorkspaceId !== identity.workspaceId || typeof actor.role !== "string" || members.length !== 1 || members[0].workspaceId !== identity.workspaceId || members[0].userId !== identity.userId || members[0].status !== "active") refuse("ACCESS_DENIED");
  const project = (await rows(tx, `SELECT id,workspaceId,userId,name,targetMarket,keywords,status,${rowFingerprint(devProjects)} AS revisionHash FROM dev_projects WHERE id=? AND workspaceId=? FOR UPDATE`, [devProjectId, identity.workspaceId]))[0];
  if (!project || project.id !== devProjectId || project.workspaceId !== identity.workspaceId || !Number.isSafeInteger(project.userId) || project.status === "archived") refuse("ACCESS_DENIED");
  // Resource policies remain authoritative, including authorized same-workspace
  // colleagues. No owner-only shortcut, null-workspace fallback or cached role.
  if (actor.role !== "super_admin") {
    const found = await rows(tx, "SELECT id,workspaceId,role,IF(OCTET_LENGTH(modules)<=65536,modules,NULL) AS modules,IF(detailedPermissions IS NULL OR OCTET_LENGTH(detailedPermissions)<=65536,detailedPermissions,NULL) AS detailedPermissions FROM role_permissions WHERE role=? AND (workspaceId=? OR workspaceId IS NULL) ORDER BY workspaceId IS NULL,id LIMIT 3 FOR SHARE", [actor.role, identity.workspaceId], 2);
    if (found.some(row => !Number.isSafeInteger(row.id) || Number(row.id) < 1 || row.role !== actor.role || row.workspaceId !== null && row.workspaceId !== identity.workspaceId) || new Set(found.map(row => row.workspaceId)).size !== found.length) refuse("ACCESS_DENIED");
    const selected = found.find(row => row.workspaceId === identity.workspaceId) ?? found.find(row => row.workspaceId === null);
    const modules = selected ? parse(z.array(z.string()).max(100), decoded(selected.modules)) : ROLE_MODULE_ACCESS[actor.role] ?? [];
    if (!modules.includes("dev") || ["run", "apply"].includes(action) && !modules.includes("emperor")) refuse("ACCESS_DENIED");
    if (selected?.detailedPermissions !== null && selected?.detailedPermissions !== undefined) {
      const operations = z.array(z.enum(["read", "edit", "delete"])).max(3), name = z.string().min(1).max(100), details = parse(z.array(z.object({ moduleId: name, operations,
        subModules: z.array(z.object({ subModuleId: name, operations }).strict()).max(100).optional() }).strict()).max(100), decoded(selected.detailedPermissions));
      if (new Set(details.map(row => row.moduleId)).size !== details.length || details.some(row => row.subModules && new Set(row.subModules.map(item => item.subModuleId)).size !== row.subModules.length)) refuse("ACCESS_DENIED");
      for (const [moduleId, sub] of [["dev", "dev_projects"], ...(["run", "apply"].includes(action) ? [["emperor", "emperor_agents"]] : [])] as Array<[string, string | null]>) {
        const directory = details.find(row => row.moduleId === moduleId), allowed = sub && directory?.subModules?.length ? directory.subModules.find(row => row.subModuleId === sub)?.operations : directory?.operations;
        if (!allowed?.includes("read") || action !== "read" && !allowed.includes("edit")) refuse("ACCESS_DENIED");
      }
    }
  }
  const common = { actor: { id: identity.userId, role: actor.role, defaultWorkspaceId: identity.workspaceId }, workspaceId: identity.workspaceId,
    projectId: devProjectId, resource: "product_development" as const, resourceId: devProjectId, ownerUserId: Number(project.userId),
    authorizationRead: { executor: tx, strict: true as const, lock: true as const, lockMode: "share" as const } };
  try {
    await permission({ ...common, action: "read" });
    if (action !== "read") { await permission({ ...common, action: "update" }); await permission({ ...common, action: action === "apply" ? "confirm" : action }); }
    if (["run", "apply"].includes(action)) { await permission({ ...common, projectId: null, ownerUserId: null, resource: "agent", resourceId: "development", action: "read" }); await permission({ ...common, projectId: null, ownerUserId: null, resource: "agent", resourceId: "development", action: "run" }); }
  } catch { refuse("ACCESS_DENIED"); }
  return { role: actor.role, project };
}
