import { describe, expect, it } from "vitest";
import { APP_ERROR_CODES } from "@shared/_core/errors";
import {
  ClientTransportError,
  getAppErrorInfo,
  isAuthRequiredError,
  isRetryableAppError,
} from "./appError";

describe("client application error helpers", () => {
  it("reads the structured tRPC error payload", () => {
    const error = {
      message: "资源已存在",
      data: {
        code: "CONFLICT",
        appCode: APP_ERROR_CODES.RESOURCE_CONFLICT,
        requestId: "request-87654321",
        retryable: false,
        details: { existingId: 42 },
      },
    };

    expect(getAppErrorInfo(error)).toMatchObject({
      code: APP_ERROR_CODES.RESOURCE_CONFLICT,
      requestId: "request-87654321",
      details: { existingId: 42 },
    });
  });

  it("uses codes rather than translated error messages", () => {
    const error = {
      message: "任意语言的认证提示",
      data: { appCode: APP_ERROR_CODES.AUTH_REQUIRED },
    };
    expect(isAuthRequiredError(error)).toBe(true);
  });

  it("preserves retryability for transport failures", () => {
    const error = new ClientTransportError(
      "网络暂时不可用",
      APP_ERROR_CODES.EXTERNAL_SERVICE_FAILED,
      true,
    );
    expect(isRetryableAppError(error)).toBe(true);
  });
});
