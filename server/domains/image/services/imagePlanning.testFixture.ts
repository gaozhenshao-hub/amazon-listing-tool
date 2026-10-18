import type { SQL } from "drizzle-orm";
import { getTableConfig, MySqlDialect, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { aiJobs, aiArtifacts } from "../../../../drizzle/schema/ai_os";
import { securityAuditLogs } from "../../../../drizzle/schema/auth";
import { projects, projectFiles, competitorAnalyses, competitorComparisonReports } from "../../../../drizzle/schema/project";
import { imageWorkflowSessions, imageWorkflowStep0Artifacts } from "../../../../drizzle/schema/image";
import { keywords, listings, reviewAggregations } from "../../../../drizzle/schema/listing";
import { configurationHash, assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash } from "../../ai_os/services/assistantConversationSourcePrimitives";
import { strictModelSnapshotFromRow, strictSkillMessages, strictRuntimeHash } from "../../ai_os/services/strictSkillRuntime";
import { renderSkillTemplate, type RunSkillInput, type RunSkillResult } from "../../ai_os/services/skillRunner";
import { ConfiguredBusinessSourceApprovalSchema, ConfiguredBusinessSavedConfigurationSchema } from "../../ai_os/services/configuredBusinessRuntimeContract";
import { type ImagePlanningStartInput } from "../../../../shared/imagePlanning";
import { buildHumanConfirmedStageDraft, materializeImmutableStageSnapshot } from "./imageWorkflowVersionPolicy";
import { createImagePlanningRuntime } from "./imagePlanningRuntime";
import { createImagePlanningRepository, type ImagePlanningPrepare } from "./imagePlanningRepository";
import { captureImagePlanningSource, type ImagePlanningExecutor } from "./imagePlanningSource";

type Row = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
export const planningOperation = "11111111-1111-4111-8111-111111111111", planningApplyOperation = "22222222-2222-4222-8222-222222222222";
export const planningCandidate = { mainImage: { purpose: "SYNTHETIC main", contentBrief: "Complete synthetic brief" },
  secondaryImages: Array.from({ length: 6 }, (_, index) => ({ imageNumber: index + 2, purpose: `SYNTHETIC secondary ${index + 2}`, contentBrief: "Complete synthetic brief" })),
  aPlusModules: Array.from({ length: 7 }, (_, index) => ({ moduleNumber: index + 1, purpose: `SYNTHETIC A+ ${index + 1}`, contentBrief: "Complete synthetic brief" })),
  brandStory: { theme: "SYNTHETIC theme", contentBrief: "Complete synthetic story" } };
function split(value: string) { const result: string[] = []; let start = 0, depth = 0, quote = false;
  for (let i = 0; i < value.length; i++) { const char = value[i]; if (char === "'") quote = !quote; if (!quote) { if (char === "(") depth++; if (char === ")") depth--; if (char === "," && depth === 0) { result.push(value.slice(start, i)); start = i + 1; } } }
  result.push(value.slice(start)); return result;
}
function metadata(table: AnyMySqlTable) { return getTableConfig(table).columns.map(column => {
  const type = column.getSQLType(), dataType = type.split("(")[0];
  return { name: column.name, columnName: column.name, columnType: type, dataType, type: dataType, nullable: column.notNull ? "NO" : "YES", isNullable: column.notNull ? "NO" : "YES",
    extra: column.name === "id" ? "auto_increment" : column.name === "updatedAt" ? "on update CURRENT_TIMESTAMP" : "",
    defaultValue: ["createdAt", "updatedAt"].includes(column.name) ? "CURRENT_TIMESTAMP" : typeof column.default === "string" || typeof column.default === "number" ? column.default : null,
    maxLength: /^varchar\((\d+)\)$/u.exec(type)?.[1] ?? null, collation: ["varchar", "char", "enum", "text", "longtext"].includes(dataType) ? "utf8mb4_unicode_ci" : null };
}); }
export function createImagePlanningTestFixture(sourceDependencies?: Parameters<typeof captureImagePlanningSource>[3]) {
  const identity = { userId: 3, workspaceId: 7 }, scope = { expectedWorkspaceId: 7, projectId: 8, sessionId: 9 }, dialect = new MySqlDialect();
  const control = { enabled: true, deny: false, actorStatus: "active", engine: "InnoDB", warning: false, now: 1802851200, failWrite: "", ackLostOn: "", modelThrows: false,
    nonTransactionalTable: "",
    afterDispatch: null as null | (() => Promise<void>), afterPaid: null as null | (() => Promise<void>) };
  const tables = [projects, projectFiles, competitorAnalyses, competitorComparisonReports, imageWorkflowSessions, imageWorkflowStep0Artifacts, keywords, listings, reviewAggregations, aiJobs, aiArtifacts, securityAuditLogs] as AnyMySqlTable[];
  const columns = new Map(tables.map(table => [getTableConfig(table).name, metadata(table)]));
  const empty = (table: AnyMySqlTable) => Object.fromEntries(getTableConfig(table).columns.map(column => [column.name, null]));
  const sourceTables: Record<string, Row[]> = Object.fromEntries(tables.map(table => [getTableConfig(table).name, []]));
  const project = { ...empty(projects), id: 8, workspaceId: 7, userId: 3, name: "SYNTHETIC PROJECT", productName: "SYNTHETIC PRODUCT", status: "draft" };
  const session: Row = { ...empty(imageWorkflowSessions), id: 9, projectId: 8, userId: 3, step0Confirmed: 1, step1Confirmed: 1, step2Confirmed: 0, status: "draft" };
  sourceTables.projects = [project]; sourceTables.image_workflow_sessions = [session];
  const versionScope = { workspaceId: 7, projectId: 8, sessionId: 9 }, snapshots: Row[] = [];
  const confirmed = [0, 1].map(step => {
    const content = { title: `SYNTHETIC human step ${step}`, confirmedOwnFact: "Saved verified input" };
    session[`step${step}UserEdit`] = JSON.stringify(content);
    const dependencies = step ? [{ step: 0 as const, version: 1, snapshotDigest: String(snapshots[0].snapshotDigest) }] : [];
    const draft = buildHumanConfirmedStageDraft({ ...versionScope, step: step as 0 | 1, content, contentRevision: 1, contentOrigin: "human_confirmed", sourceConfirmed: true }, dependencies);
    const snapshot = materializeImmutableStageSnapshot({ draft, version: 1, confirmedBy: 3, confirmedAt: new Date("2026-10-19T00:00:00Z") });
    snapshots.push({ ...snapshot, contentJson: JSON.stringify(content), assetDependenciesJson: "[]", dependenciesJson: JSON.stringify(snapshot.dependencies), state: "confirmed" }); return snapshot;
  });
  const state = { sourceTables, snapshots, version: 2, jobs: [] as Row[], artifacts: [] as Row[], audits: [] as Row[] };
  const skillRow = { id: 4, workspaceId: 7, scope: "workspace", slug: "image.step2.outline", name: "Synthetic Qingdao outline", version: 2, status: "Released", modelOverride: "synthetic-text", timeout_seconds: 120,
    manifest: { implementation: { systemPrompt: "SYNTHETIC ORIGINAL", userPromptTemplate: "{{context}}", maxTokens: 2048, temperature: 0.2, supportsJsonMode: true } } };
  const modelRow = { workspaceId: 7, slug: "synthetic-text", name: "Synthetic", provider: "custom", modelId: "synthetic", baseUrl: "https://example.invalid/v1", apiKeyRef: "env:EXTERNAL_LLM_API_KEY", isActive: 1,
    capabilityTags: ["text"], maxContextTokens: 200000, costPer1kInputTokens: "0.01", costPer1kOutputTokens: "0.02" };
  const skill = assistantConversationSkillSnapshotFromRow(skillRow), model = strictModelSnapshotFromRow(7, modelRow.slug, modelRow);
  const config = { name: "Synthetic images", description: "", enabled: true, modelSlug: modelRow.slug, instructions: "SYNTHETIC_SAVED_IMAGE_INSTRUCTION", rules: ["SYNTHETIC_SAVED_RULE"],
    skills: [{ slug: skill.pin.slug, enabled: true, trigger: "Explicit Step2", instructions: "SYNTHETIC_BINDING", version: skill.pin.version, manifestSha256: skill.pin.manifestSha256 }] };
  const configuration = ConfiguredBusinessSavedConfigurationSchema.parse({ workspaceId: 7, agentKey: "images", revision: 1, hash: configurationHash(config), config });
  const approval = ConfiguredBusinessSourceApprovalSchema.parse({ version: 1, workspaceId: 7, agentKey: "images", stage: "image_outline", skillSlug: skill.pin.slug,
    skillSnapshotHash: assistantConversationSkillSnapshotHash(skill.pin), modelSlug: model.model.slug, modelConfigurationHash: model.configurationHash,
    source: { origin: "qingdao", revision: "synthetic", approvalRef: "NOT_PRODUCTION_APPROVAL", evidenceId: "fixture", evidenceHash: "e".repeat(64) },
    inputContract: "image_planning_evidence_v1", outputContract: "image_planning_outline_v1", maxCostCents: 100 });
  const calls: Array<{ sql: string; params: unknown[] }> = [], events: string[] = [], providerContexts: string[] = [];
  let tick = 0, transactionWrites: string[] = [];
  const stamp = () => `2026-10-19T00:00:${String(tick++).padStart(2, "0")}.000000Z`;
  const result = (value: Row[]) => [clone(value), []], ok = () => [{ affectedRows: 1, warningStatus: control.warning ? 1 : 0 }, []];
  const execute = async (query: SQL): Promise<unknown> => {
    const { sql, params } = dialect.sqlToQuery(query); calls.push({ sql, params });
    if (!sql.startsWith("SELECT")) { transactionWrites.push(sql); if (control.failWrite && sql.startsWith(control.failWrite)) throw new Error("SYNTHETIC_PRIVATE_SQL_FAILURE"); }
    if (sql.includes("information_schema.TABLES")) return result((params.length ? params : ["emperor_skills", "emperor_model_providers"]).map(name => ({ name, tableName: name, engine: name === control.nonTransactionalTable ? "MyISAM" : control.engine })));
    if (sql.includes("information_schema.COLUMNS")) return result(columns.get(String(params[0])) ?? []);
    if (sql.includes("information_schema.STATISTICS")) return result((params[0] === "ai_jobs" ? ["id", "runId"] : params[0] === "ai_artifacts" ? ["id", "artifactId"] : params[0] === "security_audit_logs" ? ["id", "auditId"] : ["id"]).map(name => ({ name: name === "id" ? "PRIMARY" : `${name}_unique`, indexName: name === "id" ? "PRIMARY" : `${name}_unique`, nonUnique: 0, sequence: 1, columnName: name, subPart: null, prefixLength: null })));
    if (sql.includes("information_schema.TRIGGERS")) return result([]);
    if (sql.includes("@@max_allowed_packet")) return result([{ maximumPacket: 32 * 1024 * 1024 }]);
    if (sql.includes("UNIX_TIMESTAMP(NOW(6)) AS currentTime")) return result([{ currentTime: control.now }]);
    if (sql.includes("FROM workspaces")) return result([{ id: 7, status: "active" }]);
    if (sql.includes("FROM users")) return result([{ id: 3, role: "super_admin", status: control.actorStatus, defaultWorkspaceId: 7 }]);
    if (sql.includes("FROM workspace_memberships")) return result([{ id: 1, ...identity, status: "active" }]);
    if (sql.includes("FROM projects WHERE")) return result(state.sourceTables.projects.filter(row => row.id === params[0]));
    if (sql.includes("FROM image_workflow_sessions WHERE")) return result(state.sourceTables.image_workflow_sessions.filter(row => row.id === params[0] && row.projectId === params[1]));
    if (sql.includes("FROM image_workflow_version_scopes")) return result([{ ...versionScope, revision: state.version }]);
    if (sql.includes("FROM image_workflow_stage_snapshots")) return result(sql.includes("s.step>=2") ? state.snapshots.filter(row => Number(row.step) >= 2 && row.state === "confirmed") : state.snapshots.filter(row => Number(row.step) <= 1).map(row => {
      const bytes = Buffer.byteLength(JSON.stringify(row));
      return bytes <= 2097152 ? { ...row, __sourceBytes: bytes } : { __sourceBytes: bytes, contentJson: null, assetDependenciesJson: null, dependenciesJson: null };
    }));
    const sourceMatch = /FROM `([^`]+)` WHERE/u.exec(sql);
    if (sourceMatch) return result((state.sourceTables[sourceMatch[1]] ?? []).map(row => ({ ...row, __sourceBytes: Buffer.byteLength(JSON.stringify(row)) })));
    if (sql.includes("FROM emperor_skills")) return result([skillRow]);
    if (sql.includes("FROM emperor_model_providers")) return result([modelRow]);
    if (sql.includes("FROM security_audit_logs")) return result(state.audits.filter(row => row.auditId === params[0]));
    if (sql.includes("FROM ai_artifacts")) return result(state.artifacts.filter(row => row.artifactId === params[0]));
    if (sql.includes("FROM ai_jobs")) {
      let selected = state.jobs;
      if (sql.includes("WHERE runId=?")) selected = selected.filter(row => row.runId === params[0]);
      else selected = selected.filter(row => row.kind === params[0] && row.workspaceId === params[1] && row.projectId === (sql.includes("userId=?") ? params[3] : params[2]));
      if (sql.includes("status IN ('queued','running')")) selected = selected.filter(row => ["queued", "running"].includes(String(row.status)) || (row.output as Row).state === "outcome_unknown");
      if (sql.includes("AS logicalState")) return result(selected.map(row => ({ runId: row.runId, input: row.input, status: row.status, logicalState: (row.output as Row).state, createdAt: row.createdAt })));
      return result(selected);
    }
    const insert = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \((.+)\)$/u.exec(sql);
    if (insert) {
      const collection = insert[1] === "ai_jobs" ? state.jobs : insert[1] === "ai_artifacts" ? state.artifacts : insert[1] === "security_audit_logs" ? state.audits : null;
      if (!collection) throw new Error("UNHANDLED_SYNTHETIC_INSERT");
      const fields = insert[2].split(",").map(value => value.replaceAll("`", "")), values = split(insert[3]); if (fields.length !== values.length) throw new Error("SYNTHETIC_INSERT_ARITY");
      let at = 0; const row: Row = { id: collection.length + 1, createdAt: stamp(), updatedAt: stamp(), completedAt: null, lockedBy: null, leaseUntil: null };
      fields.forEach((field, index) => { const token = values[index].trim(); let value = token === "?" ? params[at++] : token === "NULL" ? null : token.startsWith("'") ? token.slice(1, -1) : Number(token);
        if (["input", "output", "metadata", "contentJson"].includes(field) && typeof value === "string") value = JSON.parse(value); row[field] = value; });
      collection.push(row); return ok();
    }
    if (sql.startsWith("UPDATE ai_jobs SET")) {
      const job = state.jobs.find(row => row.id === params[5] && row.runId === params[6] && row.workspaceId === params[7] && row.userId === params[8] && row.kind === params[9]);
      if (!job) return [{ affectedRows: 0, warningStatus: 0 }];
      const output = JSON.parse(String(params[1])), release = sql.includes("leaseUntil=NULL");
      Object.assign(job, { status: params[0], output, errorMessage: params[2], progress: params[3], lockedBy: params[4], leaseUntil: release ? null : control.now + 120,
        completedAt: release ? stamp() : null, updatedAt: stamp() }); if (sql.includes("attempt=1")) job.attempt = 1;
      events.push(`checkpoint:${output.state}`); return ok();
    }
    if (sql.startsWith("UPDATE image_workflow_sessions SET")) {
      const row = state.sourceTables.image_workflow_sessions.find(value => value.id === params[2] && value.projectId === params[3] && value.userId === params[4] && value.step2AiResult === params[5] && value.step2UserEdit === params[6]);
      if (!row || row.step1Confirmed !== 1 || row.step2Confirmed !== 0) return [{ affectedRows: 0, warningStatus: 0 }];
      row.step2AiResult = params[0]; row.step2UserEdit = params[1]; row.updatedAt = stamp(); return ok();
    }
    if (sql.startsWith("UPDATE image_workflow_version_scopes SET")) {
      if (params[0] !== 7 || params[1] !== 8 || params[2] !== 9 || params[3] !== state.version) return [{ affectedRows: 0, warningStatus: 0 }];
      state.version++; return ok();
    }
    throw new Error(`UNHANDLED_SYNTHETIC_SQL ${sql}`);
  };
  const tx: ImagePlanningExecutor = { execute }, database = { async transaction<T>(work: (executor: ImagePlanningExecutor) => Promise<T>): Promise<T> {
    const before = clone(state); transactionWrites = []; let value: T;
    try { value = await work(tx); } catch (error) { Object.assign(state, before); throw error; }
    events.push("commit_ack"); if (control.ackLostOn && transactionWrites.some(query => query.startsWith(control.ackLostOn))) { control.ackLostOn = ""; throw new Error("SYNTHETIC_ACK_LOST"); } return value;
  } };
  const repository = createImagePlanningRepository({ getDb: async () => database, permission: async () => { if (control.deny) throw new Error("SYNTHETIC_DENIED"); }, enabled: () => control.enabled,
    capture: (executor, owner, input) => captureImagePlanningSource(executor, owner, input, sourceDependencies),
    token: () => "44444444-4444-4444-8444-444444444444" });
  const runSkill = async <T,>(input: RunSkillInput<T>): Promise<RunSkillResult<T>> => {
    if (!input.strictExecution) throw new Error("STRICT_REQUIRED");
    providerContexts.push(input.context ?? "");
    const user = renderSkillTemplate(skill.userPrompt, { context: input.context, ...(input.variables ?? {}) }), admission = strictSkillMessages(skill.systemPrompt, user, [], model, skill.pin.maxTokens);
    const requestHash = strictRuntimeHash({ model: model.model.modelId, messages: admission.messages, max_tokens: skill.pin.maxTokens, temperature: skill.pin.temperature, response_format: { type: "json_object" } });
    await input.strictExecution.beforeDispatch({ runId: "synthetic-paid-outline", stage: "image_outline", requestHash, modelConfigurationHash: model.configurationHash,
      bindingHash: input.strictExecution.bindingHash, budget: admission.budget });
    events.push("provider_called"); await control.afterDispatch?.(); if (control.modelThrows) throw new Error("SYNTHETIC_UNKNOWN_PROVIDER");
    await control.afterPaid?.(); if (!input.validate) throw new Error("VALIDATOR_REQUIRED"); const parsed = input.validate(JSON.stringify(planningCandidate));
    return { runId: "synthetic-paid-outline", skillSlug: skill.pin.slug, modelSlug: model.model.slug, provider: "custom", content: JSON.stringify(planningCandidate), parsed,
      fallbackCount: 0, auditWarnings: [], durationMs: 1, inputTokens: 10, outputTokens: 10, costCents: 1,
      skillName: skillRow.name, skillVersion: String(skill.pin.version), skillPromptHash: skill.pin.systemPromptSha256.slice(0, 16),
      skillManifestHash: skill.pin.manifestRawSha256.slice(0, 16), executionPreset: "standard", governance: null };
  };
  const runtime = createImagePlanningRuntime({ approvalResolver: async () => clone(approval), credentialResolver: () => "SYNTHETIC_NOT_REAL", runSkill });
  const prepare = (operationId = planningOperation): ImagePlanningPrepare => async (executor, source) => ({ configuration, ...await runtime.prepare({ executor, operationId, source, configuration }) });
  const submitted = async (operationId = planningOperation) => {
    const preview = await repository.preview(identity, { ...scope, operationId }, prepare(operationId));
    const input: ImagePlanningStartInput = { ...scope, operationId, expectedSourceHash: preview.source.sourceHash, expectedRuntimeHash: preview.runtimeSnapshot.snapshotHash, maxCostCents: 100, chargeConfirmed: true };
    return { input, run: await repository.reserve(identity, input, prepare(operationId)) };
  };
  return { identity, scope, control, state, tx, database, columns, calls, events, providerContexts, repository, runtime, configuration, approval, skillRow, modelRow, confirmed, prepare, submitted };
}
