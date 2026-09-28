import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("Amazon acquisition direct-ingestion surface", () => {
  it("removes the manual snapshot review API and page while safely redirecting old links", () => {
    const router = read("server/domains/acquisition/router.ts");
    const app = read("client/src/App.tsx");
    expect(router).not.toContain("saveReview:");
    expect(router).not.toContain("confirmReview:");
    expect(router).not.toContain("rejectReview:");
    expect(router).not.toContain("review: protectedProcedure");
    expect(app).not.toContain("AcquisitionReviewPage");
    expect(app).toContain('path="/knowledge/acquisition/review/:snapshotId"');
    expect(app).toContain('<Redirect to="/knowledge/acquisition" />');
  });

  it("presents guarded direct ingestion instead of an acquisition review action", () => {
    const page = read("client/src/pages/acquisition/AcquisitionJobsPage.tsx");
    expect(page).toContain("采集任务与直接录入");
    expect(page).toContain("失败、部分结果或结构异常一律失败关闭");
    expect(page).toContain("历史任务：安全入库未完成");
    expect(page).toContain("自动安全校验中（无需人工审核）");
    expect(page).not.toContain("等待安全校验");
    expect(page).not.toContain("打开审核");
  });
});
