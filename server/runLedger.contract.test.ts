import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("皇帝 Harness Run Ledger 契约", () => {
  it("登记 0153 物理审计表，并提供只读 runProjection 查询", () => {
    const migration = read("drizzle/0153_emperor_run_ledger_v2.sql");
    const router = read("server/domains/ai_os/routers/observability.ts");
    const projection = read("server/domains/ai_os/services/contextProvenance.ts");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `emperor_run_traces`");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `emperor_run_ledger_events`");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `emperor_context_manifests`");
    expect(router).toContain("runProjection: adminProcedure");
    expect(router).toContain(".query(async ({ input }) => listRunLedgerProjection(input))");
    expect(projection).toContain("FROM emperor_run_ledger_events WHERE traceId=?");
    expect(projection).toContain("SELECT sourceType,sourceKey,status,invalidationReason,invalidatedAt");
  });

  it("通过当前 Trace、Ledger 与 Context Manifest 服务写审计，并使生命周期审计非阻断", () => {
    const execution = read("server/domains/ai_os/services/agentRunner/execution.ts");
    const service = read("server/domains/ai_os/services/runLedger.ts");
    expect(service).toContain("export async function ensureRunTrace");
    expect(service).toContain("export async function appendRunLedgerEvent");
    expect(service).toContain("export async function recordContextManifest");
    expect(execution).toContain("ensureRunTrace(");
    expect(execution).toContain("appendRunLedgerEvent(");
    expect(execution).toContain('eventType: "lifecycle.snapshot_created"');
    expect(execution).toContain('eventType: input.skip ? "lifecycle.skipped" : "lifecycle.confirmed"');
    expect(execution).toContain("}).catch(() => undefined);");
    expect(execution).not.toContain("ensureAgentRunTrace");
    expect(execution).not.toContain('eventType: "agent.run_started"');
    expect(execution).not.toContain('eventType: "agent.node_running"');
    expect(execution).not.toContain('eventType: "job.queued"');
    expect(execution).not.toContain("human.node_confirmed");
  });

  it("对敏感键脱敏，并让 RunLedgerPanel 仅经 runProjection 读取账本", () => {
    const service = read("server/domains/ai_os/services/runLedger.ts");
    const panel = read("client/src/pages/emperor/components/RunLedgerPanel.tsx");
    expect(service).toContain("SENSITIVE_KEY_PATTERN");
    expect(service).toContain("sanitizeLedgerPayload");
    expect(service).toContain("[REDACTED]");
    expect(panel).toContain("trpc.emperor.observability.runProjection.useQuery");
    expect(panel).toContain("enabled: Boolean(detail?.traceId)");
    expect(panel).not.toContain("trpc.emperor.observability.traces");
  });
});
