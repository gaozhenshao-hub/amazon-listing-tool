import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { COMPETITOR_DEEP_EXECUTION_JOB_KIND } from "../../../shared/competitorDeepExecutionJob";
import { canonicalCompetitorResearchEvidence as canonical, verifyCompetitorResearchEvidencePlan,
  type CompetitorResearchEvidencePlan } from "../../../shared/competitorResearchEvidence";
import type { CompetitorAnalysis } from "../../../drizzle/schema/project";
import { createCompetitorDeepExecution, deepSkillPlanSchema, type DeepExecutionJournal,
  type DeepExecutionStore, type DeepSkillPlan } from "../../domains/listing/services/competitorDeepExecution";
import { assertResourceAction } from "../../services/securityGovernance";
import { getDb, type DbExecutor } from "../dbClient";
import { competitorRevision } from "../project/competitorWritePolicy";

/** Worker-internal checkpoint storage only. This does not reserve jobs, approve
 * Skills/evidence, register a worker, call a model, or publish a research result.
 * The trusted reservation/worker must authenticate the initial complete evidence
 * and approved Skill plan; self-consistent hashes are not source provenance. */
export const COMPETITOR_DEEP_INPUT_MAX_BYTES = 16 * 1024 * 1024;
const id = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const exactText = (maximum: number) => z.string().min(1).max(maximum).refine(value => value.trim() === value && value.length > 0);
const scopeSchema = z.object({ runId: exactText(80), lockedBy: exactText(128),
  attempt: id, userId: id, workspaceId: id.nullable(), projectId: id, analysisId: id }).strict();
const outerSchema = z.object({ version: z.literal(1), evidence: z.unknown(), skills: z.unknown(), journal: z.unknown(),
  agentRunId: exactText(80), agentNodeId: z.literal("N1") }).strict();
export type CompetitorDeepStoredInput = { version: 1; evidence: CompetitorResearchEvidencePlan; skills: DeepSkillPlan;
  journal: DeepExecutionJournal; agentRunId: string; agentNodeId: "N1" };
