import { describe, expect, it } from "vitest";
import {
  getRuntimeRole,
  shouldProcessAiJobs,
  shouldStartSchedulerTasks,
  shouldStartWebServer,
  shouldStartWorkerTasks,
} from "./_core/runtime";
import { getStartupValidationReport } from "./_core/startupValidation";

describe("runtime bootstrap guardrails", () => {
  it("defaults to all-in-one outside production and web-only in production", () => {
    expect(getRuntimeRole({ NODE_ENV: "development" } as any)).toBe("all");
    expect(getRuntimeRole({ NODE_ENV: "test" } as any)).toBe("all");
    expect(getRuntimeRole({ NODE_ENV: "production" } as any)).toBe("web");
  });

  it("enables responsibilities by explicit role", () => {
    expect(shouldStartWebServer("web")).toBe(true);
    expect(shouldStartWorkerTasks("web")).toBe(false);
    expect(shouldStartSchedulerTasks("web")).toBe(false);
    expect(shouldStartWorkerTasks("worker")).toBe(true);
    expect(shouldStartSchedulerTasks("scheduler")).toBe(true);
    expect(shouldStartWebServer("all")).toBe(true);
    expect(shouldStartWorkerTasks("all")).toBe(true);
    expect(shouldStartSchedulerTasks("all")).toBe(true);
  });

  it("keeps jobs consumable in dedicated and single-process deployments", () => {
    expect(shouldProcessAiJobs("worker", {
      AI_JOB_IN_PROCESS: "false",
    } as any)).toBe(true);
    expect(shouldProcessAiJobs("web", {
      NODE_ENV: "production",
    } as any)).toBe(true);
    expect(shouldProcessAiJobs("web", {
      NODE_ENV: "production",
      AI_JOB_IN_PROCESS: "false",
    } as any)).toBe(false);
    expect(shouldProcessAiJobs("web", {
      NODE_ENV: "production",
      REQUIRE_AI_JOB_WORKER: "true",
    } as any)).toBe(false);
    expect(shouldProcessAiJobs("web", {
      NODE_ENV: "production",
      REQUIRE_AI_JOB_WORKER: "true",
      AI_JOB_IN_PROCESS: "true",
    } as any)).toBe(true);
  });

  it("requires production database, session secret, and stable tool secret", () => {
    const report = getStartupValidationReport({
      entrypoint: "web",
      role: "web",
      env: { NODE_ENV: "production" } as any,
    });
    expect(report.ok).toBe(false);
    expect(report.errors.map(issue => issue.code)).toEqual(
      expect.arrayContaining([
        "database_url_missing",
        "jwt_secret_missing",
        "tool_secret_key_missing",
      ])
    );
  });

  it("accepts a production-ready web runtime", () => {
    const report = getStartupValidationReport({
      entrypoint: "web",
      role: "web",
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "mysql://user:pass@localhost:3306/app",
        JWT_SECRET: "session-secret",
        TOOL_SECRET_KEY: "0123456789abcdef0123456789abcdef",
        AI_JOB_IN_PROCESS: "false",
      } as any,
    });
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it("rejects mismatched entrypoint and runtime role", () => {
    const report = getStartupValidationReport({
      entrypoint: "web",
      role: "scheduler",
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "mysql://user:pass@localhost:3306/app",
        JWT_SECRET: "session-secret",
        TOOL_SECRET_KEY: "0123456789abcdef0123456789abcdef",
      } as any,
    });
    expect(report.ok).toBe(false);
    expect(report.errors.map(issue => issue.code)).toContain(
      "entrypoint_role_mismatch"
    );
  });
});
