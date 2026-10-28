import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("皇帝Context Compiler契约", () => {
  it("只在显式启用时编译知识来源，未启用节点返回兼容旧输入", () => {
    const compiler = read("server/domains/ai_os/services/agentRunner/contextCompiler.ts");
    expect(compiler).toContain("if (record.enabled !== true && !presetEnabled) return null");
    expect(compiler).toContain("if (!policy) return legacyInput");
    expect(compiler).toContain("emperor_knowledge");
  });

  it("将知识引用、稳定排序和受治理Tool策略写入可回放上下文", () => {
    const compiler = read("server/domains/ai_os/services/agentRunner/contextCompiler.ts");
    expect(compiler).toContain("right.score - left.score || left.knowledgeId - right.knowledgeId");
    expect(compiler).toContain('sourceType: "knowledge"');
    expect(compiler).toContain('shell: "denied"');
    expect(compiler).toContain("tool_gateway_only");
    expect(compiler).toContain("policyHash");
  });

  it("由节点执行入口在记录Context Manifest前使用编译后的来源", () => {
    const execution = read("server/domains/ai_os/services/agentRunner/execution.ts");
    const runtime = read("server/domains/ai_os/services/agentRunner/runtimeCore.ts");
    expect(execution).toContain("await compileAgentNodeInput");
    expect(execution).toContain("const compiledSources");
    expect(runtime).toContain('"knowledge"');
    expect(runtime).toContain("compilerPolicy?: AgentContextCompilerPolicy");
  });
});
