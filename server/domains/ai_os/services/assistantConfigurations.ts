import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { TRPCError } from "@trpc/server";
import { AGENT_LIBRARY_ROLES, AgentLibraryKeySchema, type AgentLibraryKey } from "../../../../shared/agentLibraryContracts";
import { ASSISTANT_CONFIGURATION_MAX_REVISION, AssistantConfigurationSchema, AssistantRulesSaveInputSchema, AssistantRulesRestoreInputSchema, type AssistantConfiguration, type AssistantConfigurationMetadata, type AssistantConfigurationRead, type AssistantConfigurationOptions, type AssistantConfigurationHistory, type AssistantConfigurationVersion, type AssistantRulesMemoryRead } from "../../../../shared/assistantConfigurations";
import { createAssistantConfigurationRepository, type AssistantConfigurationRepository, type ConfigurationSession } from "../repositories/assistantConfigurations";

const MAX_REVISION = ASSISTANT_CONFIGURATION_MAX_REVISION;
function refuse(message: string, code: "BAD_REQUEST" | "PRECONDITION_FAILED" | "CONFLICT" | "NOT_FOUND" = "PRECONDITION_FAILED"): never {
  throw new TRPCError({ code, message });
}
function integer(value: unknown, min = 1): number {
  const parsed = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || Object.is(parsed, -0) || parsed < min || parsed > MAX_REVISION) refuse("ASSISTANT_DATA_INVALID");
  return parsed;
}
function workspace(value: number) { return integer(value); }
function key(value: AgentLibraryKey): AgentLibraryKey {
  const parsed = AgentLibraryKeySchema.safeParse(value);
  if (!parsed.success) refuse("ASSISTANT_KEY_INVALID", "BAD_REQUEST");
  return parsed.data;
}
function json(value: unknown): unknown {
  try { return typeof value === "string" ? JSON.parse(value) : value; }
  catch { return refuse("ASSISTANT_DATA_INVALID"); }
}
/** Stable JSON for this validated JSON-only configuration; not an execution signature. */
export function canonicalConfigurationJson(value: AssistantConfiguration): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map(name => [name, sort((item as Record<string, unknown>)[name])])) : item;
  return JSON.stringify(sort(value));
}
export function configurationHash(value: AssistantConfiguration): string {
  return createHash("sha256").update(canonicalConfigurationJson(value)).digest("hex");
}
export function skillManifestHash(value: unknown): string {
  const manifest = json(value);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) refuse("ASSISTANT_SKILL_MANIFEST_INVALID");
  const sort = (item: unknown): unknown => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) return Object.fromEntries(Object.keys(item).sort().map(name => [name, sort((item as Row)[name])]));
    return refuse("ASSISTANT_SKILL_MANIFEST_INVALID");
  };
  return createHash("sha256").update(JSON.stringify(sort(manifest))).digest("hex");
}
function configuration(value: unknown, persisted = false): AssistantConfiguration {
  const raw = persisted ? json(value) : value;
  const result = AssistantConfigurationSchema.safeParse(raw);
  if (!result.success || (persisted && !isDeepStrictEqual(result.data, raw))) refuse(persisted ? "ASSISTANT_DATA_INVALID" : "ASSISTANT_CONFIG_INVALID", persisted ? "PRECONDITION_FAILED" : "BAD_REQUEST");
  return result.data;
}
function timestamp(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z)?$/.test(value) && Number.isFinite(Date.parse(value.replace(" ", "T").replace(/Z?$/, "Z")))) return value;
  return refuse("ASSISTANT_DATA_INVALID");
}
type Row = Record<string, unknown>;
function saved(row: Row, workspaceId: number, agentKey: AgentLibraryKey) {
  if (integer(row.workspaceId) !== workspaceId || row.agentKey !== agentKey) refuse("ASSISTANT_DATA_INVALID");
  const config = configuration(row.config, true);
  if (row.configHash !== configurationHash(config)) refuse("ASSISTANT_DATA_INVALID");
  return { agentKey, revision: integer(row.revision), config };
}
function historyRow(row: Row, workspaceId: number, agentKey: AgentLibraryKey) {
  const record = saved(row, workspaceId, agentKey);
  const sourceRevision = row.sourceRevision === null ? null : integer(row.sourceRevision);
  if (sourceRevision !== null && sourceRevision >= record.revision) refuse("ASSISTANT_DATA_INVALID");
  return { ...record, sourceRevision, createdAt: timestamp(row.createdAt), createdBy: integer(row.createdBy) };
}
function exactlyOne(rows: Row[]) { if (rows.length !== 1) refuse("ASSISTANT_DATA_INVALID"); return rows[0]; }
async function current(session: ConfigurationSession, workspaceId: number, agentKey: AgentLibraryKey) {
  const rows = await session.current(workspaceId, agentKey);
  if (!rows.length) return null;
  const row = exactlyOne(rows), record = saved(row, workspaceId, agentKey);
  integer(row.updatedBy); timestamp(row.createdAt);
  const version = historyRow(exactlyOne(await session.version(workspaceId, agentKey, record.revision)), workspaceId, agentKey);
  if (!isDeepStrictEqual(version.config, record.config)) refuse("ASSISTANT_DATA_INVALID");
  return { ...record, updatedAt: timestamp(row.updatedAt) };
}
function model(row: Row, workspaceId: number) {
  if (row.workspaceId !== null && integer(row.workspaceId) !== workspaceId) refuse("ASSISTANT_BINDING_INVALID");
  if (integer(row.isActive, 0) !== 1) refuse("ASSISTANT_MODEL_UNAVAILABLE");
  const tags = json(row.capabilityTags);
  if (!Array.isArray(tags) || tags.length > 100 || tags.some(tag => typeof tag !== "string" || !tag.trim() || tag !== tag.trim() || tag.length > 128) || new Set(tags).size !== tags.length) refuse("ASSISTANT_MODEL_CAPABILITIES_INVALID");
  for (const field of ["slug", "name", "modelId"] as const) if (typeof row[field] !== "string" || !(row[field] as string).trim()) refuse("ASSISTANT_BINDING_INVALID");
  return { slug: row.slug as string, name: row.name as string, modelId: row.modelId as string, capabilityTags: tags as string[] };
}
function skill(row: Row, workspaceId: number) {
  if (row.workspaceId === null ? row.scope !== "global" : integer(row.workspaceId) !== workspaceId) refuse("ASSISTANT_SKILL_UNAVAILABLE");
  if (row.status !== "Released" || typeof row.slug !== "string" || !row.slug.trim() || typeof row.name !== "string" || !row.name.trim()) refuse("ASSISTANT_SKILL_UNAVAILABLE");
  return { slug: row.slug, name: row.name, version: integer(row.version), manifestSha256: skillManifestHash(row.manifest) };
}
async function validateBindings(session: ConfigurationSession, workspaceId: number, agentKey: AgentLibraryKey, config: AssistantConfiguration) {
  if (config.modelSlug) {
    const rows = await session.models(workspaceId, config.modelSlug);
    if (rows.length !== 1) refuse("ASSISTANT_MODEL_UNAVAILABLE");
    const descriptor = model(rows[0], workspaceId);
    if (descriptor.slug !== config.modelSlug) refuse("ASSISTANT_BINDING_INVALID");
    if (AGENT_LIBRARY_ROLES.find(role => role.key === agentKey)!.requiresVision && !descriptor.capabilityTags.includes("vision")) refuse("ASSISTANT_MODEL_VISION_REQUIRED");
  }
  // Disabled bindings are saved evidence too; they cannot smuggle foreign/draft versions.
  for (const binding of config.skills) {
    const rows = await session.skills(workspaceId, binding.slug);
    if (rows.length !== 1) refuse("ASSISTANT_SKILL_UNAVAILABLE");
    const descriptor = skill(rows[0], workspaceId);
    if (descriptor.slug !== binding.slug || descriptor.version !== binding.version) refuse("ASSISTANT_SKILL_VERSION_UNAVAILABLE");
    if (descriptor.manifestSha256 !== binding.manifestSha256) refuse("ASSISTANT_SKILL_CONTENT_CHANGED");
  }
}

