import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { AiJobHandlerContext, AiJobSnapshot } from "../../ai_os/services/jobRunner";

const effects = vi.hoisted(() => ({
  requireDb: vi.fn(),
  listJobs: vi.fn(),
  ensureAgent: vi.fn(),
  createJob: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  progress: vi.fn(),
  model: vi.fn(),
  facts: vi.fn(),
  createDraft: vi.fn(),
  handlers: new Map<string, (job: AiJobSnapshot, context: AiJobHandlerContext) => Promise<unknown>>(),
}));

vi.mock("../../../repositories/dbClient", () => ({ requireDb: effects.requireDb }));
vi.mock("../../ai_os/services/jobRunner", () => ({
  cancelAiJob: effects.cancel,
  createAiJobRun: effects.createJob,
  listAiJobRunsForUser: effects.listJobs,
  registerAiJobHandler: ({ id, handler }: { id: string; handler: (job: AiJobSnapshot, context: AiJobHandlerContext) => Promise<unknown> }) => effects.handlers.set(id, handler),
  scheduleAiJobRun: effects.schedule,
  updateAiJobProgress: effects.progress,
}));
vi.mock("../imageWorkflowAgentBridge", () => ({
  ensureImageWorkflowAgentRun: effects.ensureAgent,
  imageWorkflowSkillNodeId: (step: number) => `node-${step}`,
}));
vi.mock("../routerContext", () => ({ callImageWorkflowSkill: effects.model }));
vi.mock("../expressionLinkageService", () => ({
  createExpressionAnalysisDraft: effects.createDraft,
  createSynthesisDraft: vi.fn(),
  synthesisInputHash: vi.fn(),
}));
vi.mock("../expressionLinkageRepository", async (importOriginal) => ({
  ...await importOriginal<typeof import("../expressionLinkageRepository")>(),
  listSelectedExpressionFacts: effects.facts,
}));

import { startExpressionAnalysisJob } from "./expressionLinkageJob";

const input = { workspaceId: 41, projectId: 7, sessionId: 5, groupId: 11, selectionVersionId: 91, userId: 23 };
const kind = "image.step0.expression.linked-analysis";
const groupError = "表达方向不存在或无权访问";
const selectionError = "表达图片选择版本不存在";
const statusError = "只有已确认的图片选择版本可以进入AI分析";
const dialect = new MySqlDialect();
type Group = { id: number; projectId: number; expressionName: string };
type Selection = {
  id: number; workspaceId: number; projectId: number; groupId: number;
  sessionId: number; status: string; selectedAssetIds: number[]; selectionHash: string;
};
let groups: Group[];
let selections: Selection[];
let events: string[];
let queries: Array<{ table: string; sql: string; params: unknown[] }>;

// The production job and scoped repository queries are real. Only this DB
// boundary interprets their exact parameterized SELECTs over synthetic rows.
// No caller, live MySQL, worker scheduler, provider, or model is executed.
const db = {
  select: () => ({
    from: (table: Parameters<typeof getTableName>[0]) => ({
      where: (condition: SQL) => ({
        limit: async (limit: number) => {
          expect(limit).toBe(1);
          const name = getTableName(table);
          const query = dialect.sqlToQuery(condition);
          queries.push({ table: name, sql: query.sql, params: query.params });
          events.push(name);
          if (name === "expression_groups") {
            expect(query.sql).toBe("(`expression_groups`.`projectId` = ? and `expression_groups`.`id` = ?)");
            return groups.filter((row) => row.projectId === query.params[0] && row.id === query.params[1]).slice(0, limit);
          }
          expect(name).toBe("image_expression_selection_versions");
          expect(query.sql).toBe("(`image_expression_selection_versions`.`workspaceId` = ? and `image_expression_selection_versions`.`projectId` = ? and `image_expression_selection_versions`.`id` = ?)");
          return selections.filter((row) => row.workspaceId === query.params[0] && row.projectId === query.params[1] && row.id === query.params[2]).slice(0, limit);
        },
      }),
    }),
  }),
};

