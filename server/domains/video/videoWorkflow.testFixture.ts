import type { SQL } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig, MySqlDialect, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { aiJobs, aiArtifacts, emperorAgents, emperorAgentRuns, emperorAgentCheckpoints, emperorAgentEvents, emperorAgentArtifacts } from "../../../drizzle/schema/ai_os";
import { securityAuditLogs } from "../../../drizzle/schema/auth";
import { projects, projectFiles, competitorAnalyses } from "../../../drizzle/schema/project";
import * as videoTables from "../../../drizzle/schema/video";
import { listings, reviewAggregations } from "../../../drizzle/schema/listing";
import { kbVideos } from "../../../drizzle/schema/knowledge";
import { configurationHash, assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash } from "../ai_os/services/assistantConversationSourcePrimitives";
import { strictModelSnapshotFromRow, strictSkillMessages, strictRuntimeHash } from "../ai_os/services/strictSkillRuntime";
import { renderSkillTemplate, type RunSkillInput, type RunSkillResult } from "../ai_os/services/skillRunner";
import { VIDEO_CONFIGURED_DEFINITIONS, VideoConfiguredSourceApprovalSchema, VideoConfiguredSavedConfigurationSchema } from "./videoConfiguredRuntimeContract";
import { parseVideoWorkflowCandidate, type VideoWorkflowOperation, type VideoWorkflowStartInput } from "../../../shared/videoWorkflow";
import { videoWorkflowCandidates } from "./videoWorkflowCandidates.fixture";

import { createVideoConfiguredRuntime } from "./videoConfiguredRuntime";
import { createVideoWorkflowRepository, type VideoWorkflowPrepare } from "./videoWorkflowRepository";
import { captureVideoWorkflowSource, type VideoWorkflowExecutor } from "./videoWorkflowSource";

