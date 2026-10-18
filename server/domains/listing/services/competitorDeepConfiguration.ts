import { sql, type SQL } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { CompetitorDeepConfigurationSchema, type CompetitorDeepConfiguration } from "./competitorDeepRuntimeContract";
import { assertResourceAction } from "../../../services/securityGovernance";

export class CompetitorDeepConfigurationError extends Error {
  constructor(readonly code: string) { super(`COMPETITOR_DEEP_${code}`); this.name = "CompetitorDeepConfigurationError"; }
}
function fail(code: string): never { throw new CompetitorDeepConfigurationError(code); }
type Executor = { execute(query: SQL): Promise<unknown> };
export async function authorizeCompetitorDeepAgent(executor: Executor, identity: { userId: number; workspaceId: number }, permission = assertResourceAction): Promise<void> {
  if (![identity.userId, identity.workspaceId].every(value => Number.isSafeInteger(value) && value > 0)) fail("ACCESS_DENIED");
  const result = await executor.execute(sql`SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=${identity.userId} FOR UPDATE`);
  const actors = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [], actor = actors[0];
  if (actors.length !== 1 || actor.id !== identity.userId || actor.status !== "active" || actor.defaultWorkspaceId !== identity.workspaceId || typeof actor.role !== "string") fail("ACCESS_DENIED");
  const common = { actor: { id: identity.userId, role: actor.role, defaultWorkspaceId: identity.workspaceId }, workspaceId: identity.workspaceId,
    resource: "agent" as const, resourceId: "listing", authorizationRead: { executor, strict: true as const, lock: true as const } };
  try { await permission({ ...common, action: "read" }); await permission({ ...common, action: "run" }); }
  catch { fail("ACCESS_DENIED"); }
}
/** Caller-owned transaction; no configuration defaults, creation or second rule store. */
export async function loadCompetitorDeepConfiguration(executor: Executor, workspaceId: number): Promise<CompetitorDeepConfiguration> {
  async function rows(text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
    const parts = text.split("?");
    const result = await executor.execute(sql.join(parts.flatMap((part, i) => i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]), sql.raw("")));
    if (!Array.isArray(result) || !Array.isArray(result[0])) fail("CONFIGURATION_INVALID");
    return result[0];
  }
  try {
    if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) fail("WORKSPACE_REQUIRED");
    const required = ["emperor_assistant_configurations", "emperor_assistant_configuration_versions", "emperor_skills", "emperor_model_providers"];
    const engines = await rows(`SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${required.map(() => "?").join(",")})`, required);
    if (engines.length !== required.length || required.some(name => engines.filter(row => row.tableName === name && row.engine === "InnoDB").length !== 1)) fail("CONFIGURATION_SCHEMA_UNAVAILABLE");
    // Bound native JSON before transferring it. The schema independently enforces
    // the existing 128 KiB logical configuration limit, including all rules.
    const select = "SELECT workspaceId,agentKey,revision,configHash,IF(OCTET_LENGTH(CAST(config AS CHAR CHARACTER SET utf8mb4))<=524288,CAST(config AS CHAR CHARACTER SET utf8mb4),NULL) AS configText";
    const current = await rows(`${select} FROM emperor_assistant_configurations WHERE workspaceId=? AND BINARY agentKey=BINARY 'listing' LIMIT 2 FOR UPDATE`, [workspaceId]);
    if (!current.length) fail("CONFIGURATION_UNAVAILABLE");
    if (current.length !== 1) fail("CONFIGURATION_INVALID");
    const record = current[0];
    if (typeof record.configText !== "string") fail("CONFIGURATION_INVALID");
    const raw = { workspaceId: record.workspaceId, agentKey: record.agentKey, revision: record.revision, hash: record.configHash, config: JSON.parse(record.configText) as unknown };
    const saved = CompetitorDeepConfigurationSchema.parse(raw);
    if (saved.workspaceId !== workspaceId || !isDeepStrictEqual(saved, raw)) fail("CONFIGURATION_INVALID");
    const versions = await rows(`${select} FROM emperor_assistant_configuration_versions WHERE workspaceId=? AND BINARY agentKey=BINARY 'listing' AND revision=? LIMIT 2 FOR SHARE`, [workspaceId, saved.revision]);
    if (versions.length !== 1 || typeof versions[0].configText !== "string") fail("CONFIGURATION_INVALID");
    const history = versions[0];
    if (history.workspaceId !== workspaceId || history.agentKey !== "listing" || history.revision !== saved.revision || history.configHash !== saved.hash
      || !isDeepStrictEqual(JSON.parse(history.configText as string), saved.config)) fail("CONFIGURATION_INVALID");
    if (!saved.config.enabled) fail("CONFIGURATION_DISABLED");
    return saved;
  } catch (error) {
    if (error instanceof CompetitorDeepConfigurationError) throw error;
    return fail("CONFIGURATION_UNAVAILABLE");
  }
}
