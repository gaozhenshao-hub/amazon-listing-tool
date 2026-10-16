import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../../../_core/context";
import type { CompetitorAnalysis } from "../../../../drizzle/schema/project";
import { COMPETITOR_RESEARCH_JOB_KIND } from "../../../../shared/competitorResearchJob";
import { competitorRevision } from "../../../repositories/project/competitorWritePolicy";
import { createCompetitorResearchJobRepository, type CompetitorResearchDatabase } from "../../../repositories/listing/competitorResearchJobRepository";
vi.mock("../../ai_os/services/skillRunner", () => ({ getEmperorSkillRuntimeSnapshot: vi.fn(), runEmperorSkill: vi.fn() }));
vi.mock("../../ai_os/services/jobRunner", () => ({ registerAiJobHandler: vi.fn(), scheduleAiJobRun: vi.fn() }));
vi.mock("../listingAgentBridge", () => ({ ensureListingAgentRun: vi.fn() }));
vi.mock("../../../services/securityGovernance", () => ({ assertResourceAction: vi.fn() }));
import { createCompetitorResearchJobService } from "./competitorResearchJob";
import { buildCompetitorResearchSource } from "./competitorResearchSource";
import { buildSellingPointPlanningResearch } from "./sellingPointPlanning";

type Row = Record<string, any>;
type State = { jobs: Row[]; users: Row[]; projects: Row[]; analyses: CompetitorAnalysis[]; artifacts: Row[]; audits: Row[] };
const date = new Date("2026-10-16T00:00:00Z");
function analysis(overrides: Partial<CompetitorAnalysis> = {}): CompetitorAnalysis {
  return { id: 21, projectId: 11, asin: "B000000001", title: "Saved competitor title", bulletPoints: '["Saved bullet"]', imageUrls: null,
    price: "0", rating: "4.2", reviewCount: "0", reviewAnalysis: '{"painPoints":[]}', keywords: null,
    rawData: '{"captureOnly":true,"analysisStale":true,"sellerSpriteData":{"monthlySales":0,"hasAplus":false}}',
    summary: "Prior AI", aiSummary: "Prior AI", summaryStatus: "draft", summaryVersion: 1, summaryConfirmedBy: null, summaryConfirmedAt: null,
    createdAt: date, updatedAt: date, ...overrides };
}
const dialect = new MySqlDialect();
/** Real service + source builder + raw-SQL repository; only transactions/DB, policies,
 * Agent creation, scheduler and provider are modeled. This is not MySQL acceptance. */
