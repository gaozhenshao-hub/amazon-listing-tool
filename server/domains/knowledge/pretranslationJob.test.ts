import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const f = vi.hoisted(() => ({
  handler: null as any,
  image: {} as any,
  updates: [] as any[],
  translate: vi.fn(),
}));
vi.mock("../../services/aiJobRunner", () => ({
  registerAiJobHandler: (s: any) => {
    f.handler = s.handler;
  },
  getAiJobRun: vi.fn(),
  startRegisteredAiJob: vi.fn(),
  updateAiJobProgress: vi.fn(),
}));
vi.mock("./richContentTranslation", () => ({
  MEDIA_TRANSLATION_SKILL: "knowledge.media.translation.v1",
  translateRichContent: f.translate,
}));
vi.mock("../../repositories/dbClient", () => {
  const db: any = {
    select: () => ({
      from: () => ({
        where: () => {
          const result = () => [structuredClone(f.image)];
          const query = {
            limit: () => query,
            for: async () => result(),
            then: (resolve: any) => Promise.resolve(result()).then(resolve),
          };
          return query;
        },
      }),
    }),
    update: () => ({
      set: (patch: any) => ({
        where: async () => {
          f.updates.push(patch);
        },
      }),
    }),
    execute: vi.fn(async () => [[]]),
    transaction: async (fn: any) => fn(db),
  };
  return { requireDb: async () => db };
});
import "./pretranslationJob";
const hash = "a".repeat(64),
  bytes = "b".repeat(64),
  region = {
    source: "Cotton",
    translation: "棉",
    x: 0.1,
    y: 0.1,
    width: 0.3,
    height: 0.2,
    confidence: "clear",
  },
  translated = {
    version: 1,
    sourceHash: hash,
    contentHash: bytes,
    audited: true,
    status: "complete",
    regions: [region],
    notes: "",
  };
beforeEach(() => {
  vi.clearAllMocks();
  f.updates = [];
  f.image = {
    id: 1,
    imageUrl: "local://image.jpg",
    sourceUrlHash: hash,
    uploadHash: bytes,
    imagePosition: "main",
    imageTranslation: null,
  };
});
const job = () => ({
  runId: "run",
  workspaceId: 3,
  userId: 7,
  input: {
    kind: "image",
    id: 1,
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify({
          layout: null,
          images: [[1, "local://image.jpg", hash, bytes]],
        })
      )
      .digest("hex"),
  },
});
const context = () => ({ signal: new AbortController().signal });
it("publishes completed results even if enqueue writes its pending marker after processing begins", async () => {
  f.translate.mockImplementation(async () => {
    f.image.imageTranslation = {
      version: 1,
      sourceHash: hash,
      status: "pending",
      regions: [],
      notes: "",
    };
    return {
      presentation: {
        version: 1,
        generatedAt: "now",
        texts: [],
        images: [structuredClone(translated)],
      },
    };
  });
  await f.handler(job(), context());
  expect(f.updates).toEqual([{ imageTranslation: translated }]);
});
it("does not replace a human correction made while translation is running", async () => {
  f.translate.mockImplementation(async () => {
    f.image.imageTranslation = {
      ...translated,
      manualEdited: true,
      regions: [{ ...region, translation: "用户修正后的棉质说明" }],
    };
    return {
      presentation: {
        version: 1,
        generatedAt: "now",
        texts: [],
        images: [structuredClone(translated)],
      },
    };
  });
  await f.handler(job(), context());
  expect(f.updates).toHaveLength(0);
});
it("refuses to apply old results after the image source changes", async () => {
  f.translate.mockImplementation(async () => {
    f.image.imageUrl = "local://replacement.jpg";
    return {
      presentation: {
        version: 1,
        generatedAt: "now",
        texts: [],
        images: [structuredClone(translated)],
      },
    };
  });
  await expect(f.handler(job(), context())).rejects.toThrow("旧翻译未应用");
  expect(f.updates).toHaveLength(0);
});
