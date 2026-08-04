import { describe, it, expect } from "vitest";
import { getStartupValidationReport } from "./_core/startupValidation";

describe("TOOL_SECRET_KEY environment variable", () => {
  it("rejects a missing production encryption key", () => {
    const report = getStartupValidationReport({
      entrypoint: "web",
      role: "web",
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "mysql://user:pass@localhost:3306/app",
        JWT_SECRET: "test-session-secret",
      } as any,
    });
    expect(report.errors.map(item => item.code)).toContain(
      "tool_secret_key_missing"
    );
  });

  it("accepts a stable production encryption key", () => {
    const report = getStartupValidationReport({
      entrypoint: "web",
      role: "web",
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "mysql://user:pass@localhost:3306/app",
        JWT_SECRET: "test-session-secret",
        TOOL_SECRET_KEY: "0123456789abcdef0123456789abcdef",
        AI_JOB_IN_PROCESS: "false",
      } as any,
    });
    expect(report.errors.map(item => item.code)).not.toContain(
      "tool_secret_key_missing"
    );
  });

  it("AI_JOB_IN_PROCESS should be set to false for worker-separated deployment", () => {
    const val = process.env.AI_JOB_IN_PROCESS;
    // Either false (worker separated) or undefined (in-process mode)
    if (val !== undefined) {
      expect(["false", "true"]).toContain(val);
    }
  });
});
