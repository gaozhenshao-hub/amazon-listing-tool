import http from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getKbStats = vi.fn();

vi.mock("./kbDb", () => ({ getKbStats }));

import { kbExternalApiRouter } from "./kbExternalApi";

async function startServer() {
  const app = express();
  app.use("/api/external/kb", kbExternalApiRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server address unavailable");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api/external/kb` };
}

describe("external knowledge-base API workspace fail-closed contract", () => {
  let server: http.Server | undefined;

  beforeEach(() => {
    delete process.env.EMPEROR_KB_API_KEY;
    getKbStats.mockReset();
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close(error => error ? reject(error) : resolve());
    });
    server = undefined;
  });

  it("returns 503 without a configured caller-to-workspace binding and never queries stats", async () => {
    const started = await startServer();
    server = started.server;

    const response = await fetch(`${started.baseUrl}/stats`);
    const body = await response.json() as { error: string };

    expect(response.status).toBe(503);
    expect(body.error).toBe("WORKSPACE_SCOPE_UNAVAILABLE");
    expect(getKbStats).not.toHaveBeenCalled();
  });

  it("does not trust a global key or a caller-supplied workspace header", async () => {
    process.env.EMPEROR_KB_API_KEY = "global-key-without-workspace-binding";
    const started = await startServer();
    server = started.server;

    for (const path of ["stats", "search", "rag"]) {
      const response = await fetch(`${started.baseUrl}/${path}`, {
        method: path === "stats" ? "GET" : "POST",
        headers: {
          authorization: "Bearer global-key-without-workspace-binding",
          "x-workspace-id": "999999",
        },
      });
      const body = await response.json() as { error: string };
      expect(response.status).toBe(503);
      expect(body.error).toBe("WORKSPACE_SCOPE_UNAVAILABLE");
    }

    expect(getKbStats).not.toHaveBeenCalled();
  });
});
