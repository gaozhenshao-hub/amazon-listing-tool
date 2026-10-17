import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPETITOR_DEEP_EXECUTION_JOB_KIND } from "../../../shared/competitorDeepExecutionJob";
import { buildCompetitorResearchEvidencePlan, canonicalCompetitorResearchEvidence as canonical } from "../../../shared/competitorResearchEvidence";
import { createCompetitorDeepExecution, type DeepExecutionJournal, type DeepSkillPlan } from "../../domains/listing/services/competitorDeepExecution";
import { competitorRevision } from "../project/competitorWritePolicy";
import type { CompetitorAnalysis } from "../../../drizzle/schema/project";
import { COMPETITOR_DEEP_INPUT_MAX_BYTES, createCompetitorDeepExecutionStore, decodeCompetitorDeepExecutionInput,
  type CompetitorDeepStoredInput, type CompetitorDeepExecutionScope } from "./competitorDeepExecutionRepository";

const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
const dialect = new MySqlDialect();
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
function fixture(stored = input(), fixedScope = scope()) {
  const row = analysis();
  let state = {
    job: { runId: fixedScope.runId, kind: COMPETITOR_DEEP_EXECUTION_JOB_KIND, module: "listing", userId: fixedScope.userId, workspaceId: fixedScope.workspaceId,
      projectId: fixedScope.projectId, status: "running", attempt: 1, maxAttempts: 1, lockedBy: "worker-one", leaseUntil: new Date(Date.now() + 60_000), inputText: JSON.stringify(stored, null, 2) },
    user: { id: 3, role: "admin", status: "active", defaultWorkspaceId: fixedScope.workspaceId },
    project: { id: 11, userId: 3, workspaceId: stored.evidence.identity.sourceWorkspaceId }, analysis: row,
    agents: [{ runId: stored.agentRunId, agentSlug: "listing.full.workflow", userId: 3, workspaceId: fixedScope.workspaceId, projectId: 11, status: "running" }],
    nodes: [{ runId: stored.agentRunId, agentSlug: "listing.full.workflow", nodeId: "N1", workspaceId: fixedScope.workspaceId, status: "running" }],
  };
  type State = typeof state;
  const calls: { sql: string; params: unknown[] }[] = [];
  const control = {
    ack: { affectedRows: 1, warningStatus: 0 } as unknown, readPatch: {} as Record<string, unknown>, policyDeny: false,
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
          else if (q.sql.startsWith("UPDATE ai_jobs")) {
            if (q.params[8] !== hash(draft.job.inputText)) return [{ affectedRows: 0, warningStatus: 0 }, []];
            draft.job.inputText = JSON.stringify(JSON.parse(String(q.params[0])), null, 2); // native JSON formatting differs from our canonical wire
            control.afterWrite?.(draft); output = [control.ack, []];
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
    writes: () => calls.filter(q => q.sql.startsWith("UPDATE")),
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
    const f2 = fixture(s), expiresAt = f2.state.job.leaseUntil.getTime();
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
