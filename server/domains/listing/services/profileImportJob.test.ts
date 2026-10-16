import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { getTableName } from "drizzle-orm";
import { PROFILE_IMPORT_JOB_KIND } from "../../../../shared/profileImportJob";
import type { TrpcContext } from "../../../_core/context";
import { createProfileImportJobRepository, profileImportHash, type ProfileImportDatabase } from "../../../repositories/listing/profileImportJobRepository";

vi.mock("../../ai_os/services/skillRunner", () => ({ getEmperorSkillRuntimeSnapshot: vi.fn(), runEmperorSkill: vi.fn() }));
vi.mock("../../ai_os/services/jobRunner", () => ({ scheduleAiJobRun: vi.fn(), registerAiJobHandler: vi.fn() }));
vi.mock("../listingAgentBridge", () => ({ ensureListingAgentRun: vi.fn(), syncListingNodeJobQueued: vi.fn(), syncListingNodeJobWaitingHuman: vi.fn() }));
vi.mock("../../../services/securityGovernance", () => ({
  actorFromContext: (ctx: TrpcContext) => ({ id: ctx.user!.id, role: ctx.user!.role, defaultWorkspaceId: ctx.user!.defaultWorkspaceId }),
  workspaceIdFromContext: (ctx: TrpcContext) => ctx.workspaceId ?? ctx.user?.defaultWorkspaceId ?? null,
  assertResourceAction: vi.fn(),
}));
import { createProfileImportJobService } from "./profileImportJob";
import { loadProfileImportSource } from "./profileImportSource";

type Row = Record<string, any>;
type State = { jobs: Row[]; users: Row[]; targets: Row[]; files: Row[]; artifacts: Row[]; versions: Row[]; audits: Row[] };
const dialect = new MySqlDialect();
const sourceHash = "a".repeat(64);
const input = { listingProjectId: 11, devProjectId: 21, expectedWorkspaceId: 7, expectedSourceHash: sourceHash };
const context = () => ({ user: { id: 3, role: "ops_specialist", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext);
function reorderedJson(text: string): string {
  function reverse(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reverse);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverse(item)]));
    return value;
  }
  return JSON.stringify(reverse(JSON.parse(text)));
}

/** Real domain service + real repository SQL. Transaction serialization/rollback are
 * modeled in memory; these are not actual MySQL, worker or provider acceptance. */
