export const APP_ERROR_CODES = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  ADMIN_REQUIRED: "ADMIN_REQUIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  RESOURCE_CONFLICT: "RESOURCE_CONFLICT",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  PRECONDITION_FAILED: "PRECONDITION_FAILED",
  FEATURE_RETIRED: "FEATURE_RETIRED",
  DATA_SOURCE_UNAVAILABLE: "DATA_SOURCE_UNAVAILABLE",
  EXTERNAL_SERVICE_FAILED: "EXTERNAL_SERVICE_FAILED",
  DATABASE_UNAVAILABLE: "DATABASE_UNAVAILABLE",
  DOMAIN_OPERATION_FAILED: "DOMAIN_OPERATION_FAILED",
  PRODUCT_STAGE_GATED: "PRODUCT_STAGE_GATED",
  AI_SKILL_ROUTE_MISSING: "AI_SKILL_ROUTE_MISSING",
  REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type AppErrorCode = typeof APP_ERROR_CODES[keyof typeof APP_ERROR_CODES];
export type AppErrorDetails = Record<string, unknown>;

export type AppErrorOptions = {
  code: AppErrorCode;
  statusCode: number;
  message: string;
  retryable?: boolean;
  details?: AppErrorDetails | null;
  expose?: boolean;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly details: AppErrorDetails | null;
  readonly expose: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? null;
    this.expose = options.expose ?? options.statusCode < 500;
  }
}

function codeForStatus(statusCode: number): AppErrorCode {
  if (statusCode === 401) return APP_ERROR_CODES.AUTH_REQUIRED;
  if (statusCode === 403) return APP_ERROR_CODES.PERMISSION_DENIED;
  if (statusCode === 404) return APP_ERROR_CODES.RESOURCE_NOT_FOUND;
  if (statusCode === 409) return APP_ERROR_CODES.RESOURCE_CONFLICT;
  if (statusCode === 412) return APP_ERROR_CODES.PRECONDITION_FAILED;
  if (statusCode === 429) return APP_ERROR_CODES.RATE_LIMITED;
  if (statusCode >= 500) return APP_ERROR_CODES.INTERNAL_ERROR;
  return APP_ERROR_CODES.VALIDATION_FAILED;
}

/** Compatibility wrapper for legacy Express handlers. */
export class HttpError extends AppError {
  constructor(statusCode: number, message: string, options: Partial<Omit<AppErrorOptions, "statusCode" | "message">> = {}) {
    super({
      code: options.code ?? codeForStatus(statusCode),
      statusCode,
      message,
      retryable: options.retryable,
      details: options.details,
      expose: options.expose,
      cause: options.cause,
    });
    this.name = "HttpError";
  }
}

export const BadRequestError = (message: string, details?: AppErrorDetails) => (
  new HttpError(400, message, { code: APP_ERROR_CODES.VALIDATION_FAILED, details })
);
export const UnauthorizedError = (message: string) => new HttpError(401, message);
export const ForbiddenError = (message: string) => new HttpError(403, message);
export const NotFoundError = (message: string, details?: AppErrorDetails) => new HttpError(404, message, { details });

export function retiredFeatureError(feature: string, replacement: string, details: AppErrorDetails = {}) {
  return new AppError({
    code: APP_ERROR_CODES.FEATURE_RETIRED,
    statusCode: 410,
    message: `${feature} 已停用，请使用 ${replacement}`,
    details: { feature, replacement, ...details },
  });
}

export function resourceConflictError(message: string, details: AppErrorDetails) {
  return new AppError({
    code: APP_ERROR_CODES.RESOURCE_CONFLICT,
    statusCode: 409,
    message,
    details,
  });
}

export function dataSourceUnavailableError(
  source: string,
  message = `${source} 数据源不可用`,
  details: AppErrorDetails = {},
) {
  return new AppError({
    code: APP_ERROR_CODES.DATA_SOURCE_UNAVAILABLE,
    statusCode: 503,
    message,
    retryable: false,
    details: { source, ...details },
  });
}

/**
 * Transitional guard for code paths whose former connector was removed.
 * The `any` return preserves legacy response typing while this function
 * always throws before fabricated data can enter business calculations.
 */
export function failUnavailableDataSource(
  source = "Legacy external connector",
  details: AppErrorDetails = {},
): any {
  throw dataSourceUnavailableError(
    source,
    `${source} 已停用或尚未配置，无法返回真实数据`,
    { connectorStatus: "unavailable", ...details },
  );
}
