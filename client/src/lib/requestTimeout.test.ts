import { describe, expect, it } from "vitest";
import { getRequestTimeoutMs } from "./requestTimeout";

describe("file import transport budgets", () => {
  it.each(["previewReviewFile", "previewSellerSpriteFile", "startImportJob", "importReviews"])(
    "allows upload time for %s instead of the ordinary 30 second limit",
    procedure => expect(getRequestTimeoutMs(`/api/trpc/analysis.${procedure}?batch=1`)).toBe(180_000),
  );
  it("uses the longest budget when uploads are batched with ordinary requests", () => {
    expect(getRequestTimeoutMs("https://example.test/api/trpc/auth.me,analysis.previewReviewFile?batch=1")).toBe(180_000);
  });
  it("keeps status polling short and preserves existing analysis budgets", () => {
    expect(getRequestTimeoutMs("/api/trpc/analysis.listImportJobs?batch=1")).toBe(30_000);
    expect(getRequestTimeoutMs("/api/trpc/analysis.analyzeFromSellerSprite?batch=1")).toBe(180_000);
  });
});