function fixture(sourceOverride?: typeof loadProfileImportSource) {
  const state: State = { jobs: [], users: [{ id: 3, status: "active", role: "ops_specialist", defaultWorkspaceId: 7 }], targets: [{ id: 11, workspaceId: 7, userId: 3 }], files: [], artifacts: [], versions: [], audits: [] };
  const trace: Array<{ sql: string; params: unknown[]; transaction: number }> = [];
  let queue: Promise<unknown> = Promise.resolve(), fault = "", deny = false, sourceAllowed = true, currentHash = sourceHash, transaction = 0;
  let modelHook: (() => void | Promise<void>) | undefined, writeHook: ((text: string) => void) | undefined;
  let agentStatus = "waiting_human", nodeStatus = "waiting_human";
  const controller = new AbortController();
  function executor(draft: State) {
    return { async execute(statement: SQL) {
      const { sql: text, params: p } = dialect.sqlToQuery(statement); trace.push({ sql: text, params: p, transaction });
      if (fault === "missing-schema") throw { errno: 1146 };
      const ack = (insertId?: number) => [{ affectedRows: 1, warningStatus: fault === "warning" ? 1 : 0, insertId: insertId ?? 0 }, []];
      writeHook?.(text);
      if (text.startsWith("SELECT * FROM users")) return [structuredClone(draft.users.filter(row => row.id === p[0])), []];
      if (text.startsWith("SELECT * FROM projects")) return [structuredClone(draft.targets.filter(row => row.id === p[0])), []];
      if (text.startsWith("SELECT runId,agentSlug")) return [[{ runId: p[0], agentSlug: "listing.full.workflow", userId: 3, workspaceId: draft.users[0].defaultWorkspaceId, projectId: 11, status: agentStatus }], []];
      if (text.startsWith("SELECT runId,nodeId")) return [fault === "missing-node" ? [] : [{ runId: p[0], nodeId: "N3", workspaceId: draft.users[0].defaultWorkspaceId, status: nodeStatus }], []];
      if (text.startsWith("SELECT * FROM ai_jobs WHERE runId")) return [structuredClone(draft.jobs.filter(row => row.runId === p[0])).map(row => fault === "json-reordered"
        ? { ...row, input: reorderedJson(row.input), ...(row.output ? { output: reorderedJson(row.output) } : {}) } : row), []];
      if (text.startsWith("SELECT * FROM ai_jobs WHERE userId")) return [structuredClone(draft.jobs.filter(row => row.userId === p[0] && row.workspaceId === p[1] && row.projectId === p[2] && row.kind === p[3])), []];
      if (text.startsWith("SELECT * FROM projectFiles")) return [structuredClone(draft.files.filter(row => row.id === p[0])).map(row => fault === "file-readback" ? { ...row, workspaceId: 999 } : row), []];
      if (text.startsWith("SELECT *,CAST(contentJson")) return [structuredClone(draft.artifacts.filter(row => row.sourceAiJobRunId === p[0])).map(row => fault === "artifact-readback" ? { ...row, isCurrent: 0 }
        : fault === "json-reordered" ? { ...row, contentJsonText: reorderedJson(row.contentJsonText) } : row), []];
      if (text.startsWith("SELECT * FROM analysisVersions")) return [structuredClone(draft.versions.filter(row => row.projectFileId === p[0])).map(row => fault === "version-readback" ? { ...row, version: 2 } : row), []];
      if (text.startsWith("SELECT *,CAST(afterSnapshot")) return [structuredClone(draft.audits.filter(row => row.auditId === p[0])).map(row => fault === "audit-readback" ? { ...row, actorRole: "foreign" }
        : fault === "json-reordered" ? { ...row, afterSnapshotText: reorderedJson(row.afterSnapshotText), metadataText: reorderedJson(row.metadataText) } : row), []];
      if (text.startsWith("INSERT INTO ai_jobs ")) {
        if (draft.jobs.some(row => row.runId === p[0])) throw { errno: 1062 };
        draft.jobs.push({ runId: p[0], kind: p[1], module: p[2], procedure: p[3], workspaceId: p[4], userId: p[5], projectId: p[6], skillSlug: p[7], input: p[8], status: "queued", progress: 0, attempt: 0, maxAttempts: 1, timeoutSeconds: 600, lockedBy: null, leaseUntil: null, createdAt: new Date("2026-10-16T00:00:00Z") });
        return ack();
      }
      if (text.startsWith("UPDATE ai_jobs SET input=")) {
        const row = draft.jobs.find(row => row.runId === p[p.length - 3])!;
        if (!row || row.status !== "running" || row.lockedBy !== p[p.length - 2] || row.attempt !== p.at(-1)
          || new Date(row.leaseUntil).getTime() <= Date.now()) return [{ affectedRows: 0, warningStatus: 0 }, []];
        const value = JSON.parse(p[0] as string);
        if (value.checkpoint.stage === "analysis_ready" && fault === "checkpoint") throw new Error("private SQL data");
        row.input = p[0];
        if (text.includes("status='succeeded'")) {
          if (fault === "receipt") throw new Error("private SQL data");
          Object.assign(row, { status: "succeeded", progress: 100, output: p[1], lockedBy: null, leaseUntil: null });
        }
        return ack();
      }
      if (text.startsWith("UPDATE ai_jobs SET status='queued'")) {
        Object.assign(draft.jobs.find(row => row.runId === p[1])!, { status: "queued", progress: p[0], lockedBy: null, leaseUntil: null });
        return ack();
      }
      if (text.startsWith("INSERT INTO projectFiles ")) {
        if (fault === "file") throw new Error("private SQL data");
        const id = draft.files.length + 101;
        draft.files.push({ id, workspaceId: p[0], projectId: p[1], userId: p[2], fileType: "product_attributes", status: "completed", filename: p[3], fileSize: p[4], rawContentHash: p[5], parsedDataHash: p[6], rawContent: p[7], parsedData: p[8], analysisResult: p[9] });
        return ack(id);
      }
      if (text.startsWith("INSERT INTO ai_artifacts ")) {
        if (fault === "artifact" && draft.artifacts.length === 1) throw new Error("private SQL data");
        draft.artifacts.push({ workspaceId: p[0], artifactId: p[1], artifactKey: p[2], artifactType: p[3], sourceType: p[4], sourceId: p[5], sourceTable: "projectFiles", sourceRowId: p[6], runId: p[7], nodeId: null, domain: "listing", status: "final", isCurrent: 1, version: 1, storageUri: null, storageObjectId: null, projectId: p[8], userId: p[9], selectedBy: p[10], contentJson: p[11], contentJsonText: p[11], contentHash: p[12], sourceSkillRunId: p[17], sourceAiJobRunId: p[18] });
        return ack();
      }
      if (text.startsWith("UPDATE projectFiles SET analysisArtifactId")) { draft.files.find(row => row.id === p[1])!.analysisArtifactId = p[0]; return ack(); }
      if (text.startsWith("INSERT INTO analysisVersions ")) {
        if (fault === "version") throw new Error("private SQL data");
        draft.versions.push({ projectFileId: p[0], userId: p[1], version: 1, analysisResult: p[2], changeType: "auto_analysis" }); return ack();
      }
      if (text.startsWith("INSERT INTO security_audit_logs ")) {
        if (fault === "audit") throw new Error("private audit data");
        draft.audits.push({ auditId: p[0], workspaceId: p[1], actorUserId: p[2], actorRole: p[3], action: "file.import_from_profile", resourceType: "file", resourceId: p[4], resourceName: p[5], projectId: p[6], agentRunId: p[7], toolSlug: "analysis.rufus.attribute", status: "success", riskLevel: "medium", ipAddress: null, userAgent: null, requestId: null, reason: null, beforeSnapshot: null, afterSnapshotText: p[8], metadataText: p[9] }); return ack();
      }
      throw new Error(`Unexpected SQL: ${text}`);
    } };
  }
  const database: ProfileImportDatabase = { ...executor(state), transaction: callback => {
    const result = queue.then(async () => {
      transaction++;
      const draft = structuredClone(state), result = await callback(executor(draft));
      Object.assign(state, draft); return result;
    }); queue = result.then(() => undefined, () => undefined); return result;
  } };
  const permission = vi.fn(async () => { if (deny) throw new TRPCError({ code: "FORBIDDEN", message: "denied" }); });
  const source = vi.fn(async (_ctx: TrpcContext, request: { expectedSourceHash?: string }, options: unknown) => {
    expect(options).toMatchObject({ lock: "share", executor: { execute: expect.any(Function) } });
    if (!sourceAllowed) throw new TRPCError({ code: "NOT_FOUND", message: "source denied" });
    if (request.expectedSourceHash !== undefined && request.expectedSourceHash !== currentHash) throw new TRPCError({ code: "CONFLICT", message: "source changed" });
    return { project: { id: 21, name: "产品", updatedAt: new Date("2026-10-16T00:00:00Z") }, profile: { id: 31, mainFunctions: JSON.stringify({ zero: 0, active: false }), updatedAt: new Date("2026-10-16T00:00:00Z") }, sourceHash: currentHash };
  });
  const ensureAgent = vi.fn(async () => "real-synthetic-agent"), schedule = vi.fn(async () => undefined);
  const snapshot = vi.fn(async () => ({ status: "Released", version: "4", systemPromptLength: 100, systemPromptHash: "b".repeat(64) }));
  const skill = vi.fn(async (request: any) => {
    await modelHook?.();
    const parsed = request.validate('{"coreSpecs":[],"enabled":false,"value":0}');
    return { runId: "synthetic-skill", parsed };
  });
  const service = createProfileImportJobService({ repository: createProfileImportJobRepository(async () => database),
    source: sourceOverride ?? source as any, permission, ensureAgent, schedule: schedule as any, snapshot: snapshot as any,
    skill: skill as any, queued: vi.fn(async () => undefined), waiting: vi.fn(async () => undefined) });
  const start = () => service.start(context(), input);
  function claim() {
    const row = state.jobs[0]; Object.assign(row, { status: "running", lockedBy: "worker", leaseUntil: new Date(Date.now() + 600000), attempt: row.attempt + 1 });
    return { ...structuredClone(row), input: JSON.parse(row.input) } as any;
  }
  const run = () => service.run(claim(), { signal: controller.signal });
  function failed() { Object.assign(state.jobs[0], { status: "failed", lockedBy: null, leaseUntil: null }); }
  const get = () => service.get(context(), { listingProjectId: 11, expectedWorkspaceId: 7, runId: state.jobs[0].runId });
  const resume = () => service.resume(context(), { listingProjectId: 11, expectedWorkspaceId: 7, runId: state.jobs[0].runId, expectedSourceHash: sourceHash });
  return { state, database, trace, permission, source, ensureAgent, schedule, snapshot, skill, service, start, run, claim, failed, get, resume, controller,
    setFault: (value: string) => { fault = value; }, deny: () => { deny = true; }, revokeSource: () => { sourceAllowed = false; },
    changeSource: () => { currentHash = "c".repeat(64); }, onModel: (hook: typeof modelHook) => { modelHook = hook; }, onWrite: (hook: typeof writeHook) => { writeHook = hook; },
    setAgentStatus: (value: string) => { agentStatus = value; }, setNodeStatus: (value: string) => { nodeStatus = value; } };
}

