import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { EMPEROR_SKILL_READ_PROMPT_MAX_BYTES, EmperorSkillReadInputSchema, EmperorSkillReadResultSchema,
  type EmperorSkillReadInput, type EmperorSkillReadResult } from "../../../../shared/emperorSkillRead";
import type { TrpcContext } from "../../../_core/context";
import { getDb, type DbExecutor } from "../../../repositories/dbClient";
import { assertResourceAction } from "../../../services/securityGovernance";

export interface SkillReadonlyDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
type Row = Record<string, unknown>;
type Code = "UNAUTHORIZED" | "FORBIDDEN" | "BAD_REQUEST" | "NOT_FOUND" | "PRECONDITION_FAILED" | "INTERNAL_SERVER_ERROR";
function fail(message: string, code: Code = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message }); }
function identifier(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647; }
function workspace(value: unknown): value is number | null { return value === null || identifier(value); }
function safeError(error: unknown): never {
  if (error instanceof TRPCError && /^SKILL_READ_[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) fail("SKILL_READ_ACCESS_DENIED", "FORBIDDEN");
  // Do not disclose SQL, manifest fragments, connection URLs or driver messages.
  return fail("SKILL_READ_FAILED", "INTERNAL_SERVER_ERROR");
}
function statement(text: string, values: unknown[]): SQL {
  const parts = text.split("?");
  if (parts.length !== values.length + 1) fail("SKILL_READ_SQL_INVALID", "INTERNAL_SERVER_ERROR");
  return sql.join(parts.flatMap((part, i) => i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]), sql.raw(""));
}
async function rows(tx: DbExecutor, text: string, values: unknown[]): Promise<Row[]> {
  const result = await tx.execute(statement(text, values));
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("SKILL_READ_RESPONSE_INVALID");
  return result[0] as Row[];
}
function promptColumns(field: "systemPrompt" | "userPromptTemplate") {
  const value = `JSON_EXTRACT(manifest,'$.implementation.${field}')`, text = `JSON_UNQUOTE(${value})`;
  return `JSON_TYPE(${value}) AS ${field}Type,OCTET_LENGTH(${text}) AS ${field}Bytes,
    IF(JSON_TYPE(${value})='STRING' AND OCTET_LENGTH(${text})<=${EMPEROR_SKILL_READ_PROMPT_MAX_BYTES},${text},NULL) AS ${field}`;
}
// Deliberately never fetch or parse the complete manifest (providers/tools may
// contain credentials). Bound exact whitelisted prompt values before transport.
const columns = `id,workspaceId,slug,name,category,status,scope,version,
  IF(OCTET_LENGTH(description)<=65535,description,NULL) AS description,OCTET_LENGTH(description) AS descriptionBytes,
  JSON_TYPE(manifest) AS manifestType,JSON_TYPE(JSON_EXTRACT(manifest,'$.implementation')) AS implementationType,
  ${promptColumns("systemPrompt")},${promptColumns("userPromptTemplate")}`;
function prompt(row: Row, field: "systemPrompt" | "userPromptTemplate"): string | null {
  const kind = row[`${field}Type`], text = row[field], bytes = row[`${field}Bytes`];
  if (kind === null || kind === "NULL") {
    if (text !== null || (kind === null ? bytes !== null : bytes !== 4)) fail("SKILL_READ_DATA_INVALID");
    return null;
  }
  if (kind !== "STRING" || typeof text !== "string" || !Number.isSafeInteger(bytes) || Number(bytes) < 0
    || Number(bytes) > EMPEROR_SKILL_READ_PROMPT_MAX_BYTES || Buffer.byteLength(text, "utf8") !== bytes) fail("SKILL_READ_DATA_INVALID");
  return text;
}

/** Exact read of the current, Released registry entry. Selection precedes every
 * availability decision: a workspace draft/denial must never reveal a global
 * fallback. Read permission is the existing emperor_skill.read policy, without
 * owner/admin shortcuts, writes, model calls, or approval/version substitution. */
