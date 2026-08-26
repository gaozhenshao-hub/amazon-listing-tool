import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("./env", () => ({ ENV: { forgeApiUrl: "https://forge.example/", forgeApiKey: "test-key" } }));
vi.mock("./forgeCapability", () => ({ assertForgeCapabilityAvailable: () => undefined }));
vi.mock("../infrastructure/http/safeHttpClient", () => ({ safeHttpRequest: requestMock }));

import { updateHeartbeatJob } from "./heartbeat";

describe("Heartbeat计划更新重试", () => {
  beforeEach(() => requestMock.mockReset());

  it("遇到RST_STREAM暂态传输错误时有限重试并返回更新结果", async () => {
    requestMock.mockRejectedValueOnce(new Error("RST_STREAM CANCEL"));
    requestMock.mockResolvedValueOnce({ ok: true, json: () => ({ nextExecutionAt: "2026-08-27T09:00:00.000Z" }), text: () => "" });

    await expect(updateHeartbeatJob("task-1", { enable: false }, "session-1")).resolves.toEqual({ nextExecutionAt: "2026-08-27T09:00:00.000Z" });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("非暂态失败不重试，避免掩盖权限或参数错误", async () => {
    requestMock.mockResolvedValueOnce({ ok: false, status: 400, statusText: "Bad Request", text: () => "invalid task" });

    await expect(updateHeartbeatJob("task-1", { enable: true }, "session-1")).rejects.toThrow("failed (400)");
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
