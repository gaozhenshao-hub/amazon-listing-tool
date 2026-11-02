import { describe, expect, it, vi } from "vitest";

const safeHttpRequestMock = vi.hoisted(() => vi.fn());

vi.mock("../../infrastructure/http/safeHttpClient", () => ({
  safeHttpRequest: safeHttpRequestMock,
  SafeHttpError: class SafeHttpError extends Error {
    constructor(message: string, readonly reason: string) {
      super(message);
    }
  },
}));

import { APIFY_ACCOUNT_HEALTH_CONTRACT, requestApifyJsonIPv4, verifyApifyAccountToken } from "./apifyAccountHealth";
import { SafeHttpError } from "../../infrastructure/http/safeHttpClient";

describe("Apify无费用账户校验", () => {
  it("通过受控HTTP使用请求头认证，避免令牌出现在URL、日志或任务载荷中", async () => {
    safeHttpRequestMock.mockResolvedValue({ ok: true, json: () => ({}) });

    await expect(verifyApifyAccountToken("test-token")).resolves.toBeUndefined();
    expect(safeHttpRequestMock).toHaveBeenCalledWith(
      `https://${APIFY_ACCOUNT_HEALTH_CONTRACT.host}${APIFY_ACCOUNT_HEALTH_CONTRACT.path}`,
      expect.objectContaining({
        method: "GET",
        allowedHosts: APIFY_ACCOUNT_HEALTH_CONTRACT.allowedHosts,
        timeoutMs: APIFY_ACCOUNT_HEALTH_CONTRACT.timeoutMs,
        headers: expect.objectContaining({ authorization: "Bearer test-token" }),
      }),
    );
    expect(String(safeHttpRequestMock.mock.calls[0][0])).not.toContain("test-token");
  });

  it("将请求超时保留为固定失败信号，不继续尝试Actor或业务采集", async () => {
    safeHttpRequestMock.mockRejectedValue(new SafeHttpError("Safe HTTP request timed out", "timeout"));

    await expect(verifyApifyAccountToken("test-token")).rejects.toThrow("apify_timeout");
  });

  it("对Actor请求同样使用白名单受控HTTP与请求头认证，不把令牌拼接到路径中", async () => {
    safeHttpRequestMock.mockResolvedValue({ ok: true, json: () => ({ data: { id: "run-1" } }) });

    await expect(requestApifyJsonIPv4<{ data: { id: string } }>({ path: "/v2/acts/example~actor/runs", token: "test-token", method: "POST", body: "{}" })).resolves.toEqual({ data: { id: "run-1" } });
    expect(safeHttpRequestMock).toHaveBeenLastCalledWith(
      "https://api.apify.com/v2/acts/example~actor/runs",
      expect.objectContaining({ method: "POST", allowedHosts: ["api.apify.com"], headers: expect.objectContaining({ authorization: "Bearer test-token" }) }),
    );
    expect(String(safeHttpRequestMock.mock.calls.at(-1)?.[0])).not.toContain("test-token");
  });
});
