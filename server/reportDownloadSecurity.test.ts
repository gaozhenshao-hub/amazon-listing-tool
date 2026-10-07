import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  getProjectByIdAdmin: vi.fn(),
  getActiveListingByProject: vi.fn(),
  getProjectFilesByProject: vi.fn(),
  getCompetitorAnalysesByProject: vi.fn(),
  getKeywordsByProject: vi.fn(),
}));

vi.mock("./repositories", () => mocks);

import { appRouter } from "./routers";
import { LEGACY_REPORT_DOWNLOAD_DISABLED_MESSAGE } from "./routers/report";

const dataReads = [
  mocks.getProjectById,
  mocks.getProjectByIdAdmin,
  mocks.getActiveListingByProject,
  mocks.getProjectFilesByProject,
  mocks.getCompetitorAnalysesByProject,
  mocks.getKeywordsByProject,
];

function caller(role: string, workspaceId: number | null = 101) {
  return appRouter.createCaller({
    user: { id: 7, role, defaultWorkspaceId: workspaceId },
    workspaceId,
    req: { headers: {}, header: () => undefined },
    res: { locals: {} },
  } as any);
}

function expectNoReportDataRead() {
  for (const read of dataReads) expect(read).not.toHaveBeenCalled();
}

describe("report.generateReport legacy download boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a regular user before reading any project, Listing, raw upload, competitor, or keyword data", async () => {
    await expect(caller("ops_specialist").report.generateReport({ projectId: 41 }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: "系统下载仅限 super_admin。" });

    expectNoReportDataRead();
  });

  it("rejects a cross-workspace super_admin request before any database read", async () => {
    await expect(caller("super_admin", 101).report.generateReport({ projectId: 41, workspaceId: 202 }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: "不能为其他工作空间请求报告下载。" });

    expectNoReportDataRead();
  });

  it("rejects a super_admin without a current workspace before any database read", async () => {
    await expect(caller("super_admin", null).report.generateReport({ projectId: 41 }))
      .rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "报告下载已关闭：请先进入当前已授权工作空间。",
      });

    expectNoReportDataRead();
  });

  it("fails closed for a super_admin in the current workspace rather than exporting an unconfirmed draft", async () => {
    mocks.getActiveListingByProject.mockResolvedValue({
      id: 9,
      projectId: 41,
      title: "UNCONFIRMED DRAFT — must never be delivered",
    });

    await expect(caller("super_admin", 101).report.generateReport({ projectId: 41, workspaceId: 101 }))
      .rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: LEGACY_REPORT_DOWNLOAD_DISABLED_MESSAGE,
      });

    expectNoReportDataRead();
  });
});
