import { describe, expect, it } from "vitest";
import { validateScheduledRequest } from "./_core/scheduledRequestGuard";

function request(headers: Record<string, string> = {}) {
  return { headers } as any;
}

describe("scheduled request guard", () => {
  it("requires a platform identity in production", () => {
    expect(
      validateScheduledRequest(request(), { NODE_ENV: "production" } as any)
    ).toMatchObject({ ok: false, reason: "missing_identity" });
  });

  it("accepts the platform task UID and supports an allowlist", () => {
    const env = {
      NODE_ENV: "production",
      SCHEDULED_TASK_UIDS: "weekly-task,worker-task",
    } as any;
    expect(
      validateScheduledRequest(
        request({ "x-manus-cron-task-uid": "worker-task" }),
        env
      )
    ).toMatchObject({ ok: true, taskUid: "worker-task" });
    expect(
      validateScheduledRequest(
        request({ "x-manus-cron-task-uid": "unknown-task" }),
        env
      )
    ).toMatchObject({ ok: false, reason: "task_not_allowed" });
  });

  it("validates a configured bearer or dedicated header secret", () => {
    const env = {
      NODE_ENV: "production",
      SCHEDULED_TASK_SECRET: "0123456789abcdef0123456789abcdef",
    } as any;
    expect(
      validateScheduledRequest(
        request({
          authorization: "Bearer 0123456789abcdef0123456789abcdef",
        }),
        env
      ).ok
    ).toBe(true);
    expect(
      validateScheduledRequest(
        request({ "x-scheduled-task-secret": "wrong" }),
        env
      )
    ).toMatchObject({ ok: false, reason: "invalid_secret" });
  });

  it("keeps local development callbacks ergonomic", () => {
    expect(
      validateScheduledRequest(request(), { NODE_ENV: "development" } as any)
        .ok
    ).toBe(true);
  });
});
