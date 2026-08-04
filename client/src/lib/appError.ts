import { APP_ERROR_CODES, type AppErrorCode, type AppErrorDetails } from "@shared/_core/errors";

export type AppErrorInfo = {
  code: AppErrorCode | string;
  message: string;
  requestId: string | null;
  retryable: boolean;
  details: AppErrorDetails | null;
  trpcCode: string | null;
};

export class ClientTransportError extends Error {
  readonly appCode: AppErrorCode;
  readonly retryable: boolean;

  constructor(message: string, appCode: AppErrorCode, retryable: boolean) {
    super(message);
    this.name = "ClientTransportError";
    this.appCode = appCode;
    this.retryable = retryable;
  }
}

export function getAppErrorInfo(error: unknown): AppErrorInfo {
  if (error instanceof ClientTransportError) {
    return {
      code: error.appCode,
      message: error.message,
      requestId: null,
      retryable: error.retryable,
      details: null,
      trpcCode: null,
    };
  }
  const record = error && typeof error === "object" ? error as Record<string, any> : {};
  const data = record.data || record.shape?.data || {};
  return {
    code: String(data.appCode || APP_ERROR_CODES.INTERNAL_ERROR),
    message: typeof record.message === "string" && record.message ? record.message : "操作失败",
    requestId: typeof data.requestId === "string" ? data.requestId : null,
    retryable: data.retryable === true,
    details: data.details && typeof data.details === "object" ? data.details : null,
    trpcCode: typeof data.code === "string" ? data.code : null,
  };
}

export function isRetryableAppError(error: unknown) {
  return getAppErrorInfo(error).retryable;
}

export function isAuthRequiredError(error: unknown) {
  return getAppErrorInfo(error).code === APP_ERROR_CODES.AUTH_REQUIRED;
}

export function appErrorMessage(error: unknown, fallback = "操作失败") {
  const info = getAppErrorInfo(error);
  return info.message || fallback;
}
