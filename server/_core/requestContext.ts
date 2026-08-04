import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { appErrorResponse } from "./appError";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const incoming = String(req.header("x-request-id") || "").trim();
  const requestId = REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
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