function job(status = "queued"): AiJobSnapshot {
  return { runId: "job-1", kind, status, userId: input.userId, workspaceId: input.workspaceId, input: { ...input, agentRunId: "agent-1", agentNodeId: "node-0" } } as unknown as AiJobSnapshot;
}

function expectNoJobOrModelEffects() {
  for (const spy of [effects.listJobs, effects.ensureAgent, effects.createJob, effects.schedule, effects.cancel, effects.progress, effects.model, effects.facts, effects.createDraft]) {
    expect(spy).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  groups = [{ id: input.groupId, projectId: input.projectId, expressionName: "Synthetic direction" }];
  selections = [{ id: input.selectionVersionId, workspaceId: input.workspaceId, projectId: input.projectId, groupId: input.groupId, sessionId: input.sessionId, status: "confirmed", selectedAssetIds: [101], selectionHash: "synthetic" }];
  events = [];
  queries = [];
  effects.requireDb.mockResolvedValue(db);
  effects.listJobs.mockImplementation(async () => { events.push("active"); return []; });
  effects.ensureAgent.mockImplementation(async () => { events.push("agent"); return "agent-1"; });
  effects.createJob.mockImplementation(async () => { events.push("job"); return job(); });
  effects.schedule.mockImplementation(async () => { events.push("schedule"); });
  effects.cancel.mockResolvedValue(null);
  effects.facts.mockResolvedValue([]);
});

