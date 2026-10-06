import express from "express";
import type { Server } from "http";
import { afterEach, describe, expect, it } from "vitest";
import { requestContextMiddleware } from "./requestContext";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("请求性能关联", () => {
  it("返回安全请求标识与聚合Server-Timing耗时", async () => {
    const app = express();
    app.use(requestContextMiddleware);
    app.get("/test", (_req, res) => res.status(200).json({ ok: true }));
    const server = await new Promise<Server>((resolve) => { const created = app.listen(0, () => resolve(created)); });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test port unavailable");
    const response = await fetch(`http://127.0.0.1:${address.port}/test`);
    expect(response.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(response.headers.get("server-timing")).toMatch(/^app;dur=\d+(\.\d)?$/);
  });
});
