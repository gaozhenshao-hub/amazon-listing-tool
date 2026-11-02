import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("皇帝Skill反馈闭环与有限灰度发布契约", () => {
  it("仅以纯前向表记录计划与决策，不改写Skill或历史评测", () => {
    const migration = read("drizzle/0155_emperor_skill_feedback_rollouts.sql");
    expect(migration).toContain("emperor_skill_rollout_plans");
    expect(migration).toContain("emperor_skill_rollout_decisions");
    expect(migration).not.toMatch(/DROP\s+TABLE|DELETE\s+FROM|UPDATE\s+emperor_skills/i);
  });

  it("要求人工批准与当前强制门禁，并将有限灰度稳定地约束在1%到50%", () => {
    const service = read("server/domains/ai_os/services/skillRollout.ts");
    expect(service).toContain("evaluationMode='manual' AND humanApproved=1");
    expect(service).toContain("候选版本缺少人工批准的真实金标评测");
    expect(service).toContain("候选版本未通过当前强制发布门禁");
    expect(service).toContain("Math.min(Math.max(Math.floor(Number(value || 0)), 0), 50)");
    expect(service).toContain("skillRolloutBucket");
    expect(service).toContain('status: "paused" | "rolled_back" | "completed"');
    expect(service).toContain("input.status === \"rolled_back\"");
  });

  it("仅在显式active计划命中时注入候选快照，固定或回放运行保持原版本", () => {
    const runner = read("server/domains/ai_os/services/skillRunner.ts");
    expect(runner).toContain("resolveActiveSkillRollout");
    expect(runner).toContain('input.skillVersionPolicy !== "snapshot"');
    expect(runner).toContain('input.skillVersionPolicy !== "pinned"');
    expect(runner).toContain("skill_rollout:${rollout.planId}");
    expect(runner).toContain("rollout: rollout ?");
  });

  it("管理员路由与治理页面不提供自动发布入口", () => {
    const router = read("server/domains/ai_os/routers/skills.ts");
    const page = read("client/src/pages/emperor/EmperorQualityGates.tsx");
    for (const procedure of ["createRolloutPlan: adminProcedure", "approveRolloutPlan: adminProcedure", "activateRolloutPlan: adminProcedure", "stopRolloutPlan: adminProcedure"]) {
      expect(router).toContain(procedure);
    }
    expect(page).toContain("有限灰度计划");
    expect(page).toContain("从候选快照创建灰度草稿");
    expect(page).toContain("人工批准");
    expect(page).toContain("回退");
    expect(page).toContain("仅人工批准的候选可按稳定分桶");
  });
});
