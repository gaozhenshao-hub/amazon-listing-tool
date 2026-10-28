import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("皇帝 Harness Run Ledger 契约", () => {

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

  it("保留账本敏感键脱敏", () => {
    const service = read("server/domains/ai_os/services/runLedger.ts");
    expect(service).toContain("SENSITIVE_KEY_PATTERN");
    expect(service).toContain("sanitizeLedgerPayload");
    expect(service).toContain("[REDACTED]");
  });
});
