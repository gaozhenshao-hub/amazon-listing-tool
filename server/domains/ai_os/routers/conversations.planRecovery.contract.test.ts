import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "server/domains/ai_os/routers/conversations.ts"), "utf8");

describe("conversation Plan recovery contract", () => {
  it("only restores an unexecuted approved Plan to proposed with state-version comparison", () => {
    expect(source).toContain("recoverPlan: protectedProcedure");
    expect(source).toContain("plan.status !== \"approved\" || hasExecutedStep");
    expect(source).toContain("status='proposed',stateVersion=stateVersion+1");
    expect(source).toContain("PLAN_STATE_VERSION_CONFLICT");
  });

  it("records compensation instead of executing or rolling back an executed Plan", () => {
    expect(source).toContain("PLAN_EXECUTION_OR_RISK_REVIEW_REQUIRED");
    expect(source).toContain("lifecycle.compensation_required");
    expect(source).toContain("restore_proposed");
  });
});
