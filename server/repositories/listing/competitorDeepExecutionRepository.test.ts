import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPETITOR_DEEP_EXECUTION_JOB_KIND } from "../../../shared/competitorDeepExecutionJob";
import { buildCompetitorResearchEvidencePlan, canonicalCompetitorResearchEvidence as canonical } from "../../../shared/competitorResearchEvidence";
import { createCompetitorDeepExecution, type DeepExecutionJournal, type DeepSkillPlan } from "../../domains/listing/services/competitorDeepExecution";
import { buildCompetitorDeepResult, COMPETITOR_DEEP_RESULT_MAX_BYTES } from "../../domains/listing/services/competitorDeepResult";
import { competitorRevision } from "../project/competitorWritePolicy";
import type { CompetitorAnalysis } from "../../../drizzle/schema/project";
import { COMPETITOR_DEEP_INPUT_MAX_BYTES, createCompetitorDeepExecutionStore, decodeCompetitorDeepExecutionInput,
  type CompetitorDeepStoredInput, type CompetitorDeepExecutionScope } from "./competitorDeepExecutionRepository";

const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
const dialect = new MySqlDialect();
function boundedJsonProjection(query: string, row: Record<string, unknown>) {
  const projected = { ...row };
  // Model each bounded alias without pretending to prove MySQL's JSON renderer.
  for (const match of query.matchAll(/IF\(OCTET_LENGTH\(CAST\((\w+) AS CHAR CHARACTER SET utf8mb4\)\)<=([0-9]+),CAST\(\1 AS CHAR CHARACTER SET utf8mb4\),NULL\) AS (\w+)/gu)) {
    const alias = match[3], text = projected[alias];
    if (typeof text === "string" && Buffer.byteLength(text, "utf8") > Number(match[2])) projected[alias] = null;
  }
  return projected;
}
function analysis(): CompetitorAnalysis {
  return { id: 21, projectId: 11, asin: "B000000001", title: "Lamp", bulletPoints: null, imageUrls: null, price: null, rating: null,
    reviewCount: null, reviewAnalysis: null, keywords: null, rawData: null, aiSummary: null, summary: null, summaryStatus: "draft",
    summaryVersion: 1, summaryConfirmedBy: null, summaryConfirmedAt: null, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") };
}
function input(row = analysis(), workspaceId: number | null = 7, sourceWorkspaceId: number | null = workspaceId): CompetitorDeepStoredInput {
  const evidence = buildCompetitorResearchEvidencePlan({ identity: { userId: 3, workspaceId, sourceWorkspaceId, projectId: 11,
    analysisId: 21, asin: row.asin, revision: competitorRevision(row) }, title: row.title, bullets: [], reviews: { status: "unavailable", reason: "not_saved" } }, hash);
  const b = { skillSlug: "synthetic.pending", version: "1", status: "Released" as const, systemPromptHash: "a".repeat(16), userPromptHash: "b".repeat(16), manifestHash: "c".repeat(16) };
  const skills: DeepSkillPlan = { version: 1, authority: "user-primary", approvalRef: "synthetic-only-not-approved", title: b, selling: b,
    buyers_batch: b, buyers_synthesis: b, summary: b };
  return { version: 1, evidence, skills, journal: createCompetitorDeepExecution(evidence, skills).initial(), agentRunId: "agent-synthetic", agentNodeId: "N1" };
}
function scope(): CompetitorDeepExecutionScope {
  return { runId: "deep-synthetic", lockedBy: "worker-one", attempt: 1, userId: 3, workspaceId: 7, projectId: 11, analysisId: 21, signal: new AbortController().signal };
}
const reseal = (journal: DeepExecutionJournal) => { const { journalHash: _old, ...body } = journal; return { ...body, journalHash: hash(canonical(body)) }; };
async function dispatched(stored: CompetitorDeepStoredInput): Promise<DeepExecutionJournal> {
  const kernel = createCompetitorDeepExecution(stored.evidence, stored.skills);
  let next: DeepExecutionJournal | undefined;
  await expect(kernel.runNext({ read: async () => stored.journal, compareAndSwap: async (_old, value) => { next = value; return value; },
    assertCurrent: async () => { throw new Error("synthetic-stop-after-dispatch"); } }, async () => { throw new Error("must not call"); }, new AbortController().signal))
    .rejects.toThrow("synthetic-stop-after-dispatch");
  return next!;
}
function titleRaw(stored: CompetitorDeepStoredInput) {
  const source = stored.evidence.listingSources[0];
  return { keywords: [{ text: source.text, zh: "灯", citation: { sourceId: source.sourceId, start: 0, end: source.text.length, quote: source.text } }],
    modifiers: [], scenarios: [], titleZh: "灯" };
}
async function successfulTitle(stored: CompetitorDeepStoredInput): Promise<DeepExecutionJournal> {
  const k = createCompetitorDeepExecution(stored.evidence, stored.skills); let next = stored.journal;
  await k.runNext({ read: async () => next, compareAndSwap: async (_old, value) => next = value, assertCurrent: async () => undefined },
    async () => ({ raw: titleRaw(stored), receipt: { runId: "skill-synthetic", skillSlug: stored.skills.title.skillSlug, skillVersion: "1",
      skillPromptHash: "a".repeat(16), skillManifestHash: "c".repeat(16), modelSlug: "synthetic-model" } }), new AbortController().signal);
  return next;
}
async function settled(row = analysis()): Promise<CompetitorDeepStoredInput> {
  const stored = input(row), kernel = createCompetitorDeepExecution(stored.evidence, stored.skills);
  let journal = stored.journal;
  const transport = { read: async () => journal, compareAndSwap: async (_old: string, value: DeepExecutionJournal) => journal = value,
    assertCurrent: async () => undefined };
  for (let i = 0; i < journal.steps.length; i++) await kernel.runNext(transport, async request => {
    const source = stored.evidence.listingSources[0], citation = { sourceId: source.sourceId, start: 0, end: source.text.length, quote: source.text };
    const raw = request.stage === "title" ? titleRaw(stored) : request.stage === "selling"
      ? { points: [{ name: "Lamp", description: "Seller identifies a lamp", strength: "中", occurrences: [citation], goldenQuote: citation }], bulletTranslations: [] }
      : { positioning: { text: "A lamp", basis: "seller_claim", references: ["title:keyword:1"] }, advantages: [], weaknesses: [], learnings: [], opportunities: [] };
    return { raw, receipt: { runId: `synthetic-${request.stage}`, skillSlug: request.binding.skillSlug, skillVersion: "1",
      skillPromptHash: "a".repeat(16), skillManifestHash: "c".repeat(16), modelSlug: "synthetic-model" } };
  }, new AbortController().signal);
  return { ...stored, journal };
}
function fixture(stored = input(), fixedScope = scope()) {
  const row = analysis();
  let state = {
    job: { runId: fixedScope.runId, kind: COMPETITOR_DEEP_EXECUTION_JOB_KIND, module: "listing", userId: fixedScope.userId, workspaceId: fixedScope.workspaceId,
      projectId: fixedScope.projectId, status: "running", progress: 90, attempt: 1, maxAttempts: 1, lockedBy: "worker-one" as string | null,
      leaseUntil: new Date(Date.now() + 60_000) as Date | null, inputText: JSON.stringify(stored, null, 2),
      outputText: null as string | null, errorMessage: null as string | null, completedAt: null as Date | null },
    user: { id: 3, role: "admin", status: "active", defaultWorkspaceId: fixedScope.workspaceId },
    project: { id: 11, userId: 3, workspaceId: stored.evidence.identity.sourceWorkspaceId }, analysis: row,
    agents: [{ runId: stored.agentRunId, agentSlug: "listing.full.workflow", userId: 3, workspaceId: fixedScope.workspaceId, projectId: 11, status: "running" }],
    nodes: [{ runId: stored.agentRunId, agentSlug: "listing.full.workflow", nodeId: "N1", workspaceId: fixedScope.workspaceId, status: "running" }],
    artifacts: [] as Record<string, unknown>[], audits: [] as Record<string, unknown>[],
  };
  type State = typeof state;
  const calls: { sql: string; params: unknown[] }[] = [];
  const control = {
    ack: { affectedRows: 1, warningStatus: 0 } as unknown, readPatch: {} as Record<string, unknown>, policyDeny: false,
    ackByTable: {} as Record<string, unknown>, artifactReadPatch: {} as Record<string, unknown>, auditReadPatch: {} as Record<string, unknown>,
    afterWrite: undefined as ((draft: State) => void) | undefined,
    afterQuery: undefined as ((query: string, draft: State) => void) | undefined,
    afterBody: undefined as (() => void) | undefined, afterCommit: undefined as (() => void) | undefined,
    throwOn: "", throwError: { errno: 9999, sql: "PRIVATE SQL", message: "PRIVATE BODY" } as unknown,
  };
  const permission = vi.fn(async () => { if (control.policyDeny) throw new TRPCError({ code: "FORBIDDEN", message: "PRIVATE POLICY" }); });
  let tail: Promise<unknown> = Promise.resolve(), transactions = 0, rollbacks = 0;
  const db = {
    execute: vi.fn(),
    transaction<T>(body: (tx: { execute: (query: SQL) => Promise<unknown> }) => Promise<T>): Promise<T> {
      // A serialized, rollback-capable SQL fixture, not a MySQL concurrency proof.
      const result = tail.then(async () => {
        transactions++; const draft = clone(state);
        const execute = async (query: SQL) => {
          const q = dialect.sqlToQuery(query); calls.push({ sql: q.sql, params: q.params });
          if (control.throwOn && q.sql.includes(control.throwOn)) throw control.throwError;
          let output: unknown;
          if (q.sql.includes("FROM ai_jobs")) output = [[{ ...draft.job, inputBytes: Buffer.byteLength(draft.job.inputText, "utf8"), inputTextHash: hash(draft.job.inputText), ...control.readPatch }], []];
          else if (q.sql.includes("FROM users")) output = [[draft.user], []];
          else if (q.sql.includes("FROM projects")) output = [[draft.project], []];
          else if (q.sql.includes("FROM competitorAnalyses")) output = [[draft.analysis], []];
          else if (q.sql.includes("FROM emperor_agent_runs")) output = [draft.agents, []];
          else if (q.sql.includes("FROM emperor_agent_checkpoints")) output = [draft.nodes, []];
          else if (q.sql.includes("FROM security_access_policies")) output = [[{ effect: "deny" }], []];
          else if (q.sql.includes("FROM ai_artifacts")) output = [draft.artifacts.map(item => ({ ...boundedJsonProjection(q.sql, item), ...control.artifactReadPatch })), []];
          else if (q.sql.includes("FROM security_audit_logs")) output = [draft.audits.map(item => ({ ...boundedJsonProjection(q.sql, item), ...control.auditReadPatch })), []];
          else if (q.sql.startsWith("UPDATE ai_jobs SET input=")) {
            if (q.params[8] !== hash(draft.job.inputText)) return [{ affectedRows: 0, warningStatus: 0 }, []];
            draft.job.inputText = JSON.stringify(JSON.parse(String(q.params[0])), null, 2); // native JSON formatting differs from our canonical wire
            control.afterWrite?.(draft); output = [control.ack, []];
          } else if (q.sql.startsWith("INSERT INTO ai_artifacts")) {
            const p = q.params;
            draft.artifacts.push({ workspaceId: p[0], artifactId: p[1], domain: "listing", artifactKey: p[2], artifactType: "json", sourceType: "ai_output",
              sourceId: p[3], sourceTable: "competitorAnalyses", sourceRowId: p[4], runId: p[5], agentSlug: "listing.full.workflow", nodeId: "N1",
              projectId: p[6], userId: p[7], status: "draft", version: p[8], isCurrent: 0, contentJsonText: JSON.stringify(JSON.parse(String(p[9])), null, 2),
              contentHash: p[10], mimeType: "application/json", fileSizeBytes: p[11], retentionClass: "hot", metadataText: p[12], sourceSkillRunId: p[13], sourceAiJobRunId: p[14] });
            output = [control.ackByTable.ai_artifacts ?? control.ack, []];
          } else if (q.sql.startsWith("INSERT INTO security_audit_logs")) {
            const p = q.params;
            draft.audits.push({ auditId: p[0], workspaceId: p[1], actorUserId: p[2], actorRole: p[3], action: "analysis.research.deep",
              resourceType: "project", resourceId: p[4], projectId: p[5], agentRunId: p[6], toolSlug: "listing.competitor.deep", status: "success",
              riskLevel: "medium", beforeSnapshotText: p[7], afterSnapshotText: p[8], metadataText: p[9] });
            output = [control.ackByTable.security_audit_logs ?? control.ack, []];
          } else if (q.sql.startsWith("UPDATE competitorAnalyses")) {
            const p = q.params;
            if (p[4] !== draft.analysis.id || p[5] !== draft.analysis.projectId || p[6] !== draft.analysis.summaryVersion || draft.analysis.summaryStatus !== "draft") return [{ affectedRows: 0, warningStatus: 0 }, []];
            Object.assign(draft.analysis, { aiSummary: p[0], summary: p[1], keywords: null, rawData: p[2], summaryVersion: p[3], updatedAt: new Date() });
            output = [control.ackByTable.competitorAnalyses ?? control.ack, []];
          } else if (q.sql.startsWith("UPDATE ai_jobs SET output=")) {
            const p = q.params;
            expect(q.sql).toContain("leaseUntil>CURRENT_TIMESTAMP AND SHA2(CAST(input AS CHAR CHARACTER SET utf8mb4),256)=?");
            const eligible = p[1] === draft.job.runId && p[2] === draft.job.kind && draft.job.module === "listing"
              && p[3] === draft.job.userId && p[4] === draft.job.workspaceId && p[5] === draft.job.projectId
              && draft.job.status === "running" && p[6] === draft.job.lockedBy && p[7] === draft.job.attempt
              && draft.job.leaseUntil && draft.job.leaseUntil > new Date() && p[8] === hash(draft.job.inputText);
            if (!eligible) return [{ affectedRows: 0, warningStatus: 0 }, []];
            Object.assign(draft.job, { outputText: p[0], status: "succeeded", progress: 100, errorMessage: null, completedAt: new Date(), lockedBy: null, leaseUntil: null });
            output = [control.ackByTable.ai_jobs ?? control.ack, []];
          } else throw new Error(`Unrecognized fixture SQL: ${q.sql}`);
          control.afterQuery?.(q.sql, draft); return output;
        };
        try { const value = await body({ execute }); control.afterBody?.(); state = draft; control.afterCommit?.(); return value; }
        catch (error) { rollbacks++; throw error; }
      });
      tail = result.catch(() => undefined); return result;
    },
  };
  return { get state() { return state; }, control, calls, db, permission, fixedScope,
    get transactions() { return transactions; }, get rollbacks() { return rollbacks; },
    store: () => createCompetitorDeepExecutionStore(fixedScope, { database: async () => db, permission }),
    writes: () => calls.filter(q => /^(UPDATE|INSERT)/u.test(q.sql)),
  };
}
afterEach(() => vi.restoreAllMocks());

describe("deep worker checkpoint SQL adapter (offline controlled SQL fixture)", () => {
  it("decodes exact evidence, approved-plan shape and raw-output journal without claiming provenance", () => {
    const s = input(); expect(decodeCompetitorDeepExecutionInput(JSON.stringify(s))).toEqual(s);
    expect(decodeCompetitorDeepExecutionInput(canonical(s))).toEqual(s);
  });
  it.each(["extra", "agent", "evidence", "skills", "journal"])("rejects malformed stored %s", which => {
    const s = input() as unknown as Record<string, unknown>;
    if (which === "extra") s.extra = true;
    if (which === "agent") s.agentNodeId = "N3";
    if (which === "evidence") (s.evidence as { evidenceHash: string }).evidenceHash = "e".repeat(64);
    if (which === "skills") (s.skills as DeepSkillPlan).title.status = "Draft" as "Released";
    if (which === "journal") (s.journal as DeepExecutionJournal).journalHash = "f".repeat(64);
    expect(() => decodeCompetitorDeepExecutionInput(s)).toThrow("DEEP_STORE_INPUT_INVALID");
  });
  it("rejects oversized input before JSON.parse and malformed UTF8/getters without observing them", () => {
    expect(() => decodeCompetitorDeepExecutionInput(" ".repeat(COMPETITOR_DEEP_INPUT_MAX_BYTES + 1))).toThrow("DEEP_STORE_INPUT_TOO_LARGE");
    const getter = vi.fn(); const s = input(); Object.defineProperty(s, "journal", { enumerable: true, get: getter });
    expect(() => decodeCompetitorDeepExecutionInput(s)).toThrow("DEEP_STORE_INPUT_INVALID"); expect(getter).not.toHaveBeenCalled();
    const bad = input(); bad.skills.approvalRef = "\ud800";
    expect(() => decodeCompetitorDeepExecutionInput(bad)).toThrow("DEEP_STORE_INPUT_INVALID");
  });
  it("requires a real transaction before any DB query", async () => {
    const execute = vi.fn(), store = createCompetitorDeepExecutionStore(scope(), { database: async () => ({ execute }) });
    await expect(store.read()).rejects.toThrow("DEEP_STORE_TRANSACTION_REQUIRED"); expect(execute).not.toHaveBeenCalled();
  });
  it("read and guard reauthorize with the same tx and exact current scope, without ownership shortcut", async () => {
    const f = fixture(), store = f.store(); expect(await store.read()).toEqual(input().journal); await store.assertCurrent();
    expect(f.transactions).toBe(2); expect(f.writes()).toHaveLength(0); expect(f.permission).toHaveBeenCalledTimes(2);
    const checked = f.permission.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(checked[0]).toMatchObject({ actor: { id: 3, role: "admin", defaultWorkspaceId: 7 }, resource: "project", action: "run", workspaceId: 7,
      projectId: 11, resourceId: 11, authorizationRead: { strict: true, lock: true } });
    expect(checked[0]).not.toHaveProperty("ownerUserId");
    expect(f.calls.slice(0, 6).map(q => q.sql.match(/FROM (\w+)/u)?.[1])).toEqual(["ai_jobs", "users", "projects", "competitorAnalyses", "emperor_agent_runs", "emperor_agent_checkpoints"]);
  });
  it("actual security helper denies an explicit project.run policy despite parent ownership", async () => {
    const f = fixture(), store = createCompetitorDeepExecutionStore(f.fixedScope, { database: async () => f.db });
    await expect(store.read()).rejects.toThrow("DEEP_STORE_ACCESS_DENIED");
    expect(f.calls.some(q => q.sql.includes("security_access_policies") && q.sql.endsWith(" FOR UPDATE"))).toBe(true);
    expect(f.calls.some(q => q.sql.includes("FROM projects"))).toBe(false); expect(f.writes()).toHaveLength(0);
  });
  it.each(["user", "workspace", "role", "inactive", "parentOwner", "parentWorkspace", "legacySourceWorkspace", "analysisId", "asin", "source", "confirmed"])("rejects changed %s before any write", async which => {
    const f = fixture();
    if (which === "user") f.state.user.id++;
    if (which === "workspace") f.state.user.defaultWorkspaceId = 8;
    if (which === "role") f.control.policyDeny = true;
    if (which === "inactive") f.state.user.status = "disabled";
    if (which === "parentOwner") f.state.project.userId++;
    if (which === "parentWorkspace") f.state.project.workspaceId = 8;
    if (which === "legacySourceWorkspace") f.state.project.workspaceId = null;
    if (which === "analysisId") f.state.analysis.id++;
    if (which === "asin") f.state.analysis.asin = "B000000002";
    if (which === "source") f.state.analysis.rawData = '{"new":"source"}';
    if (which === "confirmed") f.state.analysis.summaryStatus = "confirmed";
    await expect(f.store().read()).rejects.toThrow(/^DEEP_STORE_/u); expect(f.writes()).toHaveLength(0);
  });
  it.each([null, 7])("separately accepts pinned legacy NULL parent within actor WS %s", async workspaceId => {
    const s = scope(); s.workspaceId = workspaceId;
    const f = fixture(input(analysis(), workspaceId, null), s); await expect(f.store().read()).resolves.toBeDefined();
    expect(f.permission.mock.calls[0]).toEqual([expect.objectContaining({ workspaceId, actor: expect.objectContaining({ defaultWorkspaceId: workspaceId }) })]);
  });
  it.each(["kind", "module", "userId", "workspaceId", "projectId", "maxAttempts", "status", "attempt", "worker", "expired", "noLease", "missingNode", "missingAgent", "agentCanceled", "nodeCanceled", "nodeNoStatus", "nodeUnknownStatus", "nodeSlug", "foreignAgent"])("rejects %s job/lease/Agent mismatch", async which => {
    const f = fixture();
    if (which === "kind") f.state.job.kind = "other" as typeof COMPETITOR_DEEP_EXECUTION_JOB_KIND;
    if (which === "module") f.state.job.module = "image";
    if (["userId", "projectId", "maxAttempts", "attempt"].includes(which)) (f.state.job as unknown as Record<string, number>)[which]++;
    if (which === "workspaceId") f.state.job.workspaceId = null;
    if (which === "status") f.state.job.status = "canceled";
    if (which === "worker") f.state.job.lockedBy = "worker-two";
    if (which === "expired") f.state.job.leaseUntil = new Date(0);
    if (which === "noLease") f.control.readPatch.leaseUntil = null;
    if (which === "missingNode") f.state.nodes = [];
    if (which === "missingAgent") f.state.agents = [];
    if (which === "agentCanceled") f.state.agents[0].status = "canceled";
    if (which === "nodeCanceled") f.state.nodes[0].status = "canceled";
    if (which === "nodeNoStatus") delete (f.state.nodes[0] as Partial<typeof f.state.nodes[number]>).status;
    if (which === "nodeUnknownStatus") f.state.nodes[0].status = "unknown";
    if (which === "nodeSlug") f.state.nodes[0].agentSlug = "another.agent";
    if (which === "foreignAgent") f.state.agents[0].workspaceId = 8;
    await expect(f.store().assertCurrent()).rejects.toThrow(/^DEEP_STORE_/u); expect(f.writes()).toHaveLength(0);
  });
  it("does not add a new paused-Agent ban", async () => {
    const f = fixture(); f.state.agents[0].status = "paused"; await expect(f.store().assertCurrent()).resolves.toBeUndefined();
  });
  it.each([{ inputBytes: COMPETITOR_DEEP_INPUT_MAX_BYTES + 1, inputText: null }, { inputBytes: 1 }, { inputTextHash: "0".repeat(64) }, { inputText: null }])("rejects raw input metadata mismatch %#", async patch => {
    const f = fixture(); f.control.readPatch = patch; await expect(f.store().read()).rejects.toThrow(/^DEEP_STORE_INPUT_/u); expect(f.writes()).toHaveLength(0);
  });
  it("commits exactly one pending→dispatched using native text hash, not canonical hash", async () => {
    const s = input(), f = fixture(s), store = f.store(), next = await dispatched(s), oldText = f.state.job.inputText;
    expect(hash(oldText)).not.toBe(hash(canonical(s)));
    expect(await store.compareAndSwap(s.journal.journalHash, next)).toEqual(next);
    expect(f.writes()).toHaveLength(1); const q = f.writes()[0];
    expect(q.sql).toContain("leaseUntil>CURRENT_TIMESTAMP AND SHA2(CAST(input AS CHAR CHARACTER SET utf8mb4),256)=?");
    expect(q.sql).toContain("workspaceId<=>?"); expect(q.params.slice(1)).toEqual(["deep-synthetic", COMPETITOR_DEEP_EXECUTION_JOB_KIND, 3, 7, 11, "worker-one", 1, hash(oldText)]);
    expect(decodeCompetitorDeepExecutionInput(f.state.job.inputText).journal).toEqual(next); expect(q.sql).not.toContain("Lamp");
  });
  it("permits genuine dispatched→succeeded raw validation and forbids restarting the dispatch", async () => {
    const s = input(), first = await dispatched(s), final = await successfulTitle(s), f = fixture({ ...s, journal: first }), store = f.store();
    expect(await store.compareAndSwap(first.journalHash, final)).toEqual(final);
    await expect(store.compareAndSwap(final.journalHash, first)).rejects.toThrow("DEEP_STORE_TRANSITION_INVALID"); expect(f.writes()).toHaveLength(1);
  });
  it("permits only source-backed pending→missing and distinguishes unknown from unavailable", async () => {
    const a = analysis(); a.title = null; const s = input(a), f = fixture(s); f.state.analysis = a;
    const next = clone(s.journal); next.steps[0].status = "missing"; next.steps[0].missingReason = "title_unavailable";
    await expect(f.store().compareAndSwap(s.journal.journalHash, reseal(next))).resolves.toEqual(reseal(next));
    const hasTitle = input(), invalid = clone(hasTitle.journal); invalid.steps[0] = clone(next.steps[0]);
    await expect(fixture(hasTitle).store().compareAndSwap(hasTitle.journal.journalHash, reseal(invalid))).rejects.toThrow("DEEP_STORE_TRANSITION_INVALID");
  });
  it.each(["skip", "noop", "differentEvidence", "changedRequest", "fabricatedOutput"])("rejects non-single-step transition %s", async which => {
    const s = input(), next = await dispatched(s), f = fixture(s); let candidate = next;
    if (which === "skip") candidate = await successfulTitle(s);
    if (which === "noop") candidate = clone(s.journal);
    if (which === "differentEvidence") candidate.evidenceHash = "f".repeat(64);
    if (which === "changedRequest") candidate.steps[0].requestHash = "f".repeat(64);
    if (which === "fabricatedOutput") { candidate = await successfulTitle(s); candidate.steps[0].raw = { fake: true }; }
    candidate = reseal(candidate);
    await expect(f.store().compareAndSwap(s.journal.journalHash, candidate)).rejects.toThrow("DEEP_STORE_TRANSITION_INVALID"); expect(f.writes()).toHaveLength(0);
  });
  it("one of two concurrent expected hashes wins in the controlled transactional fixture", async () => {
    const s = input(), next = await dispatched(s), f = fixture(s);
    const outcomes = await Promise.allSettled([f.store().compareAndSwap(s.journal.journalHash, next), f.store().compareAndSwap(s.journal.journalHash, next)]);
    expect(outcomes.map(x => x.status).sort()).toEqual(["fulfilled", "rejected"]); expect(f.writes()).toHaveLength(1);
  });
  it.each([{ affectedRows: 0, warningStatus: 0 }, { affectedRows: 2, warningStatus: 0 }, { affectedRows: 1, warningStatus: 1 }, {}])("rolls back non-exact acknowledgement %#", async ack => {
    const s = input(), next = await dispatched(s), f = fixture(s), before = f.state.job.inputText; f.control.ack = ack;
    await expect(f.store().compareAndSwap(s.journal.journalHash, next)).rejects.toThrow("DEEP_STORE_WRITE_UNCONFIRMED");
    expect(f.state.job.inputText).toBe(before); expect(f.rollbacks).toBe(1);
  });
  it("rolls back exact ACK followed by a different full input readback", async () => {
    const s = input(), next = await dispatched(s), f = fixture(s), before = f.state.job.inputText;
    f.control.afterWrite = draft => { const value = JSON.parse(draft.job.inputText); value.agentRunId = "different-agent"; draft.job.inputText = JSON.stringify(value); };
    await expect(f.store().compareAndSwap(s.journal.journalHash, next)).rejects.toThrow("DEEP_STORE_READBACK_MISMATCH"); expect(f.state.job.inputText).toBe(before);
  });
  it("refuses a later same-scope replacement of the pinned evidence/Skill plan", async () => {
    const f = fixture(), store = f.store(); await store.read(); const replacement = input(); replacement.skills.approvalRef = "another-plan";
    replacement.journal = createCompetitorDeepExecution(replacement.evidence, replacement.skills).initial(); f.state.job.inputText = JSON.stringify(replacement);
    await expect(store.read()).rejects.toThrow("DEEP_STORE_BINDING_CHANGED"); expect(f.writes()).toHaveLength(0);
  });
  it("clones candidate before waits so caller cannot switch an approved transition", async () => {
    const s = input(), f = fixture(s), next = await dispatched(s), expected = clone(next);
    const pending = f.store().compareAndSwap(s.journal.journalHash, next); next.steps[0].requestHash = "f".repeat(64);
    expect(await pending).toEqual(expected);
  });
  it("rejects cancellation before IO and during read without adding a write", async () => {
    const c = new AbortController(), fixed = scope(); fixed.signal = c.signal; const f = fixture(input(), fixed); c.abort();
    await expect(f.store().read()).rejects.toThrow("DEEP_STORE_LEASE_LOST"); expect(f.transactions).toBe(0);
    const c2 = new AbortController(), s2 = scope(); s2.signal = c2.signal; const f2 = fixture(input(), s2);
    f2.control.afterQuery = query => { if (query.includes("emperor_agent_checkpoints")) c2.abort(); };
    await expect(f2.store().read()).rejects.toThrow("DEEP_STORE_LEASE_LOST"); expect(f2.writes()).toHaveLength(0);
  });
  it("rolls back lease expiry during update/readback and does not claim an expired commit success", async () => {
    const s = input(), next = await dispatched(s), f = fixture(s), original = f.state.job.inputText;
    f.control.afterWrite = draft => { draft.job.leaseUntil = new Date(0); };
    await expect(f.store().compareAndSwap(s.journal.journalHash, next)).rejects.toThrow("DEEP_STORE_LEASE_LOST"); expect(f.state.job.inputText).toBe(original);
    const f2 = fixture(s), expiresAt = f2.state.job.leaseUntil!.getTime();
    f2.control.afterCommit = () => { vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); };
    await expect(f2.store().compareAndSwap(s.journal.journalHash, next)).rejects.toThrow("DEEP_STORE_LEASE_LOST");
    // Commit may already have happened; the caller must not call the model on this rejected ACK.
    expect(decodeCompetitorDeepExecutionInput(f2.state.job.inputText).journal).toEqual(next);
  });
  it.each([1146, 1054, 1205, 1213, 9999])("maps storage errors %s without SQL/prompt/cause disclosure", async errno => {
    const f = fixture(); f.control.throwOn = "FROM users"; f.control.throwError = { errno, sql: "PRIVATE", message: "PRIVATE", cause: { text: "PRIVATE" } };
    const error = await f.store().read().catch(error => error);
    expect(error).toBeInstanceOf(TRPCError); if (!(error instanceof TRPCError)) throw new Error("Expected safe storage error");
    expect(error.message).toMatch(/^DEEP_STORE_/u); expect(error.message).not.toContain("PRIVATE"); expect(error.cause).toBeUndefined();
  });
  it("keeps dispatched durable on lost commit ACK and never invokes a model through this adapter", async () => {
    const s = input(), next = await dispatched(s), f = fixture(s);
    f.control.afterCommit = () => { throw new Error("PRIVATE COMMIT ACK LOST"); };
    await expect(f.store().compareAndSwap(s.journal.journalHash, next)).rejects.toThrow("DEEP_STORE_FAILED");
    expect(decodeCompetitorDeepExecutionInput(f.state.job.inputText).journal.steps[0].status).toBe("dispatched");
    expect(f.writes()).toHaveLength(1);
  });
});