/** Actual source-access helper over in-memory table reads, including assignments. */
function realSourceFixture() {
  const date = new Date("2026-10-16T00:00:00Z");
  const tables: Record<string, Row[]> = {
    dev_projects: [21, 22].map(id => ({ id, workspaceId: 7, userId: 8, name: `source-${id}`, updatedAt: date })),
    project_assignments: [21, 22].map(projectId => ({ projectId, projectType: "dev_project", assignedUserId: 3, workspaceId: 7 })),
    dev_product_profiles: [21, 22].map(projectId => ({ id: projectId + 10, projectId, workspaceId: null, userId: 8, mainFunctions: "人工属性", updatedAt: date })),
  };
  let missingSchema = false;
  function executor(base: object = {}) {
    return { ...base, select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => ({ where: (condition: SQL) => ({ limit: (maximum: number) => {
      const name = getTableName(table), projectId = dialect.sqlToQuery(condition).params[0];
      const read = async () => {
        if (missingSchema) throw { errno: 1146 };
        return structuredClone(tables[name].filter(row => (name === "dev_projects" ? row.id : row.projectId) === projectId).slice(0, maximum));
      };
      return { for: read, then: (resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) => read().then(resolve, reject) };
    } }) }) }) };
  }
  const source: typeof loadProfileImportSource = (ctx, request, options) => loadProfileImportSource(ctx, request, { ...options, executor: executor(options?.executor) });
  return { source, tables, preview: (devProjectId: number) => source(context(), { devProjectId, expectedWorkspaceId: 7 }),
    failSchema: () => { missingSchema = true; } };
}

