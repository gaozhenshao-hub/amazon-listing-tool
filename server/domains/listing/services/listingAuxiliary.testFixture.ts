import { createHash } from "node:crypto";
import { getTableColumns, type SQL } from "drizzle-orm";
import { MySqlDialect, getTableConfig, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { projects, projectFiles, competitorAnalyses, competitorComparisonReports } from "../../../../drizzle/schema/project";
import { listings, keywords, buyerQuestions } from "../../../../drizzle/schema/listing";
import { listingFactRevisions, listingCoreRevisions, listingBulletCandidates } from "../../../../drizzle/schema/listingRevisions";
import { aiJobs, aiArtifacts, emperorSkillRuns } from "../../../../drizzle/schema/ai_os";
import { securityAuditLogs } from "../../../../drizzle/schema/auth";
import { LISTING_AUXILIARY_DEFINITIONS as definitions, type ListingAuxiliaryOperation, type ListingAuxiliaryStartInput } from "../../../../shared/listingAuxiliaryWorkflow";
import { configurationHash, assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash } from "../../ai_os/services/assistantConversationSourcePrimitives";
import { strictModelSnapshotFromRow, strictSkillMessages, strictRuntimeHash } from "../../ai_os/services/strictSkillRuntime";
import { renderSkillTemplate, type RunSkillInput, type RunSkillResult } from "../../ai_os/services/skillRunner";
import { createListingAuxiliaryRepository, type ListingAuxiliaryPrepare } from "./listingAuxiliaryRepository";
import { authorizeListingConfigured as authorizeListingAuxiliary } from "./listingConfiguredRepository";
import { LISTING_CHECKLIST_DIMENSIONS } from "./checklistContracts";
import { ListingAuxiliaryPreviewInputSchema } from "../../../../shared/listingAuxiliaryWorkflow";
import { createListingAuxiliaryRuntime } from "./listingAuxiliaryRuntime";
import { ListingAuxiliaryApprovalSchema, ListingAuxiliaryConfigurationSchema } from "./listingAuxiliaryRuntimeContract";
import { captureListingAuxiliarySource, type ListingAuxiliaryExecutor } from "./listingAuxiliarySource";
type Row = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
export const listingOperationId = "11111111-1111-4111-8111-111111111111", listingApplyId = "22222222-2222-4222-8222-222222222222";
const tables: AnyMySqlTable[] = [projects, projectFiles, competitorAnalyses, competitorComparisonReports, listings, keywords, buyerQuestions, listingFactRevisions, listingCoreRevisions, listingBulletCandidates, aiJobs, aiArtifacts, emperorSkillRuns, securityAuditLogs];
const empty = (table: AnyMySqlTable): Row => Object.fromEntries(Object.keys(getTableColumns(table)).map(key => [key, null]));
function split(value: string) { const parts = []; let start = 0, depth = 0, quoted = false;
  for (let i = 0; i < value.length; i++) { if (value[i] === "'") quoted = !quoted; if (!quoted) { if (value[i] === "(") depth++; if (value[i] === ")") depth--; if (value[i] === "," && !depth) { parts.push(value.slice(start, i).trim()); start = i + 1; } } }
  return [...parts, value.slice(start).trim()]; }
/** Transaction/SQL protocol fixture only. It does not establish native schema acceptance. */
export function createListingAuxiliaryTestFixture(operation: ListingAuxiliaryOperation = "checkTitle", targetCount = 1) {
  const dialect = new MySqlDialect(), identity = { userId: 3, workspaceId: 7 }, scope = { expectedWorkspaceId: 7, projectId: 8 };
  const control = { enabled: true, deny: false, actorStatus: "active", now: 1802851200, warnings: 0, ackLostOn: "", failWrite: "", providerThrows: false,
    afterPaid: null as null | (() => Promise<void>), afterDispatch: null as null | (() => Promise<void>) };
  const sourceTables: Record<string, Row[]> = Object.fromEntries(tables.map(table => [getTableConfig(table).name, []]));
  const stamp = "2026-10-19T00:00:00.000000Z", rawText = "Synthetic material: smooth woven fabric. Suitable for organized everyday storage.", rawHash = createHash("sha256").update(JSON.stringify(rawText)).digest("hex");
  sourceTables.projects = [{ ...empty(projects), id: 8, userId: 3, workspaceId: 7, name: "SYNTHETIC PRODUCT", createdAt: stamp, updatedAt: stamp }];
  sourceTables.projectFiles = [{ ...empty(projectFiles), id: 10, userId: 3, projectId: 8, workspaceId: 7, fileType: "product_attributes", status: "completed", rawContent: rawText, rawContentHash: rawHash, lifecycleState: "active", createdAt: stamp, updatedAt: stamp }];
  sourceTables.listing_fact_revisions = [{ ...empty(listingFactRevisions), id: 11, projectId: 8, workspaceId: 7, attributeKey: "material", value: "smooth woven fabric", sourceFileId: 10, rawHash, status: "confirmed", confirmedBy: 3, confirmedAt: stamp, contentHash: "c".repeat(64), revision: 1 }];
  sourceTables.listing_core_revisions = [{ ...empty(listingCoreRevisions), id: 12, coreId: "synthetic-core", workspaceId: 7, projectId: 8, sellingPointIndex: 1, buyerReason: "Everyday organization", factRevisionIdsJson: [11], keywordIdsJson: [], status: "confirmed", confirmedBy: 3, confirmedAt: stamp, revision: 1, inputHash: "d".repeat(64), contentHash: "e".repeat(64) }];
  sourceTables.listings = [{ ...empty(listings), id: 13, projectId: 8, title: "OLD DRAFT", version: 1, isActive: 1, lockedSteps: "[]", createdAt: stamp, updatedAt: stamp }];
  const state = { sourceTables, jobs: [] as Row[], artifacts: [] as Row[], audits: [] as Row[] };
  const modelRow = { workspaceId: 7, slug: "synthetic-text", name: "Synthetic model", provider: "custom", modelId: "synthetic", baseUrl: "https://model.example.invalid/v1", apiKeyRef: "env:EXTERNAL_LLM_API_KEY", isActive: 1, capabilityTags: ["text"], maxContextTokens: 200000, costPer1kInputTokens: "0.01", costPer1kOutputTokens: "0.02" };
  const modelRows = [modelRow];
  const skillRows = Object.entries(definitions).map(([op, definition], i) => ({ id: 30 + i, workspaceId: 7, scope: "workspace", slug: definition.slug, name: `Synthetic ${op}`, version: 1, status: "Released", modelOverride: modelRow.slug, timeout_seconds: 120,
    manifest: { implementation: { systemPrompt: "SYNTHETIC_USER_OWNED_PROMPT", userPromptTemplate: "{{context}}", maxTokens: 2048, temperature: 0.2, supportsJsonMode: true } } }));
  const pins = skillRows.map(row => assistantConversationSkillSnapshotFromRow(row)), model = strictModelSnapshotFromRow(7, modelRow.slug, modelRow);
  const config = { name: "Synthetic listing", description: "", enabled: true, modelSlug: modelRow.slug, instructions: "SYNTHETIC_SAVED_INSTRUCTIONS", rules: ["SYNTHETIC_SAVED_RULE"],
    skills: pins.map(({ pin }) => ({ slug: pin.slug, enabled: true, trigger: "explicit", instructions: "SYNTHETIC_BINDING", version: pin.version, manifestSha256: pin.manifestSha256 })) };
  const configuration = ListingAuxiliaryConfigurationSchema.parse({ workspaceId: 7, agentKey: "listing", revision: 1, hash: configurationHash(config), config });
  const approvals = Object.keys(definitions).map((op, i) => ListingAuxiliaryApprovalSchema.parse({ version: 1, workspaceId: 7, operation: op, skillSlug: pins[i].pin.slug,
    skillSnapshotHash: assistantConversationSkillSnapshotHash(pins[i].pin), source: { origin: "user_listing", revision: "synthetic", approvalRef: "NOT_PRODUCTION_APPROVAL", evidenceHash: "a".repeat(64) },
    inputContract: "listing_auxiliary_context_v1", outputContract: "listing_auxiliary_original_output_v1", executionPolicy: "frozen_routes_known_response_repair_unknown_never_retry",
    modelRoutes: [{ slug: modelRow.slug, configurationHash: model.configurationHash, maxCostCents: 100 }], maxQualityRepairs: definitions[op as ListingAuxiliaryOperation].repairs, originalPreset: definitions[op as ListingAuxiliaryOperation].preset }));
  const bullet = { subtitle: "Everyday Storage Organization:", fullText: "Smooth woven fabric provides a familiar surface for keeping your daily belongings together, letting you arrange the items you choose for an ordinary routine while using the material described in the confirmed product record", evidenceUsed: ["smooth woven fabric"], keywordsUsed: [], distinctFromPrevious: "A separate organization angle",
    qualityAudit: Object.fromEntries(["factsGrounded", "lengthInRange", "noKeywordStuffing", "oneClearBenefit", "subtitleBodyPunctuationCorrect", "americanEnglishNatural", "grammarAndParallelismCorrect", "noUnsupportedClaims", "distinctFromPrevious", "amazonBulletStyleCompliant"].map(key => [key, true])) };
  const checklist = (kind: keyof typeof LISTING_CHECKLIST_DIMENSIONS) => ({ checkListScores: Object.fromEntries(LISTING_CHECKLIST_DIMENSIONS[kind].map(key => [key, { pass: true, notes: "synthetic note", reason: "synthetic reason", suggestion: "synthetic suggestion" }])), aiSemanticRelations: { purpose: "purpose", capability: null, identity: "identity", causation: null } });
  const good = { keywordFabe: { theme: "Everyday organization", themeZh: "日常整理", description: "Investigate a buyer need; no unsupported product promise", descriptionZh: "规划方向，不承诺", fabeDirection: { feature: "unknown", advantage: "unknown", benefit: "buyer question", evidence: "missing" }, targetKeywords: ["organize"], addressesGap: "evidence missing" },
    optimizeBullet: bullet, checkBullet: checklist("bullets"), checkTitle: checklist("title"), checkDescription: checklist("description"), checkSearchTerms: checklist("searchterms"), checkQa: checklist("qa") };
  const responses: unknown[] = Array.from({ length: operation === "checkBullet" ? targetCount : 1 }, () => good[operation]);
  const calls: Array<{ sql: string; params: unknown[] }> = [], events: string[] = [], providerInputs: RunSkillInput<unknown>[] = [];
  let writes: string[] = [];
  const result = (value: Row[]) => [clone(value), []], ok = (insertId?: number) => [{ affectedRows: 1, warningStatus: control.warnings, ...(insertId ? { insertId } : {}) }, []];
  const execute = async (query: SQL): Promise<unknown> => {
    const { sql, params } = dialect.sqlToQuery(query); calls.push({ sql, params });
    if (!sql.startsWith("SELECT")) { writes.push(sql); if (control.failWrite && sql.startsWith(control.failWrite)) throw new Error("SYNTHETIC_PRIVATE_SQL_ERROR"); }
    if (sql.includes("FROM workspaces")) return result([{ id: 7, status: "active" }]);
    if (sql.includes("information_schema.TABLES")) return result(params.map(name => ({ name, engine: "InnoDB" })));
    if (sql.includes("FROM users")) return result([{ id: 3, role: "super_admin", status: control.actorStatus, defaultWorkspaceId: 7 }]);
    if (sql.includes("FROM workspace_memberships")) return result([{ id: 1, ...identity, status: "active" }]);
    if (sql.includes("FROM projects WHERE")) return result(state.sourceTables.projects.filter(row => row.id === params[0]));
    if (sql.includes("UNIX_TIMESTAMP(NOW(6))")) return result([{ nowSeconds: control.now }]);
    if (sql.includes("FROM emperor_skills")) return result(skillRows.filter(row => row.slug === params[0]));
    if (sql.includes("FROM emperor_model_providers")) return result(modelRows.filter(row => row.slug === params[0]));
    if (sql.includes("FROM emperor_skill_runs")) return result(state.sourceTables.emperor_skill_runs.filter(row => row.runId === params[0]));
    const complete = /FROM `([^`]+)` WHERE/u.exec(sql);
    if (complete) { let found = state.sourceTables[complete[1]] ?? []; if (/WHERE id=\?/u.test(sql)) found = found.filter(row => row.id === params[0]);
      return result(found.map(row => ({ ...row, __bytes: Buffer.byteLength(JSON.stringify(row)) }))); }
    if (sql.includes("FROM security_audit_logs")) return result(state.audits.filter(row => row.auditId === params[0]));
    if (sql.includes("FROM ai_artifacts")) {
      if (!sql.includes("JSON_UNQUOTE(contentJson)")) throw new Error("SYNTHETIC_CANONICAL_ARTIFACT_READ_REQUIRED");
      return result(state.artifacts.filter(row => row.artifactId === params[0]));
    }
    if (sql.includes("FROM ai_jobs")) {
      if (sql.includes("MAX(id)")) return result([{ maximum: 0 }]);
      let found = state.jobs;
      if (sql.includes("WHERE runId=?")) found = found.filter(row => row.runId === params[0]);
      else if (sql.includes("WHERE projectId=?")) found = found.filter(row => row.projectId === params[0] && row.workspaceId === params[1] && row.kind === params[2] && (["queued", "running"].includes(String(row.status)) || JSON.parse(String(row.output)).state === "outcome_unknown"));
      else if (sql.includes("WHERE workspaceId=?")) {
        if (!sql.includes("CAST(JSON_UNQUOTE(input) AS JSON)")) throw new Error("SYNTHETIC_CANONICAL_HISTORY_READ_REQUIRED");
        found = found.filter(row => row.workspaceId === params[0] && row.userId === params[1] && row.projectId === params[2] && row.kind === params[3]
          && (!sql.includes(" AND id<?") || Number(row.id) < Number(params[4]))).sort((a, b) => Number(b.id) - Number(a.id)).slice(0, Number(params.at(-1)));
        return result(found.map(row => ({ id: row.id, operationId: JSON.parse(String(row.input)).request.operationId })));
      }
      else if (sql.includes("WHERE kind=?")) {
        if (!sql.includes("CAST(JSON_UNQUOTE(input) AS JSON)")) throw new Error("SYNTHETIC_CANONICAL_QUEUE_READ_REQUIRED");
        found = found.filter(row => row.kind === params[0] && Number(row.id) > Number(params[1]) && ["queued", "running"].includes(String(row.status))
          && (row.leaseUntil === null || Number(row.leaseUntil) <= control.now)).sort((a, b) => Number(a.id) - Number(b.id)).slice(0, Number(params[2]));
        return result(found.map(row => ({ id: row.id, workspaceId: row.workspaceId, userId: row.userId, projectId: row.projectId, operationId: JSON.parse(String(row.input)).request.operationId })));
      }
      if (sql.includes("WHERE runId=?") && (!sql.includes("JSON_UNQUOTE(input)") || !sql.includes("JSON_UNQUOTE(output)"))) throw new Error("SYNTHETIC_CANONICAL_JOB_READ_REQUIRED");
      return result(found);
    }
    const insert = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \((.+)\)$/u.exec(sql);
    if (insert) {
      const table = tables.find(table => getTableConfig(table).name === insert[1])!, fields = insert[2].split(",").map(key => key.trim().replaceAll("`", "")), tokens = split(insert[3]);
      if (fields.length !== tokens.length) throw new Error("SYNTHETIC_INSERT_ARITY");
      const collection = insert[1] === "ai_jobs" ? state.jobs : insert[1] === "ai_artifacts" ? state.artifacts : insert[1] === "security_audit_logs" ? state.audits : state.sourceTables[insert[1]];
      const row: Row = { ...empty(table), id: Math.max(100, ...collection.map(row => Number(row.id))) + 1, createdAt: stamp, updatedAt: stamp }; let at = 0;
      const columns = getTableColumns(table);
      fields.forEach((field, i) => { const token = tokens[i]; let value = ["?", "JSON_QUOTE(?)"].includes(token) ? params[at++] : token === "NULL" ? null : token.startsWith("'") ? token.slice(1, -1) : Number(token);
        if (columns[field]?.getSQLType() === "json" && typeof value === "string" && token !== "JSON_QUOTE(?)") value = JSON.parse(value); row[field] = value; });
      collection.push(row); return ok(Number(row.id));
    }
    if (sql.startsWith("UPDATE ai_jobs SET lockedBy")) {
      const row = state.jobs.find(row => row.id === params[2]); if (!row || row.leaseUntil && Number(row.leaseUntil) > control.now) return [{ affectedRows: 0, warningStatus: 0 }];
      if (!sql.includes("output=JSON_QUOTE(?)")) throw new Error("SYNTHETIC_CANONICAL_JOB_WRITE_REQUIRED");
      Object.assign(row, { lockedBy: params[0], leaseUntil: control.now + 120, status: "running", attempt: 1, output: params[1] }); return ok();
    }
    if (sql.startsWith("UPDATE ai_jobs SET leaseUntil")) { const row = state.jobs.find(row => row.id === params[0] && row.lockedBy === params[1]); if (!row || Number(row.leaseUntil) <= control.now) return [{ affectedRows: 0, warningStatus: 0 }]; row.leaseUntil = control.now + 120; return ok(); }
    if (sql.startsWith("UPDATE ai_jobs SET output")) {
      const row = state.jobs.find(row => row.id === params[2] && row.runId === params[3] && row.status === params[4]);
      if (!sql.includes("output=JSON_QUOTE(?)") || !sql.includes("BINARY JSON_UNQUOTE(output)=BINARY ?")) throw new Error("SYNTHETIC_CANONICAL_JOB_CAS_REQUIRED");
      if (!row || sql.includes("lockedBy=?") && (row.lockedBy !== params[5] || Number(row.leaseUntil) <= control.now) || row.output !== params.at(-1)) return [{ affectedRows: 0, warningStatus: 0 }];
      const output = JSON.parse(String(params[0])); Object.assign(row, { output: params[0], status: params[1], completedAt: sql.includes("completedAt=NOW") ? stamp : null });
      if (sql.includes("lockedBy=NULL")) { row.lockedBy = null; row.leaseUntil = null; } events.push(`checkpoint:${output.state}`); return ok();
    }
    if (sql.startsWith("UPDATE listings SET")) {
      const assignments = sql.slice("UPDATE listings SET ".length, sql.indexOf(",version=version+1")).split(","), fields = Object.keys(getTableColumns(listings)), before = params.slice(assignments.length), row = state.sourceTables.listings.find(row => fields.every((key, i) => row[key] === before[i]));
      if (!row) return [{ affectedRows: 0, warningStatus: 0 }]; assignments.forEach((part, i) => { row[part.split("=")[0].replaceAll("`", "")] = params[i]; }); row.version = Number(row.version) + 1; row.updatedAt = stamp; return ok();
    }
    throw new Error(`SYNTHETIC_UNHANDLED_SQL:${sql}`);
  };
  const tx: ListingAuxiliaryExecutor = { execute }, database = { async transaction<T>(work: (tx: ListingAuxiliaryExecutor) => Promise<T>): Promise<T> {
    const before = clone(state); writes = []; let value: T; try { value = await work(tx); } catch (error) { Object.assign(state, before); throw error; }
    events.push("commit_ack"); if (control.ackLostOn && writes.some(sql => sql.startsWith(control.ackLostOn))) { control.ackLostOn = ""; throw new Error("SYNTHETIC_ACK_LOST"); } return value;
  } };
  const repository = createListingAuxiliaryRepository({ database: async () => database, schema: async () => undefined, enabled: () => control.enabled,
    authorize: (executor, owner, input, action) => authorizeListingAuxiliary(executor, owner, input, action, async () => { if (control.deny) throw new Error("SYNTHETIC_DENIED"); }) });
  const runSkill = async <T,>(input: RunSkillInput<T>): Promise<RunSkillResult<T>> => {
    const index = pins.findIndex(item => item.pin.slug === input.skillSlug), skill = pins[index], strict = input.strictExecution; if (!strict) throw new Error("STRICT_REQUIRED");
    const model = strict.modelSnapshot;
    const admission = strictSkillMessages(skill.systemPrompt, renderSkillTemplate(skill.userPrompt, input.variables ?? {}), [], model, skill.pin.maxTokens);
    const runId = `synthetic-paid-${providerInputs.length + 1}`;
    await strict.beforeDispatch({ runId, stage: strict.stage, bindingHash: strict.bindingHash, modelConfigurationHash: model.configurationHash, budget: admission.budget,
      requestHash: strictRuntimeHash({ model: model.model.modelId, messages: admission.messages, max_tokens: admission.budget.outputTokens, temperature: skill.pin.temperature, response_format: { type: "json_object" } }) });
    providerInputs.push(input as RunSkillInput<unknown>); events.push("provider"); await control.afterDispatch?.(); if (control.providerThrows) throw new Error("SYNTHETIC_PROVIDER_UNKNOWN");
    const raw = responses.length > 1 ? responses.shift() : responses[0], content = typeof raw === "string" ? raw : JSON.stringify(raw); if (!input.validate) throw new Error("VALIDATOR_REQUIRED");
    state.sourceTables.emperor_skill_runs.push({ id: 300 + providerInputs.length, runId, userId: identity.userId, workspaceId: identity.workspaceId, skillSlug: input.skillSlug, status: "succeeded" });
    await control.afterPaid?.(); return { runId, skillSlug: skill.pin.slug, skillName: skill.pin.name, skillVersion: String(skill.pin.version), skillPromptHash: skill.pin.systemPromptSha256.slice(0, 16), skillManifestHash: skill.pin.manifestRawSha256.slice(0, 16),
      modelSlug: model.model.slug, provider: "custom", content, parsed: input.validate(content), fallbackCount: 0, auditWarnings: [], durationMs: 1, inputTokens: 1, outputTokens: 1, costCents: 1, executionPreset: "standard", governance: null };
  };
  const runtime = createListingAuxiliaryRuntime({ approvals: async () => clone(approvals), runSkill, credential: () => "SYNTHETIC_ONLY" });
  const payloads = { keywordFabe: { keyword:"organization" },
    optimizeBullet: { coreRevisionId:12,coreInputHash:"d".repeat(64),currentBullet:{subtitle:"Initial draft:",fullText:"An initial unconfirmed local draft."},previousBullets:[],optimizationNote:"Clarify the grounded buyer benefit.",sourceCandidateId:null },
    checkBullet: { items:Array.from({length:targetCount},(_,bulletIndex)=>({subtitle:"Local draft",fullText:"Current draft text",bulletIndex,coreRevisionId:null,candidateId:null,evidenceUsed:[]})) },
    checkTitle: {title:"Current local title",itemHighlights:"Current highlights"}, checkDescription:{description:"Current local description"},
    checkSearchTerms:{searchTerms:"local search terms",title:"Current local title",bulletPoints:[{subtitle:"Local bullet",fullText:"Local full text"}]},
    checkQa:{items:[{question:"Current question",answer:"Current answer",priority:2}]} };
  const request = ListingAuxiliaryPreviewInputSchema.parse({ ...scope, operationId:listingOperationId, operation, analysisIds:[],payload:payloads[operation] });
  const prepare: ListingAuxiliaryPrepare = async (executor, source) => ({ configuration, ...await runtime.prepare({ executor, source, configuration }) });
  const submitted = async () => { const preview = await repository.preview(identity, request, prepare); const input: ListingAuxiliaryStartInput = { ...request, expectedSourceHash: preview.source.sourceHash,
    expectedRuntimeHash: preview.runtimeSnapshot.snapshotHash, maxCostCents: preview.runtimeSnapshot.maxCostCents, chargeConfirmed: true }; await repository.reserve(identity, input, prepare); return input; };
  return { identity, scope, request, control, state, tx, database, calls, events, providerInputs, repository, runtime, configuration, approvals, skillRows, modelRow, modelRows, pins, model, responses, good, prepare, submitted,
    capture: () => captureListingAuxiliarySource(tx, identity, request), operations: [operation], runSkill };
}
