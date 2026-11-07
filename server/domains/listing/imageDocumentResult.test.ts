import { describe, it, expect } from "vitest";
import { blankImageOutline } from "../../../shared/imagePlanning";
import {
  emptyImageDocument,
  recordManualDocument,
  documentEditableFields,
  applyDocumentPatches,
  imageDocumentSchema,
} from "../../../shared/imageDocument";
import {
  parseGeneratedDocument,
  parseAdjustedDocument,
} from "./imageDocumentResult";
import { synchronizeDocument } from "./imageDocumentStore";
import {
  applyCopyRepairs,
  copyRepairRequest,
  findCopyRepairs,
  imageCopyLimitIssue,
} from "./imageDocumentCopyRepair";
const tags = { categories: ["农业品"], styles: ["田园自然风"] };
const fixture = () => {
  const outline = blankImageOutline();
  outline.groups = outline.groups.slice(0, 1);
  outline.groups[0].items = outline.groups[0].items.slice(0, 2);
  outline.groups[0].items[0].content = "本品六口袋，正面白底";
  return { outline, data: emptyImageDocument(outline) };
};
const output = (data: ReturnType<typeof fixture>["data"]) => ({
  reply: "已展开画面",
  category: "农业品",
  styles: ["田园自然风"],
  palette: data.palette,
  entries: data.entries.map(entry => ({
    imageId: entry.imageId,
    layout: "左右二分",
    framing: "居中构图",
    layoutNote: "左产品右细节",
    scenes: entry.scenes.map(({ id, ...s }) => ({
      ...s,
      background: "白色背景",
      product: "本品六口袋",
    })),
    copy: {
      ...entry.copy,
      headline: "Designed for Beekeeping",
      headlinePosition: "左上",
      icons: [],
    },
    prompts: {
      scene: "先生成背景并留白",
      product: "嵌入本品图保持六口袋",
      composition: "左右区域合成统一光影",
      textIcons: "最后加入标题与图标",
    },
  })),
});
describe("套图文档的本品事实、人工保护和分步结果", () => {
  it("每个大纲图位单独扩展，保留身份、尺寸和原画面内容", () => {
    const { data } = fixture(),
      result = parseGeneratedDocument(
        output(data),
        data,
        data.entries.map(e => e.imageId),
        tags
      );
    expect(
      result.data.entries.map(e => [e.imageId, e.content, e.width, e.height])
    ).toEqual(data.entries.map(e => [e.imageId, e.content, e.width, e.height]));
    expect(result.data.entries[0].prompts.product).toBe("");
    expect(result.data.organized).toBe(true);
    expect(data.organized).toBe(false);
  });
  it("拒绝遗漏、重复和未知图位，避免批次串图", () => {
    const { data } = fixture(),
      raw = output(data),
      ids = data.entries.map(e => e.imageId);
    expect(() =>
      parseGeneratedDocument(
        { ...raw, entries: raw.entries.slice(0, 1) },
        data,
        ids,
        tags
      )
    ).toThrow("完整处理");
    raw.entries[1].imageId = raw.entries[0].imageId;
    expect(() => parseGeneratedDocument(raw, data, ids, tags)).toThrow(
      "完整处理"
    );
  });
  it("AI不能私自注入参考图片或覆盖大纲身份", () => {
    const { data } = fixture(),
      raw = output(data);
    expect(() =>
      parseGeneratedDocument(
        {
          ...raw,
          entries: [
            { ...raw.entries[0], references: { composition: [] } },
            raw.entries[1],
          ],
        },
        data,
        data.entries.map(e => e.imageId),
        tags
      )
    ).toThrow();
  });
  it("图片内容生成保留已有提示词，单独确认后再生成新版提示词", () => {
    const { data } = fixture();
    data.entries[0].prompts.product = "运营已有提示词";
    const result = parseGeneratedDocument(
      output(data),
      data,
      data.entries.map(e => e.imageId),
      tags
    );
    expect(result.data.entries[0].prompts.product).toBe("运营已有提示词");
    expect(result.data.entries[0].promptSourceHash).toBeUndefined();
  });
  it("人工改动的背景、标题和色卡在重新生成时保留", () => {
    const { data } = fixture(),
      edited = structuredClone(data);
    edited.entries[0].scenes[0].background = "运营指定真实蜂场";
    edited.entries[0].copy.headline = "Six Pockets";
    edited.palette[0].color = "#001122";
    const marked = recordManualDocument(data, edited),
      raw = output(data),
      result = parseGeneratedDocument(
        raw,
        marked,
        data.entries.map(e => e.imageId),
        tags
      );
    expect(result.data.entries[0].scenes[0].background).toBe(
      "运营指定真实蜂场"
    );
    expect(result.data.entries[0].scenes[0].product).toBe(raw.entries[0].scenes[0].product);
    expect(result.data.entries[0].copy.headline).toBe("Six Pockets");
    expect(result.data.palette[0].color).toBe("#001122");
    expect(result.protectedCount).toBe(3);
  });
  it("参考用途分别保存，重复选择同一单图会被拒绝", () => {
    const { data } = fixture(),
      entry = data.entries[0],
      ref = {
        reference: { source: "knowledge" as const, imageId: 5, label: "参考" },
        purpose: "只参考光影",
      };
    entry.references.effect = [ref];
    entry.references.other = [{ ...ref, purpose: "参考色调" }];
    expect(
      imageDocumentSchema.parse(data).entries[0].references.effect[0].purpose
    ).toBe("只参考光影");
    entry.references.effect.push(ref);
    expect(() => imageDocumentSchema.parse(data)).toThrow("不能重复");
  });
  it("类目与风格只能来自知识库，配色需四个不同角色", () => {
    const { data } = fixture(),
      raw = output(data);
    expect(() =>
      parseGeneratedDocument(
        { ...raw, category: "虚构类目" },
        data,
        data.entries.map(e => e.imageId),
        tags
      )
    ).toThrow("知识库标签");
    expect(() =>
      imageDocumentSchema.parse({
        ...data,
        palette: [...data.palette.slice(0, 3), data.palette[0]],
      })
    ).toThrow("角色重复");
  });
  it("只生成所选步骤提示词，不动其他画面或步骤", () => {
    const { data } = fixture(),
      key = `image:${data.entries[0].imageId}:prompts.scene`,
      allowed = { [key]: documentEditableFields(data)[key] },
      result = parseAdjustedDocument(
        {
          reply: "已生成场景",
          changes: [{ key, original: "", value: "先生成空背景" }],
        },
        data,
        allowed
      );
    expect(result.data.entries[0].prompts.scene).toBe("先生成空背景");
    expect(result.data.entries[0].prompts.product).toBe("");
    expect(() =>
      parseAdjustedDocument(
        {
          reply: "其他",
          changes: [
            {
              key: key.replace(".scene", ".product"),
              original: "",
              value: "不允许",
            },
          ],
        },
        data,
        allowed
      )
    ).toThrow("本次选择");
  });
  it("旧原值和重复字段不会误覆盖更新后的内容", () => {
    const { data } = fixture(),
      key = `image:${data.entries[0].imageId}:content`;
    expect(() =>
      applyDocumentPatches(data, [
        { key, original: "旧内容", value: "错误更新" },
      ])
    ).toThrow("内容已变化");
  });
  it("纯文字模块不伪造场景与产品图", () => {
    const { data } = fixture();
    data.entries = data.entries.slice(0, 1);
    data.entries[0].width = 0;
    data.entries[0].height = 0;
    data.entries[0].scenes = [];
    const raw = output(data);
    expect(() =>
      parseGeneratedDocument(raw, data, [data.entries[0].imageId], tags)
    ).toThrow("纯文字模块");
    raw.entries[0].prompts.scene = "";
    raw.entries[0].prompts.product = "";
    expect(
      parseGeneratedDocument(raw, data, [data.entries[0].imageId], tags).data
        .entries[0].scenes
    ).toEqual([]);
  });
  it("同步上游新增图位，保留人工文档和被移除的历史图位", () => {
    const { data, outline } = fixture(),
      edited = structuredClone(data);
    edited.entries[0].content = "运营改为六口袋特写";
    edited.entries[1].content = "旧图的场景和构图信息";
    const marked = recordManualDocument(data, edited),
      removed = outline.groups[0].items.pop()!;
    outline.groups[0].items[0].content = "上游改变画面";
    outline.groups[0].items.push({
      ...removed,
      id: crypto.randomUUID(),
      content: "新增尺码图",
    });
    const next = synchronizeDocument(marked, outline);
    expect(next.entries).toHaveLength(3);
    expect(next.entries[0].content).toBe("运营改为六口袋特写");
    expect(next.entries.find(e => e.imageId === removed.id)).toBeTruthy();
    expect(next.entries.at(-1)?.content).toBe("新增尺码图");
  });
  it("继承大纲选中的参考图，并稳定生成新文档默认场景", () => {
    const { outline } = fixture();
    outline.groups[0].items[0].references = [{ setId: 7, imageId: 3 }];
    const first = emptyImageDocument(outline),
      second = emptyImageDocument(outline);
    expect(first).toEqual(second);
    expect(first.entries[0].references.composition[0].reference).toMatchObject({
      source: "reference",
      setId: 7,
      imageId: 3,
    });
  });
});

