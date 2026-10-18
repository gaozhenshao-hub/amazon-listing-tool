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
    expect(router).toContain("ingestLegacyPartialJob: protectedProcedure");
    expect(router).toContain("confirmSnapshotForDirectIngestion({ workspaceId, snapshotId: snapshot.id, requestedBy: ctx.user.id })");
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
    expect(page).toContain("采集任务与直接录入");
    expect(page).toContain("已安全保存的图片立即直接录入");
    expect(page).toContain("缺失图片保留为可见缺口");
    expect(page).toContain("历史任务：可直接录入已安全保存的图片");
    expect(page).toContain("直接入库已保存图片");
    expect(page).toContain("自动安全校验中（无需人工审核）");
    expect(page).not.toContain("等待安全校验");
    expect(page).not.toContain("打开审核");
  });
});