type ConfigurationChange = { agentKey: AgentLibraryKey; expectedRevision: number } & (
  | { mode: "configuration"; config: AssistantConfiguration }
  | { mode: "configuration-restore"; targetRevision: number }
  | { mode: "rules"; rules: string[] }
  | { mode: "rules-restore"; targetRevision: number }
);
const rulesSaveRequest = AssistantRulesSaveInputSchema.omit({ expectedWorkspaceId: true });
const rulesRestoreRequest = AssistantRulesRestoreInputSchema.omit({ expectedWorkspaceId: true });
function rulesProjection(record: NonNullable<Awaited<ReturnType<typeof current>>>): AssistantRulesMemoryRead {
  return { status: "configured", agentKey: record.agentKey, revision: record.revision, rules: record.config.rules, updatedAt: record.updatedAt };
}

/** Same-executor write primitive. The caller owns the transaction, fresh actor
 * authorization and feature gates. Never opens or commits a nested transaction. */
export async function saveAssistantConfigurationInSession(
  session: ConfigurationSession,
  workspaceId: number,
  userId: number,
  input: ConfigurationChange & { expectedHash?: string },
) {
  workspace(workspaceId); integer(userId); key(input.agentKey);
  const expected = integer(input.expectedRevision, 0);
  if (expected >= MAX_REVISION) refuse("ASSISTANT_REVISION_EXHAUSTED");
  const before = await current(session, workspaceId, input.agentKey);
  if ((before?.revision ?? 0) !== expected) refuse("ASSISTANT_REVISION_CONFLICT", "CONFLICT");
  if (input.expectedHash !== undefined && (!/^[a-f0-9]{64}$/u.test(input.expectedHash) || !before || configurationHash(before.config) !== input.expectedHash)) refuse("ASSISTANT_REVISION_CONFLICT", "CONFLICT");
  let config: AssistantConfiguration, sourceRevision: number | null = null;
  if (input.mode === "configuration-restore" || input.mode === "rules-restore") {
    sourceRevision = integer(input.targetRevision);
    if (!before || sourceRevision > before.revision) refuse("ASSISTANT_VERSION_NOT_FOUND", "NOT_FOUND");
    const rows = await session.version(workspaceId, input.agentKey, sourceRevision);
    if (!rows.length) refuse("ASSISTANT_VERSION_NOT_FOUND", "NOT_FOUND");
    const historical = historyRow(exactlyOne(rows), workspaceId, input.agentKey).config;
    // Rules-only restore retains every other field of the locked CURRENT config.
    config = input.mode === "rules-restore"
      ? configuration({ ...before.config, rules: historical.rules }) : historical;
  } else if (input.mode === "rules") {
    const base: AssistantConfiguration = before?.config ?? {
      name: AGENT_LIBRARY_ROLES.find(role => role.key === input.agentKey)!.name,
      description: "", enabled: false, modelSlug: "", instructions: "", rules: [], skills: [],
    };
    // Explicit first write stays disabled. Validate the complete merged body,
    // not only the rules, preserving the existing 128KiB configuration limit.
    config = configuration({ ...base, rules: input.rules });
  } else config = configuration(input.config);
  await validateBindings(session, workspaceId, input.agentKey, config);
  const text = canonicalConfigurationJson(config), hash = configurationHash(config), revision = expected + 1;
  if (before) await session.update(workspaceId, input.agentKey, expected, text, hash, userId);
  else await session.insert(workspaceId, input.agentKey, text, hash, userId);
  await session.append(workspaceId, input.agentKey, revision, text, hash, sourceRevision, userId);
  const result = await current(session, workspaceId, input.agentKey);
  if (!result || result.revision !== revision || !isDeepStrictEqual(result.config, config)) refuse("ASSISTANT_DATA_INVALID");
  return result;
}