it("允许图位需要的长正文，仍检查文案和图标位置", () => {
  const { data } = fixture(),
    ids = data.entries.map(e => e.imageId);
  let raw = output(data);
  raw.entries[0].copy.body = "word ".repeat(50);
  raw.entries[0].copy.bodyPosition = "右侧说明区";
  expect(parseGeneratedDocument(raw, data, ids, tags).data.entries[0].copy.body)
    .toBe(raw.entries[0].copy.body);
  raw = output(data);
  raw.entries[0].copy.headlinePosition = "";
  expect(() => parseGeneratedDocument(raw, data, ids, tags)).toThrow("位置");
  raw = output(data);
  (raw.entries[0].copy.icons as any) = [
    { label: "Airflow", visual: "气流箭头", position: "" },
  ];
  expect(() => parseGeneratedDocument(raw, data, ids, tags)).toThrow(
    "摆放位置"
  );
});

it("中英对照仍需提供，默认接受长文案", () => {
  const { data } = fixture();
  const raw = output(data);
  const ids = data.entries.map(entry => entry.imageId);
  const marketing = new Map(ids.map(id => [id, { whiteMain: false }]));
  expect(() => parseGeneratedDocument(raw, data, ids, tags, marketing)).toThrow("中文小字译文");
  const bilingual = { ...raw, entries: raw.entries.map(entry => ({
    ...entry, copy: { ...entry.copy, headlineZh: "专为养蜂设计" },
  })) };
  expect(parseGeneratedDocument(bilingual, data, ids, tags, marketing).data.entries[0].copy.headlineZh).toBe("专为养蜂设计");
  bilingual.entries[0].copy.headline = "One two three four five six seven";
  expect(parseGeneratedDocument(bilingual, data, ids, tags, marketing).data.entries[0].copy.headline)
    .toBe(bilingual.entries[0].copy.headline);
  const main = new Map(ids.map(id => [id, { whiteMain: true }]));
  expect(() => parseGeneratedDocument(bilingual, data, ids, tags, main)).toThrow("白底主图");
});

