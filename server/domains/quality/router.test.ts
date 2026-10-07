import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readQualityDashboard: vi.fn() }));

vi.mock("./qualityDashboardService", () => ({
  readQualityDashboard: mocks.readQualityDashboard,
}));

import { qualityDashboardRouter } from "./router";

const aggregateOnlyResponse = {
  listing: {},
  image: {},
  operations: {},
  americanEnglishHumanReview: {
    sampleCount: 0,
    message: "样本不足，不能判断美语质量",
  },
};

describe("quality dashboard router prototype", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readQualityDashboard.mockResolvedValue(aggregateOnlyResponse);
  });

  it("derives scope from authenticated context instead of client input", async () => {
    const caller = qualityDashboardRouter.createCaller({
      user: { id: 7, role: "user" },
      workspaceId: 17,
    } as never);

    await expect(caller.dashboard()).resolves.toEqual(aggregateOnlyResponse);
    expect(mocks.readQualityDashboard).toHaveBeenCalledWith({ workspaceId: 17 });
  });

  it("rejects unauthenticated and workspace-less contexts", async () => {
    const anonymousCaller = qualityDashboardRouter.createCaller({ user: null, workspaceId: 17 } as never);
    await expect(anonymousCaller.dashboard()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const workspaceLessCaller = qualityDashboardRouter.createCaller({
      user: { id: 7, role: "user" },
      workspaceId: null,
    } as never);
    await expect(workspaceLessCaller.dashboard()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
