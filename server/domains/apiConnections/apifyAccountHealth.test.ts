import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("node:https", () => ({ request: requestMock }));

import { APIFY_ACCOUNT_HEALTH_CONTRACT, requestApifyJsonIPv4, verifyApifyAccountToken } from "./apifyAccountHealth";

describe("Apify无费用账户校验", () => {
  it("强制IPv4并使用请求头认证，避免令牌出现在URL、日志或任务载荷中", async () => {
    let receivedOptions: Record<string, unknown> | undefined;
    requestMock.mockImplementation((options: Record<string, unknown>, onResponse: (response: EventEmitter & { statusCode: number }) => void) => {
      receivedOptions = options;
      const response = new EventEmitter() as EventEmitter & { statusCode: number };
      response.statusCode = 200;
      const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void };
      request.end = () => { onResponse(response); response.emit("data", Buffer.from("{}")); response.emit("end"); };
      request.destroy = (error: Error) => request.emit("error", error);
      return request;
    });

    await expect(verifyApifyAccountToken("test-token")).resolves.toBeUndefined();
    expect(receivedOptions).toMatchObject({
      hostname: APIFY_ACCOUNT_HEALTH_CONTRACT.host,
      path: APIFY_ACCOUNT_HEALTH_CONTRACT.path,
      method: "GET",
      family: 4,
      timeout: APIFY_ACCOUNT_HEALTH_CONTRACT.timeoutMs,
      headers: { authorization: "Bearer test-token" },
    });
    expect(String(receivedOptions?.path)).not.toContain("test-token");
  });

  it("将请求超时保留为固定失败信号，不继续尝试Actor或业务采集", async () => {
    requestMock.mockImplementation(() => {
      const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void };
      request.end = () => request.emit("timeout");
      request.destroy = (error: Error) => request.emit("error", error);
      return request;
    });

    await expect(verifyApifyAccountToken("test-token")).rejects.toThrow("apify_timeout");
  });

  it("对Actor请求同样强制IPv4与请求头认证，不把令牌拼接到路径中", async () => {
    let receivedOptions: Record<string, unknown> | undefined;
    requestMock.mockImplementation((options: Record<string, unknown>, onResponse: (response: EventEmitter & { statusCode: number }) => void) => {
      receivedOptions = options;
      const response = new EventEmitter() as EventEmitter & { statusCode: number };
      response.statusCode = 200;
      const request = new EventEmitter() as EventEmitter & { end: (body?: string) => void; destroy: (error: Error) => void };
      request.end = () => { onResponse(response); response.emit("data", Buffer.from('{"data":{"id":"run-1"}}')); response.emit("end"); };
      request.destroy = (error: Error) => request.emit("error", error);
      return request;
    });

    await expect(requestApifyJsonIPv4<{ data: { id: string } }>({ path: "/v2/acts/example~actor/runs", token: "test-token", method: "POST", body: "{}" })).resolves.toEqual({ data: { id: "run-1" } });
    expect(receivedOptions).toMatchObject({ family: 4, method: "POST", headers: { authorization: "Bearer test-token" } });
    expect(String(receivedOptions?.path)).not.toContain("test-token");
  });
});