it("只修复用户限制的超长原文及对应译文，跳过豁免图位和人工字段", () => {
  const { data } = fixture();
  const [first, second] = data.entries;
  first.copy.language = "英语";
  first.copy.headline = "A manual title may exceed the limit";
  first.manualFields = ["copy.headline"];
  first.copy.body = "Keep this line\nThis sentence has too many words";
  first.copy.bodyZh = "保留此行\n这一句写得太长了";
  second.copy.body = first.copy.body;
  const ids = data.entries.map(entry => entry.imageId);
  const repairs = findCopyRepairs(data, ids, {
    headline: 3,
    bodyLine: 3,
    excludedImageIds: [second.imageId],
  });
  expect(repairs).toMatchObject([{ imageId: first.imageId, field: "bodyLine", index: 1, actual: 6 }]);
  const request = copyRepairRequest(data, repairs);
  const output = { changes: [{ key: repairs[0].key, text: "Shorter line", translation: "简短一句" }] };
  expect(applyCopyRepairs(output, data, request)).toEqual({
    ...data,
    entries: [{ ...first, copy: {
      ...first.copy,
      body: "Keep this line\nShorter line",
      bodyZh: "保留此行\n简短一句",
    } }, second],
  });
  expect(() => applyCopyRepairs({
    changes: [...output.changes, { key: "unrequested", text: "extra" }],
  }, data, request)).toThrow("返修");
  try {
    applyCopyRepairs({ changes: [{ ...output.changes[0], text: "Still far too long" }] }, data, request);
    throw new Error("expected copy length violation");
  } catch (error) {
    expect(imageCopyLimitIssue(`[unknown] ${(error as Error).message}`)).toEqual({
      imageId: first.imageId, field: "bodyLine", index: 1, limit: 3,
    });
  }
});