describe("durable selected product profile conversion", () => {
  it("persists one anchor; worker uses published Rufus once and atomically commits one file/version + complete inline artifacts", async () => {
    const d = fixture(), queued = await d.start(); expect(queued.stage).toBe("reserved"); expect(d.skill).not.toHaveBeenCalled();
    const reserveSql = d.trace.find(row => row.sql.startsWith("INSERT INTO ai_jobs "))!.sql;
    expect(reserveSql).toContain("(runId,kind,module,`procedure`,workspaceId");
    expect(reserveSql).not.toMatch(/[, (]procedure[, )]/);
    const result = await d.run(); expect(result).toMatchObject({ status: "succeeded", stage: "file_committed", fileId: 101, canResume: false });
    expect(d.skill).toHaveBeenCalledTimes(1); expect(d.skill.mock.calls[0][0]).toMatchObject({ userId: 3, workspaceId: 7, projectId: 11, skillSlug: "analysis.rufus.attribute", maxModelAttempts: 1, fallbackModels: [], skillVersionPolicy: "pinned", signal: d.controller.signal });
    expect(d.state.files).toHaveLength(1); expect(d.state.versions).toHaveLength(1); expect(d.state.artifacts).toHaveLength(3);
    expect(d.state.audits).toHaveLength(1); expect(d.state.audits[0]).toMatchObject({ action: "file.import_from_profile", actorRole: "ops_specialist", status: "success" });
    expect(JSON.stringify(d.state.audits)).not.toContain("coreSpecs");
    expect(d.state.artifacts.map(row => row.sourceAiJobRunId)).toEqual([queued.runId, queued.runId, queued.runId]);
    expect(d.state.artifacts.every(row => row.runId === null && row.nodeId === null)).toBe(true);
    const raw = JSON.parse(d.state.artifacts[0].contentJson); expect(raw).toContain("zero: 0"); expect(raw).toContain("active: false");
    expect(JSON.parse(d.state.files[0].parsedData).provenance).toMatchObject({ sourceHash, profileId: 31, devProjectId: 21, aiSuggestionsIncluded: false, factReviewRequired: true });
    expect(JSON.parse(d.state.files[0].analysisResult)).toMatchObject({ enabled: false, value: 0 });
    expect(d.permission).toHaveBeenCalledWith(expect.objectContaining({ resource: "file", action: "import", authorizationRead: { executor: expect.anything(), strict: true, lock: true } }));
    expect(await d.start()).toMatchObject({ runId: queued.runId, fileId: 101 }); expect(d.state.files).toHaveLength(1); expect(d.skill).toHaveBeenCalledTimes(1);
  });
  it("concurrent duplicate requests converge on the deterministic original runId", async () => {
    const d = fixture(); const [a, b] = await Promise.all([d.start(), d.start()]);
    expect(a.runId).toBe(b.runId); expect(d.state.jobs).toHaveLength(1); expect(d.skill).not.toHaveBeenCalled();
  });
  it.each(["file", "artifact", "version", "receipt", "audit"])("%s failure rolls back all file writes and resumes cached analysis on the same anchor with no second AI", async fault => {
    const d = fixture(), initial = await d.start(); d.setFault(fault); await expect(d.run()).rejects.toThrow("PROFILE_IMPORT_STORAGE_FAILED"); d.failed();
    expect(d.state.files).toEqual([]); expect(d.state.artifacts).toEqual([]); expect(d.state.versions).toEqual([]); expect(d.state.audits).toEqual([]);
    expect((await d.get())).toMatchObject({ stage: "analysis_ready", canResume: true }); d.setFault("");
    expect(await d.resume()).toMatchObject({ runId: initial.runId, status: "queued", stage: "analysis_ready" });
    expect(await d.run()).toMatchObject({ fileId: 101, status: "succeeded" }); expect(d.skill).toHaveBeenCalledTimes(1); expect(d.state.jobs).toHaveLength(1);
  });
  it("dispatch/result checkpoint ACK uncertainty cannot repeat the model on restart or explicit resume", async () => {
    const d = fixture(); await d.start(); d.setFault("checkpoint"); await expect(d.run()).rejects.toThrow(); d.failed();
    expect(await d.get()).toMatchObject({ stage: "model_result_unknown", canResume: false });
    await expect(d.resume()).rejects.toThrow("PROFILE_IMPORT_RESUME_UNSAFE"); await expect(d.run()).rejects.toThrow("PROFILE_IMPORT_MODEL_RESULT_UNKNOWN");
    expect(d.skill).toHaveBeenCalledTimes(1); expect(d.state.files).toEqual([]);
  });
  it("known pre-model failure remains reserved and resumes without replacing the anchor", async () => {
    const d = fixture(), first = await d.start(); d.snapshot.mockResolvedValueOnce({ status: "Draft" } as any);
    await expect(d.run()).rejects.toThrow("PROFILE_IMPORT_SKILL_NOT_RELEASED"); d.failed(); expect(d.skill).not.toHaveBeenCalled();
    expect(await d.resume()).toMatchObject({ runId: first.runId, stage: "reserved" }); await d.run(); expect(d.skill).toHaveBeenCalledTimes(1);
  });
  it.each(["status", "workspace", "target", "permission", "source", "hash"])("%s changed while queued refuses before model or file writes", async change => {
    const d = fixture(); await d.start();
    if (change === "status") d.state.users[0].status = "disabled";
    if (change === "workspace") d.state.users[0].defaultWorkspaceId = 8;
    if (change === "target") d.state.targets[0].workspaceId = 8;
    if (change === "permission") d.deny(); if (change === "source") d.revokeSource(); if (change === "hash") d.changeSource();
    await expect(d.run()).rejects.toThrow(); expect(d.skill).not.toHaveBeenCalled(); expect(d.state.files).toEqual([]);
  });
  it.each(["hash", "permission", "source", "disabled", "abort"])("%s changed during model prevents any file/version write", async change => {
    const d = fixture(); await d.start(); d.onModel(() => {
      if (change === "hash") d.changeSource(); if (change === "permission") d.deny(); if (change === "source") d.revokeSource();
      if (change === "disabled") d.state.users[0].status = "disabled"; if (change === "abort") d.controller.abort();
    });
    await expect(d.run()).rejects.toThrow(); expect(d.skill).toHaveBeenCalledTimes(1); expect(d.state.files).toEqual([]);
  });
  it("abort after actual version write rolls back file/artifacts/version and keeps analysis_ready", async () => {
    const d = fixture(); await d.start(); d.onWrite(text => { if (text.startsWith("INSERT INTO analysisVersions")) d.controller.abort(); });
    await expect(d.run()).rejects.toThrow("PROFILE_IMPORT_LEASE_LOST"); expect(d.state.files).toEqual([]); expect(d.state.versions).toEqual([]);
    expect(JSON.parse(d.state.jobs[0].input).checkpoint.stage).toBe("analysis_ready");
  });
  it.each(["worker", "attempt", "lease", "status"])("stale %s claim is rejected", async field => {
    const d = fixture(); await d.start(); const job = d.claim();
    if (field === "worker") d.state.jobs[0].lockedBy = "other"; if (field === "attempt") d.state.jobs[0].attempt++;
    if (field === "lease") d.state.jobs[0].leaseUntil = new Date(0); if (field === "status") d.state.jobs[0].status = "failed";
    await expect(d.service.run(job, { signal: d.controller.signal })).rejects.toThrow("PROFILE_IMPORT_LEASE_LOST"); expect(d.skill).not.toHaveBeenCalled();
  });
  it.each([7, null])("legacy NULL owned target remains allowed in authenticated workspace %s", async workspaceId => {
    const d = fixture(); d.state.targets[0].workspaceId = null; d.state.users[0].defaultWorkspaceId = workspaceId;
    const ctx = context(); ctx.workspaceId = workspaceId; ctx.user!.defaultWorkspaceId = workspaceId;
    expect(await d.service.start(ctx, { ...input, expectedWorkspaceId: workspaceId })).toMatchObject({ workspaceId, stage: "reserved" });
  });
  it.each(["owner", "target", "permission", "sourceHash", "source"])("initial %s refusal has zero Agent/job/model creation", async failure => {
    const d = fixture(); if (failure === "owner") d.state.targets[0].userId = 88; if (failure === "target") d.state.targets[0].workspaceId = 8;
    if (failure === "permission") d.deny(); if (failure === "sourceHash") d.changeSource(); if (failure === "source") d.revokeSource();
    await expect(d.start()).rejects.toThrow(); expect(d.ensureAgent).not.toHaveBeenCalled(); expect(d.state.jobs).toEqual([]); expect(d.skill).not.toHaveBeenCalled();
  });
  it("workspace drift rejects before repository work and read DTO never exposes checkpoint content/errors", async () => {
    const d = fixture(); await expect(d.service.start(context(), { ...input, expectedWorkspaceId: 8 })).rejects.toThrow(); expect(d.trace).toEqual([]);
    await d.start(); await d.run(); const dto = await d.get();
    expect(Object.keys(dto).sort()).toEqual(["runId", "listingProjectId", "workspaceId", "userId", "devProjectId", "sourceHash", "status", "progress", "stage", "fileId", "canResume", "message", "createdAt"].sort());
    expect(JSON.stringify(dto)).not.toContain("coreSpecs"); expect(await d.service.list(context(), { listingProjectId: 11, expectedWorkspaceId: 7 })).toEqual([dto]);
  });
  it("JSON persistence restart keeps exact binding and checkpoint; completed receipt is not replayed", async () => {
    const d = fixture(); await d.start(); await d.run(); const before = structuredClone(d.state);
    expect(await d.resume()).toMatchObject({ stage: "file_committed", fileId: 101 }); expect(d.state).toEqual(before); expect(d.skill).toHaveBeenCalledTimes(1);
  });
  it("MySQL JSON key ordering does not change checkpoint, receipt, artifact or audit semantic readback", async () => {
    const d = fixture(); d.setFault("json-reordered"); await d.start(); expect(await d.run()).toMatchObject({ status: "succeeded" });
    expect(await d.get()).toMatchObject({ fileId: 101 }); expect(d.state.files).toHaveLength(1); expect(d.state.audits).toHaveLength(1);
  });
  it("model and persisted complete raw text share the existing LF/trim fact-source hash convention", async () => {
    const d = fixture(), original = d.source.getMockImplementation()!;
    d.source.mockImplementation(async (...args) => { const loaded = await original(...args); loaded.profile.mainFunctions = " 真实属性\r\n第二行\r第三行 "; return loaded; });
    await d.start(); await d.run();
    const raw = JSON.parse(d.state.artifacts[0].contentJson);
    expect(raw).toBe(raw.replace(/\r\n?/gu, "\n").trim());
    expect(d.skill.mock.calls[0][0].context).toBe(raw);
    expect(d.state.files[0].rawContentHash).toBe(profileImportHash(JSON.stringify(raw.replace(/\r\n?/gu, "\n").trim())));
    expect(d.state.files[0].rawContent).toBe(raw);
  });
  it("missing transaction refuses before any query or Agent work", async () => {
    const d = fixture(); delete d.database.transaction; await expect(d.start()).rejects.toThrow("PROFILE_IMPORT_TRANSACTION_REQUIRED"); expect(d.trace).toEqual([]); expect(d.ensureAgent).not.toHaveBeenCalled();
  });
  it.each(["file-readback", "artifact-readback", "version-readback", "audit-readback"])("%s mismatch rolls back the entire file transaction", async fault => {
    const d = fixture(); await d.start(); d.setFault(fault); await expect(d.run()).rejects.toThrow();
    expect(d.state.files).toEqual([]); expect(d.state.versions).toEqual([]); expect(d.state.artifacts).toEqual([]);
    expect(JSON.parse(d.state.jobs[0].input).checkpoint.stage).toBe("analysis_ready");
  });
  it("missing schema is not empty data and cannot initialize a job", async () => {
    const d = fixture(); d.setFault("missing-schema"); await expect(d.start()).rejects.toThrow("PROFILE_IMPORT_SCHEMA_UNAVAILABLE"); expect(d.ensureAgent).not.toHaveBeenCalled();
  });
  it("a missing real N3 checkpoint is refused before model", async () => {
    const d = fixture(); await d.start(); d.setFault("missing-node"); await expect(d.run()).rejects.toThrow("PROFILE_IMPORT_AGENT_BINDING_INVALID"); expect(d.skill).not.toHaveBeenCalled();
  });
  it("all mixed transactions acquire job locks before user/target/authorization locks, including list", async () => {
    const d = fixture(); await d.start(); await d.run(); await d.start(); await d.get(); await d.service.list(context(), { listingProjectId: 11, expectedWorkspaceId: 7 });
    for (const transaction of new Set(d.trace.map(row => row.transaction))) {
      const statements = d.trace.filter(row => row.transaction === transaction).map(row => row.sql), job = statements.findIndex(text => text.startsWith("SELECT * FROM ai_jobs"));
      const auth = statements.findIndex(text => text.startsWith("SELECT * FROM users"));
      if (job >= 0 && auth >= 0) expect(job).toBeLessThan(auth);
      const agent = statements.findIndex(text => text.startsWith("SELECT runId,agentSlug"));
      if (agent >= 0) expect(auth).toBeLessThan(agent);
    }
  });
  it("source changes between analysis persistence and final file transaction prevent writes", async () => {
    const d = fixture(); await d.start(); let checkpoint = 0;
    d.onWrite(text => { if (text.startsWith("UPDATE ai_jobs SET input=") && ++checkpoint === 2) d.changeSource(); });
    await expect(d.run()).rejects.toThrow("source changed"); expect(d.state.files).toEqual([]); expect(d.skill).toHaveBeenCalledTimes(1);
    expect(JSON.parse(d.state.jobs[0].input).checkpoint.stage).toBe("analysis_ready");
  });
  it("provider errors, including arbitrary TRPC errors, never return raw response text", async () => {
    const d = fixture(); await d.start(); d.onModel(() => { throw new TRPCError({ code: "BAD_REQUEST", message: "PRIVATE_PROVIDER_BODY" }); });
    await expect(d.run()).rejects.toThrow("PROFILE_IMPORT_MODEL_FAILED_REVIEW_REQUIRED"); expect(d.state.files).toEqual([]);
  });
  it("canceled-before-dispatch recovery keeps the same operation id and checkpoint", async () => {
    const d = fixture(), first = await d.start(); d.state.jobs[0].status = "canceled";
    expect(await d.resume()).toMatchObject({ runId: first.runId, stage: "reserved", status: "queued" }); await d.run(); expect(d.skill).toHaveBeenCalledTimes(1);
  });
  it("unknown public input keys cannot inject browser checkpoint or Agent identity", async () => {
    const d = fixture(); await expect(d.service.start(context(), { ...input, checkpoint: {} } as any)).rejects.toThrow(); expect(d.trace).toEqual([]);
  });
  it.each(["agent", "node"])("canceled %s while queued rejects before model", async target => {
    const d = fixture(); await d.start(); (target === "agent" ? d.setAgentStatus : d.setNodeStatus)("canceled");
    await expect(d.run()).rejects.toThrow("PROFILE_IMPORT_AGENT_CANCELED"); expect(d.skill).not.toHaveBeenCalled(); expect(d.state.files).toEqual([]);
  });
  it.each(["agent", "node"])("canceled %s during model prevents result checkpoint/file commit", async target => {
    const d = fixture(); await d.start(); d.onModel(() => (target === "agent" ? d.setAgentStatus : d.setNodeStatus)("canceled"));
    await expect(d.run()).rejects.toThrow("PROFILE_IMPORT_AGENT_CANCELED"); expect(d.skill).toHaveBeenCalledTimes(1);
    expect(d.state.files).toEqual([]); expect(d.state.audits).toEqual([]); expect(JSON.parse(d.state.jobs[0].input).checkpoint.stage).toBe("model_dispatched");
  });
  it("parent cancel between analysis checkpoint and final transaction cannot commit a file", async () => {
    const d = fixture(); await d.start(); let checkpoints = 0;
    d.onWrite(text => { if (text.startsWith("UPDATE ai_jobs SET input=") && ++checkpoints === 2) d.setAgentStatus("canceled"); });
    await expect(d.run()).rejects.toThrow("PROFILE_IMPORT_AGENT_CANCELED"); expect(d.state.files).toEqual([]);
    expect(JSON.parse(d.state.jobs[0].input).checkpoint.stage).toBe("analysis_ready"); expect(d.skill).toHaveBeenCalledTimes(1);
  });
  it("paused parent is not a new cancellation or status policy", async () => {
    const d = fixture(); await d.start(); d.setAgentStatus("paused"); expect(await d.run()).toMatchObject({ status: "succeeded" });
  });
  it.each(["assignment", "deleted-parent", "missing-profile"])("list hides historical %s source but preserves another authorized task; get remains denied", async failure => {
    const sources = realSourceFixture(), d = fixture(sources.source);
    const hashes = await Promise.all([sources.preview(21), sources.preview(22)]);
    const old = await d.service.start(context(), { ...input, expectedSourceHash: hashes[0].sourceHash! });
    const current = await d.service.start(context(), { ...input, devProjectId: 22, expectedSourceHash: hashes[1].sourceHash! });
    if (failure === "assignment") sources.tables.project_assignments = sources.tables.project_assignments.filter(row => row.projectId !== 21);
    if (failure === "deleted-parent") sources.tables.dev_projects = sources.tables.dev_projects.filter(row => row.id !== 21);
    if (failure === "missing-profile") sources.tables.dev_product_profiles = sources.tables.dev_product_profiles.filter(row => row.projectId !== 21);
    const listed = await d.service.list(context(), { listingProjectId: 11, expectedWorkspaceId: 7 });
    expect(listed.map(row => row.runId)).toEqual([current.runId]); expect(JSON.stringify(listed)).not.toContain(old.runId);
    await expect(d.service.get(context(), { listingProjectId: 11, expectedWorkspaceId: 7, runId: old.runId })).rejects.toThrow();
    expect(await d.service.start(context(), { ...input, devProjectId: 22, expectedSourceHash: hashes[1].sourceHash! })).toMatchObject({ runId: current.runId });
  });
  it("list does not turn a source schema failure into an empty or partially visible history", async () => {
    const sources = realSourceFixture(), d = fixture(sources.source), preview = await sources.preview(21);
    await d.service.start(context(), { ...input, expectedSourceHash: preview.sourceHash! }); sources.failSchema();
    await expect(d.service.list(context(), { listingProjectId: 11, expectedWorkspaceId: 7 })).rejects.toThrow("PROFILE_IMPORT_SCHEMA_UNAVAILABLE");
  });
  it.each(["target", "permission", "actor"])("list still rejects initial %s authorization before checking sources", async failure => {
    const d = fixture(); await d.start(); d.source.mockClear();
    if (failure === "target") d.state.targets[0].workspaceId = 8;
    if (failure === "permission") d.deny();
    if (failure === "actor") d.state.users[0].status = "disabled";
    await expect(d.service.list(context(), { listingProjectId: 11, expectedWorkspaceId: 7 })).rejects.toThrow(); expect(d.source).not.toHaveBeenCalled();
  });
  it.each(["agent", "node"])("get/list expose canceled %s as non-resumable while resume/run still refuse", async target => {
    const d = fixture(); await d.start(); d.failed(); (target === "agent" ? d.setAgentStatus : d.setNodeStatus)("canceled");
    expect(await d.get()).toMatchObject({ canResume: false, message: "所属 Agent 已取消，不能恢复任务" });
    expect(await d.service.list(context(), { listingProjectId: 11, expectedWorkspaceId: 7 })).toEqual([await d.get()]);
    await expect(d.resume()).rejects.toThrow("PROFILE_IMPORT_AGENT_CANCELED"); await expect(d.run()).rejects.toThrow("PROFILE_IMPORT_AGENT_CANCELED");
    expect(d.skill).not.toHaveBeenCalled(); expect(d.state.files).toEqual([]);
  });
});

