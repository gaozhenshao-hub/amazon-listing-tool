import { createHash } from "node:crypto";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createDeepAdoptionCandidateFixture } from "../../domains/listing/services/competitorDeepAdoption.testFixture";
import { createCompetitorDeepAdoptionService } from "../../domains/listing/services/competitorDeepAdoption";
import { createCompetitorDeepResultReadService, type CompetitorDeepResultReadDatabase } from "../../domains/listing/services/competitorDeepResultRead";
import { createCompetitorDeepAdoptionRepository } from "./competitorDeepAdoptionRepository";
import { competitorRevision } from "../project/competitorWritePolicy";
import type { CompetitorDeepAdoptionInput } from "../../../shared/competitorDeepAdoption";

type Row = Record<string, unknown>;
const digest = (text: string) => createHash("sha256").update(text).digest("hex"), dialect = new MySqlDialect();
const copy = <T>(value: T): T => structuredClone(value);
/** Transactional SQL-protocol fixture only; not a MySQL/native acceptance claim. */
export async function createDeepAdoptionSqlFixture(options: { workspaceId?: number | null; sourceWorkspaceId?: number | null; reviewBody?: string } = {}) {
  const candidate = await createDeepAdoptionCandidateFixture(options);
  const state = { ...candidate.state, artifacts: [] as Row[], audits: [] as Row[], comparisonInvalidations: 0 };
  const control = { enabled: true, deny: false, memberActive: true, workspaceActive: true, throwSql: "", lostAck: false,
    warningStatus: 0, affectedRows: 1, artifactMissing: false, invalidateFailure: false, engine: "InnoDB", unique: true,
    now: new Date("2026-10-19T00:00:00.000Z"), afterWrite: undefined as ((statement: string) => void) | undefined };
  const calls: { sql: string; params: unknown[]; tx: number }[] = [], permissions: Row[] = [];
  let transactionCount = 0, currentTx = 0;
  const wire = (prefix: string, text: string, max = Infinity) => ({ [`${prefix}Text`]: Buffer.byteLength(text) <= max * 8 ? text : null,
    [`${prefix}Bytes`]: Buffer.byteLength(text), [`${prefix}WireHash`]: digest(text) });
  const column = (columnName: string, dataType: string, patch: Row = {}): Row => ({ columnName, dataType, columnType: dataType,
    isNullable: "YES", extra: "", maxLength: null, defaultValue: null, collation: null, ...patch });
  const text = (name: string, length: number, required = false) => column(name, "varchar", { columnType: `varchar(${length})`, maxLength: length,
    collation: "utf8mb4_unicode_ci", isNullable: required ? "NO" : "YES" });
  const columns = [column("id", "int", { isNullable: "NO", extra: "auto_increment" }), column("workspaceId", "int"), column("actorUserId", "int"),
    text("auditId", 80, true), text("actorRole", 64), text("action", 80, true), text("resourceType", 64, true), text("resourceId", 128), column("projectId", "int"),
    column("status", "enum", { columnType: "enum('success','denied','failed')", isNullable: "NO", defaultValue: "success", collation: "utf8mb4_unicode_ci" }),
    column("riskLevel", "enum", { columnType: "enum('low','medium','high','critical')", isNullable: "NO", defaultValue: "medium", collation: "utf8mb4_unicode_ci" }),
    column("metadata", "json"), column("beforeSnapshot", "json"), column("afterSnapshot", "json"),
    column("createdAt", "timestamp", { isNullable: "NO", defaultValue: "CURRENT_TIMESTAMP", extra: "DEFAULT_GENERATED" })];
  const auditIndexes = [{ indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "id", prefixLength: null },
    { indexName: "audit_id", nonUnique: 0, sequence: 1, columnName: "auditId", prefixLength: null }];
  const execute = async (query: SQL): Promise<unknown> => {
    const q = dialect.sqlToQuery(query); calls.push({ ...q, tx: currentTx });
    if (control.throwSql && q.sql.includes(control.throwSql)) throw new Error("PRIVATE SQL params and host");
    if (q.sql.includes("information_schema.TABLES")) return [q.sql.includes("AS tableName")
      ? [{ tableName: "security_audit_logs", engine: control.engine }] : q.params.map(name => ({ name, engine: control.engine })), []];
    if (q.sql.includes("information_schema.COLUMNS")) return [q.sql.includes("AS columnName") ? copy(columns)
      : ["beforeSnapshot", "afterSnapshot"].map(name => ({ name, type: "json", extra: "" })), []];
    if (q.sql.includes("information_schema.STATISTICS")) return [q.sql.includes("AS indexName") ? copy(auditIndexes) : !control.unique ? []
      : [{ name: "unique_id", seq: 1, columnName: q.params[0] === "ai_jobs" ? "runId" : "artifactId", prefix: null }], []];
    if (q.sql.startsWith("SELECT")) {
      const table = q.sql.match(/FROM (\w+)/u)?.[1];
      if (table === "users") return [[copy(state.user)], []];
      if (table === "workspaces") return [[{ id: state.user.defaultWorkspaceId, status: control.workspaceActive ? "active" : "disabled" }], []];
      if (table === "workspace_memberships") return [[{ userId: state.user.id, workspaceId: state.user.defaultWorkspaceId, status: control.memberActive ? "active" : "disabled" }], []];
      if (table === "projects") return [[copy(state.project)], []];
      if (table === "competitorAnalyses") return [[{ ...copy(state.analysis), columnsWithinLimit: 1 }], []];
      if (table === "ai_jobs") {
        if (q.params[0] !== state.job.runId) return [[], []];
        const { inputWire, outputWire, ...job } = state.job;
        return [[{ ...copy(job), ...wire("input", inputWire, 16 * 1024 * 1024), ...wire("output", outputWire, 16 * 1024) }], []];
      }
      if (table === "ai_artifacts") {
        if (q.params[0] === state.artifact.artifactId) {
          const { contentWire, metadataWire, ...artifact } = state.artifact;
          return [[{ ...copy(artifact), ...wire("content", contentWire, 512 * 1024), ...wire("metadata", metadataWire, 16 * 1024) }], []];
        }
        return [control.artifactMissing ? [] : state.artifacts.filter(row => row.artifactId === q.params[0]).map(row => ({ ...copy(row),
          ...wire("content", String(row.contentText)), ...wire("metadata", String(row.metadataText)) })), []];
      }
      if (table === "security_audit_logs") return [copy(state.audits.filter(row => row.auditId === q.params[0])), []];
      throw new Error(`Unsupported synthetic SELECT ${table}`);
    }
    const p = q.params;
    if (q.sql.startsWith("INSERT INTO ai_artifacts")) {
      if (state.artifacts.some(row => row.artifactId === p[1])) throw new Error("Synthetic duplicate artifact");
      state.artifacts.push({ workspaceId: p[0], artifactId: p[1], domain: "listing", artifactKey: p[2], artifactType: "json", sourceType: "user_edit",
        sourceId: p[3], sourceTable: "competitorAnalyses", sourceRowId: p[4], runId: p[5], agentSlug: "listing.full.workflow", nodeId: "N1",
        projectId: p[6], userId: p[7], status: "final", version: p[8], isCurrent: 0, contentText: p[9], contentHash: p[10], mimeType: "application/json",
        fileSizeBytes: p[11], retentionClass: "hot", metadataText: p[12], sourceSkillRunId: p[13], sourceAiJobRunId: p[14] });
    } else if (q.sql.startsWith("UPDATE competitorAnalyses")) {
      if (state.analysis.id !== p[6] || state.analysis.projectId !== p[7] || state.analysis.summaryVersion !== p[8]) return [{ affectedRows: 0, warningStatus: 0 }, []];
      Object.assign(state.analysis, { rawData: p[0], summary: p[1], summaryStatus: "confirmed", summaryVersion: p[2], summaryConfirmedBy: p[3], summaryConfirmedAt: p[4], updatedAt: p[5] });
    } else if (q.sql.startsWith("INSERT INTO security_audit_logs")) {
      if (state.audits.some(row => row.auditId === p[0])) throw new Error("Synthetic duplicate audit");
      state.audits.push({ auditId: p[0], workspaceId: p[1], actorUserId: p[2], actorRole: p[3], action: p[4], resourceType: p[5], resourceId: p[6],
        projectId: p[7], status: "success", riskLevel: "medium", beforeText: p[8], afterText: p[9], metadataText: p[10] });
    } else throw new Error("Unsupported synthetic DML");
    control.afterWrite?.(q.sql);
    return [{ affectedRows: control.affectedRows, warningStatus: control.warningStatus }, []];
  };
  const database: CompetitorDeepResultReadDatabase = { transaction: async body => {
    const before = copy(state); currentTx = ++transactionCount;
    let value;
    try { value = await body({ execute }); } catch (error) { Object.assign(state, before); throw error; }
    if (control.lostAck) { control.lostAck = false; throw new Error("PRIVATE COMMIT ACK host and password"); }
    return value;
  } };
  const permission = async (input: Row) => { permissions.push(input); if (control.deny) throw new TRPCError({ code: "FORBIDDEN", message: "DENIED" }); };
  const repository = createCompetitorDeepAdoptionRepository({ database: async () => database, permission, enabled: () => control.enabled, now: () => control.now,
    invalidate: async () => { state.comparisonInvalidations++; if (control.invalidateFailure) throw new Error("PRIVATE COMPARISON WRITE"); } });
  const reader = createCompetitorDeepResultReadService({ database: async () => database, permission });
  const service = createCompetitorDeepAdoptionService({ repository, reader });
  const input = (operationId = "a0000000-0000-4000-8000-000000000001"): CompetitorDeepAdoptionInput => ({ ...candidate.request(),
    expectedRevision: competitorRevision(state.analysis), operationId, jobRunId: state.job.runId, expectedResultHash: candidate.result.resultHash,
    expectedEvidenceHash: candidate.receipt.evidenceHash, summary: "Human reviewed complete evidence and limitations.", confirmLimitations: true });
  const operation = (operationId?: string) => { const value = input(operationId); return { projectId: value.projectId, analysisId: value.analysisId,
    expectedWorkspaceId: value.expectedWorkspaceId, operationId: value.operationId, jobRunId: value.jobRunId }; };
  const scope = (operationId?: string) => { const value = operation(operationId); return { userId: 3, workspaceId: value.expectedWorkspaceId,
    projectId: value.projectId, analysisId: value.analysisId, operationId: value.operationId, jobRunId: value.jobRunId }; };
  return { ...candidate, state, control, calls, permissions, execute, database, repository, reader, service, input, operation, scope, columns, auditIndexes,
    get transactionCount() { return transactionCount; } };
}
