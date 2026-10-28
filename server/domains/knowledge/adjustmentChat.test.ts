import { beforeEach, describe, it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  insert: vi.fn(),
  asset: vi.fn(),
  fingerprint: vi.fn(),
  register: vi.fn(),
  run: vi.fn(),
}));
vi.mock("../../repositories/dbClient", () => ({
  requireDb: async () => ({
    execute: mocks.execute,
    transaction: mocks.transaction,
  }),
}));
vi.mock("./assetTargets", async original => ({
  ...(await original<any>()),
  loadAsset: mocks.asset,
  assetFingerprint: mocks.fingerprint,
}));
vi.mock("../../services/aiJobRunner", () => ({
  registerAiJobHandler: mocks.register,
}));
vi.mock("../../services/emperorSkillRunner", () => ({
  runEmperorSkill: mocks.run,
  getEmperorSkillRuntimeSnapshot: async () => ({
    version: "1",
    manifestHash: "hash",
  }),
}));
vi.mock("../ai_os/services/assistantConfigurations", () => ({
  assistantConfigurationService: {
    get: async () => ({
      status: "configured",
      record: {
        config: {
          enabled: true,
          modelSlug: "vision",
          skills: [
            {
              slug: "knowledge.images.tag",
              enabled: true,
              version: 1,
              manifestSha256: "hash",
            },
          ],
        },
      },
    }),
    options: async () => ({
      skills: [{ slug: "knowledge.images.tag", manifestSha256: "hash" }],
    }),
  },
}));
vi.mock("./taggingUnitPreview", () => ({
  taggingUnitPreview: async () => Buffer.from("image"),
}));
vi.mock("./tagImprovements", () => ({ taggingImprovements: async () => "" }));
import {
  startAdjustment,
  sendAdjustment,
  confirmAdjustment,
  discardAdjustment,
  retagImage,
} from "./adjustmentChat";
const handler = mocks.register.mock.calls.find(
  ([v]) => v.id === "knowledge.labels.adjust"
)![0].handler;
const dialect = new MySqlDialect(),
  scope = { workspaceId: 2, userId: 7, role: "operator" };
const original = {
  tagCategory: "",
  tagImageTypeMain: "细节",
  tagImageTypeSub: "单一特写",
  tagSellingPointCategory: "",
  tagSellingPointDetail: "",
  tagComposition: "一分构图",
  tagColorSchemeV2: "",
  tagDesignStyleV2: "",
  tagAccentColor: "",
  tagImageBelong: "",
  tagImageBelongSub: "",
};
let draft: any,
  statements: Array<{ sql: string; params: unknown[] }>,
  asset: any;
