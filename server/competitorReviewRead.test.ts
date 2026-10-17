import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";
import type { CompetitorAnalysis } from "../drizzle/schema/project";
import { createCompetitorReviewReadRepository, competitorReviewReadSession } from "./repositories/listing/competitorReviewReadRepository";
import { buildCompetitorReviewCorpus } from "./domains/listing/services/competitorReviewCorpus";
vi.mock("./services/securityGovernance", () => ({ assertResourceAction: vi.fn() }));
import { createCompetitorReviewReadService, competitorReviewsPageSchema, competitorReviewSourceSchema } from "./domains/listing/services/competitorReviewRead";
import { competitorRevision } from "./repositories/project/competitorWritePolicy";
import { createCompetitorResearchEvidenceService } from "./domains/listing/services/competitorResearchEvidence";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const dialect = new MySqlDialect(), asin = "B000000001", filename = `${asin}-Reviews.csv`;
const date = new Date("2026-10-16T00:00:00Z");
type Job = { runId: string; userId: number; projectId: number; workspaceId: number | null; kind: string; module: string;
  status: string; input: string; results: Array<{ analysisId: number; asin: string; status: string }> };
function fixture() {
  const bytes = Buffer.from("ASIN,Content,Rating\n" + Array.from({ length: 35 }, (_, i) => `${asin},原文 ${i},5`).join("\n"));
  const user = { id: 3, role: "ops_specialist", status: "active", defaultWorkspaceId: 7 as number | null };
  const project = { id: 11, userId: 3, workspaceId: 7 as number | null };
  const analysis: CompetitorAnalysis = { id: 21, projectId: 11, asin, title: "title", bulletPoints: null, imageUrls: null,
    price: null, rating: "4.8", reviewCount: "9999", reviewAnalysis: '{"quotes":["not original"]}', keywords: null,
    rawData: JSON.stringify({ reviewImport: { filename, sourceHash: digest(bytes) } }), aiSummary: "AI", summary: "AI",
    summaryStatus: "draft", summaryVersion: 1, summaryConfirmedBy: null, summaryConfirmedAt: null, createdAt: date, updatedAt: date };
  const job: Job = { runId: `analysis_import_${"a".repeat(48)}`, userId: 3, projectId: 11, workspaceId: 7,
    kind: "analysis.import.reviews", module: "listing", status: "failed",
    input: JSON.stringify({ kind: "reviews", projectId: 11, filename, fileBase64: bytes.toString("base64"), agentRunId: "saved", agentNodeId: "N5" }),
    results: [{ analysisId: 21, asin, status: "matched" }, { analysisId: 22, asin: "B000000002", status: "failed" }] };
  const jobs: Job[] = [job], trace: Array<{ text: string; params: unknown[] }> = [];
  let txCount = 0, beforeTx: ((n: number) => void) | undefined, duringParse: (() => void) | undefined, fault = "";
  const executor = { async execute(statement: SQL) {
    const { sql: text, params: p } = dialect.sqlToQuery(statement); trace.push({ text, params: p });
    if (fault === "schema") throw { errno: 1146, message: "SECRET_SQL_UPLOAD" };
    if (fault === "db") throw new Error("SECRET_SQL_UPLOAD");
    if (fault === "shape") return {};
    if (text.startsWith("SELECT id,status")) return [[structuredClone(user)], []];
    if (text.startsWith("SELECT id,userId")) return [[structuredClone(project)], []];
    if (text.startsWith("SELECT * FROM competitorAnalyses")) return [[structuredClone(analysis)], []];
    const scoped = jobs.filter(j => j.userId === p[0] && j.projectId === p[1] && j.workspaceId === p[2]
      && j.kind === "analysis.import.reviews" && j.module === "listing" && ["succeeded", "failed", "canceled"].includes(j.status));
    const linked = (j: Job, from: number) => Array.isArray(j.results) && j.results.some(r => r && !Array.isArray(r)
      && r.asin === p[from + 1] && Number.isSafeInteger(r.analysisId) && r.analysisId === p[from] && ["matched", "new"].includes(r.status));
    if (text.startsWith("SELECT runId,OCTET_LENGTH")) return [scoped.filter(j => JSON.parse(j.input).filename === p[3] && linked(j, 4)).slice(0, 21)
      .map(j => ({ runId: j.runId, inputBytes: Buffer.byteLength(j.input), inputHash: digest(j.input) })), []];
    if (text.startsWith("SELECT CAST(input")) return [scoped.filter(j => j.runId === p[3] && Buffer.byteLength(j.input) <= Number(p[4]) && digest(j.input) === p[5])
      .map(j => ({ inputJson: j.input })), []];
    if (text.startsWith("SELECT runId FROM ai_jobs")) return [scoped.filter(j => j.runId === p[3] && digest(j.input) === p[4]
      && JSON.parse(j.input).filename === p[5] && linked(j, 6)).map(j => ({ runId: j.runId })), []];
    throw new Error(`Unexpected fixture query ${text}`);
  } };
  const repository = createCompetitorReviewReadRepository(async () => ({ async transaction(callback) { beforeTx?.(++txCount); return callback(executor); } }));
  const permission = vi.fn(async () => undefined);
  const parse = vi.fn((input: Parameters<typeof buildCompetitorReviewCorpus>[0]) => {
    const result = buildCompetitorReviewCorpus(input); duringParse?.(); return result;
  });
  const service = createCompetitorReviewReadService({ repository, permission, parse });
  const ctx = { user: { ...user }, workspaceId: 7 } as unknown as TrpcContext;
  const request = { projectId: 11, analysisId: 21, expectedWorkspaceId: 7 as number | null, page: 1, pageSize: 30 };
  return { service, repository, ctx, request, user, project, analysis, job, jobs, trace, parse, permission,
    setBeforeTx(fn: typeof beforeTx) { beforeTx = fn; }, setDuringParse(fn: typeof duringParse) { duringParse = fn; }, setFault(value: string) { fault = value; } };
}
describe("authorized original competitor review pages (real service, SQL adapter and parser; offline DB model)", () => {
  it("reads failed import's successful member, full original body and fixed-hash second page", async () => {
    const f = fixture(), first = await f.service.list(f.ctx, f.request);
    expect(first.status).toBe("available");
    if (first.status !== "available") throw new Error();
    expect(first.total).toBe(35); expect(first.items).toHaveLength(30); expect(first.coverage.matchedRows).toBe(35);
    expect(first.items[0].body).toBe("原文 0"); expect(JSON.stringify(first)).not.toContain("9999");
    expect(JSON.stringify(first)).not.toContain("fileBase64"); expect(JSON.stringify(first)).not.toContain("not original");
    const second = await f.service.list(f.ctx, { ...f.request, page: 2, expectedCorpusHash: first.corpusHash });
    expect(second.items).toHaveLength(5); expect(second.corpusHash).toBe(first.corpusHash);
    expect(second.items[0].reviewId).not.toBe(first.items[0].reviewId);
    expect(f.trace.every(q => q.text.startsWith("SELECT"))).toBe(true);
    for (const [call] of f.permission.mock.calls as unknown as Array<[Record<string, any>]>) {
      expect(call.resource).toBe("project"); expect(call.action).toBe("read"); expect(call).not.toHaveProperty("ownerUserId");
      expect(call.authorizationRead).toMatchObject({ strict: true, lock: true });
    }
  });
  it("metadata lookup never selects payload and uses exact null-safe scope, binary filename, receipts before LIMIT", async () => {
    const f = fixture(); await f.service.list(f.ctx, f.request);
    const meta = f.trace.find(q => q.text.startsWith("SELECT runId,OCTET_LENGTH"))!;
    expect(meta.text).toContain("workspaceId<=>?"); expect(meta.text).toContain("BINARY JSON_UNQUOTE");
    expect(meta.text).toContain("CHAR CHARACTER SET utf8mb4"); expect(meta.text).toContain("LIMIT 21");
    expect(meta.text.slice(0, meta.text.indexOf(" FROM "))).not.toMatch(/inputJson|fileBase64|SELECT \*/);
    const final = f.trace.filter(q => q.text.startsWith("SELECT runId FROM ai_jobs")).at(-1)!;
    expect(final.text).toContain("JSON_TABLE"); expect(final.text).toContain("JSON_TYPE(review_receipt.item)='OBJECT'");
    expect(final.params.slice(-2)).toEqual([21, asin]);
  });
  for (const dimension of ["userId", "projectId", "workspaceId", "kind", "module", "status", "receipt", "filename"]) it(`does not recover a source with different ${dimension}`, async () => {
    const f = fixture();
    if (dimension === "receipt") f.job.results = [{ analysisId: 999, asin, status: "matched" }];
    else if (dimension === "filename") f.job.input = f.job.input.replace(filename, filename.toLowerCase());
    else (f.job as any)[dimension] = ["userId", "projectId", "workspaceId"].includes(dimension) ? 99 : "other";
    const result = await f.service.list(f.ctx, f.request);
    expect(result).toMatchObject({ status: "unavailable", total: null, source: null, coverage: null, items: [] });
    expect(f.parse).not.toHaveBeenCalled(); expect(f.trace.some(q => q.text.startsWith("SELECT CAST(input"))).toBe(false);
  });
  it("supports owner legacy parent NULL but doesn't read jobs from the authenticated positive workspace", async () => {
    const f = fixture(); f.project.workspaceId = null;
    expect((await f.service.list(f.ctx, f.request)).status).toBe("unavailable");
    f.job.workspaceId = null; expect((await f.service.list(f.ctx, f.request)).status).toBe("available");
  });
  it("explicit authenticated NULL never falls back to context user workspace", async () => {
    const f = fixture(); f.ctx.workspaceId = null; f.request.expectedWorkspaceId = null;
    await expect(f.service.list(f.ctx, f.request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.user.defaultWorkspaceId = null; f.project.workspaceId = null; f.job.workspaceId = null;
    expect((await f.service.list(f.ctx, f.request)).status).toBe("available");
  });
  it("rejects denied project.read even for the owning user", async () => {
    const f = fixture(); f.permission.mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "PRIVATE" }));
    await expect(f.service.list(f.ctx, f.request)).rejects.toMatchObject({ code: "FORBIDDEN", message: "COMPETITOR_REVIEWS_ACCESS_DENIED" });
    expect(f.trace.some(q => q.text.includes("ai_jobs"))).toBe(false);
  });
  for (const change of ["actor", "workspace", "policy", "owner", "parentWorkspace", "revision", "source", "receipt", "jobDelete", "payload"]) it(`revalidates ${change} after parsing`, async () => {
    const f = fixture(); f.setDuringParse(() => {
      if (change === "actor") f.user.status = "disabled";
      if (change === "workspace") f.user.defaultWorkspaceId = 8;
      if (change === "policy") f.permission.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
      if (change === "owner") f.project.userId = 8;
      if (change === "parentWorkspace") f.project.workspaceId = null;
      if (change === "revision") f.analysis.summary = "human edit";
      if (change === "source") f.analysis.rawData = "{}";
      if (change === "receipt") f.job.results = [];
      if (change === "jobDelete") f.jobs.length = 0;
      if (change === "payload") f.job.input += " ";
    });
    await expect(f.service.list(f.ctx, f.request)).rejects.toBeInstanceOf(TRPCError);
    expect(f.parse).toHaveBeenCalledOnce();
  });
  it("rechecks scope before reading even the first uploaded payload", async () => {
    const f = fixture(); f.setBeforeTx(n => { if (n === 2) f.project.userId = 8; });
    await expect(f.service.list(f.ctx, f.request)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.trace.some(q => q.text.startsWith("SELECT CAST(input"))).toBe(false);
  });
  it("same filename and saved receipt cannot substitute different original bytes", async () => {
    const f = fixture(); const input = JSON.parse(f.job.input); input.fileBase64 = Buffer.from("Content\nwrong").toString("base64"); f.job.input = JSON.stringify(input);
    expect((await f.service.list(f.ctx, f.request)).status).toBe("unavailable"); expect(f.parse).not.toHaveBeenCalled();
  });
  it("handles missing metadata without hallucinating zero or quote-derived originals", async () => {
    const f = fixture(); f.analysis.rawData = "{}";
    expect(await f.service.list(f.ctx, f.request)).toMatchObject({ status: "unavailable", total: null });
    expect(f.trace.some(q => q.text.includes("ai_jobs"))).toBe(false);
  });
  for (const rawData of ["bad", "[]", '{"reviewImport":{}}']) it("invalid saved metadata is an error, not absent reviews", async () => {
    const f = fixture(); f.analysis.rawData = rawData;
    await expect(f.service.list(f.ctx, f.request)).rejects.toMatchObject({ message: "COMPETITOR_REVIEWS_METADATA_INVALID" });
  });
  it("requires fixed corpus after page one, bounds pages and rejects stale anchors", async () => {
    const f = fixture();
    expect(competitorReviewsPageSchema.safeParse({ ...f.request, page: 2 }).success).toBe(false);
    expect(competitorReviewsPageSchema.safeParse({ ...f.request, pageSize: 51 }).success).toBe(false);
    await expect(f.service.list(f.ctx, { ...f.request, expectedCorpusHash: "b".repeat(64) })).rejects.toMatchObject({ code: "CONFLICT", message: "COMPETITOR_REVIEWS_CORPUS_CHANGED" });
    const first = await f.service.list(f.ctx, f.request);
    await expect(f.service.list(f.ctx, { ...f.request, page: 3, expectedCorpusHash: first.corpusHash! })).rejects.toMatchObject({ message: "COMPETITOR_REVIEWS_PAGE_OUT_OF_RANGE" });
  });
  it("rejects 21 candidates explicitly before reading any payload", async () => {
    const f = fixture(); for (let i = 0; i < 20; i++) f.jobs.push({ ...f.job, runId: `${f.job.runId}_${i}` });
    await expect(f.service.list(f.ctx, f.request)).rejects.toMatchObject({ message: "COMPETITOR_REVIEWS_SOURCE_HISTORY_LIMIT" });
    expect(f.trace.some(q => q.text.startsWith("SELECT CAST(input"))).toBe(false);
  });
  it.each([{ analysisId: "21", asin, status: "matched" }, { analysisId: 21, asin, status: "MATCHED" },
    [{ analysisId: 21, asin, status: "matched" }]])("rejects noncanonical or nested receipt members %#", async result => {
    const f = fixture(); f.job.results = [result] as any;
    expect((await f.service.list(f.ctx, f.request)).status).toBe("unavailable");
  });
  it("rejects object results instead of a direct results array", async () => {
    const f = fixture(); f.job.results = { analysisId: 21, asin, status: "matched" } as any;
    expect((await f.service.list(f.ctx, f.request)).status).toBe("unavailable");
  });
  it("repository refuses overlarge payload metadata without querying the original", async () => {
    const execute = vi.fn(), session = competitorReviewReadSession({ execute });
    await expect(session.payload({ userId: 3, projectId: 11, workspaceId: 7 }, {
      runId: `analysis_import_${"a".repeat(48)}`, inputBytes: 32 * 1024 * 1024 + 1, inputHash: "a".repeat(64),
    })).rejects.toMatchObject({ message: "COMPETITOR_REVIEWS_SOURCE_TOO_LARGE" });
    expect(execute).not.toHaveBeenCalled();
  });
  for (const field of ["kind", "projectId", "fileBase64"]) it(`rejects inconsistent stored input ${field}`, async () => {
    const f = fixture(), input = JSON.parse(f.job.input); input[field] = field === "projectId" ? 999 : "invalid"; f.job.input = JSON.stringify(input);
    await expect(f.service.list(f.ctx, f.request)).rejects.toMatchObject({ message: "COMPETITOR_REVIEWS_SOURCE_INVALID" });
  });
  it("explicitly rejects unsupported XLS originals without exposing parser cells", async () => {
    const f = fixture(), input = JSON.parse(f.job.input), name = `${asin}.xls`;
    input.filename = name; f.job.input = JSON.stringify(input); f.analysis.rawData = JSON.stringify({ reviewImport: { filename: name, sourceHash: digest(Buffer.from(input.fileBase64, "base64")) } });
    await expect(f.service.list(f.ctx, f.request)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "COMPETITOR_REVIEWS_FILE_UNSUPPORTED_OR_INVALID" });
  });
  for (const fault of ["schema", "db", "shape"]) it(`does not disguise ${fault} errors as missing original`, async () => {
    const f = fixture(); f.setFault(fault);
    try { await f.service.list(f.ctx, f.request); throw new Error("not rejected"); }
    catch (error) { expect(error).toBeInstanceOf(TRPCError); expect(String(error)).not.toContain("SECRET_SQL_UPLOAD"); }
  });
  it("rejects missing transaction support instead of autocommit fallback", async () => {
    const repository = createCompetitorReviewReadRepository(async () => ({})), callback = vi.fn();
    await expect(repository.transaction(callback)).rejects.toMatchObject({ message: "COMPETITOR_REVIEWS_TRANSACTION_REQUIRED" });
    expect(callback).not.toHaveBeenCalled();
  });
});

