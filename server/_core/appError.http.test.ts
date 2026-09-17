import http from "node:http";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { afterEach, describe, expect, it } from "vitest";
import { AppError, APP_ERROR_CODES } from "../../shared/_core/errors";
import { publicProcedure, router } from "./trpc";

const testRouter = router({
  readablePrecondition: publicProcedure.query(() => {
    throw new AppError({
      code: APP_ERROR_CODES.PRECONDITION_FAILED,
      statusCode: 412,
      message: "采集Provider当前未启用。",
      details: { reason: "profile_not_active" },
    });
  }),
});

describe("tRPC AppError HTTP contract", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close(error => error ? reject(error) : resolve());
    });
    server = undefined;
  });

  it("returns an exposed PRECONDITION_FAILED as HTTP 412 without downgrading its code", async () => {
    const app = express();
    app.use("/api/trpc", createExpressMiddleware({
      router: testRouter,
      createContext: ({ req, res }) => ({ req, res, user: null, workspaceId: null, requestId: "http-precondition-test" }),
    }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server address unavailable");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/trpc/readablePrecondition`);
    const envelope = await response.json() as { error: { json: { message: string; data: { code: string; appCode: string; details: { reason: string } } } } };

    expect(response.status).toBe(412);
    expect(envelope.error.json.message).toContain("未启用");
    expect(envelope.error.json.data).toMatchObject({
      code: "PRECONDITION_FAILED",
      appCode: "PRECONDITION_FAILED",
      details: { reason: "profile_not_active" },
    });
  });
});
