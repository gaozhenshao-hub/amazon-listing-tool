import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { SafeHttpError, safeHttpRequest } from "./safeHttpClient";

describe("safeHttpRequest absolute timeout", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it("中止持续输出数据但始终不结束的响应", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      const interval = setInterval(() => response.write("data: keepalive\n\n"), 5);
      response.on("close", () => clearInterval(interval));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务器未监听端口");

    await expect(safeHttpRequest(`http://127.0.0.1:${address.port}`, {
      timeoutMs: 60,
      allowPrivateNetwork: true,
      allowTestNetwork: true,
    })).rejects.toMatchObject<Partial<SafeHttpError>>({ reason: "timeout" });
  });
});