beforeEach(() => {
  vi.clearAllMocks();
  statements = [];
  draft = null;
  asset = {
    id: 10,
    kind: "image",
    set: null,
    video: null,
    result: original,
    unit: {
      primary: { id: 10, imagePosition: "secondary" },
      images: [{ id: 10 }],
      complete: true,
    },
    title: "测试图",
    visibility: "team",
    ownerId: 7,
  };
  mocks.asset.mockResolvedValue(asset);
  mocks.fingerprint.mockReturnValue("original-fingerprint");
  mocks.insert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });
  mocks.transaction.mockImplementation(async fn =>
    fn({ execute: mocks.execute, insert: mocks.insert })
  );
  mocks.execute.mockImplementation(async query => {
    const q = dialect.sqlToQuery(query);
    statements.push(q);
    if (q.sql.startsWith("INSERT INTO knowledge_adjustments"))
      draft = {
        id: q.params[0],
        workspaceId: 2,
        userId: 7,
        kind: "image",
        targetId: 10,
        revision: 0,
        state: "open",
        payload: JSON.parse(q.params[5] as string),
      };
    if (q.sql.startsWith("SELECT * FROM knowledge_adjustments"))
      return [[structuredClone(draft)]];
    if (q.sql.includes("SET payload=")) {
      draft.payload = JSON.parse(q.params[0] as string);
      draft.revision = q.params[1];
      draft.state = "running";
    }
    if (q.sql.includes("SET state=?,payload=")) {
      draft.state = q.params[0];
      draft.payload = JSON.parse(q.params[1] as string);
      draft.revision++;
    }
    if (q.sql.includes("SET state='saved'")) {
      draft.state = "saved";
      draft.revision++;
    }
    if (q.sql.includes("SET state='discarded'")) {
      draft.state = "discarded";
      draft.revision++;
      draft.payload = {};
    }
    return [{ affectedRows: 1 }];
  });
  mocks.run.mockResolvedValue({
    content: JSON.stringify({
      reply: "已改成二分构图，请核对。",
      result: { ...original, tagComposition: "二分构图" },
      improvement: "以独立信息区域判断构图，不能只数产品数量。",
    }),
  });
});
describe("confirmed multi-turn knowledge adjustment", () => {
  it("keeps collection labels unchanged when re-tagging only one image",async()=>{
    asset.set={id:9};asset.result={...original,tagCategory:"宠物",tagDesignStyleV2:"北欧原木风",tagColorSchemeV2:"白色",tagAccentColor:"橙色"};
    const draft=await retagImage(scope,10);
    await handler({workspaceId:2,userId:7,input:{id:draft.id,revision:1,actorRole:"operator"}},{signal:new AbortController().signal});
    const update=statements.find(q=>q.sql.startsWith("UPDATE kb_image_sets"));
    expect(update).toBeUndefined();
  });
  it("keeps conversation context and never writes image labels before confirmation", async () => {
    const first = await startAdjustment(scope, "image", 10);
    await sendAdjustment(scope, first.id, 0, "这张图是二分构图");
    await handler(
      {
        workspaceId: 2,
        userId: 7,
        input: { id: first.id, revision: 1, actorRole: "operator" },
      },
      { signal: new AbortController().signal }
    );
    expect(statements.some(q => q.sql.startsWith("UPDATE kb_images"))).toBe(
      false
    );
    await sendAdjustment(scope, first.id, 2, "帮我解释一下原因");
    await handler(
      {
        workspaceId: 2,
        userId: 7,
        input: { id: first.id, revision: 3, actorRole: "operator" },
      },
      { signal: new AbortController().signal }
    );
    expect(
      JSON.parse(mocks.run.mock.calls[1][0].context).conversation.map(
        (m: any) => m.text
      )
    ).toEqual([
      "这张图是二分构图",
      "已改成二分构图，请核对。",
      "帮我解释一下原因",
    ]);
    await confirmAdjustment(scope, first.id, 4, false);
    expect(
      statements.filter(q => q.sql.startsWith("UPDATE kb_images"))
    ).toHaveLength(1);
    expect(
      statements.some(q =>
        q.sql.startsWith("INSERT INTO knowledge_tag_improvements")
      )
    ).toBe(false);
  });
  it("requires explicit improvement confirmation, stores exact differences and is idempotent", async () => {
    const first = await startAdjustment(scope, "image", 10);
    await sendAdjustment(scope, first.id, 0, "两块区域应为二分");
    await handler(
      {
        workspaceId: 2,
        userId: 7,
        input: { id: first.id, revision: 1, actorRole: "operator" },
      },
      { signal: new AbortController().signal }
    );
    await confirmAdjustment(scope, first.id, 2, true);
    await confirmAdjustment(scope, first.id, 2, true);
    const writes = statements.filter(q =>
      q.sql.startsWith("INSERT INTO knowledge_tag_improvements")
    );
    expect(writes).toHaveLength(1);
    expect(writes[0].params).toContain("team");
    expect(
      JSON.parse(writes[0].params.at(-1) as string).changes[0]
    ).toMatchObject({ label: "构图", before: "一分构图", after: "二分构图" });
  });
  it("does not allow stale conversations to overwrite newer manual labels", async () => {
    const first = await startAdjustment(scope, "image", 10);
    await sendAdjustment(scope, first.id, 0, "修改构图");
    await handler(
      {
        workspaceId: 2,
        userId: 7,
        input: { id: first.id, revision: 1, actorRole: "operator" },
      },
      { signal: new AbortController().signal }
    );
    mocks.fingerprint.mockReturnValue("edited-by-other-user");
    await expect(
      confirmAdjustment(scope, first.id, 2, false)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(statements.some(q => q.sql.startsWith("UPDATE kb_images"))).toBe(
      false
    );
  });
  it("a discarded pending response cannot save or re-open its session", async () => {
    const first = await startAdjustment(scope, "image", 10);
    await sendAdjustment(scope, first.id, 0, "修改构图");
    await discardAdjustment(scope, first.id);
    await handler(
      {
        workspaceId: 2,
        userId: 7,
        input: { id: first.id, revision: 1, actorRole: "operator" },
      },
      { signal: new AbortController().signal }
    );
    expect(mocks.run).not.toHaveBeenCalled();
    expect(statements.some(q => q.sql.startsWith("UPDATE kb_images"))).toBe(
      false
    );
  });
});
