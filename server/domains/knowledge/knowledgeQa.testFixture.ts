import type { SQL } from "drizzle-orm";
import { getTableConfig, MySqlDialect, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { aiJobs, aiArtifacts } from "../../../drizzle/schema/ai_os";
import { securityAuditLogs } from "../../../drizzle/schema/auth";
import { configurationHash, assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash } from "../ai_os/services/assistantConversationSourcePrimitives";
import { strictModelSnapshotFromRow, strictSkillMessages, strictRuntimeHash } from "../ai_os/services/strictSkillRuntime";
import { renderSkillTemplate, type RunSkillInput, type RunSkillResult } from "../ai_os/services/skillRunner";
import { KnowledgeQaApprovalSchema, KnowledgeQaConfigurationSchema } from "./knowledgeQaRuntimeContract";
import { createKnowledgeQaRuntime, createFixedKnowledgeQaApprovalResolver } from "./knowledgeQaRuntime";
import { createKnowledgeQaRepository, type KnowledgeQaPrepare } from "./knowledgeQaRepository";
import { createKnowledgeQaProcessor } from "./knowledgeQaWorker";
import { createKnowledgeQaService } from "./knowledgeQaService";
import type { KnowledgeQaExecutor } from "./knowledgeQaStorePrimitives";
import { knowledgeQaOperation, type KnowledgeQaStartInput } from "../../../shared/knowledgeQa";
type Row = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
export const qaOperation = "11111111-1111-4111-8111-111111111111", qaThread = "22222222-2222-4222-8222-222222222222";
function split(value: string) { const result: string[] = []; let start = 0, depth = 0, quote = false;
  for (let i = 0; i < value.length; i++) { const char = value[i]; if (char === "'") quote = !quote; if (!quote) { if (char === "(") depth++; if (char === ")") depth--; if (char === "," && depth === 0) { result.push(value.slice(start, i)); start = i + 1; } } }
  result.push(value.slice(start)); return result;
}
function metadata(table: AnyMySqlTable) { return getTableConfig(table).columns.map(column => { const type = column.getSQLType(), dataType = type.split("(")[0]; return {
  name: column.name, columnName: column.name, columnType: type, dataType, type: dataType, nullable: column.notNull ? "NO" : "YES", isNullable: column.notNull ? "NO" : "YES",
  extra: column.name === "id" ? "auto_increment" : column.name === "updatedAt" ? "on update CURRENT_TIMESTAMP" : "", defaultValue: ["createdAt", "updatedAt"].includes(column.name) ? "CURRENT_TIMESTAMP" : typeof column.default === "string" || typeof column.default === "number" ? column.default : null,
  maxLength: /^varchar\((\d+)\)$/u.exec(type)?.[1] ?? null, collation: ["varchar", "char", "enum", "text", "longtext"].includes(dataType) ? "utf8mb4_unicode_ci" : null }; }); }
export function createKnowledgeQaTestFixture(itemCount = 12) {
  const identity = { userId: 3, workspaceId: 7 }, scope = { expectedWorkspaceId: 7, threadId: qaThread }, dialect = new MySqlDialect();
  const control = { enabled: true, deny: false, actorStatus: "active", actorRole: "super_admin", defaultWorkspaceId: 7, membershipStatus: "active", engine: "InnoDB", nonTransactionalTable: "", warning: false, now: 1802851200,
    failWrite: "", ackLostOn: "", modelThrows: false, malformed: false, missingApproval: false, unavailableCredential: false, paidCalls: 0,
    afterDispatch: null as null | (() => Promise<void>), afterPaid: null as null | (() => Promise<void>) };
  const columns = new Map(([aiJobs, aiArtifacts, securityAuditLogs] as AnyMySqlTable[]).map(table => [getTableConfig(table).name, metadata(table)]));
  const sourceTables: Record<string, Row[]> = Object.fromEntries(["kb_product_innovations", "kb_listing_copywriting", "kb_image_sets", "kb_images", "kb_operation_skills", "kb_videos"].map(name => [name, []]));
  sourceTables.kb_product_innovations = Array.from({ length: itemCount }, (_, i) => ({ id: i + 1, userId: 3, workspaceId: 7, status: "confirmed", visibility: "team", updatedAt: "2026-10-19T00:00:00.000000Z", asin: `SYNTHETIC${i}`,
    productTitle: `SYNTHETIC PRODUCT ${i}`, category: "SYNTHETIC", tags: "[]", score: 8, oversized: 0, bulletPoints: "SYNTHETIC FULL BULLETS", crawledData: "SYNTHETIC FULL ORIGINAL", userEditedAnalysis: "SYNTHETIC HUMAN ANALYSIS ".repeat(25), aiAnalysis: "OLD_AI_NOT_PREFERRED" }));
  const state = { sourceTables, jobs: [] as Row[], artifacts: [] as Row[], audits: [] as Row[] };
  const skills = ["select", "answer"].map((name, i) => ({ id: i + 4, workspaceId: 7, scope: "workspace", slug: `knowledge.qa.${name}`, name: `SYNTHETIC ${name}`, version: 2, status: "Released", modelOverride: "synthetic-text", timeout_seconds: 120,
    manifest: { implementation: { systemPrompt: "SYNTHETIC ORIGINAL", userPromptTemplate: "{{originalSystemPrompt}}\n{{context}}", maxTokens: name === "select" ? 2000 : 5000, temperature: 0.2, supportsJsonMode: name === "select", ...(name === "answer" ? { outputMode: "text" } : {}) } } }));
  const modelRow = { workspaceId: 7, slug: "synthetic-text", name: "Synthetic", provider: "custom", modelId: "synthetic", baseUrl: "https://example.invalid/v1", apiKeyRef: "env:EXTERNAL_LLM_API_KEY", isActive: 1,
    capabilityTags: ["text"], maxContextTokens: 200000, costPer1kInputTokens: "0.01", costPer1kOutputTokens: "0.02" };
  const pins = skills.map(assistantConversationSkillSnapshotFromRow), model = strictModelSnapshotFromRow(7, modelRow.slug, modelRow);
  const config = { name: "SYNTHETIC knowledge", description: "", enabled: true, modelSlug: modelRow.slug, instructions: "SAVED_KNOWLEDGE_INSTRUCTION", rules: ["SAVED_KNOWLEDGE_RULE"],
    skills: pins.map(pin => ({ slug: pin.pin.slug, enabled: true, trigger: "Explicit question", instructions: "SAVED_BINDING", version: pin.pin.version, manifestSha256: pin.pin.manifestSha256 })) };
  const configuration = KnowledgeQaConfigurationSchema.parse({ workspaceId: 7, agentKey: "knowledge", revision: 1, hash: configurationHash(config), config });
  const approvals = pins.map((pin, i) => KnowledgeQaApprovalSchema.parse({ version: 1, workspaceId: 7, agentKey: "knowledge", stage: i === 0 ? "knowledge_select" : "knowledge_answer", skillSlug: pin.pin.slug,
    skillSnapshotHash: assistantConversationSkillSnapshotHash(pin.pin), modelSlug: model.model.slug, modelConfigurationHash: model.configurationHash,
    source: { origin: "qingdao", revision: "SYNTHETIC", approvalRef: "NOT_PRODUCTION_APPROVAL", evidenceId: "SYNTHETIC", evidenceHash: "e".repeat(64) }, inputContract: "knowledge_qa_evidence_v1", outputContract: i === 0 ? "knowledge_qa_selection_v1" : "knowledge_qa_markdown_v1", maxCostCents: 100 }));
  const calls: Array<{ sql: string; params: unknown[] }> = [], events: string[] = [], providerCalls: RunSkillInput<unknown>[] = [];
  let tick = 0, transactionWrites: string[] = [];
  const stamp = () => new Date(Date.UTC(2026, 9, 19, 0, 0, tick++)).toISOString().replace(".000Z", ".000000Z");
  const result = (value: Row[]) => [clone(value), []], ok = () => [{ affectedRows: 1, warningStatus: control.warning ? 1 : 0 }, []];
  const execute = async (query: SQL): Promise<unknown> => {
    const { sql, params } = dialect.sqlToQuery(query); calls.push({ sql, params });
    if (!sql.startsWith("SELECT")) { transactionWrites.push(sql); if (control.failWrite && sql.startsWith(control.failWrite)) throw new Error("SYNTHETIC_PRIVATE_SQL_FAILURE"); }
    if (sql.includes("information_schema.TABLES")) return result((params.length ? params : ["emperor_skills", "emperor_model_providers"]).map(name => ({ name, tableName: name, engine: name === control.nonTransactionalTable ? "MyISAM" : control.engine })));
    if (sql.includes("information_schema.COLUMNS")) return result(columns.get(String(params[0])) ?? []);
    if (sql.includes("information_schema.STATISTICS")) return result((params[0] === "ai_jobs" ? ["id", "runId"] : params[0] === "ai_artifacts" ? ["id", "artifactId"] : ["id", "auditId"]).map(name => ({ name: name === "id" ? "PRIMARY" : `${name}_unique`, indexName: name === "id" ? "PRIMARY" : `${name}_unique`, nonUnique: 0, sequence: 1, columnName: name, subPart: null, prefixLength: null })));
    if (sql.includes("information_schema.TRIGGERS")) return result([]);
    if (sql.includes("@@max_allowed_packet")) return result([{ maximumPacket: 32 * 1024 * 1024 }]);
    if (sql.includes("UNIX_TIMESTAMP(NOW(6)) AS currentTime")) return result([{ currentTime: control.now }]);
    if (sql.includes("FROM workspaces")) return result([{ id: 7, status: "active" }]);
    if (sql.includes("FROM users")) return result([{ id: 3, role: control.actorRole, status: control.actorStatus, defaultWorkspaceId: control.defaultWorkspaceId }]);
    if (sql.includes("FROM workspace_memberships")) return result([{ id: 1, ...identity, status: control.membershipStatus }]);
    if (sql.includes("FROM role_permissions")) return result([]);
    if (sql.includes("FROM emperor_skills")) return result(skills.filter(row => row.slug === params[0]));
    if (sql.includes("FROM emperor_model_providers")) return result([modelRow]);
    if (sql.includes("FROM security_audit_logs")) return result(state.audits.filter(row => row.auditId === params[0]));
    if (sql.includes("FROM ai_artifacts")) {
      if (sql.includes("WHERE artifactId=?")) return result(state.artifacts.filter(row => row.artifactId === params[0]));
      let found = state.artifacts.filter(row => row.workspaceId === params[0] && row.userId === params[1] && row.artifactKey === params[2] && !(row.contentJson as Row).deleted);
      if (sql.includes("AND id<?")) found = found.filter(row => Number(row.id) < Number(params[3]));
      found.sort((a, b) => sql.includes("id DESC") ? Number(b.id) - Number(a.id) : Number(a.id) - Number(b.id));
      return result(found.slice(0, sql.includes("LIMIT ?") ? Number(params.at(-1)) : 1001).map(row => ({ id: row.id, sourceId: row.sourceId })));
    }
    if (sql.includes("FROM ai_jobs")) {
      if (sql.includes("WHERE runId=?")) return result(state.jobs.filter(row => row.runId === params[0]));
      let found = state.jobs.filter(row => row.kind === params[0]);
      if (sql.includes("AND id>?")) { found = found.filter(row => Number(row.id) > Number(params[1]) && ["queued", "running"].includes(String(row.status)) && (row.leaseUntil === null || Number(row.leaseUntil) <= control.now));
        return result(found.sort((a, b) => Number(a.id) - Number(b.id)).slice(0, Number(params[2])).map(row => ({ id: row.id, workspaceId: row.workspaceId, userId: row.userId, threadId: ((row.input as Row).request as Row).threadId, operationId: ((row.input as Row).request as Row).operationId }))); }
      found = found.filter(row => row.workspaceId === params[1] && row.userId === params[2]);
      if (sql.includes("$.request.threadId")) found = found.filter(row => ((row.input as Row).request as Row).threadId === params[3]);
      if (sql.includes("status IN ('queued','running')")) found = found.filter(row => ["queued", "running"].includes(String(row.status)) || (row.output as Row).state === "outcome_unknown");
      if (sql.includes("status='succeeded'")) found = found.filter(row => row.status === "succeeded");
      if (sql.includes("COUNT(*)")) return result([{ count: found.length }]);
      if (sql.includes("AND id<?")) found = found.filter(row => Number(row.id) < Number(params[4]));
      found.sort((a, b) => sql.includes("id DESC") ? Number(b.id) - Number(a.id) : Number(a.id) - Number(b.id));
      found = found.slice(0, sql.includes("LIMIT ?") ? Number(params.at(-1)) : sql.includes("LIMIT 3") ? 3 : sql.includes("LIMIT 2") ? 2 : 1);
      return result(found.map(row => sql.includes("AS operationId") ? { ...(sql.startsWith("SELECT id,") ? { id: row.id } : {}), operationId: ((row.input as Row).request as Row).operationId } : sql.startsWith("SELECT id ") ? { id: row.id } : { runId: row.runId }));
    }
    const sourceMatch = /FROM `([^`]+)` WHERE/u.exec(sql);
    if (sourceMatch) return result(state.sourceTables[sourceMatch[1]].filter(row => row.workspaceId === params[0] && row.status === "confirmed" && ["team", "public"].includes(String(row.visibility))).map(row => ({ ...row, oversized: Object.values(row).some(value => typeof value === "string" && Buffer.byteLength(value) > 262144) ? 1 : row.oversized })));
    if (sql.includes("origin_instance_id AS origin")) return result(state.sourceTables.kb_image_sets.filter(row => row.id === params[0] && row.workspaceId === params[1]).map(row => ({ id: row.id, origin: row.origin_instance_id ?? null })));
    if (sql.includes("FROM kb_images")) return result(state.sourceTables.kb_images.filter(row => row.imageSetId === params[0]));
    const insert = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \((.+)\)$/u.exec(sql);
    if (insert) {
      const collection = insert[1] === "ai_jobs" ? state.jobs : insert[1] === "ai_artifacts" ? state.artifacts : insert[1] === "security_audit_logs" ? state.audits : null; if (!collection) throw new Error("UNHANDLED_INSERT");
      const fields = insert[2].split(",").map(value => value.replaceAll("`", "")), values = split(insert[3]); if (fields.length !== values.length) throw new Error("INSERT_ARITY");
      let at = 0; const row: Row = { id: collection.length + 1, createdAt: stamp(), updatedAt: stamp(), completedAt: null, lockedBy: null, leaseUntil: null };
      fields.forEach((field, index) => { const token = values[index].trim(); let value = token === "?" ? params[at++] : token === "NULL" ? null : token.startsWith("'") ? token.slice(1, -1) : Number(token);
        if (["input", "output", "metadata", "contentJson"].includes(field) && typeof value === "string") value = JSON.parse(value); row[field] = value; }); collection.push(row); return ok();
    }
    if (sql.startsWith("UPDATE ai_jobs SET")) {
      const job = state.jobs.find(row => row.id === params[5] && row.runId === params[6] && row.workspaceId === params[7] && row.userId === params[8] && row.kind === params[9]); if (!job) return [{ affectedRows: 0, warningStatus: 0 }, []];
      const output = JSON.parse(String(params[1])), release = sql.includes("leaseUntil=NULL"); Object.assign(job, { status: params[0], output, errorMessage: params[2], progress: params[3], lockedBy: params[4], leaseUntil: release ? null : control.now + 120, completedAt: release ? stamp() : null, updatedAt: stamp() }); if (sql.includes("attempt=1")) job.attempt = 1;
      events.push(`checkpoint:${output.state}`); return ok();
    }
    if (sql.startsWith("UPDATE ai_artifacts SET")) { const row = state.artifacts.find(value => value.artifactId === params[2] && value.workspaceId === params[3] && value.userId === params[4] && value.contentHash === params[5]); if (!row) return [{ affectedRows: 0, warningStatus: 0 }, []]; Object.assign(row, { contentJson: JSON.parse(String(params[0])), contentHash: params[1], updatedAt: stamp() }); return ok(); }
    throw new Error(`UNHANDLED_SYNTHETIC_SQL ${sql}`);
  };
  const tx: KnowledgeQaExecutor = { execute }, database = { async transaction<T>(work: (executor: KnowledgeQaExecutor) => Promise<T>): Promise<T> {
    const before = clone(state); transactionWrites = []; let value: T; try { value = await work(tx); } catch (error) { Object.assign(state, before); throw error; }
    events.push("commit_ack"); if (control.ackLostOn && transactionWrites.some(query => query.startsWith(control.ackLostOn))) { control.ackLostOn = ""; throw new Error("SYNTHETIC_ACK_LOST"); } return value;
  } };
  const repository = createKnowledgeQaRepository({ database: async () => database, permission: async () => { if (control.deny) throw new Error("SYNTHETIC_DENIED"); }, enabled: () => control.enabled, token: () => "44444444-4444-4444-8444-444444444444" });
  const resolver = createFixedKnowledgeQaApprovalResolver(approvals);
  const runSkill = async <T,>(input: RunSkillInput<T>): Promise<RunSkillResult<T>> => {
    if (!input.strictExecution || !input.validate) throw new Error("STRICT_REQUIRED"); providerCalls.push(input);
    const pin = pins.find(item => item.pin.slug === input.skillSlug)!;
    const user = renderSkillTemplate(pin.userPrompt, { context: input.context, ...(input.variables ?? {}) }), admission = strictSkillMessages(pin.systemPrompt, user, [], model, pin.pin.maxTokens);
    const requestHash = strictRuntimeHash({ model: model.model.modelId, messages: admission.messages, max_tokens: pin.pin.maxTokens, temperature: pin.pin.temperature, ...(pin.pin.supportsJsonMode ? { response_format: { type: "json_object" } } : {}) });
    const runId = `synthetic-paid-${control.paidCalls + 1}`;
    await input.strictExecution.beforeDispatch({ runId, stage: input.strictExecution.stage, requestHash, modelConfigurationHash: model.configurationHash, bindingHash: input.strictExecution.bindingHash, budget: admission.budget });
    control.paidCalls++; events.push("provider_called"); await control.afterDispatch?.(); if (control.modelThrows) throw new Error("SYNTHETIC_UNKNOWN_PROVIDER");
    const context = JSON.parse(input.context ?? "{}"), content = control.malformed ? "INVALID" : input.skillSlug === "knowledge.qa.answer" ? "# SYNTHETIC 完整回答\n\n已参考人工资料。[引用1]" : JSON.stringify({ selectedIndices: Array.from({ length: Math.min(context.material.length, context.stageKey === "l1_select" ? 10 : 5) }, (_, i) => i + 1) });
    await control.afterPaid?.(); const parsed = input.validate(content);
    return { runId, skillSlug: pin.pin.slug, modelSlug: model.model.slug, provider: "custom", content, parsed, fallbackCount: 0, auditWarnings: [], durationMs: 1, inputTokens: 10, outputTokens: 20, costCents: 1,
      skillName: pin.pin.slug, skillVersion: String(pin.pin.version), skillPromptHash: pin.pin.systemPromptSha256.slice(0, 16), skillManifestHash: pin.pin.manifestRawSha256.slice(0, 16), executionPreset: "standard", governance: null };
  };
  const runtime = createKnowledgeQaRuntime({ approvalResolver: input => control.missingApproval ? Promise.resolve(null) : resolver(input), credentialResolver: () => control.unavailableCredential ? null : "SYNTHETIC_NOT_REAL", runSkill });
  const prepare = (operationId = qaOperation): KnowledgeQaPrepare => async (executor, source) => ({ configuration, ...await runtime.prepare({ executor, source, operationId, configuration }) });
  const previewInput = { ...scope, operationId: qaOperation, question: "请找一些" };
  const submitted = async (operationId = qaOperation, threadId = qaThread) => { const input = { ...previewInput, operationId, threadId }, preview = await repository.preview(identity, input, prepare(operationId));
    const start: KnowledgeQaStartInput = { ...input, expectedSourceHash: preview.source.sourceHash, expectedRuntimeHash: preview.runtimeSnapshot.snapshotHash, maxCostCents: preview.runtimeSnapshot.budgetPlan.maxCostCentsTotal, chargeConfirmed: true };
    return { input: start, run: await repository.reserve(identity, start, prepare(operationId)) };
  };
  const processor = createKnowledgeQaProcessor({ repository, runtime, enabled: () => control.enabled, loadConfiguration: async () => configuration, workerId: "synthetic" });
  const process = async (input: KnowledgeQaStartInput, signal?: AbortSignal) => processor({ id: 1, ...identity, threadId: input.threadId, operationId: input.operationId }, signal);
  const service = createKnowledgeQaService({ repository, runtime, enabled: () => control.enabled, loadConfiguration: async () => configuration });
  const check = async (input: KnowledgeQaStartInput) => (await repository.check(identity, knowledgeQaOperation(input))).run;
  return { identity, scope, previewInput, control, state, columns, tx, database, calls, events, providerCalls, repository, runtime, configuration, approvals, skills, modelRow, prepare, submitted, process, service, check };
}