export type CompetitorDeepExecutionScope = z.infer<typeof scopeSchema> & { signal: AbortSignal };
export interface CompetitorDeepExecutionDatabase {
  execute(statement: SQL): Promise<unknown>;
  transaction?<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T>;
}
type ErrorCode = "CONFLICT" | "FORBIDDEN" | "NOT_FOUND" | "PRECONDITION_FAILED" | "INTERNAL_SERVER_ERROR";
function fail(message: string, code: ErrorCode = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message }); }
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function validUtf8(value: unknown): void {
  if (typeof value === "string" && Buffer.from(value, "utf8").toString("utf8") !== value) fail("DEEP_STORE_INPUT_INVALID");
  if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { validUtf8(key); validUtf8(child); }
}
function encoded(value: unknown): string {
  const text = canonical(value);
  if (Buffer.byteLength(text, "utf8") > COMPETITOR_DEEP_INPUT_MAX_BYTES) fail("DEEP_STORE_INPUT_TOO_LARGE");
  // canonical() first checks descriptors, depth, dense arrays and plain JSON;
  // walk only its inert clone, never caller getters/toJSON.
  validUtf8(JSON.parse(text));
  return text;
}
export function decodeCompetitorDeepExecutionInput(value: unknown): CompetitorDeepStoredInput {
  try {
    if (typeof value === "string" && Buffer.byteLength(value, "utf8") > COMPETITOR_DEEP_INPUT_MAX_BYTES) fail("DEEP_STORE_INPUT_TOO_LARGE");
    const source = typeof value === "string" ? JSON.parse(value) : value;
    const raw = outerSchema.parse(JSON.parse(encoded(source)));
    const evidence = verifyCompetitorResearchEvidencePlan(raw.evidence, digest), skills = deepSkillPlanSchema.parse(raw.skills);
    const journal = createCompetitorDeepExecution(evidence, skills).inspect(raw.journal).journal;
    const input = { version: 1 as const, evidence, skills, journal, agentRunId: raw.agentRunId, agentNodeId: raw.agentNodeId };
    encoded(input);
    return input;
  } catch (error) {
    if (error instanceof TRPCError && error.message === "DEEP_STORE_INPUT_TOO_LARGE") throw error;
    return fail("DEEP_STORE_INPUT_INVALID");
  }
}
function safeError(error: unknown): never {
  if (error instanceof TRPCError && /^DEEP_STORE_[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(error.code)) fail("DEEP_STORE_ACCESS_DENIED", "FORBIDDEN");
  let current = error;
  for (let i = 0; i < 5 && current && typeof current === "object"; i++) {
    const e = current as { errno?: number; cause?: unknown };
    if (e.errno === 1062 || e.errno === 1205 || e.errno === 1213) fail("DEEP_STORE_CONFLICT", "CONFLICT");
    if (e.errno === 1146 || e.errno === 1054) fail("DEEP_STORE_SCHEMA_UNAVAILABLE");
    current = e.cause;
  }
  return fail("DEEP_STORE_FAILED", "INTERNAL_SERVER_ERROR");
}
function statement(text: string, params: unknown[]): SQL {
  const parts = text.split("?");
  if (parts.length !== params.length + 1) fail("DEEP_STORE_SQL_BIND_INVALID", "INTERNAL_SERVER_ERROR");
  return sql.join(parts.flatMap((part, i) => i < params.length ? [sql.raw(part), sql`${params[i]}`] : [sql.raw(part)]), sql.raw(""));
}
// The text/hash pair is MySQL's actual JSON rendering, NOT our canonical JSON.
// Bound extraction prevents an oversized stored input from being returned whole.
const JOB_SQL = `SELECT runId,kind,module,userId,workspaceId,projectId,status,attempt,maxAttempts,lockedBy,leaseUntil,
  IF(OCTET_LENGTH(CAST(input AS CHAR CHARACTER SET utf8mb4))<=${COMPETITOR_DEEP_INPUT_MAX_BYTES},CAST(input AS CHAR CHARACTER SET utf8mb4),NULL) AS inputText,
  OCTET_LENGTH(CAST(input AS CHAR CHARACTER SET utf8mb4)) AS inputBytes,
  SHA2(CAST(input AS CHAR CHARACTER SET utf8mb4),256) AS inputTextHash
  FROM ai_jobs WHERE runId=? FOR UPDATE`;
type Job = Record<string, unknown> & { inputText: string; inputTextHash: string; input: CompetitorDeepStoredInput };

function assertTransition(current: DeepExecutionJournal, next: DeepExecutionJournal) {
  if (current.version !== next.version || current.evidenceHash !== next.evidenceHash || current.skillPlanHash !== next.skillPlanHash
    || current.steps.length !== next.steps.length) fail("DEEP_STORE_TRANSITION_INVALID", "CONFLICT");
  const index = current.steps.findIndex(step => step.status === "pending" || step.status === "dispatched");
  if (index < 0 || current.steps.some((step, i) => i !== index && canonical(step) !== canonical(next.steps[i]))) fail("DEEP_STORE_TRANSITION_INVALID", "CONFLICT");
  const before = current.steps[index], after = next.steps[index];
  if (before.stage !== after.stage || !((before.status === "pending" && ["missing", "dispatched"].includes(after.status))
    || (before.status === "dispatched" && after.status === "succeeded"))) fail("DEEP_STORE_TRANSITION_INVALID", "CONFLICT");
  if (before.status === "dispatched" && (before.requestHash !== after.requestHash || before.dispatchId !== after.dispatchId)) fail("DEEP_STORE_TRANSITION_INVALID", "CONFLICT");
}

/** Injection is for controlled SQL fixtures. The default uses the real Drizzle
 * transaction; there is no nontransactional fallback and no default SQL write. */
export function createCompetitorDeepExecutionStore(
  request: CompetitorDeepExecutionScope,
  dependencies: { database?: () => Promise<CompetitorDeepExecutionDatabase | null>; permission?: typeof assertResourceAction } = {},
): DeepExecutionStore {
  const { signal, ...fields } = request;
  let scope: z.infer<typeof scopeSchema>;
  try { scope = scopeSchema.parse(fields); } catch { return fail("DEEP_STORE_SCOPE_INVALID"); }
  if (!(signal instanceof AbortSignal)) fail("DEEP_STORE_SCOPE_INVALID");
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction;
  let immutableBinding: string | null = null;
  function assertLease(row: Record<string, unknown>) {
    const until = row.leaseUntil;
    if (signal.aborted || row.runId !== scope.runId || row.status !== "running" || row.lockedBy !== scope.lockedBy || row.attempt !== scope.attempt
      || !(until instanceof Date || typeof until === "string") || !(new Date(until).getTime() > Date.now())) fail("DEEP_STORE_LEASE_LOST", "CONFLICT");
  }
  function checkSignal() { if (signal.aborted) fail("DEEP_STORE_LEASE_LOST", "CONFLICT"); }
  async function transaction<T>(body: (tx: DbExecutor, guard: { expiresAt: number }) => Promise<T>): Promise<T> {
    try {
      checkSignal();
      const db = await database();
      if (!db || typeof db.transaction !== "function") fail("DEEP_STORE_TRANSACTION_REQUIRED");
      const guard = { expiresAt: 0 };
      const finalGuard = () => { checkSignal(); if (!(guard.expiresAt > Date.now())) fail("DEEP_STORE_LEASE_LOST", "CONFLICT"); };
      const result = await db.transaction(async tx => {
        if (!tx || typeof tx.execute !== "function") fail("DEEP_STORE_TRANSACTION_REQUIRED");
        checkSignal(); const value = await body(tx, guard); finalGuard(); return value;
      });
      // A commit acknowledgement is required; do not turn a thrown commit into
      // a successful write. A cancel while awaiting commit is also non-success.
      finalGuard(); return result;
    } catch (error) { return safeError(error); }
  }
  async function rows(tx: DbExecutor, text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    const result = await tx.execute(statement(text, params));
    if (!Array.isArray(result) || !Array.isArray(result[0])) fail("DEEP_STORE_READ_INVALID", "INTERNAL_SERVER_ERROR");
    return result[0];
  }
  async function locked(tx: DbExecutor): Promise<Job> {
    const found = await rows(tx, JOB_SQL, [scope.runId]);
    if (found.length !== 1) fail("DEEP_STORE_JOB_UNAVAILABLE", "NOT_FOUND");
    const row = found[0]; assertLease(row);
    if (row.kind !== COMPETITOR_DEEP_EXECUTION_JOB_KIND || row.module !== "listing" || row.maxAttempts !== 1
      || row.userId !== scope.userId || row.workspaceId !== scope.workspaceId || row.projectId !== scope.projectId) fail("DEEP_STORE_SCOPE_CHANGED", "CONFLICT");
    if (!Number.isSafeInteger(row.inputBytes) || Number(row.inputBytes) < 1) fail("DEEP_STORE_INPUT_INVALID");
    if (Number(row.inputBytes) > COMPETITOR_DEEP_INPUT_MAX_BYTES) fail("DEEP_STORE_INPUT_TOO_LARGE");
    if (typeof row.inputText !== "string" || Buffer.byteLength(row.inputText, "utf8") !== row.inputBytes
      || !hash.safeParse(row.inputTextHash).success || digest(row.inputText) !== row.inputTextHash) fail("DEEP_STORE_INPUT_HASH_INVALID");
    const input = decodeCompetitorDeepExecutionInput(row.inputText), b = input.evidence.identity;
    if (b.userId !== scope.userId || b.workspaceId !== scope.workspaceId || b.projectId !== scope.projectId || b.analysisId !== scope.analysisId) fail("DEEP_STORE_SCOPE_CHANGED", "CONFLICT");
    return { ...row, inputText: row.inputText, inputTextHash: row.inputTextHash as string, input };
  }
  async function authorized(tx: DbExecutor): Promise<Job> {
    // Shared lock order: job -> actor/policy -> parent -> competitor -> Agent.
    const job = await locked(tx), identity = job.input.evidence.identity;
    const users = await rows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [scope.userId]);
    const user = users[0];
    if (users.length !== 1 || user.id !== scope.userId || user.status !== "active" || user.defaultWorkspaceId !== scope.workspaceId
      || typeof user.role !== "string" || !user.role.trim()) fail("DEEP_STORE_ACTOR_CHANGED", "FORBIDDEN");
    // Deliberately omit ownerUserId: parent ownership is not a policy bypass.
    await permission({ actor: { id: scope.userId, role: user.role, defaultWorkspaceId: scope.workspaceId }, resource: "project", action: "run",
      workspaceId: scope.workspaceId, projectId: scope.projectId, resourceId: scope.projectId,
      authorizationRead: { executor: tx, strict: true, lock: true } });
    const parents = await rows(tx, "SELECT id,userId,workspaceId FROM projects WHERE id=? FOR UPDATE", [scope.projectId]);
    const parent = parents[0];
    if (parents.length !== 1 || parent.id !== scope.projectId || parent.userId !== scope.userId || parent.workspaceId !== identity.sourceWorkspaceId
      || (parent.workspaceId !== null && parent.workspaceId !== scope.workspaceId)) fail("DEEP_STORE_PROJECT_UNAVAILABLE", "NOT_FOUND");
    const analyses = await rows(tx, "SELECT * FROM competitorAnalyses WHERE projectId=? AND id=? FOR UPDATE", [scope.projectId, scope.analysisId]);
    const analysis = analyses[0] as CompetitorAnalysis | undefined;
    if (analyses.length !== 1 || !analysis || analysis.id !== scope.analysisId || analysis.projectId !== scope.projectId || analysis.asin !== identity.asin
      || analysis.summaryStatus !== "draft" || competitorRevision(analysis) !== identity.revision) fail("DEEP_STORE_SOURCE_CHANGED", "CONFLICT");
    const agents = await rows(tx, "SELECT runId,agentSlug,userId,workspaceId,projectId,status FROM emperor_agent_runs WHERE runId=? FOR SHARE", [job.input.agentRunId]);
    const nodes = await rows(tx, "SELECT runId,agentSlug,nodeId,workspaceId,status FROM emperor_agent_checkpoints WHERE runId=? AND nodeId='N1' FOR SHARE", [job.input.agentRunId]);
    const agent = agents[0], node = nodes[0];
    if (agents.length !== 1 || nodes.length !== 1 || agent.runId !== job.input.agentRunId || agent.agentSlug !== "listing.full.workflow"
      || agent.userId !== scope.userId || agent.workspaceId !== scope.workspaceId || agent.projectId !== scope.projectId
      || node.runId !== job.input.agentRunId || node.agentSlug !== "listing.full.workflow" || node.nodeId !== "N1" || node.workspaceId !== scope.workspaceId
      || !["running", "waiting_human", "paused", "completed", "failed", "canceled"].includes(String(agent.status))
      || !["pending", "ready", "running", "waiting_human", "confirmed", "skipped", "failed", "canceled"].includes(String(node.status))) fail("DEEP_STORE_AGENT_UNAVAILABLE");
    if (agent.status === "canceled" || node.status === "canceled") fail("DEEP_STORE_AGENT_CANCELED", "CONFLICT");
    const binding = canonical({ ...job.input, journal: null });
    if (immutableBinding !== null && immutableBinding !== binding) fail("DEEP_STORE_BINDING_CHANGED", "CONFLICT");
    assertLease(job); immutableBinding = binding;
    return job;
  }
  async function read(): Promise<DeepExecutionJournal> {
    return transaction(async (tx, guard) => { const job = await authorized(tx); assertLease(job);
      guard.expiresAt = new Date(job.leaseUntil as Date | string).getTime(); return job.input.journal; });
  }
  async function assertCurrent(): Promise<void> {
    return transaction(async (tx, guard) => { const job = await authorized(tx); assertLease(job);
      guard.expiresAt = new Date(job.leaseUntil as Date | string).getTime(); });
  }
  async function compareAndSwap(expectedJournalHash: string, next: DeepExecutionJournal): Promise<DeepExecutionJournal> {
    // Snapshot the untrusted candidate before the first await. Caller mutation
    // during SQL waits must not alter the transition that is checked or written.
    let candidate: unknown;
    try { if (!hash.safeParse(expectedJournalHash).success) fail("DEEP_STORE_EXPECTED_HASH_INVALID"); candidate = JSON.parse(encoded(next)); }
    catch (error) { return safeError(error); }
    return transaction(async (tx, guard) => {
      const job = await authorized(tx);
      if (job.input.journal.journalHash !== expectedJournalHash) fail("DEEP_STORE_CAS_CONFLICT", "CONFLICT");
      let nextInput: CompetitorDeepStoredInput;
      try { nextInput = decodeCompetitorDeepExecutionInput({ ...job.input, journal: candidate }); }
      catch { return fail("DEEP_STORE_TRANSITION_INVALID", "CONFLICT"); }
      assertTransition(job.input.journal, nextInput.journal);
      const inputText = encoded(nextInput); assertLease(job);
      const result = await tx.execute(statement("UPDATE ai_jobs SET input=?,updatedAt=CURRENT_TIMESTAMP WHERE runId=? AND kind=? AND module='listing' AND userId=? AND workspaceId<=>? AND projectId=? AND status='running' AND lockedBy=? AND attempt=? AND leaseUntil>CURRENT_TIMESTAMP AND SHA2(CAST(input AS CHAR CHARACTER SET utf8mb4),256)=?",
        [inputText, scope.runId, COMPETITOR_DEEP_EXECUTION_JOB_KIND, scope.userId, scope.workspaceId, scope.projectId, scope.lockedBy, scope.attempt, job.inputTextHash]));
      const ack = Array.isArray(result) ? result[0] : null;
      if (ack?.affectedRows !== 1 || ack?.warningStatus !== 0) fail("DEEP_STORE_WRITE_UNCONFIRMED", "CONFLICT");
      const saved = await locked(tx);
      if (canonical(saved.input) !== inputText) fail("DEEP_STORE_READBACK_MISMATCH", "CONFLICT");
      assertLease(saved); guard.expiresAt = new Date(saved.leaseUntil as Date | string).getTime(); return saved.input.journal;
    });
  }
  return { read, compareAndSwap, assertCurrent };
}
