import { beforeEach, describe, it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { emptyImageDocument } from "../../../shared/imageDocument";
import { blankImageOutline } from "../../../shared/imagePlanning";
const f = vi.hoisted(() => ({
  current: null as any,
  context: null as any,
  draft: null as any,
  job: null as any,
  owned: { status: "running", attempt: 1, lockedBy: "worker-one" },
  start: vi.fn(),
  agent: vi.fn(),
  agentContext: vi.fn(),
  handler: null as any,
  model: vi.fn(),
  save: vi.fn(),
  sqls: [] as string[],
  scopeLock: vi.fn(),
}));
const dialect = new MySqlDialect();
const execute = async (query: any) => {
  const { sql, params } = dialect.sqlToQuery(query);
  f.sqls.push(sql);
  if (sql.startsWith("SELECT * FROM listing_image_document_candidates"))
    return [f.draft ? [f.draft] : []];
  if (sql.startsWith("SELECT id FROM listing_image_document_candidates"))
    return [f.draft ? [{ id: f.draft.id }] : []];
  if (sql.startsWith("SELECT status,attempt,lockedBy")) return [[f.owned]];
  if (sql.startsWith("UPDATE listing_image_documents SET job_run_id"))
    f.current.jobRunId = params[0];
  return [{ affectedRows: 1 }];
};
vi.mock("../../repositories/dbClient", () => ({
  requireDb: async () => ({
    execute,
    transaction: async (fn: any) => fn({ execute }),
  }),
}));
vi.mock("./imagePlanningStore", () => ({
  lockPlanningProject: f.scopeLock,
  planningRows: async (_tx: any, query: any) => (await execute(query))[0],
  planningJson: (value: any) =>
    typeof value === "string" ? JSON.parse(value) : value,
}));
vi.mock("./imageDocumentStore", () => ({
  readImageDocument: async () => structuredClone(f.current),
  assertDocumentEditable: (value: any) => {
    if (value.locked) throw new Error("文档已锁定");
  },
  documentConflict: () => new Error("资料已更新"),
  saveImageDocument: f.save,
}));
vi.mock("./imageDocumentContext", () => ({
  imageDocumentContext: async () => structuredClone(f.context),
  imageDocumentConfiguration: async () => ({
    revision: 1,
    config: {
      enabled: true,
      skills: [],
      modelSlug: "configured-model",
      instructions: "",
    },
    snapshot: { version: 1, manifestHash: "runtime-hash" },
  }),
}));
vi.mock("./imageDocumentAgent", () => ({
  ensureImageDocumentAgent: f.agent,
  imageDocumentAgentContext: f.agentContext,
}));
vi.mock("../../services/aiJobRunner", () => ({
  getAiJobRun: async () => f.job,
  startRegisteredAiJob: f.start,
  registerAiJobHandler: (registration: any) => {
    f.handler = registration.handler;
  },
  updateAiJobProgress: vi.fn(),
}));
vi.mock("./runCompetitorSkill", () => ({ runCompetitorSkill: f.model }));
vi.mock("../ai_os/services/skillRunner", () => ({
  safeParseSkillJSON: JSON.parse,
}));
vi.mock("./imagePlanningContext", () => ({
  planningModelSources: (value: any) => value,
}));
vi.mock("./imagePlanningSources", () => ({
  planningVisuals: async () => ({ images: [], attachments: [] }),
}));
vi.mock("./researchLocks", () => ({
  researchLocks: async () => ({}),
  assertResearchEditable: vi.fn(),
}));
vi.mock("./compositionSketches", () => ({
  queueCompositionSketch: vi.fn(async () => ({ id: "sketch" })),
}));
vi.mock("./compositionReferenceSelection", () => ({
  selectCompositionReference: vi.fn(),
}));
vi.mock("../ai_os/services/skillWorkbench", () => ({
  createSkillImprovementDraft: async () => ({ id: "independent-draft" }),
}));
vi.mock("../ai_os/services/businessManagedAgent", () => ({
  markBusinessManagedNodeRunning: vi.fn(),
  markBusinessManagedNodeWaitingHuman: vi.fn(),
  markBusinessManagedNodeFailed: vi.fn(),
  markBusinessManagedNodeConfirmed: vi.fn(),
}));
import {
  startImageDocument,
  executeImageDocument,
  imageDocumentStatus,
  confirmImageDocument,
  dismissImageDocument,
} from "./imageDocument";
const scope = { projectId: 11, workspaceId: 3, userId: 7, role: "admin" },
  input = {
    projectId: 11,
    revision: 1,
    mode: "generate" as const,
    message: "",
  };
const row = () => ({
  id: "11111111-1111-4111-8111-111111111111",
  status: "open",
  base_revision: 1,
  source_hash: "source",
  configuration_revision: 1,
  data: f.current.data,
  original_data: f.current.data,
  input_data: { original: "input" },
  history: [{ role: "user", text: "请改进" }],
  reply: "已整理",
  mode: "generate",
  image_id: null,
  stage: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  f.sqls = [];
  const outline = blankImageOutline();
  outline.groups = outline.groups.slice(0, 1);
  outline.groups[0].items = outline.groups[0].items.slice(0, 1);
  outline.groups[0].items[0].content = "六口袋实拍";
  f.current = {
    data: { ...emptyImageDocument(outline), sourceOutlineHash: "outline" },
    revision: 1,
    locked: false,
    jobRunId: null,
  };
  f.context = {
    plan: { data: outline },
    sources: { input: { fact: "本品六口袋" }, upstream: {} },
    tags: { categories: ["农业品"], styles: ["田园自然风"] },
    materials: [],
    referenceSets: [],
    sourceHash: "source",
    outlineHash: "outline",
    configurationRevision: 1,
  };
  f.draft = null;
  f.job = null;
  f.owned = { status: "running", attempt: 1, lockedBy: "worker-one" };
  f.start.mockImplementation(async (args: any) => ({ runId: args.runId }));
  f.agent.mockResolvedValue({
    agentRunId: "agent-run",
    agentNodeId: "document",
  });
  f.agentContext.mockImplementation(async (_id, scope) => {
    if (scope.workspaceId !== 3 || scope.userId !== 7 || scope.projectId !== 11)
      throw new Error("流程与当前项目不匹配");
    return { runId: "agent-run", nodeId: "document", dag: {}, userId: 7 };
  });
  f.save.mockImplementation(async (_scope, revision, data) => ({
    ...f.current,
    revision: revision + 1,
    data,
  }));
  f.model.mockImplementation(async (request: any) => {
    const req = JSON.parse(request.context),
      data = f.current.data;
    return {
      parsed: request.validate(
        JSON.stringify({
          reply: "已整理",
          category: "农业品",
          styles: ["田园自然风"],
          palette: data.palette,
          entries: req.selectedEntries.map((e: any) => ({
            imageId: e.imageId,
            layout: "单画面",
            framing: "居中构图",
            layoutNote: "主体居中",
            scenes: e.scenes.map(({ id, ...s }: any) => s),
            copy: { ...e.copy, icons: [] },
            prompts: {
              scene: "背景",
              product: "嵌入本品",
              composition: "统一光影",
              textIcons: "标题",
            },
          })),
        })
      ),
    };
  });
});
async function queued(options: Partial<Parameters<typeof startImageDocument>[1]> = {}) {
  await startImageDocument(scope, { ...input, ...options });
  const created = f.start.mock.calls[0][0];
  return {
    ...created,
    input: created.input,
    status: "running",
    attempt: 1,
    lockedBy: "worker-one",
    projectId: 11,
    workspaceId: 3,
    userId: 7,
  } as any;
}
describe("套图文档真实任务与确认边界", () => {
  it("首次请求带用户上限，超长时只返修该字段并生成预览", async () => {
    f.context.plan.data.groups[0].moduleType = "附图";
    const image = f.current.data.entries[0];
    image.copy = {
      ...image.copy,
      headline: "A title with too many words",
      headlineZh: "一条很长的标题",
      headlinePosition: "顶部",
    };
    const copyLimits = { headline: 3, excludedImageIds: [] };
    const snapshot = await queued({ copyLimits });
    const generate = f.model.getMockImplementation()!;
    f.model.mockImplementationOnce(async request => {
      expect(JSON.parse(request.context).copyLimits).toEqual(copyLimits);
      return generate(request);
    }).mockImplementationOnce(async request => {
      const { mode, repairs } = JSON.parse(request.context);
      expect(mode).toBe("repairCopy");
      expect(repairs).toMatchObject([{ imageId: image.imageId, field: "headline", limit: 3 }]);
      return { parsed: request.validate(JSON.stringify({
        changes: [{ key: repairs[0].key, text: "Beekeeping Protection", translation: "养蜂防护" }],
      })) };
    });
    await executeImageDocument(snapshot, new AbortController().signal);
    expect(f.model).toHaveBeenCalledTimes(2);
    expect(f.sqls.some(statement => statement.startsWith("INSERT INTO listing_image_document_candidates"))).toBe(true);
  });
  it("返修仍失败时，状态页显示图位和对应字段", async () => {
    const [group] = f.context.plan.data.groups;
    f.current.jobRunId = "failed-image-copy";
    f.job = {
      ...scope,
      runId: f.current.jobRunId,
      status: "failed",
      progress: 100,
      error: "[unknown] IMAGE_COPY_LIMIT " + JSON.stringify({
        imageId: group.items[0].id, field: "bodyLine", index: 1, limit: 7,
      }),
      input: { copyLimits: { bodyLine: 7, excludedImageIds: [] } },
    };
    const status = await imageDocumentStatus(scope);
    expect(status.job?.error).toContain(`${group.title} · 图1`);
    expect(status.job?.error).toContain("第2行");
    expect(status.job?.copyLimits).toEqual(f.job.input.copyLimits);
  });
  it("工作端使用任务记录中的项目归属校验流程，不信任输入中遗留的旧工作区", async () => {
    const snapshot = await queued();
    await expect(
      f.handler(
        { ...snapshot, workspaceId: 4 },
        { signal: new AbortController().signal }
      )
    ).rejects.toThrow("当前项目不匹配");
    expect(f.agentContext).toHaveBeenCalledWith(
      "agent-run",
      expect.objectContaining({ workspaceId: 4 })
    );
    expect(f.model).not.toHaveBeenCalled();
  });
  it("打开状态页只读，不自动排队或调用模型", async () => {
    await imageDocumentStatus(scope);
    expect(f.start).not.toHaveBeenCalled();
    expect(f.model).not.toHaveBeenCalled();
    expect(f.sqls.some(s => s.startsWith("UPDATE"))).toBe(false);
  });
  it("主动点击后绑定独立流程、当前项目与配置模型，角色不会破坏任务输入", async () => {
    const snapshot = await queued();
    expect(snapshot.input).toMatchObject({
      ...scope,
      agentRunId: "agent-run",
      agentNodeId: "document",
    });
    await executeImageDocument(snapshot, new AbortController().signal);
    expect(f.model).toHaveBeenCalledWith(
      expect.objectContaining({
        modelOverride: "configured-model",
        expectedSkillVersion: 1,
        expectedSkillManifestHash: "runtime-hash",
      }),
      expect.any(Function),
      expect.objectContaining({ validationFailed: expect.any(Function) })
    );
    expect(
      f.sqls.some(s =>
        s.startsWith("INSERT INTO listing_image_document_candidates")
      )
    ).toBe(true);
    expect(f.save).not.toHaveBeenCalled();
    expect(
      (await import("./compositionSketches")).queueCompositionSketch
    ).not.toHaveBeenCalled();
  });
  it("锁定、旧版本和空白大纲都不会启动任务", async () => {
    f.current.locked = true;
    await expect(startImageDocument(scope, input)).rejects.toThrow("锁定");
    f.current.locked = false;
    await expect(
      startImageDocument(scope, { ...input, revision: 0 })
    ).rejects.toThrow("已更新");
    f.context.plan.data.groups = [];
    await expect(startImageDocument(scope, input)).rejects.toThrow("先填写");
    expect(f.start).not.toHaveBeenCalled();
  });
  it("本地校验失败可进入修正重试，保留本品事实且不会污染后续网络错误分类", async () => {
    const snapshot = await queued();
    const success = f.model.getMockImplementation()!;
    f.model.mockImplementationOnce(async (request, beforeRetry, options) => {
      expect(options.validationFailed()).toBe(false);
      expect(() => request.validate('{"reply":"缺少文档结构"}')).toThrow();
      expect(options.validationFailed()).toBe(true);
      beforeRetry(new Error("wrapped validation"), 1, request);
      expect(JSON.parse(request.context).upstream.fact).toBe("本品六口袋");
      expect(JSON.parse(request.context).correction).toContain("修正");
      expect(options.validationFailed()).toBe(false);
      return success(request);
    });
    await executeImageDocument(snapshot, new AbortController().signal);
    expect(
      f.sqls.some(s =>
        s.startsWith("INSERT INTO listing_image_document_candidates")
      )
    ).toBe(true);
  });
  it("重新整理必须提供改进意见，缺少其他参考目的也不会启动", async () => {
    f.current.data.organized = true;
    await expect(startImageDocument(scope, input)).rejects.toThrow("说明");
    f.current.data.organized = false;
    f.current.data.entries[0].references.other = [
      {
        reference: { source: "knowledge", imageId: 4, label: "图" },
        purpose: "",
      },
    ];
    await expect(startImageDocument(scope, input)).rejects.toThrow("参考目的");
    expect(f.start).not.toHaveBeenCalled();
  });
  it("取消或失去执行权的工作端不发布候选", async () => {
    const snapshot = await queued();
    f.owned.status = "canceled";
    await expect(
      executeImageDocument(snapshot, new AbortController().signal)
    ).rejects.toThrow("已更新");
    expect(
      f.sqls.some(s =>
        s.startsWith("INSERT INTO listing_image_document_candidates")
      )
    ).toBe(false);
  });
  it("模型运行期间上级资料变化，不覆盖旧预览或当前文档", async () => {
    const snapshot = await queued(),
      original = f.model.getMockImplementation()!;
    f.model.mockImplementation(async (...args: any[]) => {
      const result = await original(...args);
      f.context.sourceHash = "changed";
      return result;
    });
    await expect(
      executeImageDocument(snapshot, new AbortController().signal)
    ).rejects.toThrow("已更新");
    expect(f.sqls.some(s => s.includes("SET status='superseded'"))).toBe(false);
    expect(f.save).not.toHaveBeenCalled();
  });
  it("取消预览只标记该用户候选，保留原文档", async () => {
    f.draft = row();
    await dismissImageDocument(scope, f.draft.id);
    expect(f.scopeLock).toHaveBeenCalledWith(expect.anything(), scope);
    expect(f.sqls.at(-1)).toContain("user_id=?");
    expect(f.save).not.toHaveBeenCalled();
  });
  it("锁定、人工修改和上游资料变化时，仍直接采用图片内容预览", async () => {
    f.draft = { ...row(), base_revision: 0, configuration_revision: 0 };
    await expect(
      confirmImageDocument(scope, f.draft.id, false)
    ).resolves.toBeDefined();
    f.save.mockClear();
    f.current.locked = true;
    f.draft = { ...row(), source_hash: "outdated" };
    const displayed = structuredClone(f.draft.data);
    f.current.data = { ...f.current.data, category: "刚编辑的类别" };
    await expect(confirmImageDocument(scope, f.draft.id, false)).resolves.toMatchObject({ data: displayed });
    expect(f.save).toHaveBeenCalledOnce();
  });
  it("新任务尚未完成不能采用旧预览", async () => {
    f.draft = row();
    f.current.jobRunId = "running";
    f.job = { status: "running" };
    await expect(
      confirmImageDocument(scope, f.draft.id, false)
    ).rejects.toThrow("还在整理");
    expect(f.save).not.toHaveBeenCalled();
  });
  it("仅确认才替换文档，取消与对话不自动训练正式技能", async () => {
    f.draft = row();
    await confirmImageDocument(scope, f.draft.id, false);
    expect(f.save).toHaveBeenCalledWith(
      scope,
      1,
      f.draft.data,
      expect.anything(),
      { generated: true, acceptPreview: true }
    );
    expect(f.sqls.some(s => s.includes("SET status='confirmed'"))).toBe(true);
  });
});