function fixture() {
  const state: State = { jobs: [], users: [{ id: 3, status: "active", role: "ops_specialist", defaultWorkspaceId: 7 }], projects: [{ id: 11, userId: 3, workspaceId: 7 }], analyses: [analysis()], artifacts: [], audits: [] };
  const trace: Array<{ sql: string; params: unknown[]; transaction: number }> = [];
  let fault = "", agentStatus = "waiting_human", nodeStatus = "waiting_human", transaction = 0, queue = Promise.resolve<unknown>(undefined);
  let hook: (() => void | Promise<void>) | undefined, writeHook: ((text: string, state: State) => void) | undefined;
  let beforeTransaction: ((next: number) => void | Promise<void>) | undefined;
  const controller = new AbortController();
  const executeFor = (draft: State) => ({ async execute(statement: SQL) {
    const { sql: text, params: p } = dialect.sqlToQuery(statement); trace.push({ sql: text, params: p, transaction });
    if (fault === "schema") throw { errno: 1146, message: "PRIVATE" };
    const ack = () => [{ affectedRows: 1, warningStatus: fault === "warning" ? 1 : 0 }, []];
    writeHook?.(text, draft);
    if (text.startsWith("SELECT * FROM users")) return [structuredClone(draft.users.filter(r => r.id === p[0])), []];
    if (text.startsWith("SELECT * FROM projects")) return [structuredClone(draft.projects.filter(r => r.id === p[0])), []];
    if (text.startsWith("SELECT * FROM competitorAnalyses")) return [structuredClone(draft.analyses.filter(r => r.projectId === p[0] && r.id === p[1])), []];
    if (text.startsWith("SELECT * FROM ai_jobs WHERE runId")) return [structuredClone(draft.jobs.filter(r => r.runId === p[0])), []];
    if (text.startsWith("SELECT * FROM ai_jobs WHERE userId")) return [structuredClone(draft.jobs.filter(r => r.userId === p[0] && r.workspaceId === p[1] && r.projectId === p[2] && r.kind === p[3])), []];
    if (text.startsWith("SELECT runId,agentSlug")) return [[{ runId: p[0], agentSlug: "listing.full.workflow", userId: 3, workspaceId: draft.users[0].defaultWorkspaceId, projectId: 11, status: agentStatus }], []];
    if (text.startsWith("SELECT runId,nodeId")) return [fault === "node" ? [] : [{ runId: p[0], nodeId: "N1", workspaceId: draft.users[0].defaultWorkspaceId, status: nodeStatus }], []];
    if (text.startsWith("SELECT *,CAST(contentJson")) return [structuredClone(draft.artifacts.filter(r => r.sourceAiJobRunId === p[0])).map(r => fault === "artifact-readback" ? { ...r, isCurrent: 1 } : r), []];
    if (text.startsWith("SELECT *,CAST(afterSnapshot")) return [structuredClone(draft.audits.filter(r => r.auditId === p[0])).map(r => fault === "audit-readback" ? { ...r, actorRole: "wrong" } : r), []];
    if (text.startsWith("INSERT INTO ai_jobs")) {
      if (draft.jobs.some(r => r.runId === p[0])) throw { errno: 1062 };
      draft.jobs.push({ runId: p[0], kind: p[1], module: p[2], procedure: p[3], workspaceId: p[4], userId: p[5], projectId: p[6], skillSlug: p[7], input: p[8], output: null,
        status: "queued", progress: 0, attempt: 0, maxAttempts: 1, timeoutSeconds: 600, lockedBy: null, leaseUntil: null, createdAt: date }); return ack();
    }
    if (text.startsWith("UPDATE ai_jobs SET input=")) {
      const row = draft.jobs.find(r => r.runId === p.at(-3));
      if (!row || row.status !== "running" || row.lockedBy !== p.at(-2) || row.attempt !== p.at(-1) || new Date(row.leaseUntil).getTime() <= Date.now()) return [{ affectedRows: 0, warningStatus: 0 }, []];
      const input = JSON.parse(String(p[0]));
      if (fault === "checkpoint" && input.checkpoint.stage === "analysis_ready") throw new Error("PRIVATE");
      if (fault === "receipt" && input.checkpoint.stage === "analysis_committed") throw new Error("PRIVATE");
      row.input = p[0];
      if (text.includes("status='succeeded'")) Object.assign(row, { status: "succeeded", progress: 100, output: p[1], lockedBy: null, leaseUntil: null });
      return ack();
    }
    if (text.startsWith("UPDATE ai_jobs SET status='queued'")) {
      const row = draft.jobs.find(r => r.runId === p[1] && r.status === p[2]);
      if (!row) return [{ affectedRows: 0, warningStatus: 0 }, []];
      Object.assign(row, { status: "queued", progress: p[0], lockedBy: null, leaseUntil: null }); return ack();
    }
    if (text.startsWith("UPDATE ai_jobs SET status='canceled'")) {
      const row = draft.jobs.find(r => r.runId === p[0] && r.status === p[1]);
      if (!row) return [{ affectedRows: 0, warningStatus: 0 }, []];
      Object.assign(row, { status: "canceled", lockedBy: null, leaseUntil: null }); return ack();
    }
    if (text.startsWith("UPDATE competitorAnalyses")) {
      if (fault === "analysis") throw new Error("PRIVATE");
      const row = draft.analyses.find(r => r.id === p[5] && r.projectId === p[6] && r.summaryStatus === "draft" && r.summaryVersion === p[7]);
      if (!row) return [{ affectedRows: 0, warningStatus: 0 }, []];
      Object.assign(row, { aiSummary: p[0], summary: p[1], keywords: p[2], rawData: p[3], summaryVersion: p[4], updatedAt: new Date(date.getTime() + 1000) }); return ack();
    }
    if (text.startsWith("INSERT INTO ai_artifacts")) {
      if (fault === "artifact") throw new Error("PRIVATE");
      draft.artifacts.push({ workspaceId: p[0], artifactId: p[1], artifactKey: p[2], sourceId: p[3], sourceRowId: p[4], projectId: p[5], userId: p[6], version: p[7], contentJsonText: p[8], contentHash: p[9], fileSizeBytes: p[10], metadata: p[11], sourceSkillRunId: p[12], sourceAiJobRunId: p[13], domain: "listing", artifactType: "json", sourceType: "ai_output", sourceTable: "competitorAnalyses", status: "draft", isCurrent: 0, runId: null, nodeId: null }); return ack();
    }
    if (text.startsWith("INSERT INTO security_audit_logs")) {
      if (fault === "audit") throw new Error("PRIVATE");
      draft.audits.push({ auditId: p[0], workspaceId: p[1], actorUserId: p[2], actorRole: p[3], resourceId: p[4], projectId: p[5], agentRunId: p[6], afterSnapshotText: p[7], metadata: p[8], action: "analysis.research" }); return ack();
    }
    throw new Error(`Unexpected SQL ${text}`);
  } });
  const database: CompetitorResearchDatabase = { ...executeFor(state), transaction: async callback => {
    await beforeTransaction?.(transaction + 1);
    const result = queue.then(async () => { transaction++; const draft = structuredClone(state); const result = await callback(executeFor(draft)); Object.assign(state, draft); return result; });
    queue = result.then(() => undefined, () => undefined); return result;
  } };
  const permission = vi.fn(async (request: any) => {
    trace.push({ sql: `POLICY ${request.action}`, params: [], transaction });
    expect(request).toMatchObject({ resource: "project", authorizationRead: { strict: true, lock: true, executor: { execute: expect.any(Function) } } });
  });
  const ensureAgent = vi.fn(async () => "synthetic-agent"), schedule = vi.fn(async () => undefined);
  const snapshot = vi.fn(async () => ({ status: "Released", version: "4", systemPromptLength: 5, systemPromptHash: "a".repeat(16), userPromptHash: "b".repeat(16), manifestHash: "c".repeat(16) }));
  let output = '{"summary":"New research","keywords":{"core":[],"longTail":[],"traffic":[]}}';
  const skill = vi.fn(async (request: any) => { await hook?.(); return { parsed: request.validate(output), runId: "synthetic-skill", skillSlug: "listing.competitor.analyze", skillVersion: "4", skillPromptHash: "a".repeat(16), skillManifestHash: "c".repeat(16) }; });
  const service = createCompetitorResearchJobService({ repository: createCompetitorResearchJobRepository(async () => database), permission, ensureAgent, schedule: schedule as any, snapshot: snapshot as any, skill: skill as any });
  const context = () => ({ user: { id: 3, role: "ops_specialist", defaultWorkspaceId: state.users[0].defaultWorkspaceId }, workspaceId: state.users[0].defaultWorkspaceId } as TrpcContext);
  const request = () => ({ projectId: 11, expectedWorkspaceId: state.users[0].defaultWorkspaceId, analysisId: 21, expectedRevision: competitorRevision(state.analyses[0]) });
  const op = () => ({ projectId: 11, expectedWorkspaceId: state.users[0].defaultWorkspaceId, runId: state.jobs[0].runId });
  const start = () => service.start(context(), request());
  function claim() { const row = state.jobs[0]; Object.assign(row, { status: "running", attempt: row.attempt + 1, lockedBy: "worker", leaseUntil: new Date(Date.now() + 600000) }); return { ...structuredClone(row), input: JSON.parse(row.input) } as any; }
  const run = () => service.run(claim(), { signal: controller.signal });
  const failed = () => Object.assign(state.jobs[0], { status: "failed", lockedBy: null, leaseUntil: null });
  return { state, trace, database, service, permission, ensureAgent, schedule, snapshot, skill, context, request, op, start, claim, run, failed, controller,
    fault: (value: string) => { fault = value; }, onModel: (value: typeof hook) => { hook = value; }, onWrite: (value: typeof writeHook) => { writeHook = value; },
    onBeforeTransaction: (value: typeof beforeTransaction) => { beforeTransaction = value; },
    output: (value: string) => { output = value; }, agent: (value: string) => { agentStatus = value; }, node: (value: string) => { nodeStatus = value; } };
}

