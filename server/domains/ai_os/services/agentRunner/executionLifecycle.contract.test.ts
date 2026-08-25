import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./execution.ts", import.meta.url)), "utf8");

describe("Agent全局P1执行快照契约", () => {
  it("在创建Agent Run时建立受治理Trace与脱敏状态快照", () => {
    expect(source).toContain('const traceId = `agent_run_${runId}`');
    expect(source).toContain('rootRunType: "agent_run"');
    expect(source).toContain('targetType: "agent_run"');
    expect(source).toContain('inputHashScope: "stored_agent_run_inputs"');
    expect(source).toContain('eventType: "lifecycle.snapshot_created"');
  });

  it("为陈旧恢复写入补偿和拒绝事件，并将人工跳过标记为非补偿", () => {
    expect(source).toContain('eventType: "lifecycle.compensation_required"');
    expect(source).toContain('eventType: "lifecycle.recovery_rejected"');
    expect(source).toContain("AGENT_STATE_VERSION_CONFLICT");
    expect(source).toContain("skippedByHuman: input.skip === true");
    expect(source).toContain("compensationRequired: false");
  });

  it("snapshots cancellation and requires compensation when execution progressed or the version conflicts", () => {
    expect(source).toContain('action: "cancel"');
    expect(source).toContain("hasExecutionProgress");
    expect(source).toContain("AGENT_CANCELED_AFTER_EXECUTION");
    expect(source).toContain("AGENT_CANCEL_STATE_VERSION_CONFLICT");
    expect(source).toContain('"confirmed"');
    expect(source).toContain("recoverySnapshotId=?");
  });
});