export function createAssistantConfigurationService(
  repository: AssistantConfigurationRepository = createAssistantConfigurationRepository(),
  writesEnabled: () => boolean = () => process.env.ENABLE_ASSISTANT_CONFIGURATION_WRITES === "true",
) {
  async function save(workspaceId: number, userId: number, input: ConfigurationChange) {
    if (writesEnabled() !== true) refuse("ASSISTANT_WRITES_DISABLED");
    workspace(workspaceId); integer(userId); key(input.agentKey);
    const expected = integer(input.expectedRevision, 0);
    if (expected >= MAX_REVISION) refuse("ASSISTANT_REVISION_EXHAUSTED");
    return repository.transaction(workspaceId, session => saveAssistantConfigurationInSession(session, workspaceId, userId, input));
  }
  return {
    async listMetadata(workspaceId: number): Promise<{ items: AssistantConfigurationMetadata[] }> {
      workspace(workspaceId);
      return repository.read(workspaceId, async session => {
        const rows = await session.list(workspaceId), found = new Map<AgentLibraryKey, ReturnType<typeof saved> & { updatedAt: string }>();
        for (const row of rows) {
          const agentKey = key(row.agentKey as AgentLibraryKey);
          if (found.has(agentKey)) refuse("ASSISTANT_DATA_INVALID");
          const record = saved(row, workspaceId, agentKey);
          integer(row.updatedBy); timestamp(row.createdAt);
          const version = historyRow(exactlyOne(await session.version(workspaceId, agentKey, record.revision)), workspaceId, agentKey);
          if (!isDeepStrictEqual(version.config, record.config)) refuse("ASSISTANT_DATA_INVALID");
          found.set(agentKey, { ...record, updatedAt: timestamp(row.updatedAt) });
        }
        return { items: AGENT_LIBRARY_ROLES.map(role => {
          const record = found.get(role.key);
          if (!record) return { agentKey: role.key, status: "not-configured" as const, revision: null, name: null,
            description: null, enabled: null, modelSlug: null, skillCount: 0, ruleCount: 0, updatedAt: null };
          return { agentKey: role.key, status: "configured" as const,
            revision: record.revision, name: record.config.name,
            description: record.config.description, enabled: record.config.enabled,
            modelSlug: record.config.modelSlug, skillCount: record.config.skills.length,
            ruleCount: record.config.rules.length, updatedAt: record.updatedAt };
        }) };
      });
    },
    async get(workspaceId: number, agentKey: AgentLibraryKey): Promise<AssistantConfigurationRead> {
      workspace(workspaceId); key(agentKey);
      return repository.read(workspaceId, async session => {
        const record = await current(session, workspaceId, agentKey);
        return record ? { status: "configured" as const, record } : { status: "not-configured" as const, agentKey };
      });
    },
    async getRules(workspaceId: number, agentKey: AgentLibraryKey): Promise<AssistantRulesMemoryRead> {
      workspace(workspaceId); key(agentKey);
      return repository.read(workspaceId, async session => {
        const record = await current(session, workspaceId, agentKey);
        return record ? rulesProjection(record) : { status: "not-configured", agentKey };
      });
    },
    async options(workspaceId: number): Promise<AssistantConfigurationOptions> {
      workspace(workspaceId);
      return repository.read(workspaceId, async session => ({ writeEnabled: writesEnabled() === true, models: (await session.models(workspaceId)).map(row => model(row, workspaceId)), skills: (await session.skills(workspaceId)).map(row => skill(row, workspaceId)) }));
    },
    async history(workspaceId: number, input: { agentKey: AgentLibraryKey; beforeRevision?: number; limit: number }): Promise<AssistantConfigurationHistory> {
      workspace(workspaceId); key(input.agentKey);
      const limit = integer(input.limit), before = input.beforeRevision === undefined ? MAX_REVISION + 1 : integer(input.beforeRevision);
      if (limit > 20) refuse("ASSISTANT_HISTORY_LIMIT_INVALID", "BAD_REQUEST");
      return repository.read(workspaceId, async session => {
        const head = await current(session, workspaceId, input.agentKey);
        const rows = await session.history(workspaceId, input.agentKey, before, limit + 1);
        const versions = rows.map(row => historyRow(row, workspaceId, input.agentKey));
        let previous = before;
        for (const item of versions) {
          if (!head || item.revision > head.revision || item.revision >= previous) refuse("ASSISTANT_DATA_INVALID");
          previous = item.revision;
        }
        return { versions: versions.slice(0, limit).map(({ revision, sourceRevision, createdAt, createdBy }) => ({ revision, sourceRevision, createdAt, createdBy })), nextBeforeRevision: versions.length > limit ? versions[limit - 1].revision : null };
      });
    },
    async getVersion(workspaceId: number, agentKey: AgentLibraryKey, revision: number): Promise<AssistantConfigurationVersion> {
      workspace(workspaceId); key(agentKey); integer(revision);
      return repository.read(workspaceId, async session => {
        const head = await current(session, workspaceId, agentKey);
        if (!head || revision > head.revision) refuse("ASSISTANT_VERSION_NOT_FOUND", "NOT_FOUND");
        const rows = await session.version(workspaceId, agentKey, revision);
        if (!rows.length) refuse("ASSISTANT_VERSION_NOT_FOUND", "NOT_FOUND");
        const { createdBy: _createdBy, ...version } = historyRow(exactlyOne(rows), workspaceId, agentKey);
        return version;
      });
    },
    save(workspaceId: number, userId: number, input: { agentKey: AgentLibraryKey; expectedRevision: number; config: AssistantConfiguration }) { return save(workspaceId, userId, { ...input, mode: "configuration" }); },
    rollback(workspaceId: number, userId: number, input: { agentKey: AgentLibraryKey; expectedRevision: number; targetRevision: number }) { return save(workspaceId, userId, { ...input, mode: "configuration-restore" }); },
    async saveRules(workspaceId: number, userId: number, input: { agentKey: AgentLibraryKey; expectedRevision: number; rules: string[] }): Promise<AssistantRulesMemoryRead> {
      if (writesEnabled() !== true) refuse("ASSISTANT_WRITES_DISABLED");
      const parsed = rulesSaveRequest.safeParse(input);
      if (!parsed.success) refuse("ASSISTANT_RULES_INVALID", "BAD_REQUEST");
      return rulesProjection(await save(workspaceId, userId, { ...parsed.data, mode: "rules" }));
    },
    async restoreRules(workspaceId: number, userId: number, input: { agentKey: AgentLibraryKey; expectedRevision: number; targetRevision: number }): Promise<AssistantRulesMemoryRead> {
      if (writesEnabled() !== true) refuse("ASSISTANT_WRITES_DISABLED");
      const parsed = rulesRestoreRequest.safeParse(input);
      if (!parsed.success) refuse("ASSISTANT_RULES_INVALID", "BAD_REQUEST");
      return rulesProjection(await save(workspaceId, userId, { ...parsed.data, mode: "rules-restore" }));
    },
  };
}
export const assistantConfigurationService = createAssistantConfigurationService();