export function createSkillReadonlyService(dependencies: {
  database?: () => Promise<SkillReadonlyDatabase | null>; permission?: typeof assertResourceAction;
} = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction;
  async function read(ctx: TrpcContext, raw: EmperorSkillReadInput): Promise<EmperorSkillReadResult> {
    try {
      if (!ctx.user) fail("SKILL_READ_LOGIN_REQUIRED", "UNAUTHORIZED");
      const input = EmperorSkillReadInputSchema.safeParse(raw);
      if (!input.success) fail("SKILL_READ_INPUT_INVALID", "BAD_REQUEST");
      const workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user.defaultWorkspaceId ?? null;
      if (!identifier(ctx.user.id) || !workspace(workspaceId) || typeof ctx.user.role !== "string" || !ctx.user.role) fail("SKILL_READ_ACTOR_INVALID", "FORBIDDEN");
      if (workspaceId !== input.data.expectedWorkspaceId) fail("SKILL_READ_WORKSPACE_CHANGED", "FORBIDDEN");
      const db = await database();
      if (!db || typeof db.transaction !== "function") fail("SKILL_READ_TRANSACTION_REQUIRED");
      return await db.transaction(async tx => {
        const actors = await rows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [ctx.user!.id]), actor = actors[0];
        if (actors.length !== 1 || actor.id !== ctx.user!.id || actor.role !== ctx.user!.role || actor.status !== "active"
          || actor.defaultWorkspaceId !== workspaceId) fail("SKILL_READ_ACTOR_CHANGED", "FORBIDDEN");
        const found = await rows(tx, `SELECT ${columns} FROM emperor_skills WHERE BINARY slug=BINARY ? AND ${workspaceId === null ? "workspaceId IS NULL" : "(workspaceId=? OR workspaceId IS NULL)"}
          ORDER BY workspaceId IS NULL ASC LIMIT 3 FOR SHARE`, workspaceId === null ? [input.data.slug] : [input.data.slug, workspaceId]);
        // Validate all candidate identities and duplicates before precedence;
        // malformed/ambiguous storage must not become a lucky LIMIT 1 result.
        if (found.some(row => row.slug !== input.data.slug || !identifier(row.id) || !workspace(row.workspaceId)
          || (row.workspaceId !== null && row.workspaceId !== workspaceId))
          || new Set(found.map(row => row.workspaceId)).size !== found.length
          || new Set(found.map(row => row.id)).size !== found.length) fail("SKILL_READ_REGISTRY_AMBIGUOUS");
        const selected = found.find(row => row.workspaceId === workspaceId) ?? found.find(row => row.workspaceId === null);
        await permission({ actor: { id: actor.id as number, role: actor.role as string, defaultWorkspaceId: workspaceId },
          resource: "emperor_skill", action: "read", workspaceId, resourceId: input.data.slug,
          authorizationRead: { executor: tx, strict: true, lock: true } });
        if (!selected) fail("SKILL_READ_NOT_FOUND", "NOT_FOUND");
        if (!["global", "private", "shared"].includes(String(selected.scope))) fail("SKILL_READ_DATA_INVALID");
        // Match the configuration catalog's Released-only availability policy.
        if (selected.status !== "Released" || (selected.workspaceId === null && selected.scope !== "global")) fail("SKILL_READ_UNAVAILABLE", "FORBIDDEN");
        if (selected.manifestType !== "OBJECT" || (selected.implementationType !== null && selected.implementationType !== "OBJECT")) fail("SKILL_READ_DATA_INVALID");
        const description = selected.description;
        if (description === null ? selected.descriptionBytes !== null : typeof description !== "string"
          || !Number.isSafeInteger(selected.descriptionBytes) || Buffer.byteLength(description, "utf8") !== selected.descriptionBytes
          || Number(selected.descriptionBytes) > 65_535) fail("SKILL_READ_DATA_INVALID");
        const version = typeof selected.version === "number" ? selected.version : typeof selected.version === "string" && /^[1-9][0-9]*$/u.test(selected.version) ? Number(selected.version) : null;
        if (!identifier(version)) fail("SKILL_READ_DATA_INVALID");
        const output = EmperorSkillReadResultSchema.safeParse({ identity: { userId: actor.id, workspaceId },
          skill: { slug: selected.slug, name: selected.name, description, category: selected.category, status: selected.status,
            scope: selected.scope, version: String(version), sourceWorkspaceId: selected.workspaceId,
            systemPrompt: prompt(selected, "systemPrompt"), userPromptTemplate: prompt(selected, "userPromptTemplate") },
          provenance: { kind: "current_registry", pinnedVersion: false } });
        if (!output.success) fail("SKILL_READ_DATA_INVALID");
        return output.data;
      });
    } catch (error) { return safeError(error); }
  }
  return { read };
}
export const skillReadonlyService = createSkillReadonlyService();
