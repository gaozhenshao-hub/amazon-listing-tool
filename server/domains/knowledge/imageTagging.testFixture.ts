import { createHash } from "node:crypto";
import { getTableConfig, MySqlDialect, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { aiJobs, aiArtifacts } from "../../../drizzle/schema/ai_os";
import { kbImages, kbImageSets } from "../../../drizzle/schema/image";
import { securityAuditLogs } from "../../../drizzle/schema/auth";
import { imageTaggingHash, IMAGE_TAGGING_TAG_FIELDS, type ImageTaggingSubmitInput, type ImageTaggingCandidate } from "../../../shared/imageTagging";
import { configurationHash, assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash } from "../ai_os/services/assistantConversationSourcePrimitives";
import { strictModelSnapshotFromRow } from "../ai_os/services/strictSkillRuntime";
import { createImageTaggingRuntime } from "./imageTaggingRuntime";
import { createImageTaggingSourceCapture } from "./imageTaggingSource";
import { createImageTaggingRepository, type ImageTaggingExecutor, type ImageTaggingPrepare } from "./imageTaggingRepository";
import type { ImageTaggingSourceApproval, ImageTaggingSavedConfiguration } from "./imageTaggingRuntimeContract";

type Row = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
export const taggingOperation = "11111111-1111-4111-8111-111111111111";
export const taggingOtherOperation = "22222222-2222-4222-8222-222222222222";
export const taggingApplyOperation = "33333333-3333-4333-8333-333333333333";
export const syntheticTaggingCandidate: ImageTaggingCandidate = { tagCategory: "", tagImageTypeMain: "", tagImageTypeSub: "", tagSellingPointCategory: "", tagSellingPointDetail: "",
  tagComposition: "", tagColorSchemeV2: "", tagDesignStyleV2: "", accentColor: "", evidence: "SYNTHETIC_IMAGE_EVIDENCE" };
function split(value: string) { const result: string[] = []; let start = 0, depth = 0, quote = false;
  for (let i = 0; i < value.length; i++) { const char = value[i]; if (char === "'") quote = !quote; if (!quote) { if (char === "(") depth++; if (char === ")") depth--; if (char === "," && depth === 0) { result.push(value.slice(start, i)); start = i + 1; } } }
  result.push(value.slice(start)); return result;
}
function meta(table: AnyMySqlTable) {
  const config = getTableConfig(table);
  return config.columns.map(column => {
    const columnType = column.getSQLType(), dataType = columnType.split("(")[0], timestamp = ["createdAt", "updatedAt"].includes(column.name);
    const extra = column.name === "id" ? "auto_increment" : column.name === "updatedAt" ? "on update CURRENT_TIMESTAMP" : "";
    return { name: column.name, columnName: column.name, columnType, dataType, type: dataType, nullable: column.notNull ? "NO" : "YES", isNullable: column.notNull ? "NO" : "YES",
      extra, maxLength: /^varchar\((\d+)\)$/u.exec(columnType)?.[1] ?? null, defaultValue: timestamp ? "CURRENT_TIMESTAMP" : typeof column.default === "string" || typeof column.default === "number" ? column.default : null,
      collation: ["varchar", "char", "enum", "text", "longtext"].includes(dataType) ? "utf8mb4_unicode_ci" : null };
  });
}
export function createImageTaggingTestFixture() {
  const identity = { workspaceId: 7, userId: 3 }, scope = { expectedWorkspaceId: 7, imageSetId: 5 }, dialect = new MySqlDialect();
  const columns = new Map([aiJobs, aiArtifacts, kbImages, kbImageSets, securityAuditLogs].map(table => [getTableConfig(table).name, meta(table)]));
  const control = { enabled: true, deny: false, engine: "InnoDB", trigger: false, warning: false, packet: 32 * 1024 * 1024,
    actorStatus: "active", memberStatus: "active", workspaceStatus: "active", role: "super_admin", agentDenied: false,
    ackLostOn: "", badReadback: "", failWrite: "", now: 1802851200, manualProofCalls: 0 };
  const state: { sets: Row[]; images: Row[]; jobs: Row[]; artifacts: Row[]; audits: Row[] } = {
    sets: [{ id: 5, userId: 3, workspaceId: 7, asin: "B012345678", productTitle: "SYNTHETIC_PRIVATE_PRODUCT", status: "pending_review", visibility: "private",
      origin_instance_id: null, remote_id: null, sync_version: 0, createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z" }],
    images: [9, 10].map(id => ({ id, imageSetId: 5, imageUrl: `storage://s3/private/synthetic-${id}.png`, imagePosition: id === 9 ? "main" : "secondary", positionIndex: id - 9,
      ...Object.fromEntries(IMAGE_TAGGING_TAG_FIELDS.map(key => [key, null])), tagImageBelong: null, tagImageBelongSub: null,
      tagImageType: "OLD_PRIVATE_LEGACY_TYPE", tagColorScheme: "OLD_PRIVATE_COLOR", tagDesignStyle: "OLD_PRIVATE_STYLE",
      aiDimensionAnalysis: "OLD_AI_ANALYSIS_MUST_SURVIVE", userEditedDimensionAnalysis: "OLD_HUMAN_ANALYSIS_MUST_SURVIVE", highlights: "OLD_HIGHLIGHTS", singleImageScore: 8,
      aplusModuleType: null, aplusModuleClass: null, tagsConfirmed: 0, analysisConfirmed: 0, createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z" })),
    jobs: [], artifacts: [], audits: [],
  };
  const calls: Array<{ sql: string; params: unknown[] }> = [], events: string[] = [];
  let tick = 0, transactionWrites: string[] = [];
  const stamp = () => `2026-10-19T01:00:${String(tick++).padStart(2, "0")}.000000Z`;
  const fingerprint = (row: Row) => imageTaggingHash(row);
  const skillRow = { id: 4, workspaceId: 7, scope: "workspace", slug: "qingdao.synthetic.tags", name: "Synthetic approved Skill", version: 2, status: "Released", modelOverride: "synthetic-vision", timeout_seconds: 120,
    manifest: { implementation: { systemPrompt: "SYNTHETIC ONLY", userPromptTemplate: "{{context}}", maxTokens: 1024, temperature: 0.2, supportsJsonMode: true } } };
  const modelRow = { workspaceId: 7, slug: "synthetic-vision", name: "Synthetic model", provider: "custom", modelId: "synthetic", baseUrl: "https://example.invalid/v1", apiKeyRef: "env:EXTERNAL_LLM_API_KEY", isActive: 1, capabilityTags: ["text", "vision"], maxContextTokens: 200000, costPer1kInputTokens: "0.01", costPer1kOutputTokens: "0.02" };
  const skill = assistantConversationSkillSnapshotFromRow(skillRow), model = strictModelSnapshotFromRow(7, modelRow.slug, modelRow);
  const config = { name: "Synthetic tagger", description: "", enabled: true, modelSlug: modelRow.slug, instructions: "SYNTHETIC_PRIVATE_RULE", rules: [], skills: [{ slug: skill.pin.slug, enabled: true, trigger: "synthetic", instructions: "", version: skill.pin.version, manifestSha256: skill.pin.manifestSha256 }] };
  const configuration: ImageTaggingSavedConfiguration = { workspaceId: 7, agentKey: "tagger", revision: 1, hash: configurationHash(config), config };
  const approval: ImageTaggingSourceApproval = { version: 1, workspaceId: 7, agentKey: "tagger", stage: "image_tagging", skillSlug: skill.pin.slug, skillSnapshotHash: assistantConversationSkillSnapshotHash(skill.pin),
    modelSlug: model.model.slug, modelConfigurationHash: model.configurationHash, source: { origin: "qingdao", revision: "synthetic", approvalRef: "NOT_PRODUCTION_APPROVAL", evidenceId: "fixture", evidenceHash: "e".repeat(64) },
    inputContract: "image_tagging_evidence_v1", outputContract: "image_tagging_labels_v1", maxCostCents: 100,
    imageBudget: { policyId: "synthetic", maxInputTokensPerImage: 8192, stage: "image_tagging", maxImageBytes: 8388608, maxImages: 1 } };
  const result = (value: Row[]) => [clone(value), []];
  const ok = () => [{ affectedRows: 1, warningStatus: control.warning ? 1 : 0 }, []];
  const execute = async (statement: SQL): Promise<unknown> => {
    const { sql, params } = dialect.sqlToQuery(statement); calls.push({ sql, params });
    if (!sql.startsWith("SELECT")) { transactionWrites.push(sql); if (control.failWrite && sql.startsWith(control.failWrite)) throw new Error("SYNTHETIC_SQL_PRIVATE_ERROR"); }
    if (sql.includes("information_schema.TABLES")) return result((params.length ? params : ["emperor_skills", "emperor_model_providers"]).map(name => ({ tableName: name, engine: control.engine })));
    if (sql.includes("information_schema.COLUMNS")) {
      if (sql.includes("COLUMN_NAME IN ('beforeSnapshot'")) return result(columns.get("security_audit_logs")!.filter(row => ["beforeSnapshot", "afterSnapshot"].includes(row.name)));
      return result(columns.get(String(params[0])) ?? []);
    }
    if (sql.includes("information_schema.STATISTICS")) {
      const names = params[0] === "ai_jobs" ? ["id", "runId"] : params[0] === "ai_artifacts" ? ["id", "artifactId"] : params[0] === "security_audit_logs" ? ["id", "auditId"] : ["id"];
      return result(names.map(name => ({ name: name === "id" ? "PRIMARY" : `${name}_unique`, indexName: name === "id" ? "PRIMARY" : `${name}_unique`, nonUnique: 0, sequence: 1, columnName: name, subPart: null, prefixLength: null })));
    }
    if (sql.includes("information_schema.TRIGGERS")) return result(control.trigger ? [{ triggerName: "synthetic_trigger" }] : []);
    if (sql.includes("@@max_allowed_packet")) return result([{ maximumPacket: control.packet }]);
    if (sql.includes("UNIX_TIMESTAMP(NOW(6)) AS currentTime")) return result([{ currentTime: control.now }]);
    if (sql.includes("FROM workspaces")) return result(params[0] === identity.workspaceId ? [{ id: identity.workspaceId, status: control.workspaceStatus }] : []);
    if (sql.includes("FROM users")) return result(params[0] === identity.userId ? [{ id: identity.userId, role: control.role, defaultWorkspaceId: identity.workspaceId, status: control.actorStatus }] : []);
    if (sql.includes("FROM workspace_memberships")) return result([{ id: 1, ...identity, role: "admin", status: control.memberStatus }]);
    if (sql.includes("FROM role_permissions")) return result([]);
    if (sql.includes("FROM emperor_skills")) return result([skillRow]);
    if (sql.includes("FROM emperor_model_providers")) return result([modelRow]);
    if (sql.includes("FROM kb_image_sets")) {
      const found = state.sets.filter(row => row.id === params[0] && (params.length < 3 || row.workspaceId === params[1] && row.userId === params[2]));
      if (sql.startsWith("SELECT id,origin_instance_id")) return result(found.map(row => ({ id: row.id, originInstanceId: row.origin_instance_id, remoteId: row.remote_id })));
      if (sql.includes("AS revisionHash")) return result(found.map(row => ({ id: row.id, userId: row.userId, workspaceId: row.workspaceId, asin: row.asin, title: row.productTitle, status: row.status, visibility: row.visibility,
        originInstanceId: row.origin_instance_id, remoteId: row.remote_id, syncVersion: row.sync_version, revisionHash: fingerprint(row) })));
      return result(found);
    }
    if (sql.includes("FROM kb_images")) return result(state.images.filter(row => row.imageSetId === params[0]).sort((a, b) => Number(a.id) - Number(b.id)).map(row => ({
      id: row.id, imageSetId: row.imageSetId, imageUrl: row.imageUrl, imagePosition: row.imagePosition, positionIndex: row.positionIndex,
      tagsConfirmed: row.tagsConfirmed, analysisConfirmed: row.analysisConfirmed, aplusModuleType: row.aplusModuleType, aplusModuleClass: row.aplusModuleClass,
      ...Object.fromEntries(IMAGE_TAGGING_TAG_FIELDS.map(key => [key, row[key]])), revisionHash: fingerprint(row),
    })));
    if (sql.startsWith("UPDATE kb_images SET")) {
      const image = state.images.find(row => row.id === params[11] && row.imageSetId === params[12] && row.imageUrl === params[13] && fingerprint(row) === params[14]
        && row.tagsConfirmed === 0 && row.analysisConfirmed === 0 && IMAGE_TAGGING_TAG_FIELDS.every((key, index) => row[key] === params[15 + index]));
      if (!image) return [{ affectedRows: 0, warningStatus: 0 }, []];
      IMAGE_TAGGING_TAG_FIELDS.forEach((key, index) => { image[key] = params[index]; });
      Object.assign(image, { tagImageType: params[8], tagColorScheme: params[9], tagDesignStyle: params[10], tagsConfirmed: 1, updatedAt: stamp() });
      return ok();
    }
    if (sql.includes("FROM security_audit_logs")) return result(state.audits.filter(row => row.auditId === params[0]));
    if (sql.includes("FROM ai_artifacts")) return result(state.artifacts.filter(row => row.artifactId === params[0]).map(row => control.badReadback === "artifact" ? { ...row, contentHash: "0".repeat(64) } : row));
    if (sql.includes("FROM ai_jobs")) {
      let selected = state.jobs;
      if (sql.includes("WHERE runId=?")) selected = selected.filter(row => row.runId === params[0]);
      else selected = selected.filter(row => row.kind === params[0] && row.workspaceId === params[1] && row.userId === params[2] && (!sql.includes("JSON_EXTRACT(input,'$.imageSetId')=?") || (row.input as Row).imageSetId === params[3]));
      if (sql.includes("status IN ('queued','running')")) selected = selected.filter(row => ["queued", "running"].includes(String(row.status)) || (row.output as Row).state === "unknown");
      if (sql.includes("ORDER BY id DESC")) selected = [...selected].reverse();
      if (sql.includes("AS logicalState")) return result(selected.map(row => ({ runId: row.runId, input: row.input, status: row.status, logicalState: (row.output as Row).state, createdAt: row.createdAt })));
      return result(selected.map(row => control.badReadback === "job" ? { ...row, projectId: 5 } : row));
    }
    const inserted = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \((.+)\)$/u.exec(sql);
    if (inserted) {
      const table = inserted[1], fields = inserted[2].split(",").map(value => value.replaceAll("`", "")), tokens = split(inserted[3]);
      const collection = table === "ai_jobs" ? state.jobs : table === "ai_artifacts" ? state.artifacts : table === "security_audit_logs" ? state.audits : null;
      if (!collection || fields.length !== tokens.length) throw new Error("UNHANDLED_SYNTHETIC_INSERT");
      const row: Row = { id: collection.length + 1, createdAt: stamp(), updatedAt: stamp(), completedAt: null, lockedBy: null, leaseUntil: null };
      let at = 0;
      fields.forEach((field, index) => { const token = tokens[index].trim(); let value = token === "?" ? params[at++] : token === "NULL" ? null : token.startsWith("'") ? token.slice(1, -1) : Number(token);
        if (["input", "output", "metadata", "contentJson"].includes(field) && typeof value === "string") value = JSON.parse(value); row[field] = value; });
      if (collection.some(value => ["runId", "artifactId", "auditId"].some(key => row[key] && row[key] === value[key] && (key !== "runId" || table === "ai_jobs")))) throw new Error("SYNTHETIC_DUPLICATE_KEY");
      collection.push(row); return ok();
    }
    if (sql.startsWith("UPDATE ai_jobs SET")) {
      const release = sql.includes("leaseUntil=NULL"), offset = release ? 5 : 6, job = state.jobs.find(row => row.id === params[offset] && row.runId === params[offset + 1] && row.userId === params[offset + 2] && row.workspaceId === params[offset + 3] && row.kind === params[offset + 4]);
      if (!job) return [{ affectedRows: 0, warningStatus: 0 }, []];
      const output = JSON.parse(String(params[1]));
      Object.assign(job, { status: params[0], output, progress: params[2], errorMessage: params[3], lockedBy: params[4], leaseUntil: release ? null : control.now + Number(params[5]),
        updatedAt: stamp(), completedAt: ["succeeded", "failed", "canceled", "unknown"].includes(output.state) ? stamp() : null });
      if (sql.includes("attempt=1")) job.attempt = 1;
      events.push(`checkpoint:${output.state}:${output.stages.map((stage: Row) => stage.state).join(",")}`); return ok();
    }
    throw new Error(`UNHANDLED_SYNTHETIC_SQL ${sql}`);
  };
  const tx: ImageTaggingExecutor = { execute };
  const database = { async transaction<T>(body: (executor: ImageTaggingExecutor) => Promise<T>): Promise<T> {
    const before = clone(state); transactionWrites = []; let value: T;
    try { value = await body(tx); } catch (error) { Object.assign(state, before); throw error; }
    events.push("commit_ack");
    if (control.ackLostOn && transactionWrites.some(text => text.startsWith(control.ackLostOn))) { control.ackLostOn = ""; events.push("ack_lost"); throw new Error("SYNTHETIC_COMMIT_ACK_LOST"); }
    return value;
  } };
  const capture = createImageTaggingSourceCapture({ manualProof: async () => { control.manualProofCalls++; throw new Error("SYNTHETIC_MANUAL_PROOF_DENIED"); } });
  const repository = createImageTaggingRepository({ getDb: async () => database, capture: capture.capture, permission: async input => {
    events.push(`permission:${input.resource}:${input.action}`);
    if (control.deny || input.resource === "agent" && control.agentDenied) throw new Error("SYNTHETIC_PERMISSION_DENIED");
  }, writesEnabled: () => control.enabled, token: () => "44444444-4444-4444-8444-444444444444" });
  const runtime = createImageTaggingRuntime({ approvalResolver: async () => clone(approval), credentialResolver: () => "SYNTHETIC_NOT_REAL", runSkill: async () => { throw new Error("SYNTHETIC_NO_PROVIDER_IN_REPOSITORY_TEST"); } });
  const prepare = (operationId = taggingOperation, mode: "missing" | "all_unconfirmed" = "missing"): ImageTaggingPrepare => async (executor, source) => ({ configuration: clone(configuration),
    ...(await runtime.prepare({ executor, identity, operationId, configuration, sourceHash: source.sourceHash,
      imageCount: source.images.filter(image => !image.tagsConfirmed && !image.analysisConfirmed && (mode === "all_unconfirmed" || image.tags.tagCategory === null || image.tags.tagImageTypeMain === null || image.tags.tagDesignStyleV2 === null)).length })) });
  async function submitted(operationId = taggingOperation) {
    const preview = await repository.preview(identity, { ...scope, operationId, mode: "missing" }, prepare(operationId));
    const input: ImageTaggingSubmitInput = { ...scope, operationId, mode: "missing", expectedSourceHash: preview.source.sourceHash, expectedRuntimeHash: preview.runtimeSnapshot.snapshotHash,
      maxCostCents: preview.runtimeSnapshot.budgetPlan.maxCostCentsTotal, chargeConfirmed: true };
    return { input, run: await repository.reserve(identity, input, prepare(operationId)) };
  }
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YG9QmcAAAAASUVORK5CYII=", "base64");
  return { identity, scope, control, state, calls, events, columns, tx, database, repository, runtime, configuration, approval, skillRow, modelRow, prepare, submitted, fingerprint, bytes,
    sha: (value: Uint8Array) => createHash("sha256").update(value).digest("hex") };
}
