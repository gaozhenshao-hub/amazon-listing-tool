import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../../_core/context";
import type { AuthorizedCompetitorReviewSource } from "./competitorReviewRead";
import { buildCompetitorReviewCorpus } from "./competitorReviewCorpus";
import { createCompetitorResearchEvidenceService } from "./competitorResearchEvidence";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const asin = "B000000001", revision = "a".repeat(64);
const request = { projectId: 11, analysisId: 21, expectedWorkspaceId: 7, expectedRevision: revision };
const ctx = { user: { id: 3, role: "ops_specialist", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
function fixture(rows = 125) {
  const fileName = `${asin}-Reviews.csv`, bytes = Buffer.from("ASIN,Review ID,Content\n"
    + (rows ? Array.from({ length: rows }, (_, i) => `${asin},SOURCE${i},精确原文 ${i} 第两句`).join("\n") : "B000000002,OTHER,其他竞品"));
  const corpus = buildCompetitorReviewCorpus({ bytes, fileName, asin, projectId: 11, analysisId: 21, sourceFileHash: digest(bytes) });
  const source: AuthorizedCompetitorReviewSource = {
    identity: { userId: 3, workspaceId: 7, sourceWorkspaceId: 7, projectId: 11, analysisId: 21, asin, revision },
    listing: { title: "  原标题  ", bulletPoints: '["第1条原文","第2条原文"]' },
    reviews: { status: "available", authorizedCorpusHash: "b".repeat(64), source: { runId: "analysis_import_" + "c".repeat(48), fileName, fileHash: digest(bytes) }, corpus },
  };
  const readFullCorpus = vi.fn(async () => source);
  return { source, readFullCorpus, service: createCompetitorResearchEvidenceService({ readFullCorpus }) };
}
describe("selected saved research evidence loader (offline, no model or writes)", () => {
  it("loads the complete original once, binds exact selection and returns only source coverage for preview", async () => {
    const f = fixture(), result = await f.service.preview(ctx, request);
    expect(f.readFullCorpus).toHaveBeenCalledOnce(); expect(f.readFullCorpus).toHaveBeenCalledWith(ctx, request);
    expect(result).toMatchObject({ version: 1, identity: f.source.identity, modelRead: false,
      listing: { titleAvailable: true, bulletCount: 2, sourceCount: 3 }, reviews: { status: "available", total: 125, scope: "complete_file_not_market_total" } });
    expect(result.reviews.batches.reduce((sum, batch) => sum + batch.count, 0)).toBe(125);
    expect(result.reviews.batches.every(batch => batch.utf8Bytes <= 24576 && batch.count <= 60)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/原标题|精确原文|第1条原文|SOURCE0|Reviews.csv|fileBase64|occurrences|"author"/);
    const plan = await f.service.load(ctx, request);
    expect(plan.listingSources[0].text).toBe("  原标题  ");
    if (plan.reviews.status !== "available") throw new Error();
    expect(plan.reviews.batches.flatMap(batch => batch.items).at(-1)?.body).toBe("精确原文 124 第两句");
  });
  it("available zero and unavailable unknown remain different; neither is model-read", async () => {
    const f = fixture(0);
    expect((await f.service.preview(ctx, request)).reviews).toMatchObject({ status: "available", total: 0, batchCount: 0 });
    f.source.reviews = { status: "unavailable", reason: "没有可核验的原文件" };
    expect(await f.service.preview(ctx, request)).toMatchObject({ modelRead: false, reviews: { status: "unavailable", total: null, batchCount: 0, scope: null, sourceFileHash: null } });
  });
  it("supports a separately bound legacy NULL parent without broadening user scope", async () => {
    const f = fixture(); f.source.identity.sourceWorkspaceId = null;
    expect((await f.service.preview(ctx, request)).identity.sourceWorkspaceId).toBeNull();
  });
  it.each(["userId", "workspaceId", "sourceWorkspaceId", "projectId", "analysisId", "revision"])("rejects a mismatched reader %s", async key => {
    const f = fixture(); Object.assign(f.source.identity, { [key]: key === "revision" ? "d".repeat(64) : 999 });
    await expect(f.service.preview(ctx, request)).rejects.toMatchObject({ message: "COMPETITOR_EVIDENCE_SCOPE_CHANGED" });
  });
  it.each(["broken", "{}", "null", '["ok",null]', '[""]', JSON.stringify(["x".repeat(32001)])])("never replaces malformed listing input with an empty success %#", async bulletPoints => {
    const f = fixture(); f.source.listing.bulletPoints = bulletPoints;
    await expect(f.service.preview(ctx, request)).rejects.toMatchObject({ message: "COMPETITOR_EVIDENCE_LISTING_INVALID" });
  });
  it("missing saved title/bullets are explicit and do not require a new upload", async () => {
    const f = fixture(); f.source.listing = { title: null, bulletPoints: null };
    expect((await f.service.preview(ctx, request)).listing).toEqual({ titleAvailable: false, bulletCount: 0, sourceCount: 0 });
  });
  it("does not silently cut a single over-budget review or pretend the file is missing", async () => {
    const f = fixture(1);
    const fileName = `${asin}-Reviews.csv`, bytes = Buffer.from(`ASIN,Content\n${asin},${"中".repeat(9000)}`);
    const corpus = buildCompetitorReviewCorpus({ bytes, fileName, asin, projectId: 11, analysisId: 21, sourceFileHash: digest(bytes) });
    f.source.reviews = { status: "available", authorizedCorpusHash: "b".repeat(64), source: { runId: "original", fileName, fileHash: digest(bytes) }, corpus };
    await expect(f.service.preview(ctx, request)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "COMPETITOR_EVIDENCE_REVIEW_TOO_LARGE" });
  });
  it("preserves safe denial, hides unknown source content/errors and requires an exact revision", async () => {
    const f = fixture();
    f.readFullCorpus.mockRejectedValueOnce(new TRPCError({ code: "FORBIDDEN", message: "COMPETITOR_REVIEWS_ACCESS_DENIED" }));
    await expect(f.service.preview(ctx, request)).rejects.toMatchObject({ code: "FORBIDDEN", message: "COMPETITOR_REVIEWS_ACCESS_DENIED" });
    f.readFullCorpus.mockRejectedValueOnce(new Error("PRIVATE_RAW_PAYLOAD"));
    await expect(f.service.preview(ctx, request)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "COMPETITOR_EVIDENCE_PREVIEW_FAILED" });
    await expect(f.service.preview(ctx, { ...request, expectedRevision: undefined } as unknown as typeof request)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.readFullCorpus).toHaveBeenCalledTimes(2);
  });
});