describe("single competitor durable analysis with actual service/repository/source logic", () => {
  it("reserves without model; runs once with pin; commits draft/version/artifact/audit and preserves trusted source", async () => {
    const d = fixture(), before = structuredClone(d.state.analyses[0]), source = buildCompetitorResearchSource(before), queued = await d.start();
    expect(queued.stage).toBe("reserved"); expect(d.skill).not.toHaveBeenCalled();
    expect(d.trace.find(t => t.sql.startsWith("INSERT INTO ai_jobs"))?.sql).toContain("`procedure`");
    const done = await d.run(); expect(done.stage).toBe("analysis_committed"); expect(done.status).toBe("succeeded");
    expect(d.skill).toHaveBeenCalledOnce(); expect(d.skill.mock.calls[0][0]).toMatchObject({ skillSlug: "listing.competitor.analyze", userId: 3, workspaceId: 7, projectId: 11, skillVersionPolicy: "pinned", expectedSkillVersion: "4", expectedSkillPromptHash: "a".repeat(16), maxModelAttempts: 1, fallbackModels: [] });
    expect(d.state.analyses[0]).toMatchObject({ aiSummary: "New research", summary: "New research", summaryStatus: "draft", summaryVersion: 2, reviewAnalysis: before.reviewAnalysis });
    expect(JSON.parse(d.state.analyses[0].rawData!)).toMatchObject({ analysisStale: false, captureOnly: false, sellerSpriteData: { monthlySales: 0, hasAplus: false }, research: { sourceHash: source.sourceHash, jobRunId: queued.runId } });
    expect(buildCompetitorResearchSource(d.state.analyses[0]).sourceHash).toBe(source.sourceHash);
    expect(d.state.artifacts).toHaveLength(1); expect(d.state.artifacts[0]).toMatchObject({ isCurrent: 0, status: "draft", version: 2, runId: null, nodeId: null });
    expect(d.state.audits).toHaveLength(1);
    expect(d.trace.filter(t => /^INSERT INTO (ai_artifacts|security_audit_logs)|^UPDATE competitorAnalyses|^UPDATE ai_jobs SET input=.*status='succeeded'/u.test(t.sql)).map(t => t.transaction).every(v => v === d.trace.at(-1)!.transaction)).toBe(true);
    expect(d.trace.some(t => /UPDATE emperor_/u.test(t.sql))).toBe(false);
  });
  it("serializes duplicate starts into one deterministic anchor and reuses completed result", async () => {
    const d = fixture(); const [a, b] = await Promise.all([d.start(), d.start()]); expect(a.runId).toBe(b.runId); expect(d.state.jobs).toHaveLength(1);
    await d.run(); const previous = await d.start(); expect(previous.status).toBe("succeeded"); expect(d.skill).toHaveBeenCalledOnce(); expect(d.state.artifacts).toHaveLength(1);
  });
  it("requires current revision even when the source anchor already exists", async () => {
    const d = fixture(), request = d.request(); await d.start(); d.state.analyses[0].summary = "Human edit";
    await expect(d.service.start(d.context(), request)).rejects.toThrow("COMPETITOR_RESEARCH_REVISION_CHANGED"); expect(d.state.jobs).toHaveLength(1);
  });
  it("reuses a same-source success committed after prepare but before previous lookup", async () => {
    const d = fixture(); await d.start();
    d.onBeforeTransaction(async next => { if (next === 5) { d.onBeforeTransaction(undefined); await d.run(); } });
    const result = await d.start(); expect(result.status).toBe("succeeded"); expect(d.state.jobs).toHaveLength(1); expect(d.skill).toHaveBeenCalledOnce(); expect(d.state.artifacts).toHaveLength(1);
  });
  it("reuses a same-source success committed after absent lookup but before reserve", async () => {
    const d = fixture();
    d.ensureAgent.mockImplementationOnce(async () => { await d.start(); await d.run(); return "synthetic-agent"; });
    const result = await d.start(); expect(result.status).toBe("succeeded"); expect(d.state.jobs).toHaveLength(1); expect(d.skill).toHaveBeenCalledOnce(); expect(d.state.artifacts).toHaveLength(1);
  });
  it("recovers a same-source success after unique-key conflict without creating or invoking again", async () => {
    const other = fixture(); await other.start(); await other.run();
    const d = fixture();
    d.onWrite(text => {
      if (text.startsWith("INSERT INTO ai_jobs")) {
        d.onWrite(undefined);
        // Simulate the other transaction's committed state becoming visible
        // when this insert loses its unique-key race, not a second model call.
        Object.assign(d.state, structuredClone(other.state));
        throw { errno: 1062 };
      }
    });
    const result = await d.start(); expect(result.status).toBe("succeeded"); expect(d.skill).not.toHaveBeenCalled(); expect(d.state.jobs).toHaveLength(1); expect(d.state.artifacts).toHaveLength(1);
  });
  it("preserves a preexisting human draft but writes new AI draft separately", async () => {
    const d = fixture(); d.state.analyses[0].summary = "Human wording"; await d.start(); await d.run();
    expect(d.state.analyses[0]).toMatchObject({ summary: "Human wording", aiSummary: "New research" });
  });
  it.each([null, 7])("supports authenticated workspace %s with legacy NULL owner project", async workspaceId => {
    const d = fixture(); d.state.users[0].defaultWorkspaceId = workspaceId; d.state.projects[0].workspaceId = null;
    await d.start(); await d.run(); expect(d.state.jobs[0].workspaceId).toBe(workspaceId);
  });
  it.each(["actor", "workspace", "owner", "foreign", "analysis", "confirmed", "revision", "undefined"])("rejects bad admission %s before Agent/model/job", async kind => {
    const d = fixture(), request = d.request();
    if (kind === "actor") d.state.users[0].status = "disabled";
    if (kind === "workspace") request.expectedWorkspaceId = 8;
    if (kind === "owner") d.state.projects[0].userId = 4;
    if (kind === "foreign") d.state.projects[0].workspaceId = 8;
    if (kind === "analysis") request.analysisId = 999;
    if (kind === "confirmed") { d.state.analyses[0].summaryStatus = "confirmed"; request.expectedRevision = competitorRevision(d.state.analyses[0]); }
    if (kind === "revision") request.expectedRevision = "f".repeat(64);
    if (kind === "undefined") d.state.users[0].defaultWorkspaceId = undefined;
    await expect(d.service.start(d.context(), request)).rejects.toBeInstanceOf(TRPCError);
    expect(d.ensureAgent).not.toHaveBeenCalled(); expect(d.skill).not.toHaveBeenCalled(); expect(d.state.jobs).toEqual([]);
  });
  it("uses real project.run action and strict same-transaction policy; deny prevents Agent/job", async () => {
    const d = fixture(); d.permission.mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "sensitive policy detail" }));
    await expect(d.start()).rejects.toThrow("COMPETITOR_RESEARCH_ACCESS_DENIED"); expect(d.permission).toHaveBeenCalledWith(expect.objectContaining({ action: "run" })); expect(d.ensureAgent).not.toHaveBeenCalled();
  });
  it("get/list use read rather than model execution permission and expose only safe DTO", async () => {
    const d = fixture(); await d.start(); d.permission.mockClear();
    const read = await d.service.get(d.context(), d.op()), list = await d.service.list(d.context(), { projectId: 11, expectedWorkspaceId: 7 });
    expect(list).toEqual([read]); expect(d.permission.mock.calls.every(([p]) => p.action === "read")).toBe(true);
    expect(JSON.stringify(read)).not.toMatch(/expectedRevision|checkpoint|analysisJson|skillSnapshot|Saved competitor/u);
  });
  it("locks job before actor/policy, parent and competitor in worker transactions", async () => {
    const d = fixture(); await d.start(); d.trace.length = 0; await d.run();
    for (const tx of new Set(d.trace.map(v => v.transaction))) {
      const calls = d.trace.filter(v => v.transaction === tx).map(v => v.sql);
      expect(calls[0]).toBe("SELECT * FROM ai_jobs WHERE runId=? FOR UPDATE");
      expect(calls.findIndex(v => v.startsWith("SELECT * FROM users"))).toBeLessThan(calls.indexOf("POLICY run"));
      expect(calls.indexOf("POLICY run")).toBeLessThan(calls.findIndex(v => v.startsWith("SELECT * FROM projects")));
      expect(calls.findIndex(v => v.startsWith("SELECT * FROM projects"))).toBeLessThan(calls.findIndex(v => v.startsWith("SELECT * FROM competitorAnalyses")));
    }
  });
  it.each(["title", "summary", "confirmed", "review"])("rejects source/human change before model: %s", async kind => {
    const d = fixture(); await d.start();
    if (kind === "title") d.state.analyses[0].title = "Changed";
    if (kind === "summary") d.state.analyses[0].summary = "Human change";
    if (kind === "confirmed") d.state.analyses[0].summaryStatus = "confirmed";
    if (kind === "review") d.state.analyses[0].reviewAnalysis = '{"new":true}';
    await expect(d.run()).rejects.toThrow("COMPETITOR_RESEARCH_SOURCE_CHANGED"); expect(d.skill).not.toHaveBeenCalled(); expect(d.state.artifacts).toEqual([]);
  });
  it.each(["title", "summary", "agent", "node", "disabled", "permission", "lease", "abort"])("rejects changes during model and keeps old result: %s", async kind => {
    const d = fixture(); await d.start();
    d.onModel(() => {
      if (kind === "title") d.state.analyses[0].title = "Changed";
      if (kind === "summary") d.state.analyses[0].summary = "Human change";
      if (kind === "agent") d.agent("canceled");
      if (kind === "node") d.node("canceled");
      if (kind === "disabled") d.state.users[0].status = "disabled";
      if (kind === "permission") d.permission.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
      if (kind === "lease") d.state.jobs[0].leaseUntil = new Date(0);
      if (kind === "abort") d.controller.abort();
    });
    await expect(d.run()).rejects.toBeInstanceOf(TRPCError); expect(d.skill).toHaveBeenCalledOnce();
    expect(d.state.analyses[0].aiSummary).toBe("Prior AI"); expect(d.state.artifacts).toEqual([]);
    expect(JSON.parse(d.state.jobs[0].input).checkpoint.stage).toBe("model_dispatched");
  });
  it.each(["analysis", "artifact", "audit", "receipt", "artifact-readback", "audit-readback"])("atomically rolls back %s and resumes saved result without model", async fault => {
    const d = fixture(), before = structuredClone(d.state.analyses[0]); await d.start(); d.fault(fault);
    await expect(d.run()).rejects.toBeInstanceOf(TRPCError);
    expect(d.state.analyses[0]).toEqual(before); expect(d.state.artifacts).toEqual([]); expect(d.state.audits).toEqual([]);
    expect(JSON.parse(d.state.jobs[0].input).checkpoint.stage).toBe("analysis_ready");
    d.fault(""); d.failed(); const resumed = await d.service.resume(d.context(), d.op()); expect(resumed.stage).toBe("analysis_ready");
    await d.run(); expect(d.skill).toHaveBeenCalledOnce(); expect(d.state.jobs).toHaveLength(1); expect(d.state.artifacts).toHaveLength(1);
  });
  it("an unpersisted model result is unknown and never called twice after restart", async () => {
    const d = fixture(); await d.start(); d.fault("checkpoint"); await expect(d.run()).rejects.toBeInstanceOf(TRPCError); d.fault(""); d.failed();
    const view = await d.service.get(d.context(), d.op()); expect(view).toMatchObject({ stage: "model_result_unknown", canResume: false });
    await expect(d.service.resume(d.context(), d.op())).rejects.toThrow("COMPETITOR_RESEARCH_RESUME_UNSAFE");
    await expect(d.run()).rejects.toThrow("COMPETITOR_RESEARCH_MODEL_RESULT_UNKNOWN"); expect(d.skill).toHaveBeenCalledOnce();
  });
  it.each(["null", "[]", "{}", '{"raw":"PRIVATE MODEL TEXT"}'])("invalid model %s keeps old result and does not retry", async text => {
    const d = fixture(); d.output(text); await d.start(); await expect(d.run()).rejects.toThrow("COMPETITOR_RESEARCH_MODEL_FAILED_REVIEW_REQUIRED");
    expect(d.skill).toHaveBeenCalledOnce(); expect(d.state.artifacts).toEqual([]); expect(d.state.analyses[0].aiSummary).toBe("Prior AI");
  });
  it("cancel reserved then resume uses same anchor, while running cancel prevents post-model persistence", async () => {
    const d = fixture(), first = await d.start(); const canceled = await d.service.cancel(d.context(), d.op()); expect(canceled).toMatchObject({ status: "canceled", canResume: true });
    expect((await d.service.resume(d.context(), d.op())).runId).toBe(first.runId);
    d.onModel(async () => { await d.service.cancel(d.context(), d.op()); });
    await expect(d.run()).rejects.toThrow("COMPETITOR_RESEARCH_LEASE_LOST"); expect(d.state.artifacts).toEqual([]); expect(d.skill).toHaveBeenCalledOnce();
    expect(await d.service.get(d.context(), d.op())).toMatchObject({ status: "canceled", stage: "model_result_unknown", canResume: false });
  });
  it("parent Agent cancellation disables resume without requiring paused or other states", async () => {
    const d = fixture(); await d.start(); d.failed(); d.agent("canceled");
    expect(await d.service.get(d.context(), d.op())).toMatchObject({ canResume: false });
    await expect(d.service.resume(d.context(), d.op())).rejects.toThrow("COMPETITOR_RESEARCH_AGENT_CANCELED");
  });
  it("lease SQL CAS rejects expiry that occurs after locked validation", async () => {
    const d = fixture(); await d.start(); d.onWrite((text, state) => { if (text.startsWith("UPDATE ai_jobs SET input=") && text.includes("status='succeeded'")) state.jobs[0].leaseUntil = new Date(0); });
    await expect(d.run()).rejects.toThrow("COMPETITOR_RESEARCH_WRITE_NOT_ACKNOWLEDGED"); expect(d.state.artifacts).toEqual([]); expect(d.state.analyses[0].aiSummary).toBe("Prior AI");
  });
  it("old worker attempt cannot publish into a reclaimed lease", async () => {
    const d = fixture(); await d.start(); const old = d.claim(); d.state.jobs[0].attempt++;
    await expect(d.service.run(old, { signal: d.controller.signal })).rejects.toThrow("COMPETITOR_RESEARCH_LEASE_LOST"); expect(d.skill).not.toHaveBeenCalled();
  });
  it("a missing schema is not treated as absent data", async () => {
    const d = fixture(); d.fault("schema"); await expect(d.start()).rejects.toThrow("COMPETITOR_RESEARCH_SCHEMA_UNAVAILABLE"); expect(d.ensureAgent).not.toHaveBeenCalled();
  });
  it("does not accept missing Agent N1 or unpublished Skill", async () => {
    const d = fixture(); d.fault("node"); await expect(d.start()).rejects.toThrow("COMPETITOR_RESEARCH_AGENT_INVALID"); expect(d.state.jobs).toEqual([]);
    d.fault(""); await d.start(); d.snapshot.mockResolvedValue({ status: "Draft" } as any); await expect(d.run()).rejects.toThrow("COMPETITOR_RESEARCH_SKILL_NOT_RELEASED"); expect(d.skill).not.toHaveBeenCalled();
  });
  it("only returns this owner's exact workspace jobs", async () => {
    const d = fixture(); await d.start(); const op = d.op(); d.state.users[0].defaultWorkspaceId = 8; d.state.projects[0].workspaceId = null;
    await expect(d.service.get(d.context(), { ...op, expectedWorkspaceId: 8 })).rejects.toThrow("COMPETITOR_RESEARCH_JOB_UNAVAILABLE");
    expect(await d.service.list(d.context(), { projectId: 11, expectedWorkspaceId: 8 })).toEqual([]);
  });
  it("deleted historical source keeps safe unavailable history instead of blocking the list", async () => {
    const d = fixture(); await d.start(); d.state.analyses = [];
    expect(await d.service.list(d.context(), { projectId: 11, expectedWorkspaceId: 7 })).toEqual([expect.objectContaining({ sourceChanged: true, canResume: false, message: expect.stringContaining("无法核验") })]);
    expect(await d.service.get(d.context(), d.op())).toMatchObject({ sourceChanged: true, canResume: false });
  });
  it.each(["broken-json", "missing-title"])("one %s source returns unavailable DTO without hiding another good job", async kind => {
    const d = fixture(); await d.start(); d.state.analyses.push(analysis({ id: 22, asin: "B000000002" }));
    await d.service.start(d.context(), { ...d.request(), analysisId: 22, expectedRevision: competitorRevision(d.state.analyses[1]) });
    d.failed();
    if (kind === "broken-json") d.state.analyses[0].rawData = "broken";
    else { d.state.analyses[0].title = null; d.state.analyses[0].bulletPoints = null; }
    const list = await d.service.list(d.context(), { projectId: 11, expectedWorkspaceId: 7 });
    expect(list).toHaveLength(2); expect(list[0]).toMatchObject({ sourceChanged: true, canResume: false }); expect(list[1]).toMatchObject({ sourceChanged: false });
    expect(JSON.stringify(list)).not.toContain("broken");
  });
  it("cancellation remains possible when Agent checkpoint is missing", async () => {
    const d = fixture(); await d.start(); d.fault("node");
    expect(await d.service.cancel(d.context(), d.op())).toMatchObject({ status: "canceled", canResume: false, message: expect.stringContaining("无法核验") });
  });
  it("new successful draft replaces legacy output keys read by the real planner, but retains source and marks old deep analysis stale", async () => {
    const d = fixture(); d.state.analyses[0].rawData = JSON.stringify({ ...JSON.parse(d.state.analyses[0].rawData!), advantages: ["OLD ADVANTAGE"], weaknesses: ["OLD WEAKNESS"], competitivePositioning: "OLD POSITION", deepAnalysis: { old: true }, trustedUnknown: false });
    d.output('{"summary":"New research","advantages":["NEW ADVANTAGE"]}');
    const before = buildCompetitorResearchSource(d.state.analyses[0]).sourceHash; await d.start(); await d.run();
    const raw = JSON.parse(d.state.analyses[0].rawData!);
    expect(raw).toMatchObject({ advantages: ["NEW ADVANTAGE"], deepAnalysis: { old: true }, deepAnalysisStale: true, trustedUnknown: false,
      research: { kind: "legacy_competitor_analysis", deepResearchComplete: false } });
    expect(raw).not.toHaveProperty("weaknesses"); expect(raw).not.toHaveProperty("competitivePositioning");
    const research = buildSellingPointPlanningResearch({ projectId: 11, competitors: d.state.analyses, reviewAggregation: null, keywords: [], buyerQuestions: [], confirmedComparison: null });
    expect(JSON.stringify(research)).toContain("NEW ADVANTAGE"); expect(JSON.stringify(research)).not.toMatch(/OLD ADVANTAGE|OLD WEAKNESS|OLD POSITION/u);
    expect(buildCompetitorResearchSource(d.state.analyses[0]).sourceHash).toBe(before);
  });
  it.each(["skillSlug", "skillVersion", "skillPromptHash", "skillManifestHash"])("rejects mismatched actual returned %s before analysis_ready", async field => {
    const d = fixture(), original = d.skill.getMockImplementation()!;
    d.skill.mockImplementation(async request => ({ ...await original(request), [field]: "CHANGED" }));
    await d.start(); await expect(d.run()).rejects.toThrow("COMPETITOR_RESEARCH_SKILL_RESULT_CHANGED");
    expect(JSON.parse(d.state.jobs[0].input).checkpoint.stage).toBe("model_dispatched"); expect(d.state.artifacts).toEqual([]); expect(d.skill).toHaveBeenCalledOnce();
  });
  it("stored worker identity must agree with the new kind, scope and source anchor", async () => {
    const d = fixture(); await d.start(); const job = d.claim(); job.kind = "other";
    await expect(d.service.run(job, { signal: d.controller.signal })).rejects.toThrow("COMPETITOR_RESEARCH_BINDING_INVALID");
    expect(d.state.jobs[0].kind).toBe(COMPETITOR_RESEARCH_JOB_KIND); expect(d.skill).not.toHaveBeenCalled();
  });
});