describe("expression linked-analysis admission before enqueue (controlled DB)", () => {
  const denied = [
    ["missing group", () => { groups = []; }, groupError],
    ["group belonging to another project", () => { groups[0].projectId += 1; }, groupError],
    ["missing selection", () => { selections = []; }, selectionError],
    ["selection belonging to another workspace", () => { selections[0].workspaceId += 1; }, selectionError],
    ["selection belonging to another project", () => { selections[0].projectId += 1; }, selectionError],
    ["selection belonging to another group", () => { selections[0].groupId += 1; }, selectionError],
    ["selection belonging to another session", () => { selections[0].sessionId += 1; }, selectionError],
    ["draft selection", () => { selections[0].status = "draft"; }, statusError],
    ["superseded selection", () => { selections[0].status = "superseded"; }, statusError],
  ] as const;

  it.each(denied)("rejects %s before even reading active jobs", async (_name, corrupt, message) => {
    corrupt();
    effects.listJobs.mockResolvedValue([job("running")]);
    await expect(startExpressionAnalysisJob(input)).rejects.toThrow(new Error(message));
    expectNoJobOrModelEffects();
    expect(queries[0]?.params).toEqual([input.projectId, input.groupId]);
    if (message !== groupError) expect(queries[1]?.params).toEqual([input.workspaceId, input.projectId, input.selectionVersionId]);
  });

  it("does not create side effects when the admission database is unavailable", async () => {
    const failure = new Error("synthetic database unavailable");
    effects.requireDb.mockRejectedValue(failure);
    await expect(startExpressionAnalysisJob(input)).rejects.toBe(failure);
    expectNoJobOrModelEffects();
  });

  it.each(["queued", "running"])("reuses a valid %s job only after scoped reads", async (status) => {
    const active = job(status);
    effects.listJobs.mockImplementation(async () => { events.push("active"); return [active]; });
    expect(await startExpressionAnalysisJob(input)).toBe(active);
    expect(events).toEqual(["expression_groups", "image_expression_selection_versions", "active"]);
    expect(effects.ensureAgent).not.toHaveBeenCalled();
    expect(effects.createJob).not.toHaveBeenCalled();
    expect(effects.schedule).not.toHaveBeenCalled();
    expect(effects.model).not.toHaveBeenCalled();
  });

  it("creates and schedules one valid job after the same scoped reads", async () => {
    const created = await startExpressionAnalysisJob(input);
    expect(events).toEqual(["expression_groups", "image_expression_selection_versions", "active", "agent", "job", "schedule"]);
    expect(effects.ensureAgent).toHaveBeenCalledTimes(1);
    expect(effects.ensureAgent).toHaveBeenCalledWith(input);
    expect(effects.createJob).toHaveBeenCalledTimes(1);
    expect(effects.createJob).toHaveBeenCalledWith({
      kind, module: "imageWorkflow", procedure: "imageWorkflow.startExpressionAssetAnalysis",
      workspaceId: input.workspaceId, userId: input.userId, projectId: input.projectId,
      skillSlug: "image.step0.expression.linked-analysis",
      input: { ...input, agentRunId: "agent-1", agentNodeId: "node-0" },
      progress: 5, maxAttempts: 3, timeoutSeconds: 30 * 60,
    });
    expect(effects.schedule).toHaveBeenCalledTimes(1);
    expect(effects.schedule).toHaveBeenCalledWith(created.runId);
    expect(effects.cancel).not.toHaveBeenCalled();
    expect(effects.model).not.toHaveBeenCalled();
  });

  it("preserves the no-Agent refusal without creating or scheduling a job", async () => {
    effects.ensureAgent.mockResolvedValue(null);
    await expect(startExpressionAnalysisJob(input)).rejects.toThrow("图片工作流无法创建Agent Run，任务未入队");
    expect(effects.createJob).not.toHaveBeenCalled();
    expect(effects.schedule).not.toHaveBeenCalled();
  });

  it.each([false, true])("preserves scheduler error and attempts cancellation once (cancel rejects: %s)", async (cancelRejects) => {
    const failure = new Error("synthetic schedule refusal");
    effects.schedule.mockRejectedValue(failure);
    if (cancelRejects) effects.cancel.mockRejectedValue(new Error("synthetic cancel refusal"));
    await expect(startExpressionAnalysisJob(input)).rejects.toBe(failure);
    expect(effects.cancel).toHaveBeenCalledTimes(1);
    expect(effects.cancel).toHaveBeenCalledWith("job-1", "同表达竞品图片分析任务调度失败");
    expect(effects.createJob).toHaveBeenCalledTimes(1);
    expect(effects.schedule).toHaveBeenCalledTimes(1);
    expect(effects.model).not.toHaveBeenCalled();
  });

  it.each(denied)("worker rechecks %s after admission, before facts or models", async (_name, corrupt, message) => {
    const admitted = await startExpressionAnalysisJob(input);
    corrupt();
    vi.clearAllMocks();
    queries = [];
    const handler = effects.handlers.get("imageWorkflow.expressionLinkedAnalysis");
    expect(handler).toBeTypeOf("function");
    await expect(handler!(admitted, { signal: new AbortController().signal } as AiJobHandlerContext)).rejects.toThrow(new Error(message));
    expectNoJobOrModelEffects();
    expect(queries[0]?.params).toEqual([input.projectId, input.groupId]);
    if (message !== groupError) expect(queries[1]?.params).toEqual([input.workspaceId, input.projectId, input.selectionVersionId]);
  });

  it("a valid worker gate continues to the existing confirmed-facts requirement", async () => {
    const handler = effects.handlers.get("imageWorkflow.expressionLinkedAnalysis")!;
    await expect(handler(job(), { signal: new AbortController().signal } as AiJobHandlerContext)).rejects.toThrow("已选图片的确认事实不完整，请回到竞品全图分析复核");
    expect(effects.facts).toHaveBeenCalledTimes(1);
    expect(effects.facts).toHaveBeenCalledWith(db, input.workspaceId, input.selectionVersionId);
    expect(effects.model).not.toHaveBeenCalled();
    expect(effects.createDraft).not.toHaveBeenCalled();
    expect(effects.progress).not.toHaveBeenCalled();
  });
});
