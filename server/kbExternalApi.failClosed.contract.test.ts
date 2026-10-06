import http from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getKbStats, searchKnowledgeBase, rawExecute } = vi.hoisted(() => ({
  getKbStats: vi.fn(),
  searchKnowledgeBase: vi.fn(),
  rawExecute: vi.fn(),
}));

vi.mock("./kbDb", () => ({ getKbStats, searchKnowledgeBase }));
vi.mock("./domains/ai_os/routerContext", () => ({ rawExecute }));

import { kbExternalApiRouter } from "./kbExternalApi";

async function startServer() {
  const app = express();
  app.use(express.json());
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

function configureBoundCaller(scopes = ["stats", "search", "rag"]) {
  rawExecute.mockImplementation(async (statement: string) => {
    if (statement.includes("SELECT caller.connectorId")) {
      return [{ connectorId: 71, workspaceId: 9, createdByUserId: 7, scopes: JSON.stringify(scopes) }];
    }
    return [];
  });
}

describe("external knowledge-base API caller-to-workspace binding", () => {
  let server: http.Server | undefined;

  beforeEach(() => {
    getKbStats.mockReset();
    searchKnowledgeBase.mockReset();
    rawExecute.mockReset();
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close(error => error ? reject(error) : resolve());
    });
    server = undefined;
  });

  it("fails closed when no caller token is provided and never queries the knowledge base", async () => {
    const started = await startServer();
    server = started.server;
    const response = await fetch(`${started.baseUrl}/stats`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "AUTH_REQUIRED" });
    expect(rawExecute).not.toHaveBeenCalled();
    expect(getKbStats).not.toHaveBeenCalled();
  });

  it("rejects an unknown caller binding rather than honoring global environment or caller headers", async () => {
    process.env.EMPEROR_KB_API_KEY = "legacy-global-key-must-not-authorize";
    rawExecute.mockResolvedValue([]);
    const started = await startServer();
    server = started.server;
    const response = await fetch(`${started.baseUrl}/stats`, {
      headers: {
        authorization: "Bearer legacy-global-key-must-not-authorize",
        "x-workspace-id": "999999",
      },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "CALLER_BINDING_INVALID" });
    expect(getKbStats).not.toHaveBeenCalled();
    delete process.env.EMPEROR_KB_API_KEY;
  });

  it("uses only the persisted caller workspace and shared confirmed scope", async () => {
    configureBoundCaller();
    getKbStats.mockResolvedValue({ totalCount: 3 });
    const started = await startServer();
    server = started.server;
    const response = await fetch(`${started.baseUrl}/stats`, {
      headers: {
        authorization: "Bearer caller-token",
        "x-workspace-id": "999999",
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ totalCount: 3 });
    expect(getKbStats).toHaveBeenCalledWith(7, 9, "shared");
    expect(rawExecute.mock.calls.some(([statement]) => String(statement).includes("lastUsedAt"))).toBe(true);
  });

  it("enforces each caller's explicit read-only scopes", async () => {
    configureBoundCaller(["stats"]);
    const started = await startServer();
    server = started.server;
    const response = await fetch(`${started.baseUrl}/search`, {
      method: "POST",
      headers: { authorization: "Bearer caller-token", "content-type": "application/json" },
      body: JSON.stringify({ query: "ceiling fan" }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "CALLER_SCOPE_DENIED" });
    expect(searchKnowledgeBase).not.toHaveBeenCalled();
  });
});
