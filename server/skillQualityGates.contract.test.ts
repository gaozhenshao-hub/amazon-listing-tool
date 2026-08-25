import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("皇帝Skill质量评测与发布门禁契约", () => {
  it("登记金标、版本快照、评测结果和门禁的纯前向迁移与类型化实体", () => {
    const migration = read("drizzle/0154_emperor_skill_quality_gates.sql");
    const schema = read("drizzle/schema/ai_os.ts");
    for (const table of [
      "emperor_skill_version_snapshots",
      "emperor_skill_eval_cases",
      "emperor_skill_eval_results",
      "emperor_skill_release_gates",
    ]) expect(migration).toContain(table);
    expect(schema).toContain("emperorSkillVersionSnapshots");
    expect(schema).toContain("emperorSkillEvalCases");
    expect(schema).toContain("emperorSkillReleaseGates");
  });

  it("在Skill创建、更新和发布入口保存候选快照，且仅强制门禁阻止发布", () => {
    const router = read("server/domains/ai_os/routers/skills.ts");
    expect(router).toContain("captureSkillVersionSnapshot");
    expect(router).toContain("getSkillReleaseGateDecision");
    expect(router).toContain('gate.mode === "enforced" && !gate.allowed');
    expect(router).toContain("发布门禁未通过");
    expect(router).toContain("createEvalCase:");
    expect(router).toContain("recordEvalResult:");
    expect(router).toContain("updateReleaseGate:");
  });

  it("默认门禁为建议式，且评测界面不生成或伪造质量结果", () => {
    const service = read("server/domains/ai_os/services/skillQualityGates.ts");
    const page = read("client/src/pages/emperor/EmperorQualityGates.tsx");
    expect(service).toContain('mode === "enforced" ? "enforced" : "advisory"');
    expect(service).toContain('"manual", "completed"');
    expect(page).toContain("仅记录人工判断，不触发模型生成。");
    expect(page).toContain("金标用例与候选回放");
    expect(page).toContain("发布门禁策略");
  });
});