type Row = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
export const videoOperation = "11111111-1111-4111-8111-111111111111", videoApplyOperation = "22222222-2222-4222-8222-222222222222";
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
export function createVideoWorkflowTestFixture(operation: VideoWorkflowOperation = "sections") {
  const definition = VIDEO_CONFIGURED_DEFINITIONS[operation], candidate = videoWorkflowCandidates[operation];
  const identity = { userId: 3, workspaceId: 7 }, scope = { expectedWorkspaceId: 7, projectId: 8, videoScriptId: 9 }, dialect = new MySqlDialect();
  const control = { enabled: true, deny: false, actorStatus: "active", engine: "InnoDB", warning: false, now: 1802851200, failWrite: "", ackLostOn: "", modelThrows: false,
    nonTransactionalTable: "",
    afterDispatch: null as null | (() => Promise<void>), afterPaid: null as null | (() => Promise<void>) };
  const tables = [projects, projectFiles, competitorAnalyses, ...Object.values(videoTables).filter(value => {try{return !!getTableConfig(value as AnyMySqlTable).name;}catch{return false;}}), listings, reviewAggregations, kbVideos, aiJobs, aiArtifacts, securityAuditLogs, emperorAgents, emperorAgentRuns, emperorAgentCheckpoints, emperorAgentEvents, emperorAgentArtifacts] as AnyMySqlTable[];
  const columns = new Map(tables.map(table => [getTableConfig(table).name, metadata(table)]));
  const empty = (table: AnyMySqlTable) => Object.fromEntries(Object.keys(getTableColumns(table)).map(name => [name, null]));
  const sourceTables: Record<string, Row[]> = Object.fromEntries(tables.map(table => [getTableConfig(table).name, []]));
  sourceTables.projects = [{ ...empty(projects), id:8, workspaceId:7, userId:3, name:"SYNTHETIC PROJECT", productName:"SYNTHETIC PRODUCT",status:"draft" }];
  sourceTables.video_scripts = [{...empty(videoTables.videoScripts),id:9,projectId:8,userId:3,version:1,scriptName:"Synthetic video",productName:"Synthetic",videoType:"main_video",stylePreset:"minimal_white",targetDuration:"30.0",status:"draft",currentStage:"stage_0a",stageStatus:{stage_0a:"confirmed",stage_0b:"confirmed",stage_1:"confirmed",stage_2:"confirmed",stage_3:"confirmed",stage_4:"pending"}}];
  sourceTables.video_competitor_scripts = [{...empty(videoTables.videoCompetitorScripts),id:11,videoScriptId:9,inputType:"excel_upload",rawContent:"SYNTHETIC original transcript",userConfirmed:1}];
  sourceTables.video_script_sections = [{...empty(videoTables.videoScriptSections),id:15,videoScriptId:9,sectionCode:"MBP1",sectionName:"Synthetic section",durationBudget:"4.0",userConfirmed:1,sortOrder:0}];
  sourceTables.video_script_subtopics = [{...empty(videoTables.videoScriptSubtopics),id:20,sectionId:15,subtopicName:"Synthetic subtopic",durationBudget:"4.0",shotCount:1,sortOrder:0}];
  sourceTables.video_script_shots = [{...empty(videoTables.videoScriptShots),id:25,sectionId:15,subtopicId:20,shotCode:"OLD",shotDescription:"ORIGINAL_SHOT",duration:"4.0",sortOrder:0}];
  sourceTables.video_product_snapshots = [{...empty(videoTables.videoProductSnapshots),id:30,videoScriptId:9,basicInfo:{product_name:"Synthetic original"},userConfirmed:1}];
  const state = { sourceTables, jobs: [] as Row[], artifacts: [] as Row[], audits: [] as Row[] };
  const skillRow = { id: 4, workspaceId: 7, scope: "workspace", slug: definition.skillSlug, name: "Synthetic Qingdao outline", version: 2, status: "Released", modelOverride: "synthetic-text", timeout_seconds: 120,
    manifest: { implementation: { systemPrompt: "SYNTHETIC ORIGINAL", userPromptTemplate: "{{context}}", maxTokens: 2048, temperature: 0.2, supportsJsonMode: true } } };
  const modelRow = { workspaceId: 7, slug: "synthetic-text", name: "Synthetic", provider: "custom", modelId: "synthetic", baseUrl: "https://example.invalid/v1", apiKeyRef: "env:EXTERNAL_LLM_API_KEY", isActive: 1,
    capabilityTags: ["text"], maxContextTokens: 200000, costPer1kInputTokens: "0.01", costPer1kOutputTokens: "0.02" };
  const skill = assistantConversationSkillSnapshotFromRow(skillRow), model = strictModelSnapshotFromRow(7, modelRow.slug, modelRow);
  const config = { name: "Synthetic images", description: "", enabled: true, modelSlug: modelRow.slug, instructions: "SYNTHETIC_SAVED_IMAGE_INSTRUCTION", rules: ["SYNTHETIC_SAVED_RULE"],
    skills: [{ slug: skill.pin.slug, enabled: true, trigger: "Explicit Step2", instructions: "SYNTHETIC_BINDING", version: skill.pin.version, manifestSha256: skill.pin.manifestSha256 }] };
  const configuration = VideoConfiguredSavedConfigurationSchema.parse({ workspaceId: 7, agentKey: "video", revision: 1, hash: configurationHash(config), config });
  const approval = VideoConfiguredSourceApprovalSchema.parse({ version: 1, workspaceId: 7, agentKey: "video", operation, stage: definition.stage, skillSlug: skill.pin.slug,
    skillSnapshotHash: assistantConversationSkillSnapshotHash(skill.pin), modelSlug: model.model.slug, modelConfigurationHash: model.configurationHash,
    source: { origin: "qingdao", revision: "synthetic", approvalRef: "NOT_PRODUCTION_APPROVAL", evidenceId: "fixture", evidenceHash: "e".repeat(64) },
    inputContract: definition.inputContract, outputContract: definition.outputContract, maxCostCents: 100 });
  const calls: Array<{ sql: string; params: unknown[] }> = [], events: string[] = [], providerContexts: string[] = [];
  let tick = 0, transactionWrites: string[] = [];
  const stamp = () => `2026-10-19T00:00:${String(tick++).padStart(2, "0")}.000000Z`;
  const result = (value: Row[]) => [clone(value), []], ok = () => [{ affectedRows: 1, warningStatus: control.warning ? 1 : 0 }, []];
  const execute = async (query: SQL): Promise<unknown> => {
    const { sql, params } = dialect.sqlToQuery(query); calls.push({ sql, params });
    if (!sql.startsWith("SELECT")) { transactionWrites.push(sql); if (control.failWrite && sql.startsWith(control.failWrite)) throw new Error("SYNTHETIC_PRIVATE_SQL_FAILURE"); }
    if (sql.includes("information_schema.TABLES")) return result((params.length ? params : ["emperor_skills", "emperor_model_providers"]).map(name => ({ name, tableName: name, engine: name === control.nonTransactionalTable ? "MyISAM" : control.engine })));
    if (sql.includes("information_schema.COLUMNS")) return result(columns.get(String(params[0])) ?? []);
    if (sql.includes("information_schema.STATISTICS")) return result((["ai_jobs","emperor_agent_runs"].includes(String(params[0])) ? ["id", "runId"] : params[0] === "emperor_agents" ? ["id","slug"] : params[0] === "ai_artifacts" ? ["id", "artifactId"] : params[0] === "security_audit_logs" ? ["id", "auditId"] : ["id"]).map(name => ({ name: name === "id" ? "PRIMARY" : `${name}_unique`, indexName: name === "id" ? "PRIMARY" : `${name}_unique`, nonUnique: 0, sequence: 1, columnName: name, subPart: null, prefixLength: null })));
    if (sql.includes("information_schema.TRIGGERS")) return result([]);
    if (sql.includes("@@max_allowed_packet")) return result([{ maximumPacket: 32 * 1024 * 1024 }]);
    if (sql.includes("@@SESSION.sql_mode")) return result([{ sqlMode: "STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION" }]);
    if (sql.includes("UNIX_TIMESTAMP(NOW(6)) AS currentTime")) return result([{ currentTime: control.now }]);
    if (sql.includes("FROM workspaces")) return result([{ id: 7, status: "active" }]);
    if (sql.includes("FROM users")) return result([{ id: 3, role: "super_admin", status: control.actorStatus, defaultWorkspaceId: 7 }]);
    if (sql.includes("FROM workspace_memberships")) return result([{ id: 1, ...identity, status: "active" }]);
    if (sql.startsWith("SELECT projectId FROM video_scripts")) return result(state.sourceTables.video_scripts.filter(row=>row.id===params[0]).map(row=>({projectId:row.projectId})));
    if (sql.startsWith("SELECT s.videoScriptId FROM video_script_shots")) {
      const shot=state.sourceTables.video_script_shots.find(row=>row.id===params[0]);
      return result(state.sourceTables.video_script_sections.filter(row=>row.id===shot?.sectionId).map(row=>({videoScriptId:row.videoScriptId})));
    }
    if (sql.startsWith("SELECT videoScriptId FROM ")) { const table=/FROM (\w+)/u.exec(sql)![1]; return result((state.sourceTables[table]??[]).filter(row=>row.id===params[0]).map(row=>({videoScriptId:row.videoScriptId}))); }
    if (sql.includes("FROM projects WHERE")) return result(state.sourceTables.projects.filter(row => row.id === params[0]));
    if (sql.includes("FROM video_scripts WHERE")) return result(state.sourceTables.video_scripts.filter(row => row.id === params[0] && row.projectId === params[1]));
    const sourceMatch = /FROM `([^`]+)` WHERE/u.exec(sql);
    if (sourceMatch && sql.startsWith("SELECT")) return result((state.sourceTables[sourceMatch[1]] ?? []).map(row => ({ ...row, __sourceBytes: Buffer.byteLength(JSON.stringify(row)) })));
    if (sql.includes("FROM emperor_skills")) return result([skillRow]);
    if (sql.includes("FROM emperor_model_providers")) return result([modelRow]);
    if (sql.includes("FROM security_audit_logs")) return result(state.audits.filter(row => row.auditId === params[0]));
    if (sql.includes("FROM ai_artifacts")) return result(sql.includes("WHERE artifactId=?") ? state.artifacts.filter(row => row.artifactId === params[0])
      : state.artifacts.filter(row => row.workspaceId === params[0] && row.projectId === params[1] && row.sourceRowId === params[2] && row.artifactKey === "video.script" && row.isCurrent === 1));
    if (sql.startsWith("SELECT") && sql.includes("FROM emperor_agents WHERE")) return result(state.sourceTables.emperor_agents.filter(row=>row.slug===params[0]));
    if (sql.startsWith("SELECT") && sql.includes("FROM emperor_agent_runs WHERE")) return result(sql.includes("WHERE runId=?") ? state.sourceTables.emperor_agent_runs.filter(row=>row.runId===params[0])
      : state.sourceTables.emperor_agent_runs.filter(row=>row.agentSlug===params[0]&&row.workspaceId===params[1]&&row.projectId===params[2]&&row.userId===params[3]).slice(-1));
    if (sql.startsWith("SELECT") && sql.includes("FROM emperor_agent_checkpoints WHERE")) return result(state.sourceTables.emperor_agent_checkpoints.filter(row=>row.runId===params[0]));
    if (sql.startsWith("SELECT") && sql.includes("FROM emperor_agent_artifacts WHERE")) return result(state.sourceTables.emperor_agent_artifacts.filter(row=>row.runId===params[0]&&row.isCurrent===1));
    if (sql.includes("FROM ai_jobs")) {
      let selected = state.jobs;
      if (sql.includes("WHERE runId=?")) selected = selected.filter(row => row.runId === params[0]);
      else selected = selected.filter(row => row.kind === params[0] && row.workspaceId === params[1] && row.projectId === (sql.includes("userId=?") ? params[3] : params[2]));
      if (sql.includes("status IN ('queued','running')")) selected = selected.filter(row => ["queued", "running"].includes(String(row.status)) || (row.output as Row).state === "outcome_unknown");
      if (sql.includes("AS logicalState")) return result(selected.map(row => ({ runId: row.runId, request: (row.input as Row).request, requestHash: (row.input as Row).requestHash, sourceHash: (row.input as Row).sourceHash, status: row.status, logicalState: (row.output as Row).state, createdAt: row.createdAt })));
      return result(selected);
    }
    const insert = /^INSERT INTO `?(\w+)`? \(([^)]+)\) VALUES \((.+)\)$/u.exec(sql);
    if (insert) {
      const collection = insert[1] === "ai_jobs" ? state.jobs : insert[1] === "ai_artifacts" ? state.artifacts : insert[1] === "security_audit_logs" ? state.audits : state.sourceTables[insert[1]];
      if (!collection) throw new Error("UNHANDLED_SYNTHETIC_INSERT");
      const table = tables.find(table => getTableConfig(table).name === insert[1]);
      const byName = table ? Object.fromEntries(Object.entries(getTableColumns(table)).map(([key,column]) => [column.name,key])) : {};
      const fields = insert[2].split(",").map(value => byName[value.replaceAll("`", "")] ?? value.replaceAll("`", "")), values = split(insert[3]); if (fields.length !== values.length) throw new Error("SYNTHETIC_INSERT_ARITY");
      let at = 0; const row: Row = { ...(table?empty(table):{}), id: Math.max(100, ...collection.map(row=>Number(row.id))) + 1, createdAt: stamp() };
      if(table&&"updatedAt" in getTableColumns(table))row.updatedAt=stamp();
      fields.forEach((field, index) => { const token = values[index].trim(); let value = token === "?" ? params[at++] : token === "NULL" ? null : token.startsWith("'") ? token.slice(1, -1) : Number(token);
        if ((["input", "output", "metadata", "contentJson"].includes(field) || table && getTableColumns(table)[field]?.getSQLType()==="json") && typeof value === "string") value = JSON.parse(value); row[field] = value; });
      collection.push(row); return [{affectedRows:1,warningStatus:control.warning?1:0,insertId:row.id}];
    }
    if (sql.startsWith("UPDATE ai_jobs SET")) {
      const job = state.jobs.find(row => row.id === params[5] && row.runId === params[6] && row.workspaceId === params[7] && row.userId === params[8] && row.kind === params[9]);
      if (!job) return [{ affectedRows: 0, warningStatus: 0 }];
      const output = JSON.parse(String(params[1])), release = sql.includes("leaseUntil=NULL");
      Object.assign(job, { status: params[0], output, errorMessage: params[2], progress: params[3], lockedBy: params[4], leaseUntil: release ? null : control.now + 120,
        completedAt: release ? stamp() : null, updatedAt: stamp() }); if (sql.includes("attempt=1")) job.attempt = 1;
      events.push(`checkpoint:${output.state}`); return ok();
    }
    if(sql.startsWith("UPDATE emperor_agent_runs SET status=")){
      const row=state.sourceTables.emperor_agent_runs.find(row=>row.id===params[4]&&row.stateVersion===params[5]);if(!row)return [{affectedRows:0,warningStatus:0}];
      Object.assign(row,{status:params[0],progress:params[1],currentNodeId:params[2],outputs:JSON.parse(String(params[3])),stateVersion:Number(row.stateVersion)+1,errorMessage:null});return ok();
    }
    const projectionUpdate=/^UPDATE (emperor_agent_checkpoints|emperor_agent_artifacts|ai_artifacts) SET (.+) WHERE id=\?$/u.exec(sql);
    if(projectionUpdate){
      const collection=projectionUpdate[1]==="ai_artifacts"?state.artifacts:state.sourceTables[projectionUpdate[1]],row=collection.find(row=>row.id===params.at(-1));
      if(!row)return [{affectedRows:0,warningStatus:0}];
      projectionUpdate[2].split(",").forEach((part,index)=>{const key=part.split("=")[0];row[key]=["metadata","output","userEdit"].includes(key)&&params[index]!==null?JSON.parse(String(params[index])):params[index];});return ok();
    }
    if (sql.startsWith("UPDATE video_scripts SET version=version+1")) {
      const row=state.sourceTables.video_scripts.find(row=>row.id===params[1]&&row.projectId===params[2]&&row.version===params[3]);
      if(!row)return [{affectedRows:0,warningStatus:0}];row.version=Number(row.version)+1;row.stageStatus=JSON.parse(String(params[0]));row.updatedAt=stamp();return ok();
    }
    if(sql.startsWith("UPDATE video_scripts SET version=?")){const row=state.sourceTables.video_scripts.find(row=>row.id===params[2]&&row.projectId===params[3]&&row.version===params[4]);if(!row)return [{affectedRows:0,warningStatus:0}];row.version=params[0];row.stageStatus=JSON.parse(String(params[1]));row.updatedAt=stamp();return ok();}
    const changed=/^UPDATE `([^`]+)` SET (.+),updatedAt=NOW\(\) WHERE id=\?$/u.exec(sql);
    if(changed){const table=tables.find(table=>getTableConfig(table).name===changed[1])!;const entries=getTableColumns(table);const row=state.sourceTables[changed[1]].find(row=>row.id===params.at(-1));if(!row)return [{affectedRows:0,warningStatus:0}];
      changed[2].split(",").forEach((part,index)=>{const name=/`([^`]+)`/u.exec(part)![1];const key=Object.keys(entries).find(key=>entries[key].name===name)!;row[key]=entries[key].getSQLType()==="json"&&params[index]!==null?JSON.parse(String(params[index])):params[index];});row.updatedAt=stamp();return ok();}
    const deleted=/^DELETE FROM `([^`]+)` WHERE/u.exec(sql);
    if(deleted){const count=state.sourceTables[deleted[1]].length;state.sourceTables[deleted[1]]=[];return [{affectedRows:count,warningStatus:control.warning?1:0}];}
    throw new Error(`UNHANDLED_SYNTHETIC_SQL ${sql}`);
  };
  const tx: VideoWorkflowExecutor = { execute }, database = { async transaction<T>(work: (executor: VideoWorkflowExecutor) => Promise<T>): Promise<T> {
    const before = clone(state); transactionWrites = []; let value: T;
    try { value = await work(tx); } catch (error) { Object.assign(state, before); throw error; }
    events.push("commit_ack"); if (control.ackLostOn && transactionWrites.some(query => query.startsWith(control.ackLostOn))) { control.ackLostOn = ""; throw new Error("SYNTHETIC_ACK_LOST"); } return value;
  } };
  const repository = createVideoWorkflowRepository({ getDb: async () => database, permission: async () => { if (control.deny) throw new Error("SYNTHETIC_DENIED"); }, enabled: () => control.enabled,
    capture: captureVideoWorkflowSource,
    token: () => "44444444-4444-4444-8444-444444444444" });
  const runSkill = async <T,>(input: RunSkillInput<T>): Promise<RunSkillResult<T>> => {
    if (!input.strictExecution) throw new Error("STRICT_REQUIRED");
    const user = renderSkillTemplate(skill.userPrompt, { context: input.context, ...(input.variables ?? {}) }), admission = strictSkillMessages(skill.systemPrompt, user, [], model, skill.pin.maxTokens);
    const requestHash = strictRuntimeHash({ model: model.model.modelId, messages: admission.messages, max_tokens: skill.pin.maxTokens, temperature: skill.pin.temperature, response_format: { type: "json_object" } });
    await input.strictExecution.beforeDispatch({ runId: "synthetic-paid-video", stage: definition.stage, requestHash, modelConfigurationHash: model.configurationHash,
      bindingHash: input.strictExecution.bindingHash, budget: admission.budget });
    providerContexts.push(input.context ?? "");
    events.push("provider_called"); await control.afterDispatch?.(); if (control.modelThrows) throw new Error("SYNTHETIC_UNKNOWN_PROVIDER");
    await control.afterPaid?.(); if (!input.validate) throw new Error("VALIDATOR_REQUIRED"); const parsed = input.validate(JSON.stringify(candidate));
    return { runId: "synthetic-paid-video", skillSlug: skill.pin.slug, modelSlug: model.model.slug, provider: "custom", content: JSON.stringify(candidate), parsed,
      fallbackCount: 0, auditWarnings: [], durationMs: 1, inputTokens: 10, outputTokens: 10, costCents: 1,
      skillName: skillRow.name, skillVersion: String(skill.pin.version), skillPromptHash: skill.pin.systemPromptSha256.slice(0, 16),
      skillManifestHash: skill.pin.manifestRawSha256.slice(0, 16), executionPreset: "standard", governance: null };
  };
  const runtime = createVideoConfiguredRuntime({ definition, parseCandidate: value => parseVideoWorkflowCandidate(operation,value), approvalResolver: async () => clone(approval), credentialResolver: () => "SYNTHETIC_NOT_REAL", runSkill });
  const prepare = (operationId = videoOperation): VideoWorkflowPrepare => async (executor, source) => ({ configuration, ...await runtime.prepare({ executor, operationId, identity, sourceHash:source.sourceHash,sourceContext:source.context, configuration }) });
  const submitted = async (operationId = videoOperation) => {
    const preview = await repository.preview(identity, { ...scope, operationId,operation,competitorScriptId:operation==="competitor_analysis"?11:null }, prepare(operationId));
    const input: VideoWorkflowStartInput = { ...scope, operationId,operation,competitorScriptId:operation==="competitor_analysis"?11:null, expectedSourceHash: preview.source.sourceHash, expectedRuntimeHash: preview.runtimeSnapshot.snapshotHash, maxCostCents: 100, chargeConfirmed: true };
    return { input, run: await repository.reserve(identity, input, prepare(operationId)) };
  };
  return { identity, scope, control, state, tx, database, columns, calls, events, providerContexts, repository, runtime, configuration, approval, skillRow, modelRow, candidate, definition, prepare, submitted };
}
