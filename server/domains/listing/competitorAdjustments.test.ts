import { beforeEach, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { acquisitionReviewHash } from "../../../shared/acquisitionReview";
const f = vi.hoisted(() => ({
  record: {} as any,
  data: {} as any,
  revision: 4,
  owner: true,
  reply: {} as any,
  receipts: new Map<string, any>(),
  improvementError: false,
  execute: vi.fn(),
  create: vi.fn(),
  run: vi.fn(),
}));
vi.mock("../../repositories/dbClient", () => ({
  requireDb: async () => ({
    execute: f.execute,
    transaction: async (fn: any) => {
      const before = {
        data: structuredClone(f.data),
        revision: f.revision,
        receipts: new Map(f.receipts),
      };
      try {
        return await fn({ execute: f.execute });
      } catch (e) {
        Object.assign(f, before);
        throw e;
      }
    },
  }),
}));
vi.mock("../ai_os/services/skillRunner", () => ({
  safeParseSkillJSON: JSON.parse,
}));
vi.mock("./runCompetitorSkill", () => ({ runCompetitorSkill: f.run }));
vi.mock("../ai_os/services/skillWorkbench", () => ({
  createSkillImprovementDraft: f.create,
}));
vi.mock("../knowledge/richContentTranslation", () => ({
  MEDIA_TRANSLATION_SKILL: "knowledge.media.translation.v1",
}));
vi.mock("../../storage", () => ({
  resolveStoredObjectUrl: async (key: string) =>
    `https://stored.invalid/${key}`,
}));
import {
  adjustCompetitorResult,
  confirmCompetitorAdjustment,
} from "./competitorAdjustments";
import { competitorStudyFields } from "../../../shared/competitorStudyFields";
const scope = { workspaceId: 1, userId: 2, role: "admin" },
  hash = "a".repeat(64),
  operationId = "9f595324-ec34-4831-92ae-8c4ec1a27a21";
const dialect = new MySqlDialect();
const raw = () => JSON.parse(f.record.rawData);
const pointKey = () =>
  Object.keys(
    competitorStudyFields(raw().comparisonAnalysis, raw().sourceLayout)
  ).find(k => k.startsWith("module:"))!;
const baseline = () => ({
  sourceHash: acquisitionReviewHash({
    study: raw().comparisonAnalysis,
    layout: raw().sourceLayout,
    snapshot: 170,
  }),
  revision: f.revision,
});
const change = () => ({
  key: pointKey(),
  original: "耐用",
  value: "用户确认的耐用材料",
});
const confirmInput = (improve = false) => ({
  projectId: 1,
  analysisId: 1,
  target: "translation" as const,
  fieldKeys: [pointKey()],
  history: [
    { role: "user" as const, text: "请把重复的耐用卖点合并" },
    { role: "assistant" as const, text: "已统一，请确认" },
  ],
  proposed: [change()],
  baseline: baseline(),
  operationId,
  improve,
});
beforeEach(() => {
  vi.clearAllMocks();
  f.revision = 4;
  f.owner = true;
  f.receipts = new Map();
  f.improvementError = false;
  const data = {
    confirmedSnapshotId: 170,
    analysisStale: false,
    sourceLayout: {
      version: 2,
      modules: [
        {
          id: "aplus-0",
          section: "aplus",
          kind: "image",
          cards: [
            {
              images: [{ hash }],
              blocks: [{ id: "copy", text: "Durable material" }],
            },
          ],
        },
      ],
    },
    imageAssets: [{ sourceUrlHash: hash, storageKey: "tenant/source.jpg" }],
    comparisonAnalysis: {
      images: [
        { hash, sellingPoints: ["耐用"], sellingPointCategories: ["质量"] },
      ],
      richContent: {
        version: 1,
        generatedAt: "now",
        images: [],
        texts: [
          {
            id: "copy",
            source: "Durable material",
            translation: "耐用材料",
            sellingPoints: ["耐用"],
            sellingPointCategories: ["质量"],
          },
        ],
      },
    },
  };
  f.record = {
    rawData: JSON.stringify(data),
    asin: "B08C7LHM7S",
    title: "Title",
    bulletPoints: "[]",
  };
  f.data = { selling: [], reviews: [], questions: [], marks: [] };
  f.execute.mockImplementation(async (q: any) => {
    const { sql, params } = dialect.sqlToQuery(q);
    if (sql.includes("SELECT id FROM projects"))
      return [f.owner ? [{ id: 1 }] : []];
    if (sql.includes("SELECT c.rawData")) return [f.owner ? [f.record] : []];
    if (sql.includes("SELECT rawData,bulletPoints")) return [[f.record]];
    if (sql.includes("SELECT data,revision FROM listing_aggregations"))
      return [[{ data: structuredClone(f.data), revision: f.revision }]];
    if (sql.includes("SELECT payload FROM emperor_skill_workbench_drafts"))
      return [
        [
          ...(f.receipts.has(String(params[0]))
            ? [{ payload: f.receipts.get(String(params[0])) }]
            : []),
        ],
      ];
    if (sql.includes("UPDATE listing_aggregations")) {
      f.data = JSON.parse(String(params[0]));
      f.revision++;
      return [{ affectedRows: 1 }];
    }
    throw new Error("Unexpected SQL: " + sql);
  });
  f.create.mockImplementation(
    async (_actor: any, _slug: string, id: string, input: any, tx: any) => {
      expect(tx.execute).toBe(f.execute);
      f.receipts.set(id, { input });
      if (f.improvementError) throw new Error("工作台保存失败");
      return { id };
    }
  );
  f.run.mockImplementation(async (request: any) => ({
    parsed: request.validate(JSON.stringify(f.reply)),
  }));
  f.reply = { reply: "已统一", changes: [change()] };
});
it("keeps conversation proposals out of saved marks and preserves earlier turns", async () => {
  const first = await adjustCompetitorResult(scope, {
    projectId: 1,
    analysisId: 1,
    message: "合并耐用",
    target: "translation",
    fieldKeys: [pointKey()],
    history: [],
    proposed: [],
  });
  expect(f.data.marks).toEqual([]);
  expect(f.revision).toBe(4);
  expect(f.create).not.toHaveBeenCalled();
  f.reply = { reply: "我已解释依据", changes: [] };
  const second = await adjustCompetitorResult(scope, {
    projectId: 1,
    analysisId: 1,
    message: "说明依据",
    target: "translation",
    fieldKeys: [pointKey()],
    history: [{ role: "assistant", text: first.reply }],
    proposed: first.changes,
    baseline: first.baseline,
  });
  expect(second.changes).toEqual(first.changes);
  expect(f.data.marks).toEqual([]);
  expect(f.run.mock.calls[0][0].attachments).toHaveLength(1);
});
it("saves current corrections alone and treats an acknowledgement retry as already saved", async () => {
  const input = confirmInput();
  expect(await confirmCompetitorAdjustment(scope, input)).toMatchObject({
    saved: true,
  });
  expect(f.data.marks[0].edits[pointKey()]).toEqual({
    original: "耐用",
    value: "用户确认的耐用材料",
  });
  expect(f.create).not.toHaveBeenCalled();
  await confirmCompetitorAdjustment(scope, input);
  expect(f.revision).toBe(5);
});
it("saves a real improvement draft and correction atomically, with idempotent retries", async () => {
  const input = confirmInput(true);
  const result = await confirmCompetitorAdjustment(scope, input);
  expect(result.improvementId).toBe(operationId);
  expect(f.create).toHaveBeenCalledOnce();
  const context = JSON.parse(f.create.mock.calls[0][3].context);
  expect(context.originalResult[pointKey()]).toBe("耐用");
  expect(context.editedResult[pointKey()]).toBe("用户确认的耐用材料");
  expect(context.feedback).toContain("合并");
  expect(context.input.modules[0].imageHashes).toContain(hash);
  expect(await confirmCompetitorAdjustment(scope, input)).toEqual(result);
  expect(f.create).toHaveBeenCalledOnce();
  expect(f.revision).toBe(5);
});
it("rolls back the entire confirmation if the improvement draft cannot be saved", async () => {
  f.improvementError = true;
  await expect(
    confirmCompetitorAdjustment(scope, confirmInput(true))
  ).rejects.toThrow("工作台保存失败");
  expect(f.revision).toBe(4);
  expect(f.data.marks).toEqual([]);
  expect(f.receipts.size).toBe(0);
});
it("rejects changed sources, concurrent edits, foreign projects and out-of-scope model fields", async () => {
  const old = confirmInput();
  const changed = raw();
  changed.comparisonAnalysis.generatedAt = "new";
  f.record.rawData = JSON.stringify(changed);
  await expect(confirmCompetitorAdjustment(scope, old)).rejects.toThrow(
    "已变化"
  );
  const input = confirmInput();
  f.revision++;
  await expect(confirmCompetitorAdjustment(scope, input)).rejects.toThrow(
    "已变化"
  );
  f.owner = false;
  await expect(
    confirmCompetitorAdjustment(scope, confirmInput())
  ).rejects.toThrow("项目不可编辑");
  f.owner = true;
  f.reply = {
    reply: "超出范围",
    changes: [
      { key: "text:copy:translation", original: "耐用材料", value: "不应修改" },
    ],
  };
  await expect(
    adjustCompetitorResult(scope, {
      projectId: 1,
      analysisId: 1,
      message: "合并",
      target: "translation",
      fieldKeys: [pointKey()],
      history: [],
      proposed: [],
    })
  ).rejects.toThrow("不属于当前模块");
  expect(f.data.marks).toEqual([]);
});