describe("source helper transaction extension keeps the original caller contract", () => {
  function sourceExecutor() {
    const locks: string[] = [];
    const rows: Record<string, unknown[]> = {
      dev_projects: [{ id: 21, workspaceId: 7, userId: 8, name: "source" }],
      project_assignments: [{ projectId: 21, projectType: "dev_project", assignedUserId: 3, workspaceId: 7 }],
      dev_product_profiles: [{ id: 31, projectId: 21, workspaceId: null, userId: 8 }],
    };
    const executor = { select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => {
      const name = getTableName(table);
      return { where: () => ({ limit: () => ({
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(rows[name] ?? [])),
        for: (kind: string) => { locks.push(`${name}:${kind}`); return Promise.resolve(rows[name] ?? []); },
      }) }) };
    } }) };
    return { executor, locks, rows };
  }
  it("locks parent, assignment and profile using the supplied transaction, preserving NULL child inheritance", async () => {
    const d = sourceExecutor(); const result = await loadProfileImportSource(context(), { devProjectId: 21, expectedWorkspaceId: 7 }, { executor: d.executor, lock: "share" });
    expect(result.profile?.id).toBe(31); expect(d.locks).toEqual(["dev_projects:share", "project_assignments:share", "dev_product_profiles:share"]);
  });
  it("an executor without requested locks retains the old read-only query behavior", async () => {
    const d = sourceExecutor(); expect((await loadProfileImportSource(context(), { devProjectId: 21 }, { executor: d.executor })).profile?.id).toBe(31); expect(d.locks).toEqual([]);
  });
  it("lock mode without a transaction fails before opening a database", async () => {
    await expect(loadProfileImportSource(context(), { devProjectId: 21 }, { lock: "share" })).rejects.toThrow("来源锁需要真实事务");
  });
});
