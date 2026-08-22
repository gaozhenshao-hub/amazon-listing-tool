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
});
