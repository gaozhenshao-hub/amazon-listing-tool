import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("皇帝 Harness Run Ledger 契约", () => {
  it("登记前向迁移、类型化实体与只读查询接口", () => {
    const migration = read("drizzle/0153_emperor_run_ledger_v2.sql");
    const schema = read("drizzle/schema/ai_os.ts");
    const router = read("server/domains/ai_os/routers/observability.ts");
    expect(migration).toContain("emperor_run_traces");
    expect(migration).toContain("emperor_run_ledger_events");
    expect(migration).toContain("emperor_context_manifests");
    expect(schema).toContain("emperorRunTraces");
    expect(schema).toContain("emperorRunLedgerEvents");
    expect(schema).toContain("emperorContextManifests");
    expect(router).toContain("traces:");
    expect(router).toContain("traceDetail:");
  });

  it("在Agent运行、节点、Job和人工确认处追加非阻断事件", () => {
    const execution = read("server/domains/ai_os/services/agentRunner/execution.ts");
    expect(execution).toContain("ensureAgentRunTrace");
    expect(execution).toContain("recordContextManifest");
    expect(execution).toContain('eventType: "agent.run_started"');
    expect(execution).toContain('eventType: "agent.node_running"');
    expect(execution).toContain('eventType: "job.queued"');
    expect(execution).toContain("human.node_confirmed");
    expect(execution).toContain(".catch(() => null)");
  });

  it("对敏感键脱敏，并在既有运行历史中提供Trace查看工作区", () => {
    const service = read("server/domains/ai_os/services/runLedger.ts");
    const trace = read("client/src/pages/emperor/EmperorTrace.tsx");
    const panel = read("client/src/pages/emperor/components/RunLedgerPanel.tsx");
    expect(service).toContain("SENSITIVE_KEY_PATTERN");
    expect(service).toContain("[REDACTED]");
    expect(trace).toContain("查看 Agent 执行轨迹");
    expect(panel).toContain("Context Manifest");
    expect(panel).toContain("trpc.emperor.observability.traces");
  });
});
