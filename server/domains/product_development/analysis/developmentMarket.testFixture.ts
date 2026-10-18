import { getTableConfig, MySqlDialect, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { aiJobs, aiArtifacts } from "../../../../drizzle/schema/ai_os";
import { securityAuditLogs } from "../../../../drizzle/schema/auth";
import { devProjects, devProducts, devProductTags, devPanoramaStatus, devPanoramaVersions, devAnalysisStages } from "../../../../drizzle/schema/project";
import { developmentMarketHash, type DevelopmentMarketCandidate, type DevelopmentMarketStart } from "../../../../shared/developmentMarket";
import { configurationHash, assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash } from "../../ai_os/services/assistantConversationSourcePrimitives";
import { strictModelSnapshotFromRow } from "../../ai_os/services/strictSkillRuntime";
import { createDevelopmentMarketRuntime } from "./developmentMarketRuntime";
import { createDevelopmentMarketRepository, type DevelopmentMarketPrepare } from "./developmentMarketRepository";
import { developmentMarketSourceContext } from "./developmentMarketSource";
import type { DevelopmentMarketExecutor } from "./developmentMarketCore";
import type { ConfiguredBusinessSourceApproval, ConfiguredBusinessSavedConfiguration } from "../../ai_os/services/configuredBusinessRuntimeContract";
type Row = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
export const marketOperation = "11111111-1111-4111-8111-111111111111", marketOtherOperation = "22222222-2222-4222-8222-222222222222",
  marketApplyOperation = "33333333-3333-4333-8333-333333333333";
export const marketCandidate: DevelopmentMarketCandidate = { maturityLevel: "成长", maturityReason: "SYNTHETIC_FULL_INTERPRETATION", growthTrend: null, growthRate: null,
  seasonality: { hasSeasonality: null, peakMonths: [], lowMonths: [], description: "缺少完整年度趋势" }, marketCapacity: { level: "小", monthlyRevenue: null, potential: "测试市场" },
  entryTiming: { recommendation: "谨慎进入", bestEntryTime: null, reason: "人工核对" }, summary: "SYNTHETIC_ONLY", risks: ["合成风险"], opportunities: ["合成机会"] };
function split(value: string) { const result: string[] = []; let start = 0, depth = 0, quote = false;
  for (let index = 0; index < value.length; index++) { const char = value[index]; if (char === "'") quote = !quote; if (!quote) { if (char === "(") depth++; if (char === ")") depth--; if (char === "," && depth === 0) { result.push(value.slice(start, index)); start = index + 1; } } } result.push(value.slice(start)); return result;
}
function meta(table: AnyMySqlTable) { return getTableConfig(table).columns.map(column => {
  const columnType = column.getSQLType(), dataType = columnType.split("(")[0], timestamp = ["createdAt", "updatedAt"].includes(column.name);
  return { name: column.name, columnName: column.name, columnType, dataType, nullable: column.notNull ? "NO" : "YES", isNullable: column.notNull ? "NO" : "YES",
    extra: column.name === "id" ? "auto_increment" : column.name === "updatedAt" ? "on update CURRENT_TIMESTAMP" : "",
    maxLength: /^varchar\((\d+)\)$/u.exec(columnType)?.[1] ?? null, defaultValue: timestamp ? "CURRENT_TIMESTAMP" : typeof column.default === "string" || typeof column.default === "number" ? column.default : null,
    collation: ["varchar", "char", "enum", "text", "longtext"].includes(dataType) ? "utf8mb4_unicode_ci" : null };
}); }
/** Synthetic SQL protocol fixture: real source, registry runtime and repository.
 * No live DB, model, network, credentials or customer product data. */
export function createDevelopmentMarketTestFixture() {
  const identity = { workspaceId: 7, userId: 3 }, scope = { expectedWorkspaceId: 7, devProjectId: 5 }, dialect = new MySqlDialect(),
    tables = [aiJobs, aiArtifacts, devProjects, devProducts, devProductTags, devPanoramaStatus, devPanoramaVersions, devAnalysisStages, securityAuditLogs];
  const columns = new Map(tables.map(table => [getTableConfig(table).name, meta(table)])),
    control = { enabled: true, deny: false, agentDenied: false, role: "super_admin", workspaceStatus: "active", actorStatus: "active", memberStatus: "active", engine: "InnoDB",
      trigger: false, warning: false, packet: 32 * 1024 * 1024, ackLostOn: "", badReadback: "", failWrite: "", now: 1802851200 };
  const products: Row[] = [9, 10].map((id, index) => ({ id, workspaceId: 7, projectId: 5, userId: 3, asin: `B00000000${index}`, parentAsin: null,
    title: "SYNTHETIC_PRODUCT", brand: "Synthetic", price: "20.00", rating: "4.2", reviewCount: "10", monthlySales: 100 + index, bsr: 1,
    monthlyRevenue: "2000.00", listingDate: index ? "2020-01-01" : "2026-09-01", fulfillment: "FBA", sellerName: "Synthetic", sellerLocation: "US", variantCount: 1,
    category: "Synthetic", monthlySalesHistory: null, monthlyRevenueHistory: null, imageUrl: "https://m.media-amazon.com/images/I/SYNTHETIC.jpg", searchRank: index + 1 }));
  const state: { project: Row; products: Row[]; tags: Row[]; status: Row; version: Row; stages: Row[]; roles: Row[]; jobs: Row[]; artifacts: Row[]; audits: Row[] } = {
    project: { id: 5, workspaceId: 7, userId: 99, name: "SYNTHETIC_COLLEAGUE_PROJECT", targetMarket: "US", keywords: "synthetic market", status: "active" }, products,
    tags: products.map((product, index) => ({ id: index + 1, workspaceId: 7, projectId: 5, productId: product.id, confirmed: 1, tag: "SYNTHETIC" })),
    status: { id: 2, workspaceId: 7, projectId: 5, userId: 99, confirmed: 1, currentVersionId: 4 },
    version: { id: 4, workspaceId: 7, projectId: 5, userId: 99, version: 2, status: "confirmed", confirmedAt: "2026-10-18T00:00:00.000000Z", snapshot: { products: clone(products), confirmedAt: "2026-10-18T00:00:00Z" } },
    stages: [{ id: 6, workspaceId: 7, projectId: 5, userId: 99, stageType: "market_overview", rowVersion: 2, status: "generated", rawResult: "OLD_COMPLETE_AI_RESULT", editedResult: "OLD_COMPLETE_HUMAN_EDIT", confirmedAt: null,
      runId: null, runProgress: 100, runError: null, runStartedAt: null, runCompletedAt: "2026-10-18T00:00:00.000000", lastMutationKey: null, createdAt: "2026-10-18T00:00:00.000000", updatedAt: "2026-10-18T00:00:00.000000" },
    { id: 7, workspaceId: 7, projectId: 5, userId: 99, stageType: "information_summary", rowVersion: 3, status: "confirmed", rawResult: "OLD_SUMMARY_AI", editedResult: "OLD_SUMMARY_HUMAN", confirmedAt: "2026-10-18T00:00:00.000000", runId: null }],
    roles: [], jobs: [], artifacts: [], audits: [],
  };
  const calls: Array<{ sql: string; params: unknown[] }> = [], events: string[] = []; let writes: string[] = [], tick = 0;
  const stamp = () => `2026-10-19T01:00:${String(tick++).padStart(2, "0")}.000000`, fingerprint = developmentMarketHash;
  const skillRow = { id: 4, workspaceId: 7, scope: "workspace", slug: "dev.analysis.market_overview", name: "Synthetic Qingdao Skill", version: 2, status: "Released", modelOverride: "synthetic-text", timeout_seconds: 60,
    manifest: { implementation: { systemPrompt: "SYNTHETIC MARKET INTERPRETATION ONLY", userPromptTemplate: "{{context}}", maxTokens: 1000, temperature: 0, supportsJsonMode: true } } };
  const skill = assistantConversationSkillSnapshotFromRow(skillRow), modelRow = { workspaceId: 7, slug: "synthetic-text", name: "Synthetic model", provider: "custom", modelId: "synthetic-text-model", baseUrl: "https://synthetic.invalid/v1", apiKeyRef: "env:EXTERNAL_LLM_API_KEY",
    isActive: 1, capabilityTags: ["text"], maxContextTokens: 200000, costPer1kInputTokens: "0.01", costPer1kOutputTokens: "0.02" }, model = strictModelSnapshotFromRow(7, "synthetic-text", modelRow);
  const config = { name: "Synthetic development config", description: "Synthetic", enabled: true, instructions: "SAVED_DEVELOPMENT_INSTRUCTIONS", rules: ["SAVED_DEVELOPMENT_RULE"], modelSlug: "",
    skills: [{ slug: skill.pin.slug, enabled: true, instructions: "SAVED_SKILL_BINDING", trigger: "manual", version: skill.pin.version, manifestSha256: skill.pin.manifestSha256 }] };
  const configuration: ConfiguredBusinessSavedConfiguration = { workspaceId: 7, agentKey: "development", revision: 2, config, hash: configurationHash(config) };
  const approval: ConfiguredBusinessSourceApproval = { version: 1, workspaceId: 7, stage: "development_market_overview", agentKey: "development", skillSlug: skill.pin.slug,
    skillSnapshotHash: assistantConversationSkillSnapshotHash(skill.pin), modelSlug: model.model.slug, modelConfigurationHash: model.configurationHash,
    source: { origin: "qingdao", revision: "SYNTHETIC_REVISION", approvalRef: "SYNTHETIC_APPROVAL", evidenceId: "SYNTHETIC_EVIDENCE", evidenceHash: "a".repeat(64) },
    inputContract: "development_market_evidence_v1", outputContract: "development_market_analysis_v1", maxCostCents: 100 };
  const result = (value: Row[]) => [clone(value), []], ok = () => [{ affectedRows: 1, warningStatus: control.warning ? 1 : 0 }, []];
  const execute = async (query: SQL): Promise<unknown> => {
    const { sql, params } = dialect.sqlToQuery(query); calls.push({ sql, params });
    if (!sql.startsWith("SELECT")) { writes.push(sql); if (control.failWrite && sql.startsWith(control.failWrite)) throw new Error("SYNTHETIC_PRIVATE_SQL_ERROR"); }
    if (sql.includes("information_schema.TABLES")) return result((params.length ? params : ["emperor_skills", "emperor_model_providers"]).map(tableName => ({ tableName, engine: control.engine })));
    if (sql.includes("information_schema.COLUMNS")) return result(columns.get(String(params[0])) ?? []);
    if (sql.includes("information_schema.STATISTICS")) {
      const keys = params[0] === "ai_jobs" ? [["id"], ["runId"]] : params[0] === "ai_artifacts" ? [["id"], ["artifactId"]] : params[0] === "security_audit_logs" ? [["id"], ["auditId"]]
        : params[0] === "dev_analysis_stages" ? [["id"], ["workspaceId", "projectId", "stageType"], ["projectId", "stageType"]] : params[0] === "dev_panorama_versions" ? [["id"], ["workspaceId", "projectId", "version"]] : [["id"]];
      return result(keys.flatMap((key, index) => key.map((columnName, offset) => ({ name: index ? `unique_${index}` : "PRIMARY", indexName: index ? `unique_${index}` : "PRIMARY", nonUnique: 0, sequence: offset + 1, columnName, subPart: null, prefixLength: null }))));
    }
    if (sql.includes("information_schema.TRIGGERS")) return result(control.trigger ? [{ triggerName: "synthetic" }] : []);
    if (sql.includes("@@max_allowed_packet")) return result([{ maximumPacket: control.packet }]);
    if (sql.includes("AS currentTime")) return result([{ currentTime: control.now }]);
    if (sql.includes("FROM workspaces")) return result(params[0] === identity.workspaceId ? [{ id: 7, status: control.workspaceStatus }] : []);
    if (sql.includes("FROM users")) return result(params[0] === identity.userId ? [{ id: 3, role: control.role, status: control.actorStatus, defaultWorkspaceId: 7 }] : []);
    if (sql.includes("FROM workspace_memberships")) return result([{ id: 1, ...identity, status: control.memberStatus }]);
    if (sql.includes("FROM role_permissions")) return result(state.roles);
    if (sql.includes("FROM emperor_skills")) return result([skillRow]);
    if (sql.includes("FROM emperor_model_providers")) return result([modelRow]);
    if (sql.includes("FROM dev_projects")) return result(state.project.id === params[0] && state.project.workspaceId === params[1] ? [{ ...state.project, revisionHash: fingerprint(state.project) }] : []);
    if (sql.includes("FROM dev_panorama_status")) return result([{ ...state.status, revisionHash: fingerprint(state.status) }]);
    if (sql.includes("FROM dev_panorama_versions")) return result(params[0] === state.version.id ? [{ ...state.version, revisionHash: fingerprint(state.version) }] : []);
    if (sql.includes("FROM dev_products")) return result(state.products.map(row => ({ ...row, revisionHash: fingerprint(row) })));
    if (sql.includes("FROM dev_product_tags")) return result(state.tags.map(row => ({ ...row, revisionHash: fingerprint(row) })));
    if (sql.includes("FROM dev_analysis_stages")) return result(state.stages.filter(row => row.projectId === params[0]).sort((a, b) => String(a.stageType).localeCompare(String(b.stageType))).map(row => sql.includes("AS revisionHash") ? { ...row, revisionHash: fingerprint(row) } : row));
    if (sql.includes("FROM security_audit_logs")) return result(state.audits.filter(row => row.auditId === params[0]));
    if (sql.includes("FROM ai_artifacts")) return result(state.artifacts.filter(row => row.artifactId === params[0]).map(row => control.badReadback === "artifact" ? { ...row, contentHash: "0".repeat(64) } : row));
    if (sql.includes("FROM ai_jobs")) {
      const selected = sql.includes("WHERE runId=?") ? state.jobs.filter(row => row.runId === params[0]) : state.jobs.filter(row => row.kind === params[0] && row.workspaceId === params[1] && (row.input as Row).devProjectId === params[2]
        && (["queued", "running"].includes(String(row.status)) || (row.output as Row).state === "outcome_unknown"));
      return result(selected.map(row => control.badReadback === "job" ? { ...row, projectId: 5 } : row));
    }
    const inserted = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \((.+)\)$/u.exec(sql);
    if (inserted) {
      const table = inserted[1], fields = inserted[2].split(",").map(value => value.replaceAll("`", "")), tokens = split(inserted[3]), collection = table === "ai_jobs" ? state.jobs : table === "ai_artifacts" ? state.artifacts : table === "security_audit_logs" ? state.audits : table === "dev_analysis_stages" ? state.stages : null;
      if (!collection || fields.length !== tokens.length) throw new Error(`UNHANDLED_SYNTHETIC_INSERT ${sql}`);
      const row: Row = { id: Math.max(0, ...collection.map(row => Number(row.id))) + 1, createdAt: stamp(), updatedAt: stamp(), completedAt: null, lockedBy: null, leaseUntil: null,
        ...(table === "dev_analysis_stages" ? { editedResult: null, confirmedAt: null } : {}) }; let at = 0;
      fields.forEach((field, index) => { const token = tokens[index].trim(); let value = token === "?" ? params[at++] : token === "NULL" ? null : token.startsWith("'") ? token.slice(1, -1) : Number(token);
        if (["input", "output", "metadata", "contentJson"].includes(field) && typeof value === "string") value = JSON.parse(value); row[field] = value; });
      if (collection.some(old => ["runId", "artifactId", "auditId"].some(key => row[key] && old[key] === row[key] && (key !== "runId" || table === "ai_jobs")))) throw new Error("SYNTHETIC_DUPLICATE"); collection.push(row); return ok();
    }
    if (sql.startsWith("UPDATE ai_jobs SET")) {
      const row = state.jobs.find(row => row.id === params[3] && row.runId === params[4] && row.workspaceId === params[5] && row.userId === params[6] && row.kind === params[7]);
      if (!row) return [{ affectedRows: 0, warningStatus: 0 }, []];
      Object.assign(row, { status: params[0], output: JSON.parse(String(params[1])), lockedBy: params[2], leaseUntil: sql.includes("leaseUntil=NULL") ? null : control.now + 120, attempt: 1 });
      events.push(`checkpoint:${(row.output as Row).state}`); return ok();
    }
    if (sql.startsWith("UPDATE dev_analysis_stages SET status='completed'")) {
      const row = state.stages.find(row => row.id === params[2] && row.workspaceId === params[3] && row.projectId === params[4] && row.rowVersion === params[5] && fingerprint(row) === params[6]);
      if (!row) return [{ affectedRows: 0, warningStatus: 0 }, []];
      Object.assign(row, { status: "completed", rawResult: params[0], editedResult: null, runId: null, runProgress: 100, runError: null, runCompletedAt: stamp(), confirmedAt: null,
        rowVersion: Number(row.rowVersion) + 1, lastMutationKey: params[1], updatedAt: stamp() }); return ok();
    }
    if (sql.startsWith("UPDATE dev_analysis_stages SET status=IF")) {
      const row = state.stages.find(row => row.id === params[1] && row.workspaceId === params[2] && row.projectId === params[3] && row.rowVersion === params[4]); if (!row) return [{ affectedRows: 0, warningStatus: 0 }, []];
      Object.assign(row, { status: row.rawResult === null && row.editedResult === null ? "pending" : "generated", confirmedAt: null, runId: null, runProgress: 0, rowVersion: Number(row.rowVersion) + 1, lastMutationKey: params[0], updatedAt: stamp() }); return ok();
    }
    throw new Error(`UNHANDLED_SYNTHETIC_SQL ${sql}`);
  };
  const tx: DevelopmentMarketExecutor = { execute }, database = { async transaction<T>(body: (executor: DevelopmentMarketExecutor) => Promise<T>): Promise<T> {
    const before = clone(state); writes = []; let value: T;
    try { value = await body(tx); } catch (error) { Object.assign(state, before); throw error; }
    events.push("commit_ack"); if (control.ackLostOn && writes.some(sql => sql.startsWith(control.ackLostOn))) { control.ackLostOn = ""; events.push("ack_lost"); throw new Error("SYNTHETIC_ACK_LOST"); } return value;
  } };
  const repository = createDevelopmentMarketRepository({ getDb: async () => database, permission: async input => { events.push(`permission:${input.resource}:${input.action}`); if (control.deny || input.resource === "agent" && control.agentDenied) throw new Error("SYNTHETIC_DENIED"); }, enabled: () => control.enabled, token: () => "44444444-4444-4444-8444-444444444444" });
  const runtime = createDevelopmentMarketRuntime({ approvalResolver: async () => clone(approval), credentialResolver: () => "SYNTHETIC_NOT_REAL", runSkill: async () => { throw new Error("SYNTHETIC_PROVIDER_FORBIDDEN"); } });
  const prepare = (operationId = marketOperation): DevelopmentMarketPrepare => async (executor, source) => ({ configuration: clone(configuration), ...(await runtime.prepare({ executor, identity,
    operationId, configuration, source, sourceHash: source.sourceHash, sourceContext: developmentMarketSourceContext(source) })) });
  async function submitted(operationId = marketOperation) { const preview = await repository.preview(identity, { ...scope, operationId }, prepare(operationId)), input: DevelopmentMarketStart = { ...scope, operationId,
    expectedSourceHash: preview.source.sourceHash, expectedRuntimeHash: preview.runtimeSnapshot.snapshotHash, maxCostCents: preview.runtimeSnapshot.budgetPlan.maxCostCentsTotal, chargeConfirmed: true };
    return { input, run: await repository.reserve(identity, input, prepare(operationId)) };
  }
  return { identity, scope, state, control, calls, events, columns, tx, database, repository, runtime, configuration, approval, skillRow, modelRow, prepare, submitted, fingerprint };
}
