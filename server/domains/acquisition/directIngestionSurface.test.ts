import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("Amazon acquisition direct-ingestion surface", () => {
  it("retains default direct ingestion and exposes optional scoped manual review without automatic analysis", () => {
    const router = read("server/domains/acquisition/router.ts");
    const app = read("client/src/App.tsx");
    expect(router).toContain("saveReview: protectedProcedure.input(AcquisitionReviewSaveInputSchema)");
    expect(router).toContain("confirmReview: protectedProcedure.input(AcquisitionReviewConfirmInputSchema)");
    expect(router).toContain("rejectReview: protectedProcedure.input(AcquisitionReviewRejectInputSchema)");
    expect(router).toContain("review: protectedProcedure.input(AcquisitionReviewReadInputSchema)");
    expect(router).toContain('supplementMissingImage: workspaceScopedProcedure("knowledge")');
    expect(router).toContain('confirmCompletedCollection: workspaceScopedProcedure("knowledge")');
    expect(app).toContain('path="/knowledge/acquisition/review/:snapshotId"');
    expect(app).toContain('<PermissionGuard><AcquisitionReviewPage /></PermissionGuard>');
    expect(app).toContain('path="/knowledge/acquisition/job/:jobId"');
    const runtime = read("server/domains/acquisition/manualSnapshotReviewRuntime.ts");
    expect(runtime).toContain("createManualSnapshotConsumerPublisher");
    expect(runtime).not.toContain("triggerConsumerPostConfirmation");
    expect(read("server/domains/acquisition/manualSnapshotReviewRepository.ts")).toContain('process.env.ENABLE_ACQUISITION_REVIEW_WRITES === "true"');
  });

  it("presents guarded direct ingestion instead of an acquisition review action", () => {
    const page = read("client/src/pages/acquisition/AcquisitionJobsPage.tsx");
    expect(page).toContain("图片采集任务");
    expect(page).toContain("全部素材齐全后自动入库并打标签");
    expect(page).toContain("缺失的图片或视频可在对应位置单独补采、上传");
    expect(page).toContain("采集重复 ASIN");
    expect(page).toContain("KnowledgeCollectionForm");
    expect(page).toContain("自动安全校验中（无需人工审核）");
    expect(page).not.toContain("等待安全校验");
    expect(page).not.toContain("打开审核");
  });
});
