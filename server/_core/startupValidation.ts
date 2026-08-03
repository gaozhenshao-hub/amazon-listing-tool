import { getRuntimeRole, type RuntimeRole } from "./runtime";

export type StartupEntrypoint = "web" | "worker" | "scheduler";
export type StartupIssueSeverity = "error" | "warning";

export type StartupIssue = {
  severity: StartupIssueSeverity;
  code: string;
  message: string;
};

export type StartupValidationReport = {
  entrypoint: StartupEntrypoint;
  role: RuntimeRole;
  isProduction: boolean;
  ok: boolean;
  errors: StartupIssue[];
  warnings: StartupIssue[];
};

function isTruthy(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}

function pushIssue(
  issues: StartupIssue[],
  severity: StartupIssueSeverity,
  code: string,
  message: string
) {
  issues.push({ severity, code, message });
}

function validateToolSecret(
  env: NodeJS.ProcessEnv,
  isProduction: boolean,
  issues: StartupIssue[]
) {
  const configured = env.TOOL_SECRET_KEY || "";
  const fallbackConfigured = env.EMPEROR_SECRET_KEY || env.JWT_SECRET || "";

  if (configured.length >= 32) return;

  if (isProduction) {
    pushIssue(
      issues,
      "error",
      "tool_secret_key_missing",
      "Production requires TOOL_SECRET_KEY with at least 32 characters for stable Tool secret encryption."
    );
    return;
  }

  if (!configured && fallbackConfigured) {
    pushIssue(
      issues,
      "warning",
      "tool_secret_key_fallback",
      "TOOL_SECRET_KEY is not set; development will fall back to EMPEROR_SECRET_KEY/JWT_SECRET for Tool secret encryption."
    );
    return;
  }

  pushIssue(
    issues,
    "warning",
    "tool_secret_key_development_default",
    "TOOL_SECRET_KEY is not set; development will use a local-only fallback key."
  );
}

export function getStartupValidationReport(input: {
  entrypoint: StartupEntrypoint;
  role?: RuntimeRole;
  env?: NodeJS.ProcessEnv;
}): StartupValidationReport {
  const env = input.env || process.env;
  const role = input.role || getRuntimeRole(env);
  const isProduction = env.NODE_ENV === "production";
  const issues: StartupIssue[] = [];

  const validRoles: RuntimeRole[] = ["web", "worker", "scheduler", "all"];
  const explicitRole = env.APP_PROCESS_ROLE || env.PROCESS_ROLE;
  if (explicitRole && !validRoles.includes(explicitRole as RuntimeRole)) {
    pushIssue(
      issues,
      "error",
      "invalid_process_role",
      `Invalid APP_PROCESS_ROLE "${explicitRole}". Expected one of: ${validRoles.join(", ")}.`
    );
  }

  if (
    input.entrypoint === "web" &&
    (role === "worker" || role === "scheduler")
  ) {
    pushIssue(
      issues,
      "error",
      "entrypoint_role_mismatch",
      `Web entrypoint cannot run with APP_PROCESS_ROLE=${role}. Use the ${role} entrypoint instead.`
    );
  }

  if (input.entrypoint === "worker" && role !== "worker" && role !== "all") {
    pushIssue(
      issues,
      "error",
      "entrypoint_role_mismatch",
      `Worker entrypoint requires APP_PROCESS_ROLE=worker or all, got ${role}.`
    );
  }

  if (
    input.entrypoint === "scheduler" &&
    role !== "scheduler" &&
    role !== "all"
  ) {
    pushIssue(
      issues,
      "error",
      "entrypoint_role_mismatch",
      `Scheduler entrypoint requires APP_PROCESS_ROLE=scheduler or all, got ${role}.`
    );
  }

  const requiresDb =
    isProduction ||
    role === "worker" ||
    role === "scheduler" ||
    isTruthy(env.REQUIRE_DATABASE);
  if (requiresDb && !env.DATABASE_URL) {
    pushIssue(
      issues,
      "error",
      "database_url_missing",
      "DATABASE_URL is required for this runtime role."
    );
  } else if (!env.DATABASE_URL) {
    pushIssue(
      issues,
      "warning",
      "database_url_missing",
      "DATABASE_URL is not set; database-backed features will be disabled."
    );
  }

  if (isProduction && !env.JWT_SECRET) {
    pushIssue(
      issues,
      "error",
      "jwt_secret_missing",
      "Production requires JWT_SECRET for secure session cookies."
    );
  }

  validateToolSecret(env, isProduction, issues);

  if (role === "web" && isProduction && env.AI_JOB_IN_PROCESS !== "false") {
    pushIssue(
      issues,
      "warning",
      "web_in_process_ai_jobs",
      "Production Web defaults to API-only. Set AI_JOB_IN_PROCESS=false and run a dedicated Worker for long AI jobs."
    );
  }

  if (role === "scheduler" && !env.SCHEDULER_LEADER_LOCK_NAME) {
    pushIssue(
      issues,
      "warning",
      "default_scheduler_lock",
      "SCHEDULER_LEADER_LOCK_NAME is not set; using the default global scheduler lock."
    );
  }

  const errors = issues.filter(issue => issue.severity === "error");
  const warnings = issues.filter(issue => issue.severity === "warning");
  return {
    entrypoint: input.entrypoint,
    role,
    isProduction,
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function assertStartupConfig(input: {
  entrypoint: StartupEntrypoint;
  role?: RuntimeRole;
  env?: NodeJS.ProcessEnv;
}) {
  const report = getStartupValidationReport(input);
  for (const warning of report.warnings) {
    console.warn(`[Startup] ${warning.code}: ${warning.message}`);
  }
  if (!report.ok) {
    const message = report.errors
      .map(error => `${error.code}: ${error.message}`)
      .join("\n");
    throw new Error(`Startup validation failed:\n${message}`);
  }
  return report;
}
