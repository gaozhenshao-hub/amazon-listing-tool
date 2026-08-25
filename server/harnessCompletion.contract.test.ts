import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("Harness剩余能力统一契约", () => {
  it("登记审批、反馈、Preset与受控并行的纯前向数据结构", () => {
    const migration = read("drizzle/0156_emperor_harness_completion.sql");
    for (const table of [
      "emperor_harness_review_requests",
      "emperor_harness_feedback_signals",
      "emperor_execution_presets",
      "emperor_parallel_plans",
      "emperor_parallel_branches",
    ]) expect(migration).toContain(`CREATE TABLE ${table}`);
    expect(migration).not.toMatch(/\bDROP\b/i);
  });

  it("只允许显式人审、Preset、反馈和独立分支计划进入治理服务", () => {
    const service = read("server/domains/ai_os/services/harnessCompletion.ts");
    expect(service).toContain("review_required");
    expect(service).toContain("approval_required");
    expect(service).toContain("selection_required");
    expect(service).toContain("SYSTEM_EXECUTION_PRESETS");
    expect(service).toContain("modelStrategy");
    expect(service).toContain("prohibitBusinessWrites: true");
    expect(service).toContain("至少需要两个独立分支");
    expect(service).toContain("Math.min(4, unique.length)");
  });

  it("将人工选择非阻断归因并保持Tool与Preset的安全边界", () => {
    const lifecycle = read("server/domains/ai_os/services/artifactLifecycle.ts");
    const registry = read("server/domains/ai_os/services/toolGateway/registry.ts");
    const executors = read("server/domains/ai_os/services/toolGateway/executors.ts");
    const compiler = read("server/domains/ai_os/services/agentRunner/contextCompiler.ts");
    expect(lifecycle).toContain("recordHarnessFeedback");
    expect(registry).toContain("internal.lingxing.read");
    expect(registry).not.toContain("internal.export.prepare");
    expect(executors).toContain("requires at least one shop scope parameter");
    expect(compiler).toContain('preset === "quality_first"');
    expect(compiler).toContain('preset === "evaluation"');
  });

  it("在既有状态机保持waiting_human兼容时创建结构化人审请求", () => {
    const stateMachine = read("server/domains/ai_os/services/agentStateMachine.ts");
    expect(stateMachine).toContain("createHarnessReviewRequest");
    expect(stateMachine).toContain('input.to === "waiting_human"');
    expect(stateMachine).toContain("normalizeReviewType");
    expect(stateMachine).toContain('"waiting_human"');
  });

  it("提供可操作的人审决定、模型策略可见证据和备案后验收清单", () => {
    const governance = read("client/src/pages/emperor/EmperorHarnessGovernance.tsx");
    expect(governance).toContain("resolveReviewRequest");
    expect(governance).toContain("人工决定已写入审核账本");
    expect(governance).toContain("模型策略：");
    expect(governance).toContain("备案恢复后的真实业务验收清单");
    expect(governance).toContain("确认选择");
  });

  it("将质量与评测Preset的模型策略接入实际Skill候选模型解析", () => {
    const runner = read("server/domains/ai_os/services/skillRunner.ts");
    const execution = read("server/domains/ai_os/services/agentRunner/execution.ts");
    expect(runner).toContain("executionPreset?: SkillExecutionPreset");
    expect(runner).toContain('executionPreset === "quality_first"');
    expect(runner).toContain("const qualityModel = executionPreset === \"quality_first\"");
    expect(runner).toContain("qualityModel,");
    expect(runner).toContain("configuredModel,");
    expect(runner).toContain("__executionPreset: executionPreset");
    expect(execution).toContain('const executionPreset = normalizeSkillExecutionPreset((node as any).executionPreset || "standard")');
    expect(execution).toContain("executionPreset: payload.executionPreset");
  });
});
