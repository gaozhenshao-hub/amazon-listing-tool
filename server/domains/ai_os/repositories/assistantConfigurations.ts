import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../../../repositories/dbClient";

type Row = Record<string, unknown>;
export interface ConfigurationExecutor { execute(statement: SQL): Promise<unknown> }
export interface ConfigurationDatabase extends ConfigurationExecutor {
  transaction?<T>(callback: (tx: ConfigurationExecutor) => Promise<T>): Promise<T>;
}

/** Only fixed statements reach this adapter. Values are always Drizzle binds. */
function statement(text: string, values: unknown[]): SQL {
  const parts = text.split("?");
  if (parts.length !== values.length + 1) throw new Error("ASSISTANT_SQL_BIND_MISMATCH");
  return sql.join(parts.flatMap((part, index) => index < values.length
    ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}

export function configurationStorageError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  let current = error;
  for (let depth = 0; current && typeof current === "object" && depth < 4; depth++) {
    const item = current as { code?: unknown; errno?: unknown; cause?: unknown };
    if (item.errno === 1146 || item.errno === 1054 || item.code === "ER_NO_SUCH_TABLE" || item.code === "ER_BAD_FIELD_ERROR") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ASSISTANT_SCHEMA_UNAVAILABLE" });
    }
    if (item.errno === 1062 || item.errno === 1213 || item.code === "ER_DUP_ENTRY" || item.code === "ER_LOCK_DEADLOCK") {
      throw new TRPCError({ code: "CONFLICT", message: "ASSISTANT_REVISION_CONFLICT" });
    }
    current = item.cause;
  }
  // Never expose SQL, bound prompts, connection URLs or native error text.
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "ASSISTANT_STORAGE_FAILED" });
}

const currentColumns = "workspaceId,agentKey,revision,config,configHash,updatedBy,createdAt,updatedAt";
const versionColumns = "workspaceId,agentKey,revision,config,configHash,sourceRevision,createdBy,createdAt";

export function configurationSession(executor: ConfigurationExecutor, locking = false) {
  async function run(text: string, values: unknown[] = []): Promise<unknown> {
    try { return await executor.execute(statement(text, values)); } catch (error) { return configurationStorageError(error); }
  }
  async function rows(text: string, values: unknown[] = []): Promise<Row[]> {
    const result = await run(text, values);
    if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "ASSISTANT_STORAGE_RESULT_INVALID" });
    }
    return result[0] as Row[];
  }
  async function write(text: string, values: unknown[]) {
    if (!locking) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ASSISTANT_TRANSACTION_REQUIRED" });
    const result = await run(text, values);
    const header = Array.isArray(result) ? result[0] as { affectedRows?: unknown } : undefined;
    if (header?.affectedRows !== 1) throw new TRPCError({ code: "CONFLICT", message: "ASSISTANT_REVISION_CONFLICT" });
  }
  return {
    async assertSchema(workspaceId: number) {
      await rows("SELECT configHash FROM emperor_assistant_configurations WHERE workspaceId=? LIMIT 0", [workspaceId]);
      await rows("SELECT configHash FROM emperor_assistant_configuration_versions WHERE workspaceId=? LIMIT 0", [workspaceId]);
    },
    list(workspaceId: number) {
      return rows(`SELECT ${currentColumns} FROM emperor_assistant_configurations WHERE workspaceId=? ORDER BY agentKey`, [workspaceId]);
    },
    current(workspaceId: number, agentKey: string) {
      return rows(`SELECT ${currentColumns} FROM emperor_assistant_configurations WHERE workspaceId=? AND agentKey=?${locking ? " FOR UPDATE" : ""}`, [workspaceId, agentKey]);
    },
    version(workspaceId: number, agentKey: string, revision: number) {
      return rows(`SELECT ${versionColumns} FROM emperor_assistant_configuration_versions WHERE workspaceId=? AND agentKey=? AND revision=?${locking ? " FOR SHARE" : ""}`, [workspaceId, agentKey, revision]);
    },
    history(workspaceId: number, agentKey: string, beforeRevision: number, limit: number) {
      return rows(`SELECT ${versionColumns} FROM emperor_assistant_configuration_versions WHERE workspaceId=? AND agentKey=? AND revision<? ORDER BY revision DESC LIMIT ?`, [workspaceId, agentKey, beforeRevision, limit]);
    },
    models(workspaceId: number, slug?: string) {
      return rows(`SELECT workspaceId,slug,name,modelId,isActive,capabilityTags FROM emperor_model_providers WHERE (workspaceId=? OR workspaceId IS NULL) AND isActive=1${slug === undefined ? " ORDER BY slug" : " AND slug=?"}${locking ? " FOR SHARE" : ""}`, slug === undefined ? [workspaceId] : [workspaceId, slug]);
    },
    skills(workspaceId: number, slug?: string) {
      return rows(`SELECT workspaceId,scope,slug,name,version,status,manifest FROM emperor_skills WHERE (workspaceId=? OR (workspaceId IS NULL AND scope='global')) AND status='Released'${slug === undefined ? " ORDER BY slug" : " AND slug=?"}${locking ? " FOR SHARE" : ""}`, slug === undefined ? [workspaceId] : [workspaceId, slug]);
    },
    insert(workspaceId: number, agentKey: string, config: string, hash: string, userId: number) {
      return write("INSERT INTO emperor_assistant_configurations (workspaceId,agentKey,revision,config,configHash,updatedBy) VALUES (?,?,1,?,?,?)", [workspaceId, agentKey, config, hash, userId]);
    },
    update(workspaceId: number, agentKey: string, expected: number, config: string, hash: string, userId: number) {
      return write("UPDATE emperor_assistant_configurations SET revision=revision+1,config=?,configHash=?,updatedBy=?,updatedAt=CURRENT_TIMESTAMP WHERE workspaceId=? AND agentKey=? AND revision=?", [config, hash, userId, workspaceId, agentKey, expected]);
    },
    append(workspaceId: number, agentKey: string, revision: number, config: string, hash: string, sourceRevision: number | null, userId: number) {
      return write("INSERT INTO emperor_assistant_configuration_versions (workspaceId,agentKey,revision,config,configHash,sourceRevision,createdBy) VALUES (?,?,?,?,?,?,?)", [workspaceId, agentKey, revision, config, hash, sourceRevision, userId]);
    },
  };
}
export type ConfigurationSession = ReturnType<typeof configurationSession>;

export function createAssistantConfigurationRepository(load: () => Promise<ConfigurationDatabase | null> = getDb) {
  async function database() {
    const db = await load();
    if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ASSISTANT_DATABASE_UNAVAILABLE" });
    return db;
  }
  return {
    async read<T>(workspaceId: number, callback: (session: ConfigurationSession) => Promise<T>): Promise<T> {
      try {
        const session = configurationSession(await database());
        await session.assertSchema(workspaceId);
        return await callback(session);
      } catch (error) { return configurationStorageError(error); }
    },
    async transaction<T>(workspaceId: number, callback: (session: ConfigurationSession) => Promise<T>): Promise<T> {
      try {
        const db = await database();
        if (typeof db.transaction !== "function") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ASSISTANT_TRANSACTION_REQUIRED" });
        return await db.transaction(async tx => {
          const session = configurationSession(tx, true);
          await session.assertSchema(workspaceId);
          return callback(session);
        });
      } catch (error) { return configurationStorageError(error); }
    },
  };
}
export type AssistantConfigurationRepository = ReturnType<typeof createAssistantConfigurationRepository>;
