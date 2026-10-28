import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  run: vi.fn(),
  gate: vi.fn(),
}));
vi.mock("./repositories/dbClient", () => ({ getDb: mocks.getDb }));
vi.mock("./domains/ai_os/services/skillRunner", () => ({
  runEmperorSkill: mocks.run,
}));
vi.mock("./domains/ai_os/services/skillQualityGates", () => ({
  getSkillReleaseGateDecision: mocks.gate,
}));
import { skillWorkbench } from "./domains/ai_os/services/skillWorkbench";
import type { SkillWorkbenchDraft } from "../shared/skillWorkbench";

const actor = { workspaceId: 7, userId: 9, admin: true, superAdmin: true };
const formal = {
  id: 1,
  slug: "listing.review",
  name: "评论分析",
  workspaceId: 7,
  version: 3,
  status: "Released",
  modelOverride: "model",
  manifest: {
    implementation: {
      systemPrompt: "原方法",
      userPromptTemplate: "{{context}}",
    },
  },
};
const dialect = new MySqlDialect();
function memoryDb() {
  let data: {
    drafts: Array<{
      id: string;
      workspaceId: number;
      userId: number;
      payload: SkillWorkbenchDraft;
    }>;
    skill: typeof formal;
  } = { drafts: [], skill: structuredClone(formal) };
  const trace: Array<{ sql: string; params: unknown[] }> = [];
  let queue = Promise.resolve();
  const executor = (state: typeof data) => ({
    execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
      const { sql, params: p } = dialect.sqlToQuery(query);
      trace.push({ sql, params: p });
      if (sql.includes("FROM emperor_skills"))
        return [[structuredClone(state.skill)]];
      if (sql.startsWith("INSERT INTO emperor_skill_workbench_drafts")) {
        state.drafts.push({
          id: String(p[0]),
          workspaceId: Number(p[1]),
          userId: Number(p[2]),
          payload: JSON.parse(String(p[4])),
        });
        return [{ affectedRows: 1 }];
      }
      if (
        sql.startsWith(
          "SELECT payload FROM emperor_skill_workbench_drafts WHERE id="
        )
      )
        return [
          state.drafts
            .filter(
              row =>
                row.id === p[0] &&
                row.workspaceId === p[1] &&
                row.userId === p[2]
            )
            .map(row => ({ payload: structuredClone(row.payload) })),
        ];
      if (sql.startsWith("UPDATE emperor_skill_workbench_drafts")) {
        const row = state.drafts.find(
          row =>
            row.id === p[1] &&
            row.workspaceId === p[2] &&
            row.userId === p[3] &&
            row.payload.revision === p[4]
        );
        if (!row) return [{ affectedRows: 0 }];
        row.payload = JSON.parse(String(p[0]));
        return [{ affectedRows: 1 }];
      }
      if (
        sql.startsWith("SELECT snapshotId FROM emperor_skill_version_snapshots")
      )
        return [[]];
      if (sql.startsWith("INSERT INTO emperor_skill_version_snapshots"))
        return [{ affectedRows: 1 }];
      if (sql.startsWith("UPDATE emperor_skills SET manifest")) {
        state.skill.manifest = JSON.parse(String(p[0]));
        state.skill.version++;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected test SQL: ${sql}`);
    },
  });
  const db = {
    execute: (query: Parameters<typeof dialect.sqlToQuery>[0]) =>
      executor(data).execute(query),
    transaction: <T>(
      fn: (tx: ReturnType<typeof executor>) => Promise<T>
    ): Promise<T> => {
      const result = queue.then(async () => {
        const working = structuredClone(data);
        const result = await fn(executor(working));
        data = working;
        return result;
      });
      queue = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
  };
  return { db, trace, state: () => data };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockResolvedValue({
    allowed: true,
    mode: "advisory",
    reasons: [],
  });
  mocks.run.mockResolvedValue({
    content: "基于原文的评论分析",
    runId: "fixture-run",
    durationMs: 100,
    costCents: 2,
  });
});
describe("skill workbench owned drafts", () => {
  it("denies another user's draft and another workspace without model calls or registry changes", async () => {
    const memory = memoryDb();
    mocks.getDb.mockResolvedValue(memory.db);
    const draft = await skillWorkbench.create(actor, formal.slug);
    for (const other of [
      { ...actor, userId: 10 },
      { ...actor, workspaceId: 8 },
    ]) {
      await expect(
        skillWorkbench.save(
          other,
          draft.id,
          draft.revision,
          draft.content,
          draft.input
        )
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(mocks.run).not.toHaveBeenCalled();
    expect(memory.state().skill.version).toBe(3);
  });
  it("claims a revision once before a model call, retaining both baseline and candidate test outputs", async () => {
    const memory = memoryDb();
    mocks.getDb.mockResolvedValue(memory.db);
    const draft = await skillWorkbench.create(actor, formal.slug);
    const results = await Promise.allSettled([
      skillWorkbench.run(actor, draft.id, draft.revision, false),
      skillWorkbench.run(actor, draft.id, draft.revision, false),
    ]);
    expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    const tested = memory.state().drafts[0].payload;
    expect(tested.tests[0]).toMatchObject({
      approved: false,
      baseline: false,
      output: "基于原文的评论分析",
    });
    expect(memory.state().skill.manifest.implementation.systemPrompt).toBe(
      "原方法"
    );
  });
  it("publishes only a human-approved tested draft and preserves versions atomically", async () => {
    const memory = memoryDb();
    mocks.getDb.mockResolvedValue(memory.db);
    let draft = await skillWorkbench.create(actor, formal.slug);
    draft = await skillWorkbench.save(
      actor,
      draft.id,
      draft.revision,
      { ...draft.content, systemPrompt: "新方法：引用原文" },
      { context: "测试评论", productId: null }
    );
    draft = await skillWorkbench.run(actor, draft.id, draft.revision, false);
    await expect(
      skillWorkbench.publish(actor, draft.id, draft.revision)
    ).rejects.toThrow("确认至少一个");
    draft = await skillWorkbench.approve(
      actor,
      draft.id,
      draft.revision,
      draft.tests[0].id,
      true
    );
    await skillWorkbench.publish(actor, draft.id, draft.revision);
    expect(memory.state().skill).toMatchObject({
      version: 4,
      manifest: { implementation: { systemPrompt: "新方法：引用原文" } },
    });
    expect(
      memory.trace.filter(item =>
        item.sql.startsWith("INSERT INTO emperor_skill_version_snapshots")
      )
    ).toHaveLength(2);
    expect(memory.state().drafts[0].payload.status).toBe("published");
  });
  it("keeps a failed provider attempt visible and does not automatically retry", async () => {
    const memory = memoryDb();
    mocks.getDb.mockResolvedValue(memory.db);
    mocks.run.mockRejectedValue(new Error("PRIVATE PROVIDER ERROR"));
    const draft = await skillWorkbench.create(actor, formal.slug);
    const failed = await skillWorkbench.run(
      actor,
      draft.id,
      draft.revision,
      false
    );
    expect(failed.status).toBe("failed");
    expect(failed.error).not.toContain("PRIVATE");
    expect(failed.tests).toEqual([]);
    expect(mocks.run).toHaveBeenCalledOnce();
  });
});
