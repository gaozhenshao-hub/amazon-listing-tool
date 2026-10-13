import { afterEach, describe, it, expect, vi } from "vitest";
import { getStartupValidationReport } from "./_core/startupValidation";

const SYNTHETIC_TOOL_SECRET = "0123456789abcdef0123456789abcdef";
const productionEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "mysql://synthetic:synthetic@localhost:3306/test_only",
  JWT_SECRET: "synthetic-session-secret",
  AI_JOB_IN_PROCESS: "false",
};

afterEach(() => vi.unstubAllEnvs());

describe("TOOL_SECRET_KEY environment variable", () => {
  it("rejects a missing production encryption key", () => {
    const report = getStartupValidationReport({
      entrypoint: "web",
      role: "web",
      env: { ...productionEnv },
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
        ...productionEnv,
        TOOL_SECRET_KEY: SYNTHETIC_TOOL_SECRET,
      },
    });
    expect(report.errors.map(item => item.code)).not.toContain(
      "tool_secret_key_missing"
    );
  });

  it("accepts a synthetically configured runtime tool encryption key", () => {
    vi.stubEnv("TOOL_SECRET_KEY", SYNTHETIC_TOOL_SECRET);
    const report = getStartupValidationReport({
      entrypoint: "web",
      role: "web",
      env: {
        ...productionEnv,
        TOOL_SECRET_KEY: process.env.TOOL_SECRET_KEY,
      },
    });

    expect(report.errors.map(item => item.code)).not.toContain(
      "tool_secret_key_missing"
    );
  });

  it.each([undefined, "short"])("rejects an injected invalid key (%s) without a host secret fallback", value => {
    vi.stubEnv("TOOL_SECRET_KEY", value);
    const report = getStartupValidationReport({
      entrypoint: "web", role: "web",
      env: { ...productionEnv, TOOL_SECRET_KEY: process.env.TOOL_SECRET_KEY },
    });
    expect(report.errors.map(item => item.code)).toContain("tool_secret_key_missing");
  });

  it.each(["false", "true", undefined])("checks synthetic worker separation setting (%s)", value => {
    vi.stubEnv("AI_JOB_IN_PROCESS", value);
    const report = getStartupValidationReport({
      entrypoint: "web", role: "web",
      env: { ...productionEnv, TOOL_SECRET_KEY: SYNTHETIC_TOOL_SECRET, AI_JOB_IN_PROCESS: process.env.AI_JOB_IN_PROCESS },
    });
    expect(report.warnings.some(item => item.code === "embedded_ai_job_worker")).toBe(value !== "false");
  });
});
