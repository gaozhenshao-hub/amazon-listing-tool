import type express from "express";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../repositories/dbClient";
import {
  getAiJobRuntimeStatus,
  getAiJobWorkerHealth,
} from "../services/aiJobRunner";
import { describeRuntimeRole, getRuntimeRole } from "./runtime";
import {
  getStartupValidationReport,
  type StartupEntrypoint,
} from "./startupValidation";

export type RuntimeHealthCheck = {
  status: "ok" | "warning" | "error";
  message?: string;
  latencyMs?: number;
  details?: unknown;
};

export type RuntimeHealth = {
  ok: boolean;
  ready: boolean;
  service: StartupEntrypoint | "process";
  role: ReturnType<typeof getRuntimeRole>;
  timestamp: string;
  uptimeSeconds: number;
  pid: number;
  checks: Record<string, RuntimeHealthCheck>;
};

function statusRank(status: RuntimeHealthCheck["status"]) {
  if (status === "error") return 2;
  if (status === "warning") return 1;
  return 0;
}

async function checkDatabase(): Promise<RuntimeHealthCheck> {
  const start = Date.now();
  try {
    const db = await getDb();
    if (!db) return { status: "error", message: "Database is not configured." };
    await db.execute(drizzleSql.raw("SELECT 1"));
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (error: any) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      message: error?.message || "Database check failed.",
    };
  }
}

async function checkAiQueue(): Promise<RuntimeHealthCheck> {
  try {
    const runtime = getAiJobRuntimeStatus();
    const workers = await getAiJobWorkerHealth({ limit: 20 });
    const hasActiveWorkers =
      workers.healthyCount > 0 || runtime.schedulingEnabled;
    return {
      status: hasActiveWorkers ? "ok" : "warning",
      message: hasActiveWorkers
        ? undefined
        : "No active AI Job worker heartbeat found.",
      details: {
        runtime,
        healthyWorkers: workers.healthyCount,
        staleWorkers: workers.staleCount,
        unhealthyWorkers: workers.unhealthyCount,
        checkedAt: workers.checkedAt,
      },
    };
  } catch (error: any) {
    return {
      status: "warning",
      message: error?.message || "AI queue health is unavailable.",
    };
  }
}

function checkToolGatewaySecret(): RuntimeHealthCheck {
  const hasStableSecret = Boolean(
    process.env.TOOL_SECRET_KEY && process.env.TOOL_SECRET_KEY.length >= 32
  );
  if (process.env.NODE_ENV === "production" && !hasStableSecret) {
    return {
      status: "error",
      message:
        "Production TOOL_SECRET_KEY is missing or shorter than 32 characters.",
    };
  }
  if (!hasStableSecret) {
    return {
      status: "warning",
      message:
        "TOOL_SECRET_KEY is not set; development fallback key may be used.",
    };
  }
  return { status: "ok" };
}

export async function buildRuntimeHealth(
  input: {
    service?: StartupEntrypoint | "process";
    includeQueue?: boolean;
    entrypoint?: StartupEntrypoint;
  } = {}
): Promise<RuntimeHealth> {
  const role = getRuntimeRole();
  const checks: Record<string, RuntimeHealthCheck> = {};
  const validation = getStartupValidationReport({
    entrypoint: input.entrypoint || "web",
    role,
  });
  checks.environment = validation.ok
    ? {
        status: validation.warnings.length > 0 ? "warning" : "ok",
        details: validation.warnings,
      }
    : {
        status: "error",
        details: validation.errors,
      };
  checks.database = await checkDatabase();
  checks.toolGateway = checkToolGatewaySecret();
  checks.runtime = { status: "ok", details: describeRuntimeRole(role) };
  if (input.includeQueue) {
    checks.aiQueue = await checkAiQueue();
  }

  const worstStatus = Object.values(checks).reduce(
    (max, check) => Math.max(max, statusRank(check.status)),
    0
  );
  const ready =
    checks.database.status === "ok" &&
    checks.environment.status !== "error" &&
    checks.toolGateway.status !== "error";
  return {
    ok: worstStatus < 2,
    ready,
    service: input.service || "process",
    role,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
    checks,
  };
}

export function registerRuntimeHealthRoutes(
  app: express.Express,
  input: { service: StartupEntrypoint }
) {
  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: input.service,
      role: getRuntimeRole(),
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      pid: process.pid,
    });
  });

  app.get("/readyz", async (_req, res) => {
    const health = await buildRuntimeHealth({
      service: input.service,
      entrypoint: input.service,
      includeQueue: true,
    });
    res.status(health.ready ? 200 : 503).json(health);
  });
}
