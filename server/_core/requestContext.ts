import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { appErrorResponse } from "./appError";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const incoming = String(req.header("x-request-id") || "").trim();
  const requestId = REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  const startedAt = performance.now();
  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  const originalWriteHead = res.writeHead;
  res.writeHead = ((statusCode: number, statusMessage?: string | Record<string, string | string[]>, headers?: Record<string, string | string[]>) => {
    if (!res.headersSent && !res.hasHeader("Server-Timing")) {
      const duration = Math.max(0, performance.now() - startedAt);
      res.setHeader("Server-Timing", `app;dur=${duration.toFixed(1)}`);
    }
    if (headers !== undefined) return (originalWriteHead as any).call(res, statusCode, statusMessage, headers);
    return originalWriteHead.call(res, statusCode, statusMessage as any);
  }) as typeof res.writeHead;
  res.on("finish", () => {
    const duration = Math.max(0, performance.now() - startedAt);
    if (duration >= 2_000 || res.statusCode >= 500) {
      console.warn("[HTTP] slow or failed request", {
        requestId,
        statusCode: res.statusCode,
        durationMs: Math.round(duration),
      });
    }
  });
  next();
};

export const expressAppErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const requestId = String(res.locals.requestId || randomUUID());
  const response = appErrorResponse(error, requestId);
  console.error("[HTTP] request failed", {
    requestId,
    code: response.body.error.code,
    statusCode: response.statusCode,
    retryable: response.body.error.retryable,
  });
  res.status(response.statusCode).json(response.body);
};
