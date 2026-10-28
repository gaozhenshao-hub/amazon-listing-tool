import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("皇帝候选版本回放评测契约", () => {
  it("只对已批准金标和同Skill版本快照执行受控回放", () => {
    const service = read("server/domains/ai_os/services/skillQualityGates.ts");
    expect(service).toContain("仅允许回放已批准的真实金标用例");
    expect(service).toContain("候选版本快照不存在或不属于该Skill");
    expect(service).toContain("evaluationMode: \"replay\"");
    expect(service).toContain("replaySnapshot");
  });

  it("回放输出仅写入独立评测记录并执行确定性约束检查", () => {
    const service = read("server/domains/ai_os/services/skillQualityGates.ts");
    expect(service).toContain("evaluateExpectedConstraints");
    expect(service).toContain("requiredIncludes");
    expect(service).toContain("forbiddenIncludes");
    expect(service).toContain("emperor_skill_eval_results");
    expect(service).toContain('"replay", "completed"');
  });

  it("Skill运行器以evaluation preset隔离回放调用量，门禁只统计人工评测", () => {
    const runner = read("server/domains/ai_os/services/skillRunner.ts");
    const service = read("server/domains/ai_os/services/skillQualityGates.ts");
    expect(runner).toContain('executionPreset !== "evaluation"');
    expect(runner).toContain("UPDATE emperor_skills SET callCount = callCount + 1");
    expect(service).toContain('executionPreset: "evaluation"');
    expect(service).toContain("evaluationMode='manual'");
  });

  it("路由仅管理员可启动回放，并提供结果读取接口", () => {
    const router = read("server/domains/ai_os/routers/skills.ts");
    expect(router).toContain("replayEvalCase: adminProcedure");
    expect(router).toContain("replayResults: protectedProcedure");
    expect(router).toContain("versionSnapshots: protectedProcedure");
  });
});
