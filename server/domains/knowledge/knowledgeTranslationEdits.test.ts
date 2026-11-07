import { expect, it } from "vitest";
import {
  validateContentTranslationEdits,
  validateImageTranslationEdits,
  applyContentTranslationEdits,
} from "../../../shared/knowledgeTranslationEdits";
const hash = "a".repeat(64),
  translation = {
    version: 1 as const,
    sourceHash: hash,
    status: "complete" as const,
    regions: [
      {
        source: "Cotton",
        translation: "棉",
        x: 0.1,
        y: 0.1,
        width: 0.4,
        height: 0.2,
        confidence: "clear" as const,
      },
    ],
    notes: "",
  },
  original = [{ imageId: 1, translation }];
it("keeps original OCR regions for improvement drafts when a user edits Chinese or its position", () => {
  const edited = validateImageTranslationEdits(
    [
      {
        imageId: 1,
        translation: {
          ...translation,
          regions: [
            { ...translation.regions[0], translation: "纯棉", x: 0.12 },
          ],
        },
      },
    ],
    original
  );
  expect(edited[0].translation).toMatchObject({
    manualEdited: true,
    originalRegions: translation.regions,
  });
});
it("rejects a changed image identity and invalid overlay boxes", () => {
  expect(() =>
    validateImageTranslationEdits(
      [
        {
          imageId: 1,
          translation: { ...translation, sourceHash: "b".repeat(64) },
        },
      ],
      original
    )
  ).toThrow("其他图片");
  expect(() =>
    validateImageTranslationEdits(
      [
        {
          imageId: 1,
          translation: {
            ...translation,
            regions: [{ ...translation.regions[0], x: 0.9 }],
          },
        },
      ],
      original
    )
  ).toThrow();
});
it("requires complete source-bound native translations and preserves their original value", () => {
  const texts = [
    { id: "one", source: "First.", translation: "第一段" },
    { id: "two", source: "Last.", translation: "最后一段" },
  ];
  expect(() =>
    validateContentTranslationEdits(texts.slice(0, 1), texts)
  ).toThrow("逐段对应");
  expect(() =>
    validateContentTranslationEdits(
      [{ ...texts[0], source: "Other." }, texts[1]],
      texts
    )
  ).toThrow("逐段对应");
  const value = applyContentTranslationEdits(
    {
      version: 1,
      generatedAt: "now",
      images: [],
      texts: texts.map(t => ({ ...t, sellingPoints: [] })),
    },
    [{ ...texts[0], translation: "修正后的第一段" }, texts[1]]
  );
  expect(value?.texts[0]).toMatchObject({
    originalTranslation: "第一段",
    translation: "修正后的第一段",
  });
});
