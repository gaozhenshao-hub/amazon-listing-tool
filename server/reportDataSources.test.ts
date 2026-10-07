import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  getProjectByIdAdmin: vi.fn(),
  getActiveListingByProject: vi.fn(),
  getProjectFilesByProject: vi.fn(),
  getCompetitorAnalysesByProject: vi.fn(),
  getKeywordsByProject: vi.fn(),
}));

// These are the exact legacy sources the former report assembler joined into a
// printable payload. A rejection must happen before any of them runs.
vi.mock("./repositories", () => mocks);

import { LEGACY_REPORT_DOWNLOAD_DISABLED_MESSAGE, reportRouter } from "./routers/report";

const legacyReportDataReads = [
  mocks.getProjectById,
  mocks.getProjectByIdAdmin,
  mocks.getActiveListingByProject,
  mocks.getProjectFilesByProject,
  mocks.getCompetitorAnalysesByProject,
  mocks.getKeywordsByProject,
];

function superAdminCaller(workspaceId = 101) {
  return reportRouter.createCaller({
    user: { id: 1, role: "super_admin", defaultWorkspaceId: workspaceId },
    workspaceId,
    req: { headers: {}, header: () => undefined },
    res: { locals: {} },
  } as any);
}

function expectNoLegacyReportRead() {
  for (const read of legacyReportDataReads) expect(read).not.toHaveBeenCalled();
}

describe("Report data sources - governed download boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not assemble a printable payload from active Listing, raw analysis, competitor, or keyword data", async () => {
    mocks.getActiveListingByProject.mockResolvedValue({
      id: 1,
      projectId: 1,
      title: "Legacy unreviewed active Listing",
    });
    mocks.getProjectFilesByProject.mockResolvedValue([{ status: "completed", analysisResult: "{}" }]);
    mocks.getCompetitorAnalysesByProject.mockResolvedValue([{ asin: "B001TEST01" }]);
    mocks.getKeywordsByProject.mockResolvedValue([{ keyword: "unsafe legacy keyword" }]);

    await expect(superAdminCaller().generateReport({ projectId: 1, workspaceId: 101 }))
      .rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: LEGACY_REPORT_DOWNLOAD_DISABLED_MESSAGE,
      });

    expectNoLegacyReportRead();
  });

  it("documents that only a future verified complete-snapshot export may re-enable this route", async () => {
    await expect(superAdminCaller().generateReport({ projectId: 1 }))
      .rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("当前工作空间已确认完整快照"),
      });

    expectNoLegacyReportRead();
  });
});
