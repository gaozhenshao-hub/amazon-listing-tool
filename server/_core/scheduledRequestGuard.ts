import { timingSafeEqual } from "crypto";
import type { Request, Response } from "express";

export type ScheduledRequestValidation = {
  ok: boolean;
  taskUid?: string;
  reason?: "missing_identity" | "invalid_secret" | "task_not_allowed";
};

function firstHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function equalSecret(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function parseBearer(value: string): string {
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function allowedTaskUids(env: NodeJS.ProcessEnv): Set<string> {
  return new Set(
    (env.SCHEDULED_TASK_UIDS || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
  );
}

export function validateScheduledRequest(
  request: Pick<Request, "headers">,
  env: NodeJS.ProcessEnv = process.env
): ScheduledRequestValidation {
  const taskUid = firstHeader(request.headers["x-manus-cron-task-uid"]);
  const configuredSecret = env.SCHEDULED_TASK_SECRET || "";
  const suppliedSecret =
    firstHeader(request.headers["x-scheduled-task-secret"]) ||
    parseBearer(firstHeader(request.headers.authorization));

  if (configuredSecret && !equalSecret(configuredSecret, suppliedSecret)) {
    return { ok: false, taskUid, reason: "invalid_secret" };
  }

  const allowlist = allowedTaskUids(env);
  if (allowlist.size > 0 && (!taskUid || !allowlist.has(taskUid))) {
    return { ok: false, taskUid, reason: "task_not_allowed" };
  }

  if (env.NODE_ENV === "production" && !configuredSecret && !taskUid) {
    return { ok: false, reason: "missing_identity" };
  }

  return { ok: true, taskUid: taskUid || undefined };
}

export function authorizeScheduledRequest(
  req: Request,
  res: Response
): string | null {
  const validation = validateScheduledRequest(req);
  if (validation.ok) return validation.taskUid || "local";

  res.status(401).json({
    ok: false,
    error: "Unauthorized scheduled task request",
    reason: validation.reason,
    timestamp: new Date().toISOString(),
  });
  return null;
}
