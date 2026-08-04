import { describe, expect, it, vi } from "vitest";
import {
  APP_ERROR_CODES,
  dataSourceUnavailableError,
  retiredFeatureError,
} from "@shared/_core/errors";
import { appErrorResponse, normalizeAppError, toTrpcError } from "./_core/appError";
import { requestContextMiddleware } from "./_core/requestContext";

describe("application error contract", () => {
  it("preserves structured codes and migration details", () => {
    const error = retiredFeatureError("旧同步", "dataImport.uploadAndParse", {
      replacementProcedure: "dataImport.uploadAndParse",
    });
    const response = appErrorResponse(error, "request-12345678");

    expect(response.statusCode).toBe(410);
    expect(response.body.error).toMatchObject({
      code: APP_ERROR_CODES.FEATURE_RETIRED,
      requestId: "request-12345678",
      retryable: false,
      details: {
        feature: "旧同步",
        replacement: "dataImport.uploadAndParse",
        replacementProcedure: "dataImport.uploadAndParse",
      },
    });
  });

  it("maps unavailable dependencies to a non-retryable service error", () => {
    const error = dataSourceUnavailableError("NextSLS", "NextSLS 未配置", {
      configurationProcedure: "logistics.saveConfig",
    });
    const trpcError = toTrpcError(error);
    const normalized = normalizeAppError(trpcError);

    expect(trpcError.code).toBe("INTERNAL_SERVER_ERROR");
    expect(normalized.code).toBe(APP_ERROR_CODES.DATA_SOURCE_UNAVAILABLE);
    expect(normalized.statusCode).toBe(503);
    expect(normalized.details?.configurationProcedure).toBe("logistics.saveConfig");
  });

  it("accepts a valid request id and returns it on the response", () => {
    const requestId = "client-request-12345678";
    const req = { header: vi.fn(() => requestId) } as any;
    const res = {
      locals: {},
      setHeader: vi.fn(),
    } as any;
    const next = vi.fn();

    requestContextMiddleware(req, res, next);

    expect(res.locals.requestId).toBe(requestId);
    expect(res.setHeader).toHaveBeenCalledWith("x-request-id", requestId);
    expect(next).toHaveBeenCalledOnce();
  });

  it("replaces invalid incoming request ids", () => {
    const req = { header: vi.fn(() => "bad id") } as any;
    const res = { locals: {}, setHeader: vi.fn() } as any;

    requestContextMiddleware(req, res, vi.fn());

    expect(res.locals.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.locals.requestId).not.toBe("bad id");
  });
});
