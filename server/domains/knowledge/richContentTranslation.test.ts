import { it, expect, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  run: vi.fn(),
  execute: vi.fn(async () => [[]]),
}));
vi.mock("../ai_os/services/skillRunner", () => ({
  runEmperorSkill: runtime.run,
  getEmperorSkillRuntimeSnapshot: async () => ({
    version: 1,
    manifestHash: "test-manifest",
  }),
  safeParseSkillJSON: JSON.parse,
}));
vi.mock("../../repositories/dbClient", () => ({
  requireDb: async () => ({ execute: runtime.execute }),
}));
vi.mock("../../storage", () => ({
  resolveStoredObjectUrl: async (key: string) => key,
}));
import {
  prepareRichContent,
  translateRichContent,
} from "./richContentTranslation";
const hash = "a".repeat(64),
  bg = "b".repeat(64);
const region = {
  source: "HIGH QUALITY FABRIC",
  translation: "优质面料",
  x: 0.1,
  y: 0.2,
  width: 0.5,
  height: 0.1,
  confidence: "clear",
};
const initial = {
  status: "complete",
  regions: [region],
  notes: "",
  sellingPoints: ["优质面料"],
  sellingPointCategories: ["质量"],
};
function wrappedValidation(cause: unknown, retryable = true) {
  return new Error("wrapped runtime error", {
    cause: Object.assign(new Error("INVALID_OUTPUT"), { retryable, cause }),
  });
}
it("retries a wrapped validation error on the configured model and includes safe field feedback", async () => {
  runtime.run.mockReset();
  let calls = 0;
  runtime.run.mockImplementation(async (request: any) => {
    calls++;
    try {
      return {
        parsed: request.validate(
          JSON.stringify(
            calls === 1
              ? { ...initial, regions: [{ ...region, x: 0.9 }] }
              : initial
          )
        ),
      };
    } catch (error) {
      throw wrappedValidation(error);
    }
  });
  const result = await translateRichContent({
    ...input,
    layout: undefined,
    assets: input.assets.slice(1),
  });
  expect(runtime.run).toHaveBeenCalledTimes(3);
  expect(result.presentation.images[0].audited).toBe(true);
  expect(
    JSON.parse(runtime.run.mock.calls[1][0].context).validationFeedback
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "custom" })])
  );
  for (const [request] of runtime.run.mock.calls) {
    expect(request.fallbackModels).toEqual([]);
    expect(request.maxModelAttempts).toBe(1);
    expect(request.skillSlug).toBe("knowledge.media.translation.v1");
  }
});
it("does not retry a wrapped non-retryable failure", async () => {
  runtime.run.mockReset();
  runtime.run.mockRejectedValue(wrappedValidation(null, false));
  await expect(
    translateRichContent({
      ...input,
      layout: undefined,
      assets: input.assets.slice(1),
    })
  ).rejects.toThrow("wrapped runtime error");
  expect(runtime.run).toHaveBeenCalledOnce();
});
it("limits repeated wrapped failures to three configured-model calls", async () => {
  runtime.run.mockReset();
  runtime.run.mockRejectedValue(wrappedValidation(null));
  await expect(
    translateRichContent({
      ...input,
      layout: undefined,
      assets: input.assets.slice(1),
    })
  ).rejects.toThrow("wrapped runtime error");
  expect(runtime.run).toHaveBeenCalledTimes(3);
});
it("retries missing native paragraphs inside the validated model call before publishing anything", async () => {
  runtime.run.mockReset();
  let calls = 0;
  runtime.run.mockImplementation(async (request: any) => {
    calls++;
    const c = JSON.parse(request.context);
    const items = c.entries
      .slice(0, calls === 1 ? 1 : undefined)
      .map((e: any) => ({
        id: e.id,
        translation: "全文 " + e.source,
        sellingPoints: [],
        sellingPointCategories: [],
      }));
    try {
      return { parsed: request.validate(JSON.stringify({ items })) };
    } catch (error) {
      throw wrappedValidation(error);
    }
  });
  const result = await translateRichContent({ ...input, assets: [] });
  expect(runtime.run).toHaveBeenCalledTimes(2);
  expect(result.presentation.texts).toHaveLength(2);
});
const layout = {
  version: 2,
  modules: [
    {
      id: "brand",
      section: "brand_story",
      kind: "brand_story",
      background: { hash: bg },
      cards: [
        {
          images: [{ hash }],
          blocks: [
            { id: "body", text: "Full paragraph." },
            { id: "second", text: "Second paragraph." },
          ],
        },
      ],
    },
  ],
};
const input = {
  workspaceId: 1,
  userId: 2,
  assets: [
    { role: "brand_story", storageKey: "bg", sourceUrlHash: bg },
    {
      role: "brand_story",
      storageKey: "image",
      sourceUrlHash: hash,
      contentHash: "c".repeat(64),
    },
  ],
  layout,
};
it("prepares and audits image regions before returning; excludes the brand background and translates every paragraph", async () => {
  const modes: string[] = [],
    resolve = vi.fn(async (k: string) => `local:${k}`);
  const result = await prepareRichContent(input, {
    resolve,
    run: async (context: any, schema: any) => {
      modes.push(context.mode);
      return schema.parse(
        context.mode === "texts"
          ? {
              items: context.entries.map((e: any) => ({
                id: e.id,
                translation: "译文 " + e.source,
                sellingPoints: [],
                sellingPointCategories: [],
              })),
            }
          : context.mode === "image_audit"
            ? {
                ...initial,
                regions: [
                  region,
                  {
                    ...region,
                    source: "220 GSM",
                    translation: "220克重",
                    y: 0.5,
                  },
                ],
              }
            : initial
      );
    },
  });
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(modes).toEqual(["image", "image_audit", "texts"]);
  expect(result.presentation.images).toHaveLength(1);
  expect(result.presentation.images[0]).toMatchObject({
    sourceHash: hash,
    contentHash: "c".repeat(64),
    audited: true,
  });
  expect(result.presentation.images[0].regions).toHaveLength(2);
  expect(result.presentation.texts.map(t => t.source)).toEqual([
    "Full paragraph.",
    "Second paragraph.",
  ]);
});
it("reuses prepared results from the same processor/source and invalidates different image bytes", async () => {
  const values = new Map<string, unknown>(),
    run = vi.fn(async (c: any, s: any) =>
      s.parse(
        c.mode === "texts"
          ? {
              items: c.entries.map((e: any) => ({
                id: e.id,
                translation: "全文",
                sellingPoints: [],
                sellingPointCategories: [],
              })),
            }
          : initial
      )
    );
  const cache = {
      read: async (k: string, key: string) => values.get(k + key),
      write: async (k: string, key: string, v: unknown) => {
        values.set(k + key, v);
      },
    },
    deps = { cache, run, resolve: async (k: string) => k };
  await prepareRichContent(input, deps);
  const count = run.mock.calls.length;
  await prepareRichContent(input, deps);
  expect(run.mock.calls.length).toBe(count);
  await prepareRichContent(
    {
      ...input,
      assets: input.assets.map(a =>
        a.storageKey === "image" ? { ...a, contentHash: "d".repeat(64) } : a
      ),
    },
    deps
  );
  expect(run.mock.calls.length).toBe(count + 2);
});
it("rejects omitted, duplicate or invented paragraph IDs instead of saving a partial translation", async () => {
  await expect(
    prepareRichContent(
      { ...input, assets: [] },
      {
        run: async (_c: any, s: any) =>
          s.parse({
            items: [
              {
                id: "T1",
                translation: "Only one",
                sellingPoints: [],
                sellingPointCategories: [],
              },
            ],
          }),
      }
    )
  ).rejects.toThrow("模块文字翻译不完整");
});
it("rejects out-of-bounds regions and unsupported claims/categories", async () => {
  await expect(
    prepareRichContent(
      { ...input, layout: undefined },
      {
        resolve: async (k: string) => k,
        run: async (_c: any, s: any) =>
          s.parse({ ...initial, regions: [{ ...region, x: 0.9, width: 0.9 }] }),
      }
    )
  ).rejects.toThrow();
});
it("preserves human translations and their history when processing resumes, without putting corrections in the reusable cache", async () => {
  const previous = {
    version: 1,
    generatedAt: "now",
    images: [
      {
        version: 1,
        sourceHash: hash,
        contentHash: "c".repeat(64),
        status: "complete",
        audited: true,
        manualEdited: true,
        regions: [{ ...region, translation: "用户确认的面料译文" }],
        originalRegions: [region],
        notes: "",
      },
    ],
    texts: [
      {
        id: "body",
        source: "Full paragraph.",
        translation: "用户确认的全文",
        originalTranslation: "首次译文",
        sellingPoints: [],
        sellingPointCategories: [],
      },
      {
        id: "second",
        source: "Second paragraph.",
        translation: "第二段全文",
        sellingPoints: [],
        sellingPointCategories: [],
      },
    ],
  };
  const write = vi.fn(),
    run = vi.fn(async (c: any, s: any) => {
      expect(c.mode).toBe("image_points");
      return s.parse({
        sellingPoints: ["优质面料"],
        sellingPointCategories: ["质量"],
      });
    });
  const result = await prepareRichContent(
    { ...input, previous },
    {
      run,
      resolve: async (k: string) => k,
      cache: { read: async () => null, write },
    }
  );
  expect(run).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();
  expect(result.presentation.images[0].regions[0].translation).toBe(
    "用户确认的面料译文"
  );
  expect(result.presentation.texts[0]).toMatchObject({
    translation: "用户确认的全文",
    originalTranslation: "首次译文",
  });
});
