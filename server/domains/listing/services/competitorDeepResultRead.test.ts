import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../../_core/context";
import type { CompetitorAnalysis } from "../../../../drizzle/schema/project";
import { COMPETITOR_DEEP_EXECUTION_JOB_KIND } from "../../../../shared/competitorDeepExecutionJob";
import { buildCompetitorResearchEvidencePlan, canonicalCompetitorResearchEvidence as canonical } from "../../../../shared/competitorResearchEvidence";
import { buildCompetitorReviewCorpus } from "./competitorReviewCorpus";
import { createCompetitorDeepExecution, type DeepSkillPlan } from "./competitorDeepExecution";
import { buildCompetitorDeepResult } from "./competitorDeepResult";
import { competitorRevision } from "../../../repositories/project/competitorWritePolicy";
import { createCompetitorDeepResultReadService, competitorDeepResultReadSchema } from "./competitorDeepResultRead";

const digest = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
const dialect = new MySqlDialect();
const originalBody = "Original unabridged 评论全文 with 100% punctuation & exact casing.";
function original(): CompetitorAnalysis {
  return { id: 21, projectId: 11, asin: "B000000001", title: "Lamp", bulletPoints: null, imageUrls: null, price: null, rating: null,
    reviewCount: null, reviewAnalysis: null, keywords: null, rawData: null, aiSummary: null, summary: null, summaryStatus: "draft", summaryVersion: 1,
    summaryConfirmedBy: null, summaryConfirmedAt: null, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") };
}
async function fixture(options: { workspaceId?: number | null; sourceWorkspaceId?: number | null } = {}) {
  const workspaceId = options.workspaceId === undefined ? 7 : options.workspaceId;
  const sourceWorkspaceId = options.sourceWorkspaceId === undefined ? workspaceId : options.sourceWorkspaceId;
  const before = original(), bytes = Buffer.from(`ASIN,Review ID,Content,Rating\n${before.asin},platform-r1,${originalBody},5`), fileName = `${before.asin}.csv`;
  const corpus = buildCompetitorReviewCorpus({ bytes, fileName, asin: before.asin, projectId: 11, analysisId: 21, sourceFileHash: digest(bytes) });
  const evidence = buildCompetitorResearchEvidencePlan({ identity: { userId: 3, workspaceId, sourceWorkspaceId, projectId: 11, analysisId: 21,
    asin: before.asin, revision: competitorRevision(before) }, title: before.title, bullets: [], reviews: { status: "available", corpus,
    source: { runId: "original-import", fileName, fileHash: digest(bytes) }, authorizedCorpusHash: "f".repeat(64) } }, digest);
  const binding = { skillSlug: "synthetic-historical", version: "1", status: "Released" as const, systemPromptHash: "a".repeat(16), userPromptHash: "b".repeat(16), manifestHash: "c".repeat(16) };
  const skills: DeepSkillPlan = { version: 1, authority: "user-primary", approvalRef: "historical-synthetic-plan", title: binding, selling: binding,
    buyers_batch: binding, buyers_synthesis: binding, summary: binding };
  const kernel = createCompetitorDeepExecution(evidence, skills); let journal = kernel.initial();
  const source = evidence.listingSources[0], citation = { sourceId: source.sourceId, start: 0, end: 4, quote: "Lamp" };
  const review = evidence.reviews.batches[0].items[0];
  for (let i = 0; i < journal.steps.length; i++) await kernel.runNext({ read: async () => journal,
    compareAndSwap: async (_old, next) => journal = next, assertCurrent: async () => undefined }, async request => {
    const raw = request.stage === "title" ? { keywords: [{ text: "Lamp", zh: "灯", citation }], modifiers: [], scenarios: [], titleZh: "灯" }
      : request.stage === "selling" ? { points: [{ name: "Lamp", description: "Seller claim", strength: "中", occurrences: [citation], goldenQuote: citation }], bulletTranslations: [] }
      : request.stage.startsWith("buyers:") ? { themes: [{ name: "User feedback", sentiment: "positive", reviewIds: [review.reviewId],
        citations: [{ sourceId: `${review.reviewId}:body`, start: 0, end: originalBody.length, quote: originalBody }] }], noThemeReviewIds: [] }
      : request.stage === "buyers_synthesis" ? { groups: [{ name: "Feedback", sentiment: "positive", themeIds: ["buyers:batch:0:theme:1"] }], concerns: [] }
      : { positioning: { text: "Supported lamp positioning", basis: "review_feedback", references: ["buyers:group:1"] }, advantages: [], weaknesses: [], learnings: [], opportunities: [] };
    return { raw, receipt: { runId: `historic-${request.stage}`, skillSlug: binding.skillSlug, skillVersion: "1", skillPromptHash: binding.systemPromptHash,
      skillManifestHash: binding.manifestHash, modelSlug: "synthetic-only" } };
  }, new AbortController().signal);
  const stored = { version: 1, evidence, skills, journal, agentRunId: "agent-historical", agentNodeId: "N1" };
  const runId = "deep-historical", artifactId = `deep_${digest(runId)}`, generatedAt = "2026-10-17T12:00:00.000Z";
  const result = buildCompetitorDeepResult({ evidence, skills, journal, jobRunId: runId, generatedAt }), artifactHash = digest(canonical(result));
  const base = { version: 1, kind: "competitor_deep_research", runId, analysisId: 21, artifactId, artifactHash, resultHash: result.resultHash,
    evidenceHash: evidence.evidenceHash, skillPlanHash: journal.skillPlanHash, journalHash: journal.journalHash, sourceRevision: evidence.identity.revision,
    summaryVersion: 2, generatedAt, reviewRequired: true, deepResearchComplete: false };
  const analysis = { ...before, aiSummary: result.summaryText, summary: result.summaryText, summaryVersion: 2,
    updatedAt: new Date(generatedAt), rawData: JSON.stringify({ research: { reviews: ["original capture"] }, deepResearchPublication: base,
      deepAnalysisRef: { artifactId, jobRunId: runId, resultHash: result.resultHash }, analysisStale: true, deepAnalysisStale: true }) };
  const receipt = { ...base, committedRevision: competitorRevision(analysis) }, metadata = { ...base, agentRunId: stored.agentRunId, agentNodeId: "N1" };
  const state = {
    user: { id: 3, status: "active", role: "admin", defaultWorkspaceId: workspaceId }, project: { id: 11, userId: 3, workspaceId: sourceWorkspaceId }, analysis,
    job: { runId, kind: COMPETITOR_DEEP_EXECUTION_JOB_KIND as string, module: "listing", userId: 3, workspaceId, projectId: 11, status: "succeeded",
      progress: 100, attempt: 1, maxAttempts: 1, lockedBy: null as string | null, leaseUntil: null as Date | null, errorMessage: null,
      completedAt: new Date(generatedAt), inputWire: JSON.stringify(stored, null, 2), outputWire: JSON.stringify(receipt, null, 2) },
    artifact: { workspaceId, artifactId, domain: "listing", artifactKey: `listing.competitor_deep.${before.asin}`, artifactType: "json", sourceType: "ai_output",
      sourceId: "21", sourceTable: "competitorAnalyses", sourceRowId: "21", runId: stored.agentRunId, agentSlug: "listing.full.workflow", nodeId: "N1", projectId: 11,
      userId: 3, status: "draft", version: 2, isCurrent: 0, contentHash: artifactHash, mimeType: "application/json", fileSizeBytes: Buffer.byteLength(canonical(result)),
      retentionClass: "hot", sourceSkillRunId: "historic-summary", sourceAiJobRunId: runId, contentWire: JSON.stringify(result, null, 2), metadataWire: JSON.stringify(metadata, null, 2) },
  };
  const calls: { sql: string; params: unknown[]; tx: number }[] = [];
  const control = { deny: false, missing: "", afterTx: undefined as ((count: number) => void) | undefined,
    jobPatch: {} as Record<string, unknown>, artifactPatch: {} as Record<string, unknown>, analysisPatch: {} as Record<string, unknown>, throwOn: "", error: new Error("PRIVATE SQL BODY") as unknown };
  let txCount = 0;
  const wire = (prefix: string, text: string, maximum: number) => ({ [`${prefix}Text`]: Buffer.byteLength(text) > maximum * 8 ? null : text,
    [`${prefix}Bytes`]: Buffer.byteLength(text), [`${prefix}WireHash`]: digest(text) });
  const permission = vi.fn(async () => { if (control.deny) throw new TRPCError({ code: "FORBIDDEN", message: "PRIVATE POLICY" }); });
  const database = { transaction: async <T>(body: (tx: { execute: (query: SQL) => Promise<unknown> }) => Promise<T>) => {
    const tx = ++txCount;
    const value = await body({ execute: async query => {
      const q = dialect.sqlToQuery(query); calls.push({ ...q, tx });
      expect(q.sql).not.toMatch(/^(?:INSERT|UPDATE|DELETE)\b/u);
      expect(q.sql).not.toContain("SELECT *"); expect(q.sql).toMatch(/FOR (?:SHARE|UPDATE)$/u);
      if (control.throwOn && q.sql.includes(control.throwOn)) throw control.error;
      const table = q.sql.match(/FROM (\w+)/u)?.[1];
      if (control.missing === table) return [[], []];
      if (table === "security_access_policies") return [[{ effect: "deny" }], []];
      if (table === "users") { expect(q.params).toEqual([3]); return [[clone(state.user)], []]; }
      if (table === "projects") { expect(q.params).toEqual([11]); return [[clone(state.project)], []]; }
      if (table === "competitorAnalyses") {
        expect(q.params).toEqual([11, 21]); expect(q.sql).toContain("OCTET_LENGTH(rawData)<=65535");
        return [[{ ...clone(state.analysis), columnsWithinLimit: 1, ...control.analysisPatch }], []];
      }
      if (table === "ai_jobs") {
        expect(q.params).toEqual([runId]); expect(q.sql).toContain("<=134217728"); expect(q.sql).toContain("<=131072");
        const { inputWire, outputWire, ...job } = state.job;
        return [[{ ...clone(job), ...wire("input", inputWire, 16 * 1024 * 1024), ...wire("output", outputWire, 16 * 1024), ...control.jobPatch }], []];
      }
      if (table === "ai_artifacts") {
        expect(q.params).toEqual([artifactId, runId]); expect(q.sql).toContain("<=4194304");
        const { contentWire, metadataWire, ...artifact } = state.artifact;
        return [[{ ...clone(artifact), ...wire("content", contentWire, 512 * 1024), ...wire("metadata", metadataWire, 16 * 1024), ...control.artifactPatch }], []];
      }
      throw new Error("Unexpected SQL");
    } });
    control.afterTx?.(tx); return value;
  } };
  const ctx = { user: { id: 3, role: "admin", defaultWorkspaceId: workspaceId }, workspaceId, req: {}, res: {} } as TrpcContext;
  const request = () => ({ projectId: 11, analysisId: 21, expectedWorkspaceId: workspaceId, expectedRevision: competitorRevision(state.analysis) });
  const service = createCompetitorDeepResultReadService({ database: async () => database, permission });
  return { state, control, calls, database, service, permission, ctx, request, result, stored, receipt, get txCount() { return txCount; } };
}

describe("authorized historical competitor deep results (offline MySqlDialect fixture)", () => {
  it("returns only the verified authorized result with exact original text and no current-approval/model dependency", async () => {
    const f = await fixture(), before = clone(f.state), result = await f.service.read(f.ctx, f.request());
    expect(result).toEqual({ status: "available", identity: { userId: 3, workspaceId: 7, sourceWorkspaceId: 7, projectId: 11, analysisId: 21, asin: "B000000001" },
      currentRevision: f.request().expectedRevision, sourceChanged: false, reviewRequired: true, result: f.result });
    if (result.status !== "available") throw new Error("Expected available");
    expect(result.result.deepAnalysis.buyers.groups[0].evidence[0].body).toBe(originalBody);
    expect(result.result.deepAnalysis.deepResearchComplete).toBe(false); expect(f.state).toEqual(before);
    expect(f.txCount).toBe(2); expect(f.permission).toHaveBeenCalledTimes(2);
    for (const [input] of f.permission.mock.calls as unknown as [Record<string, unknown>][]) {
      expect(input).toMatchObject({ action: "read", resource: "project", authorizationRead: { strict: true, lock: true } });
      expect(input).not.toHaveProperty("ownerUserId");
    }
    expect(f.calls.filter(call => call.tx === 2).map(call => call.sql.match(/FROM (\w+)/u)?.[1])).toEqual(["ai_jobs", "users", "projects", "competitorAnalyses", "ai_artifacts"]);
  });
  it("returns not_available only for an authorized row without a pointer", async () => {
    const f = await fixture(); f.state.analysis.rawData = JSON.stringify({ research: { original: true }, deepAnalysis: { legacy: true } });
    const result = await f.service.read(f.ctx, f.request()); expect(result).toMatchObject({ status: "not_available", sourceChanged: false, reviewRequired: true });
    expect(result).not.toHaveProperty("result"); expect(f.txCount).toBe(1); expect(f.calls).toHaveLength(3);
  });
  it("uses the actual strict policy helper and rejects an explicit deny despite parent ownership", async () => {
    const f = await fixture(), service = createCompetitorDeepResultReadService({ database: async () => f.database });
    await expect(service.read(f.ctx, f.request())).rejects.toThrow("DEEP_RESULT_READ_ACCESS_DENIED");
    expect(f.calls.some(call => call.sql.includes("FROM security_access_policies") && call.sql.endsWith("FOR UPDATE"))).toBe(true);
    expect(f.calls.some(call => call.sql.includes("FROM projects"))).toBe(false);
  });
  it("accepts bounded whitespace-heavy native JSON while enforcing canonical content hashes independently", async () => {
    const f = await fixture(); f.state.artifact.contentWire = " ".repeat(600 * 1024) + f.state.artifact.contentWire;
    f.state.job.outputWire = " ".repeat(20 * 1024) + f.state.job.outputWire;
    expect(await f.service.read(f.ctx, f.request())).toMatchObject({ status: "available", sourceChanged: false, result: f.result });
  });
  it("does not deliver a result if the final transaction acknowledgement fails", async () => {
    const f = await fixture(); f.control.afterTx = count => { if (count === 2) throw new Error("PRIVATE COMMIT ACK"); };
    await expect(f.service.read(f.ctx, f.request())).rejects.toThrow("DEEP_RESULT_READ_FAILED");
  });
  it.each(["source", "human", "confirmation"])("makes %s changes explicitly stale while retaining verified history", async which => {
    const f = await fixture();
    if (which === "source") f.state.analysis.price = "19.00";
    if (which === "human") f.state.analysis.summary = "New human draft";
    if (which === "confirmation") f.state.analysis.summaryStatus = "confirmed";
    expect(await f.service.read(f.ctx, f.request())).toMatchObject({ status: "available", sourceChanged: true, result: f.result });
  });
  it.each([null, 7])("accepts explicitly pinned legacy NULL parent within current workspace %s", async workspaceId => {
    const f = await fixture({ workspaceId, sourceWorkspaceId: null });
    expect(await f.service.read(f.ctx, f.request())).toMatchObject({ identity: { workspaceId, sourceWorkspaceId: null }, sourceChanged: false });
  });
  it("locks the UI's current revision rather than silently selecting a new row", async () => {
    const f = await fixture(), request = f.request(); f.state.analysis.title = "changed";
    await expect(f.service.read(f.ctx, request)).rejects.toThrow("DEEP_RESULT_READ_SOURCE_CHANGED");
    expect(f.calls.some(call => call.sql.includes("FROM ai_jobs"))).toBe(false);
  });
  it.each(["jobRunId", "skills", "plan", "extra"])("rejects a client %s before DB IO", async key => {
    const f = await fixture(); await expect(f.service.read(f.ctx, { ...f.request(), [key]: "forged" })).rejects.toThrow("DEEP_RESULT_READ_INPUT_INVALID");
    expect(f.txCount).toBe(0); expect(competitorDeepResultReadSchema.safeParse({ ...f.request(), [key]: true }).success).toBe(false);
  });
  it.each(["anonymous", "workspace", "inactive", "roleDenied", "parentOwner", "parentWorkspace"])("denies %s before touching artifact/job payloads", async which => {
    const f = await fixture();
    if (which === "anonymous") f.ctx.user = null;
    if (which === "workspace") f.ctx.workspaceId = 8;
    if (which === "inactive") f.state.user.status = "disabled";
    if (which === "roleDenied") f.control.deny = true;
    if (which === "parentOwner") f.state.project.userId = 4;
    if (which === "parentWorkspace") f.state.project.workspaceId = 8;
    await expect(f.service.read(f.ctx, f.request())).rejects.toThrow(/^DEEP_RESULT_READ_/u);
    expect(f.calls.some(call => /FROM ai_(jobs|artifacts)/u.test(call.sql))).toBe(false);
  });
  it.each(["actor", "source", "pointer"])("reauthorizes %s changed between the two transactions", async which => {
    const f = await fixture(), request = f.request();
    f.control.afterTx = count => {
      if (count !== 1) return;
      if (which === "actor") f.state.user.status = "disabled";
      if (which === "source") f.state.analysis.rawData += " ";
      if (which === "pointer") { const raw = JSON.parse(f.state.analysis.rawData!); raw.deepAnalysisRef.jobRunId = "other"; f.state.analysis.rawData = JSON.stringify(raw); }
    };
    await expect(f.service.read(f.ctx, request)).rejects.toThrow(/^DEEP_RESULT_READ_/u);
    expect(f.calls.some(call => call.sql.includes("FROM ai_artifacts"))).toBe(false);
  });
  it.each(["users", "projects", "competitorAnalyses", "ai_jobs", "ai_artifacts"])("does not invent missing %s data", async table => {
    const f = await fixture(); f.control.missing = table;
    await expect(f.service.read(f.ctx, f.request())).rejects.toThrow(/^DEEP_RESULT_READ_/u);
  });
  it.each(["kind", "module", "userId", "workspaceId", "projectId", "status", "maxAttempts", "progress", "lease", "worker"])("rejects job %s mismatch", async key => {
    const f = await fixture();
    const patch: Record<string, unknown> = { kind: "legacy", module: "operations", userId: 4, workspaceId: 8, projectId: 12,
      status: "running", maxAttempts: 2, progress: 99, lease: new Date(), worker: "still-owned" };
    f.control.jobPatch[key === "lease" ? "leaseUntil" : key === "worker" ? "lockedBy" : key] = patch[key];
    await expect(f.service.read(f.ctx, f.request())).rejects.toThrow("DEEP_RESULT_READ_JOB_INVALID");
  });
  it.each(["evidenceHash", "journal", "skillPlan"])("revalidates historical %s rather than trusting serialized receipts", async key => {
    const f = await fixture(), input = JSON.parse(f.state.job.inputWire);
    if (key === "evidenceHash") input.evidence.evidenceHash = "e".repeat(64);
    if (key === "journal") input.journal.steps[0].raw.titleZh = "forged";
    if (key === "skillPlan") input.skills.title.version = "different";
    f.state.job.inputWire = JSON.stringify(input);
    await expect(f.service.read(f.ctx, f.request())).rejects.toThrow("DEEP_RESULT_READ_JOB_INPUT_INVALID");
  });
  it.each(["artifactId", "resultHash", "evidenceHash", "skillPlanHash", "journalHash", "sourceRevision", "analysisId", "runId", "summaryVersion"])("rejects receipt %s mismatch", async key => {
    const f = await fixture(), output = JSON.parse(f.state.job.outputWire);
    output[key] = key === "analysisId" ? 22 : key === "summaryVersion" ? 99 : key === "runId" ? "foreign" : key === "artifactId" ? `deep_${"a".repeat(64)}` : "a".repeat(64);
    f.state.job.outputWire = JSON.stringify(output);
    await expect(f.service.read(f.ctx, f.request())).rejects.toThrow("DEEP_RESULT_READ_BINDING_INVALID");
  });
  it.each(["foreignUser", "current", "status", "hash", "metadata", "body", "fileSize", "node", "sourceRun"])("rejects artifact %s mismatch", async key => {
    const f = await fixture();
    if (key === "foreignUser") f.state.artifact.userId = 4;
    if (key === "current") f.state.artifact.isCurrent = 1;
    if (key === "status") f.state.artifact.status = "confirmed";
    if (key === "hash") f.state.artifact.contentHash = "a".repeat(64);
    if (key === "metadata") f.state.artifact.metadataWire = '{}';
    if (key === "body") f.state.artifact.contentWire = '{}';
    if (key === "fileSize") f.state.artifact.fileSizeBytes++;
    if (key === "node") f.state.artifact.nodeId = "N3";
    if (key === "sourceRun") f.state.artifact.sourceAiJobRunId = "other";
    await expect(f.service.read(f.ctx, f.request())).rejects.toThrow(/^DEEP_RESULT_READ_ARTIFACT_/u);
  });
  it.each(["pointer", "publication"])("requires the authorized %s envelope, not unrelated legacy research data", async key => {
    const f = await fixture(), raw = JSON.parse(f.state.analysis.rawData!);
    if (key === "pointer") raw.deepAnalysisRef.extra = true;
    else raw.deepResearchPublication = { ...raw.deepResearchPublication, resultHash: "e".repeat(64) };
    f.state.analysis.rawData = JSON.stringify(raw);
    await expect(f.service.read(f.ctx, f.request())).rejects.toThrow(key === "pointer" ? "DEEP_RESULT_READ_POINTER_INVALID" : "DEEP_RESULT_READ_PUBLICATION_INVALID");
  });
  it("rejects a self-consistent replaced artifact even when its content hash and receipt are forged together", async () => {
    const f = await fixture(), body = JSON.parse(f.state.artifact.contentWire), receipt = JSON.parse(f.state.job.outputWire), metadata = JSON.parse(f.state.artifact.metadataWire), raw = JSON.parse(f.state.analysis.rawData!);
    body.deepAnalysis.title.titleZh = "Invented translation";
    const content = canonical(body), contentHash = digest(content);
    f.state.artifact.contentWire = content; f.state.artifact.contentHash = contentHash; f.state.artifact.fileSizeBytes = Buffer.byteLength(content);
    receipt.artifactHash = contentHash; metadata.artifactHash = contentHash; raw.deepResearchPublication.artifactHash = contentHash;
    f.state.job.outputWire = JSON.stringify(receipt); f.state.artifact.metadataWire = JSON.stringify(metadata); f.state.analysis.rawData = JSON.stringify(raw);
    await expect(f.service.read(f.ctx, f.request())).rejects.toThrow("DEEP_RESULT_READ_REPLAY_MISMATCH");
  });
  it.each(["wireHash", "wireBytes", "nullPayload", "canonicalOversize", "analysisOversize"])("enforces bounded %s without truncating", async key => {
    const f = await fixture();
    if (key === "wireHash") f.control.artifactPatch.contentWireHash = "0".repeat(64);
    if (key === "wireBytes") f.control.artifactPatch.contentBytes = 1;
    if (key === "nullPayload") f.control.artifactPatch.contentText = null;
    if (key === "canonicalOversize") f.state.artifact.contentWire = JSON.stringify({ oversized: "x".repeat(512 * 1024) });
    if (key === "analysisOversize") f.control.analysisPatch.columnsWithinLimit = 0;
    await expect(f.service.read(f.ctx, f.request())).rejects.toThrow(/^DEEP_RESULT_READ_/u);
  });
  it("requires transactional reads and never falls back to a bare execute", async () => {
    const f = await fixture(), execute = vi.fn();
    const service = createCompetitorDeepResultReadService({ database: async () => ({ execute }) as never });
    await expect(service.read(f.ctx, f.request())).rejects.toThrow("DEEP_RESULT_READ_TRANSACTION_REQUIRED"); expect(execute).not.toHaveBeenCalled();
  });
  it.each([1146, 1054, 1205, 1213, 9999])("sanitizes SQL error %s", async errno => {
    const f = await fixture(); f.control.throwOn = "FROM ai_jobs"; f.control.error = { errno, sql: "PRIVATE", message: "PRIVATE", cause: { raw: "PRIVATE" } };
    const error = await f.service.read(f.ctx, f.request()).catch(error => error);
    expect(error).toBeInstanceOf(TRPCError); expect(error.message).toMatch(/^DEEP_RESULT_READ_/u); expect(error.message).not.toContain("PRIVATE"); expect(error.cause).toBeUndefined();
  });
});