describe("server-only complete authorized corpus for selected research", () => {
  const request = { projectId: 11, analysisId: 21, expectedWorkspaceId: 7 };
  it("connects the real authorized reader, SQL adapter, original parser and evidence preview without a model", async () => {
    const f = fixture(), evidence = createCompetitorResearchEvidenceService({ readFullCorpus: f.service.readFullCorpus });
    const result = await evidence.preview(f.ctx, { ...request, expectedRevision: competitorRevision(f.analysis) });
    expect(result).toMatchObject({ modelRead: false, listing: { titleAvailable: true, bulletCount: 0 },
      reviews: { status: "available", total: 35, scope: "complete_file_not_market_total" } });
    expect(result.reviews.batches.reduce((sum, batch) => sum + batch.count, 0)).toBe(35);
    expect(f.parse).toHaveBeenCalledOnce(); expect(f.trace.every(q => q.text.startsWith("SELECT"))).toBe(true);
  });
  it("returns every original in one parse and binds listing and reviews to the same whole-row revision", async () => {
    const f = fixture(); f.analysis.bulletPoints = '["保存的五点原文"]';
    const expectedRevision = competitorRevision(f.analysis);
    const result = await f.service.readFullCorpus(f.ctx, { ...request, expectedRevision });
    expect(result.identity).toEqual({ userId: 3, workspaceId: 7, sourceWorkspaceId: 7, projectId: 11, analysisId: 21, asin, revision: expectedRevision });
    expect(result.listing).toEqual({ title: "title", bulletPoints: f.analysis.bulletPoints });
    expect(result.reviews.status).toBe("available");
    if (result.reviews.status !== "available") throw new Error();
    expect(result.reviews.corpus.items).toHaveLength(35);
    expect(result.reviews.corpus.items.at(-1)?.body).toBe("原文 34");
    expect(f.parse).toHaveBeenCalledOnce();
    expect(f.trace.filter(q => q.text.startsWith("SELECT CAST(input"))).toHaveLength(1);
    expect(f.trace.every(q => q.text.startsWith("SELECT"))).toBe(true);
    const page = await f.service.list(f.ctx, f.request);
    expect(result.reviews.authorizedCorpusHash).toBe(page.corpusHash);
    expect(result.reviews.corpus.corpusHash).not.toBe(page.corpusHash);
    expect(JSON.stringify(result)).not.toMatch(/not original|fileBase64|aiSummary/);
  });
  it("refuses a stale row before loading its original file", async () => {
    const f = fixture();
    await expect(f.service.readFullCorpus(f.ctx, { ...request, expectedRevision: "c".repeat(64) })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.parse).not.toHaveBeenCalled(); expect(f.trace.some(q => q.text.includes("ai_jobs"))).toBe(false);
  });
  it("does not silently truncate long originals at the old 12,000-character prompt limit", async () => {
    const f = fixture(), body = "原文".repeat(7000) + "尾部证据";
    const bytes = Buffer.from(`ASIN,Content\n${asin},${body}`), payload = JSON.parse(f.job.input);
    payload.fileBase64 = bytes.toString("base64"); f.job.input = JSON.stringify(payload);
    f.analysis.rawData = JSON.stringify({ reviewImport: { filename, sourceHash: digest(bytes) } });
    const result = await f.service.readFullCorpus(f.ctx, request);
    if (result.reviews.status !== "available") throw new Error();
    expect(result.reviews.corpus.items[0].body).toBe(body);
    expect(result.reviews.corpus.coverage.scope).toBe("complete_file_not_market_total");
  });
  it("keeps a complete empty import distinct from an unavailable original", async () => {
    const f = fixture(), bytes = Buffer.from("ASIN,Content\nB000000002,其他竞品"), payload = JSON.parse(f.job.input);
    payload.fileBase64 = bytes.toString("base64"); f.job.input = JSON.stringify(payload);
    f.analysis.rawData = JSON.stringify({ reviewImport: { filename, sourceHash: digest(bytes) } });
    const empty = await f.service.readFullCorpus(f.ctx, request);
    expect(empty.reviews).toMatchObject({ status: "available", corpus: { items: [], coverage: { uniqueReviews: 0, otherAsinRows: 1 } } });
    f.analysis.rawData = "{}";
    expect((await f.service.readFullCorpus(f.ctx, request)).reviews).toEqual({ status: "unavailable", reason: expect.any(String) });
  });
  it("binds legacy NULL parent scope independently of authenticated workspace", async () => {
    const f = fixture(); f.project.workspaceId = null; f.job.workspaceId = null;
    const result = await f.service.readFullCorpus(f.ctx, request);
    expect(result.identity).toMatchObject({ workspaceId: 7, sourceWorkspaceId: null });
    expect(result.reviews.status).toBe("available");
  });
  it.each(["title", "bulletPoints", "owner", "receipt"])("revalidates %s after full parsing", async change => {
    const f = fixture(); f.setDuringParse(() => {
      if (change === "title") f.analysis.title = "changed";
      if (change === "bulletPoints") f.analysis.bulletPoints = '["changed"]';
      if (change === "owner") f.project.userId = 99;
      if (change === "receipt") f.job.results = [];
    });
    await expect(f.service.readFullCorpus(f.ctx, request)).rejects.toBeInstanceOf(TRPCError);
  });
  it.each([{ page: 1 }, { pageSize: 1 }, { userId: 999 }, { expectedRevision: "invalid" }, { corpus: {} }])("rejects unsupported server-read fields %#", extra => {
    expect(competitorReviewSourceSchema.safeParse({ ...request, ...extra }).success).toBe(false);
  });
});
