import { describe, expect, it, vi } from "vitest";
import { AppError, APP_ERROR_CODES } from "../../../shared/_core/errors";

vi.mock("./acquisitionJobs", () => ({
  startAmazonAcquisitionJob: vi.fn(),
}));

import { startAmazonAcquisitionJob } from "./acquisitionJobs";
import { amazonAcquisitionRouter } from "./router";

describe("amazon acquisition createJob router preconditions", () => {
  it("preserves an acquisition precondition as a 412 tRPC error", async () => {
    vi.mocked(startAmazonAcquisitionJob).mockRejectedValueOnce(new AppError({
      code: APP_ERROR_CODES.PRECONDITION_FAILED,
      statusCode: 412,
      message: "采集Provider当前未启用。请由超级管理员完成资格审核后再试。",
      details: { provider: "apify", reason: "profile_not_active" },
    }));

    const caller = amazonAcquisitionRouter.createCaller({
      user: { id: 7, role: "ops_specialist", defaultWorkspaceId: 1 } as any,
      workspaceId: 1,
      requestId: "router-precondition-test",
      req: { headers: {}, header: () => undefined } as any,
      res: { locals: { requestId: "router-precondition-test" } } as any,
    });

    await expect(caller.createJob({
      consumerType: "image_workflow",
      consumerRef: "project:12:competitor-gallery",
      marketplace: "US",
      asin: "B000000000",
      capabilities: ["catalog_basic", "image_gallery"],
      cachePolicy: "prefer_cache",
      maxChargeUsd: 0.1,
    })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("未启用"),
    });
  });
});
