import { AppError, APP_ERROR_CODES, type AppErrorCode } from "@shared/_core/errors";
import { TRPCError, type TRPC_ERROR_CODE_KEY } from "@trpc/server";

const trpcToAppCode: Partial<Record<TRPC_ERROR_CODE_KEY, AppErrorCode>> = {
  UNAUTHORIZED: APP_ERROR_CODES.AUTH_REQUIRED,
  FORBIDDEN: APP_ERROR_CODES.PERMISSION_DENIED,
  NOT_FOUND: APP_ERROR_CODES.RESOURCE_NOT_FOUND,
  CONFLICT: APP_ERROR_CODES.RESOURCE_CONFLICT,
  PRECONDITION_FAILED: APP_ERROR_CODES.PRECONDITION_FAILED,
  TOO_MANY_REQUESTS: APP_ERROR_CODES.RATE_LIMITED,
  TIMEOUT: APP_ERROR_CODES.REQUEST_TIMEOUT,
  BAD_REQUEST: APP_ERROR_CODES.VALIDATION_FAILED,
  INTERNAL_SERVER_ERROR: APP_ERROR_CODES.INTERNAL_ERROR,
};

function statusForTrpcCode(code: TRPC_ERROR_CODE_KEY) {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND") return 404;
  if (code === "CONFLICT") return 409;
  if (code === "PRECONDITION_FAILED") return 412;
  if (code === "TOO_MANY_REQUESTS") return 429;
  if (code === "TIMEOUT") return 504;
  if (code === "INTERNAL_SERVER_ERROR") return 500;
  return 400;
}

function trpcCodeForStatus(statusCode: number): TRPC_ERROR_CODE_KEY {
  if (statusCode === 401) return "UNAUTHORIZED";
  if (statusCode === 403) return "FORBIDDEN";
  if (statusCode === 404) return "NOT_FOUND";
  if (statusCode === 409) return "CONFLICT";
  if (statusCode === 412 || statusCode === 410) return "PRECONDITION_FAILED";
  if (statusCode === 429) return "TOO_MANY_REQUESTS";
  if (statusCode === 408 || statusCode === 504) return "TIMEOUT";
  if (statusCode >= 500) return "INTERNAL_SERVER_ERROR";
  return "BAD_REQUEST";
}

export function normalizeAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof TRPCError) {
    if (error.cause instanceof AppError) return error.cause;
    return new AppError({
      code: trpcToAppCode[error.code] ?? APP_ERROR_CODES.INTERNAL_ERROR,
      statusCode: statusForTrpcCode(error.code),
      message: error.message,
      retryable: ["TIMEOUT", "TOO_MANY_REQUESTS", "INTERNAL_SERVER_ERROR"].includes(error.code),
      expose: error.code !== "INTERNAL_SERVER_ERROR",
      cause: error.cause,
    });
  }
  if (error && typeof error === "object" && (error as { name?: string }).name === "ZodError") {
    return new AppError({
      code: APP_ERROR_CODES.VALIDATION_FAILED,
      statusCode: 400,
      message: "请求参数校验失败",
      details: { validation: (error as { issues?: unknown }).issues ?? null },
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : "Unknown application error";
  return new AppError({
    code: APP_ERROR_CODES.INTERNAL_ERROR,
    statusCode: 500,
    message: process.env.NODE_ENV === "production" ? "系统内部错误" : message,
    retryable: false,
    expose: process.env.NODE_ENV !== "production",
    cause: error,
  });
}

export function toTrpcError(error: unknown) {
  if (error instanceof TRPCError && !(error.cause instanceof AppError)) return error;
  const appError = normalizeAppError(error);
  return new TRPCError({
    code: trpcCodeForStatus(appError.statusCode),
    message: appError.expose ? appError.message : "系统内部错误",
    cause: appError,
  });
}

export function appErrorResponse(error: unknown, requestId: string) {
  const normalized = normalizeAppError(error);
  return {
    statusCode: normalized.statusCode,
    body: {
      error: {
        code: normalized.code,
        message: normalized.expose ? normalized.message : "系统内部错误",
        requestId,
        retryable: normalized.retryable,
        details: normalized.details,
      },
    },
  };
}