describe("atomic deep-result publication (offline SQL fixture, no models)", () => {
  it("replays the locked journal and publishes a content-free receipt plus an immutable draft artifact", async () => {
    const stored = await settled(), f = fixture(stored), beforeInput = f.state.job.inputText;
    const receipt = await f.store().publish();
    expect(receipt).toMatchObject({ version: 1, kind: "competitor_deep_research", runId: "deep-synthetic", analysisId: 21,
      summaryVersion: 2, reviewRequired: true, deepResearchComplete: false, sourceRevision: stored.evidence.identity.revision });
    expect(receipt.committedRevision).toBe(competitorRevision(f.state.analysis));
    expect(receipt.committedRevision).not.toBe(receipt.sourceRevision);
    expect(f.state.job).toMatchObject({ status: "succeeded", progress: 100, lockedBy: null, leaseUntil: null });
    expect(f.state.job.inputText).toBe(beforeInput); expect(JSON.parse(f.state.job.outputText!)).toEqual(receipt);
    const rebuilt = buildCompetitorDeepResult({ jobRunId: receipt.runId, generatedAt: receipt.generatedAt,
      evidence: stored.evidence, skills: stored.skills, journal: stored.journal });
    // Pass only the exact builder API, never an artifact supplied by the caller.
    expect(rebuilt.resultHash).toBe(receipt.resultHash);
    expect(JSON.parse(String(f.state.artifacts[0].contentJsonText))).toEqual(rebuilt);
    expect(hash(canonical(rebuilt))).toBe(receipt.artifactHash);
    expect(f.state.artifacts[0]).toMatchObject({ status: "draft", isCurrent: 0, sourceSkillRunId: "synthetic-summary", sourceAiJobRunId: receipt.runId });
    expect(f.writes().map(call => call.sql.match(/^(?:INSERT INTO|UPDATE) (\w+)/u)?.[1])).toEqual(["ai_artifacts", "competitorAnalyses", "security_audit_logs", "ai_jobs"]);
    expect(f.transactions).toBe(1); expect(f.permission).toHaveBeenCalledOnce(); expect(f.rollbacks).toBe(0);
    expect(JSON.stringify(receipt)).not.toMatch(/A lamp|灯|Seller identifies/);
    const raw = JSON.parse(f.state.analysis.rawData!);
    expect(raw.deepAnalysisRef).toEqual({ artifactId: receipt.artifactId, jobRunId: receipt.runId, resultHash: receipt.resultHash });
    expect(raw.deepResearchPublication).not.toHaveProperty("committedRevision"); expect(raw).not.toHaveProperty("deepAnalysis");
    expect(raw).not.toHaveProperty("research");
    expect(raw).toMatchObject({ deepAnalysisStale: true, analysisStale: true, captureOnly: false });
    expect(JSON.parse(String(f.state.audits[0].afterSnapshotText))).toEqual(receipt);
  });

  it("preserves all original research/legacy AI fields and a human summary, with a complete before snapshot", async () => {
    const row = analysis(); row.aiSummary = "old generated"; row.summary = "Human-edited summary"; row.keywords = '["old"]';
    row.reviewAnalysis = "original review analysis";
    row.rawData = JSON.stringify({ source: "capture", scrapedData: { title: "original" }, reviewImport: { sourceHash: "x" }, importedReviews: [{ body: "Original" }],
      arbitrary: { keep: true }, analysis: { old: true }, titleAnalysis: "old", bulletPointsAnalysis: "old", keywords: ["old"], advantages: ["old"],
      weaknesses: ["old"], summary: "old", competitivePositioning: "old", deepAnalysis: { old: true },
      research: { variants: [{ asin: "B000000002", color: "yellow" }], reviews: [{ sourceReviewId: "R1", body: "Exact original text" }], purchaseBadge: "100+ bought in past month" } });
    const f = fixture(await settled(row)); f.state.analysis = clone(row);
    await f.store().publish();
    expect(f.state.analysis.summary).toBe(row.summary); expect(f.state.analysis.aiSummary).not.toBe(row.aiSummary);
    expect(f.state.analysis.reviewAnalysis).toBe(row.reviewAnalysis); expect(f.state.analysis.keywords).toBeNull();
    const raw = JSON.parse(f.state.analysis.rawData!);
    expect(raw).toMatchObject(JSON.parse(row.rawData));
    expect(raw.deepAnalysis).toEqual({ old: true });
    expect(raw).toMatchObject({ analysisStale: true, deepAnalysisStale: true, deepResearchPublication: { reviewRequired: true, deepResearchComplete: false } });
    const before = JSON.parse(String(f.state.audits[0].beforeSnapshotText));
    expect(before).toEqual({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
    expect(before.rawData).toBe(row.rawData); expect(before.keywords).toBe(row.keywords); expect(before.aiSummary).toBe(row.aiSummary);
  });

  it("replaces only an unedited AI draft summary, without confirming it", async () => {
    const row = analysis(); row.aiSummary = "old generated"; row.summary = row.aiSummary;
    const f = fixture(await settled(row)); f.state.analysis = row;
    await f.store().publish(); expect(f.state.analysis.summary).toBe(f.state.analysis.aiSummary);
    expect(f.state.analysis.summaryStatus).toBe("draft"); expect(f.state.analysis.summaryConfirmedBy).toBeNull();
  });

  it.each(["pending", "dispatched", "no-summary"])("does not publish %s or mutate anything", async which => {
    const row = analysis(); if (which === "no-summary") row.title = null;
    const stored = which === "no-summary" ? await settled(row) : input(row);
    if (which === "dispatched") stored.journal = await dispatched(stored);
    const f = fixture(stored); f.state.analysis = row; const before = clone(f.state);
    await expect(f.store().publish()).rejects.toThrow(which === "no-summary" ? "DEEP_STORE_RESULT_INCOMPLETE" : "DEEP_STORE_RESULT_INVALID");
    expect(f.state).toEqual(before); expect(f.writes()).toHaveLength(0);
  });

  it.each(["denied", "owner", "workspace", "source", "confirmed", "canceledAgent", "expired", "wrongAttempt"])("reauthorizes %s before publication writes", async which => {
    const f = fixture(await settled());
    if (which === "denied") f.control.policyDeny = true;
    if (which === "owner") f.state.project.userId++;
    if (which === "workspace") f.state.user.defaultWorkspaceId = 8;
    if (which === "source") f.state.analysis.price = "10";
    if (which === "confirmed") f.state.analysis.summaryStatus = "confirmed";
    if (which === "canceledAgent") f.state.agents[0].status = "canceled";
    if (which === "expired") f.state.job.leaseUntil = new Date(0);
    if (which === "wrongAttempt") f.state.job.attempt++;
    const before = clone(f.state); await expect(f.store().publish()).rejects.toThrow(/^DEEP_STORE_/u);
    expect(f.state).toEqual(before); expect(f.writes()).toHaveLength(0);
  });

  it.each(["ai_artifacts", "competitorAnalyses", "security_audit_logs", "ai_jobs"])("rolls back all writes on non-exact %s ACK", async table => {
    for (const ack of [{ affectedRows: 0, warningStatus: 0 }, { affectedRows: 2, warningStatus: 0 }, { affectedRows: 1, warningStatus: 1 }, {}]) {
      const f = fixture(await settled()), before = clone(f.state); f.control.ackByTable[table] = ack;
      await expect(f.store().publish()).rejects.toThrow("DEEP_STORE_WRITE_UNCONFIRMED");
      expect(f.state).toEqual(before); expect(f.rollbacks).toBe(1);
    }
  });

  it.each(["artifactContent", "artifactMetadata", "artifactScope", "artifactCurrent", "auditBefore", "auditSnapshot", "auditMetadata", "auditScope", "analysis", "jobInput", "jobOutput"])("rolls back a changed %s readback", async which => {
    const f = fixture(await settled()), before = clone(f.state);
    if (which === "artifactContent") f.control.artifactReadPatch.contentJsonText = '{"forged":true}';
    if (which === "artifactMetadata") f.control.artifactReadPatch.metadataText = '{}';
    if (which === "artifactScope") f.control.artifactReadPatch.userId = 4;
    if (which === "artifactCurrent") f.control.artifactReadPatch.isCurrent = 1;
    if (which === "auditBefore") f.control.auditReadPatch.beforeSnapshotText = '{}';
    if (which === "auditSnapshot") f.control.auditReadPatch.afterSnapshotText = '{}';
    if (which === "auditMetadata") f.control.auditReadPatch.metadataText = '{}';
    if (which === "auditScope") f.control.auditReadPatch.workspaceId = 8;
    f.control.afterQuery = (query, draft) => {
      if (which === "analysis" && query.startsWith("UPDATE competitorAnalyses")) draft.analysis.summary = "changed";
      if (query.startsWith("UPDATE ai_jobs SET output=")) {
        if (which === "jobInput") draft.job.inputText += " ";
        if (which === "jobOutput") draft.job.outputText = '{}';
      }
    };
    await expect(f.store().publish()).rejects.toThrow(/^DEEP_STORE_.*READBACK_MISMATCH$/u); expect(f.state).toEqual(before);
  });

  it.each(["artifact", "analysis", "audit", "job"])("rolls back query failure at %s without unsafe error details", async where => {
    const f = fixture(await settled()), before = clone(f.state);
    f.control.throwOn = { artifact: "INSERT INTO ai_artifacts", analysis: "UPDATE competitorAnalyses", audit: "INSERT INTO security_audit_logs", job: "UPDATE ai_jobs SET output=" }[where]!;
    await expect(f.store().publish()).rejects.toThrow("DEEP_STORE_FAILED"); expect(f.state).toEqual(before);
  });

  it("refuses oversized retained rawData without truncating or removing originals", async () => {
    const row = analysis(); row.rawData = JSON.stringify({ deepAnalysis: { original: "x".repeat(65530) } });
    const f = fixture(await settled(row)); f.state.analysis = row;
    await expect(f.store().publish()).rejects.toThrow("DEEP_STORE_SOURCE_TOO_LARGE"); expect(f.writes()).toHaveLength(0); expect(f.state.analysis.rawData).toBe(row.rawData);
  });

  it("refuses an oversized complete before snapshot before writing without discarding old AI history", async () => {
    const row = analysis(); row.aiSummary = "旧摘要".repeat(120000); row.summary = "Human summary";
    const f = fixture(await settled(row)); f.state.analysis = row; const before = clone(f.state);
    await expect(f.store().publish()).rejects.toThrow("DEEP_STORE_SOURCE_TOO_LARGE");
    expect(f.writes()).toHaveLength(0); expect(f.state).toEqual(before);
  });

  it("stores a full artifact larger than rawData TEXT capacity without embedding or truncating it", async () => {
    const row = analysis(); row.title = "Lamp ".repeat(3000).trim();
    const f = fixture(await settled(row)); f.state.analysis = row;
    const receipt = await f.store().publish(), artifact = f.state.artifacts[0];
    expect(artifact.fileSizeBytes).toBeGreaterThan(65535);
    expect(artifact.fileSizeBytes).toBeLessThanOrEqual(512 * 1024);
    expect(Buffer.byteLength(f.state.analysis.rawData!, "utf8")).toBeLessThan(4096);
    const candidate = JSON.parse(String(artifact.contentJsonText));
    expect(candidate.deepAnalysis.title.keywords[0].text).toBe(row.title);
    expect(candidate.deepAnalysis.trace.listingSources[0].text).toBe(row.title);
    expect(hash(canonical(candidate))).toBe(receipt.artifactHash);
  });

  it("selects only explicit non-JSON columns plus independently bounded JSON aliases", async () => {
    const f = fixture(await settled()); await f.store().publish();
    const artifact = f.calls.find(call => call.sql.includes("FROM ai_artifacts"))!.sql;
    const audit = f.calls.find(call => call.sql.includes("FROM security_audit_logs"))!.sql;
    for (const query of [artifact, audit]) {
      expect(query).not.toMatch(/\bSELECT\s+(?:\w+\.)?\*/iu);
      expect(query.split("IF(")[0]).not.toMatch(/\b(contentJson|metadata|beforeSnapshot|afterSnapshot)\b/u);
      expect(query).toContain("LIMIT 2 FOR SHARE");
    }
    expect(artifact).toContain(`contentJson AS CHAR CHARACTER SET utf8mb4))<=${COMPETITOR_DEEP_RESULT_MAX_BYTES * 8}`);
    expect(artifact).toContain("metadata AS CHAR CHARACTER SET utf8mb4))<=131072");
    expect(audit).toContain("beforeSnapshot AS CHAR CHARACTER SET utf8mb4))<=8388608");
    expect(audit).toContain("afterSnapshot AS CHAR CHARACTER SET utf8mb4))<=131072");
    expect(audit).toContain("metadata AS CHAR CHARACTER SET utf8mb4))<=131072");
  });

  it("accepts equivalent expanded database JSON wire above canonical caps without weakening those caps", async () => {
    const f = fixture(await settled());
    // Deliberately exaggerated legal JSON whitespace tests the independent wire
    // budget. This fixture is not a claim about one exact MySQL renderer format.
    f.control.afterQuery = (query, draft) => {
      if (query.startsWith("INSERT INTO ai_artifacts")) {
        draft.artifacts[0].contentJsonText = " ".repeat(COMPETITOR_DEEP_RESULT_MAX_BYTES + 1) + draft.artifacts[0].contentJsonText;
        draft.artifacts[0].metadataText = " ".repeat(16 * 1024 + 1) + draft.artifacts[0].metadataText;
      }
      if (query.startsWith("INSERT INTO security_audit_logs")) {
        draft.audits[0].beforeSnapshotText = " ".repeat(1024 * 1024 + 1) + draft.audits[0].beforeSnapshotText;
        for (const field of ["afterSnapshotText", "metadataText"]) draft.audits[0][field] = " ".repeat(16 * 1024 + 1) + draft.audits[0][field];
      }
    };
    const receipt = await f.store().publish(), stored = String(f.state.artifacts[0].contentJsonText);
    expect(Buffer.byteLength(stored, "utf8")).toBeGreaterThan(COMPETITOR_DEEP_RESULT_MAX_BYTES);
    const canon = canonical(JSON.parse(stored));
    expect(Buffer.byteLength(canon, "utf8")).toBeLessThanOrEqual(COMPETITOR_DEEP_RESULT_MAX_BYTES);
    expect(hash(canon)).toBe(receipt.artifactHash); expect(f.rollbacks).toBe(0);
  });

  const jsonReadbacks = [
    { table: "ai_artifacts", field: "contentJsonText", cap: COMPETITOR_DEEP_RESULT_MAX_BYTES },
    { table: "ai_artifacts", field: "metadataText", cap: 16 * 1024 },
    { table: "security_audit_logs", field: "beforeSnapshotText", cap: 1024 * 1024 },
    { table: "security_audit_logs", field: "afterSnapshotText", cap: 16 * 1024 },
    { table: "security_audit_logs", field: "metadataText", cap: 16 * 1024 },
  ];
  it.each(jsonReadbacks)("rejects $table.$field over its own wire bound in SQL and application readback", async ({ table, field, cap }) => {
    for (const bypassSqlProjection of [false, true]) {
      const f = fixture(await settled()), before = clone(f.state), value = " ".repeat(cap * 8 + 1);
      if (bypassSqlProjection) (table === "ai_artifacts" ? f.control.artifactReadPatch : f.control.auditReadPatch)[field] = value;
      else f.control.afterQuery = (query, draft) => {
        if (query.startsWith(`INSERT INTO ${table}`)) (table === "ai_artifacts" ? draft.artifacts : draft.audits)[0][field] = value;
      };
      await expect(f.store().publish()).rejects.toThrow(table === "ai_artifacts" ? "DEEP_STORE_ARTIFACT_READBACK_MISMATCH" : "DEEP_STORE_AUDIT_READBACK_MISMATCH");
      expect(f.state).toEqual(before); expect(f.rollbacks).toBe(1);
    }
  });
  it.each(jsonReadbacks)("rejects $table.$field whose UTF8 canonical bytes exceed the cap even inside the wire bound", async ({ table, field, cap }) => {
    const f = fixture(await settled()), before = clone(f.state), value = canonical({ extra: "中".repeat(Math.ceil(cap / 3)) });
    expect(Buffer.byteLength(value, "utf8")).toBeGreaterThan(cap);
    expect(Buffer.byteLength(value, "utf8")).toBeLessThan(cap * 8);
    (table === "ai_artifacts" ? f.control.artifactReadPatch : f.control.auditReadPatch)[field] = value;
    await expect(f.store().publish()).rejects.toThrow(table === "ai_artifacts" ? "DEEP_STORE_ARTIFACT_READBACK_MISMATCH" : "DEEP_STORE_AUDIT_READBACK_MISMATCH");
    expect(f.state).toEqual(before);
  });

  it("rejects lease loss between artifact and job writes and rolls the whole publication back", async () => {
    const f = fixture(await settled()), before = clone(f.state);
    f.control.afterQuery = (query, draft) => { if (query.startsWith("INSERT INTO ai_artifacts")) draft.job.leaseUntil = new Date(0); };
    await expect(f.store().publish()).rejects.toThrow("DEEP_STORE_WRITE_UNCONFIRMED");
    expect(f.state).toEqual(before); expect(f.rollbacks).toBe(1);
  });

  it("does not acknowledge an expired post-commit lease as successful publication", async () => {
    const f = fixture(await settled()), expiresAt = f.state.job.leaseUntil!.getTime();
    f.control.afterCommit = () => { vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); };
    await expect(f.store().publish()).rejects.toThrow("DEEP_STORE_LEASE_LOST");
    expect(f.state.job.status).toBe("succeeded"); expect(f.state.analysis.summaryVersion).toBe(2);
  });

  it("serializes concurrent publication and refuses a second succeeded job without another version or artifact", async () => {
    const f = fixture(await settled()); const results = await Promise.allSettled([f.store().publish(), f.store().publish()]);
    expect(results.map(value => value.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(f.state.analysis.summaryVersion).toBe(2); expect(f.state.artifacts).toHaveLength(1); expect(f.state.audits).toHaveLength(1);
    expect(f.writes()).toHaveLength(4);
  });

  it("rolls back cancellation after artifact insertion", async () => {
    const controller = new AbortController(), fixed = scope(); fixed.signal = controller.signal;
    const f = fixture(await settled(), fixed), before = clone(f.state);
    f.control.afterQuery = query => { if (query.startsWith("INSERT INTO ai_artifacts")) controller.abort(); };
    await expect(f.store().publish()).rejects.toThrow("DEEP_STORE_LEASE_LOST"); expect(f.state).toEqual(before);
  });

  it("does not report success after commit acknowledgement is lost, and cannot publish twice", async () => {
    const f = fixture(await settled()); f.control.afterCommit = () => { throw new Error("PRIVATE LOST ACK"); };
    await expect(f.store().publish()).rejects.toThrow("DEEP_STORE_FAILED");
    expect(f.state.job.status).toBe("succeeded"); expect(f.state.artifacts).toHaveLength(1);
    f.control.afterCommit = undefined;
    await expect(f.store().publish()).rejects.toThrow("DEEP_STORE_LEASE_LOST"); expect(f.writes()).toHaveLength(4);
  });
});
