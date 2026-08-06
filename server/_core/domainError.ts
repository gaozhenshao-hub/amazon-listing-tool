import {
  AppError,
  APP_ERROR_CODES,
  type AppErrorDetails,
} from "@shared/_core/errors";

export function databaseUnavailableError(domain: string) {
  return new AppError({
    code: APP_ERROR_CODES.DATABASE_UNAVAILABLE,
    statusCode: 503,
    message: "数据库暂时不可用，请稍后重试",
    retryable: true,
    details: { domain },
  });
}

export function productStageGatedError(
  stage: string,
  reason: string,
  details: AppErrorDetails = {},
) {
  return new AppError({
    code: APP_ERROR_CODES.PRODUCT_STAGE_GATED,
    statusCode: 412,
    message: `当前阶段尚不可执行：${reason}`,
    details: { stage, reason, ...details },
  });
}

export function domainOperationError(
  domain: string,
  operation: string,
  cause: unknown,
  options: {
    message?: string;
    retryable?: boolean;
    details?: AppErrorDetails;
  } = {},
) {
  return new AppError({
    code: APP_ERROR_CODES.DOMAIN_OPERATION_FAILED,
    statusCode: 500,
    message: options.message ?? "业务操作执行失败",
    retryable: options.retryable ?? false,
    expose: Boolean(options.message),
    details: { domain, operation, ...options.details },
    cause,
  });
}
