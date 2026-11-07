import SHA256 from "crypto-js/sha256.js";
import {
  AmazonImageLayoutSchema,
  type AmazonImageModule,
  type AmazonTextBlock,
} from "./amazonImageLayout";
import { amazonModuleCopy, isAmazonPageNavigation } from "./amazonContentText";
import {
  RichModuleFindingSchema,
  type RichContentPresentation,
} from "./richContentPresentation";

type ImageSource = {
  sourceHash?: string;
  sourceUrlHash?: string | null;
  contentHash?: string | null;
};
export type RichModuleTarget = {
  id: string;
  moduleId: string;
  cardIndex?: number;
  sourceHash: string;
  imageHashes: string[];
  videoHashes?: string[];
  blocks: Array<{ id: string; text: string }>;
  copy: string[];
};
export type ModulePoints = {
  sellingPoints: string[];
  sellingPointCategories: string[];
};
const readable = (blocks: AmazonTextBlock[] = []) =>
  blocks.filter(b => b.text.trim() && !isAmazonPageNavigation(b.text));

/** One unit is an entire module, or the current carousel/Brand Story card (including all four images). */
export function richModuleTargets(
  layout: unknown,
  images: ImageSource[] = []
): RichModuleTarget[] {
  const parsed = AmazonImageLayoutSchema.safeParse(layout);
  if (!parsed.success) return [];
  const bytes = new Map(
    images.map(i => [i.sourceHash || i.sourceUrlHash, i.contentHash || null])
  );
  return parsed.data.modules.flatMap(module => {
    const perCard = ["carousel", "brand_story"].includes(module.kind);
    return (perCard ? module.cards.map((_, i) => i) : [undefined]).flatMap(
      cardIndex => {
        const cards =
          cardIndex === undefined ? module.cards : [module.cards[cardIndex]];
        const blocks = readable([
          ...(module.section === "brand_story" ? [] : module.blocks || []),
          ...cards.flatMap(c => c.blocks || []),
          ...(module.questions || []).flatMap(q => [q.question, q.answer]),
          ...(module.hotspots || []).flatMap(h => h.blocks),
        ]);
        const native = new Map(
          blocks.map(b => [b.id, { id: b.id, text: b.text }])
        );
        for (const row of module.rows) {
          if (row.labelId && row.label.trim())
            native.set(row.labelId, { id: row.labelId, text: row.label });
          row.cells.forEach((text, i) => {
            const id = row.cellIds?.[i];
            if (id && text.trim()) native.set(id, { id, text });
          });
        }
        const copy = [
          ...(!module.blocks?.length && module.section !== "brand_story"
            ? [module.title]
            : []),
          ...cards.flatMap(c => (c.blocks?.length ? [] : [c.title, c.text])),
          ...module.rows.flatMap(r => [r.label, ...r.cells]),
        ]
          .map(amazonModuleCopy)
          .filter(Boolean);
        const videoHashes = [
          ...new Set([
            ...(module.videoHashes || []),
            ...cards.flatMap(c => c.videoHashes || []),
          ]),
        ];
        const imageHashes = [
          ...new Set(
            cards
              .flatMap(c => c.images.map(i => i.hash))
              .filter(h => h !== module.background?.hash)
          ),
        ];
        if (!imageHashes.length && !native.size && !copy.length &&
          !videoHashes.length) return [];
        const id =
          "M" +
          SHA256(
            JSON.stringify([
              module.section,
              module.id,
              cardIndex === undefined
                ? null
                : module.cards[cardIndex].id || cardIndex,
            ])
          )
            .toString()
            .slice(0, 24);
        const sourceHash = SHA256(
          JSON.stringify({
            moduleId: module.id,
            section: module.section,
            kind: module.kind,
            videos: [
              ...(module.videoHashes || []),
              ...cards.flatMap(c => c.videoHashes || []),
            ],
            images: imageHashes.map(hash => [hash, bytes.get(hash) || null]),
            blocks: [...native.values()],
            copy,
          })
        ).toString();
        return [
          {
            id,
            moduleId: module.id,
            ...(cardIndex === undefined ? {} : { cardIndex }),
            sourceHash,
            imageHashes,
            videoHashes,
            blocks: [...native.values()],
            copy,
          },
        ];
      }
    );
  });
}

export function richModuleTarget(
  module: AmazonImageModule,
  images: ImageSource[] = [],
  cardIndex?: number
) {
  return richModuleTargets({ version: 2, modules: [module] }, images).find(
    t => t.cardIndex === cardIndex
  );
}

export function moduleVideoEvidenceHash(
  target: RichModuleTarget,
  videos: any[] = []
) {
  const values = (target.videoHashes || []).flatMap(hash => {
    const v = videos.find(v => v.hash === hash);
    return v
      ? [
          {
            hash: v.hash,
            sourceHash: v.sourceHash,
            points: v.sellingPoints,
            cues: v.cues,
          },
        ]
      : [];
  });
  return values.length ? SHA256(JSON.stringify(values)).toString() : undefined;
}

/** Legacy results immediately share one group; prepared unified AI results supersede this compatibility merge. */
export function moduleSellingPoints(
  target: RichModuleTarget,
  study: any,
  edits: Record<string, { original: string; value: string }> = {}
): ModulePoints {
  const moduleKey = "module:" + target.id + ":sellingPoints",
    moduleEdit = edits[moduleKey];
  if (moduleEdit) {
    const original = moduleSellingPoints(target, study).sellingPoints.join(
      "、"
    );
    if (moduleEdit.original === original)
      return {
        sellingPoints: moduleEdit.value
          .split(/[、，,\n]+/)
          .map(v => v.trim())
          .filter(Boolean),
        sellingPointCategories: [],
      };
    edits = { ...edits };
    delete edits[moduleKey];
  }
  const videoHash = moduleVideoEvidenceHash(target, study?.videoAnalyses);
  const saved = study?.richContent?.modulePoints?.find((m: unknown) => {
    const p = RichModuleFindingSchema.safeParse(m);
    return (
      p.success &&
      p.data.id === target.id &&
      p.data.sourceHash === target.sourceHash &&
      p.data.videoEvidenceHash === videoHash
    );
  });
  const output: ModulePoints = {
    sellingPoints: [],
    sellingPointCategories: [],
  };
  const seen = new Set<string>();
  const add = (
    key: string,
    points: string[] = [],
    categories: string[] = []
  ) => {
    const original = points.join("、"),
      edit = edits[key];
    const values =
      edit?.original === original
        ? edit.value
            .split(/[、，,\n]+/)
            .map(v => v.trim())
            .filter(Boolean)
        : points;
    for (const [i, value] of values.entries()) {
      const normalized = value
        .normalize("NFKC")
        .replace(/[\s、，,。.!！:：;；]/gu, "")
        .toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.sellingPoints.push(value);
      output.sellingPointCategories.push(
        edit?.original === original ? "其他" : categories[i] || "其他"
      );
    }
  };
  const hasLegacyEdits =
    (target.videoHashes || []).some(hash => {
      const video = study?.videoAnalyses?.find((v: any) => v.hash === hash);
      const edit = edits[`video:${hash}:sellingPoints`];
      return (
        video &&
        edit &&
        edit.original ===
          video.sellingPoints?.map((p: any) => p.text).join("、") &&
        edit.value !== edit.original
      );
    }) ||
    target.imageHashes.some(hash => {
      const image = study?.images?.find((i: any) => i.hash === hash);
      const edit = edits[`image:${hash}:sellingPoints`];
      return (
        image &&
        edit &&
        edit.original === image.sellingPoints?.join("、") &&
        edit.value !== edit.original
      );
    }) ||
    target.blocks.some(block => {
      const text = study?.richContent?.texts?.find(
        (t: any) => t.id === block.id && t.source === block.text
      );
      const edit = edits[`text:${block.id}:sellingPoints`];
      return (
        text &&
        edit &&
        edit.original === text.sellingPoints?.join("、") &&
        edit.value !== edit.original
      );
    });
  // Existing human corrections win until the user confirms a unified module result.
  if (
    saved &&
    (!hasLegacyEdits ||
      edits[`module:${target.id}:sellingPoints`]?.original ===
        saved.sellingPoints.join("、"))
  )
    add(
      `module:${target.id}:sellingPoints`,
      saved.sellingPoints,
      saved.sellingPointCategories
    );
  else {
    for (const hash of target.imageHashes) {
      const image = study?.images?.find((i: any) => i.hash === hash);
      if (image)
        add(
          `image:${hash}:sellingPoints`,
          image.sellingPoints,
          image.sellingPointCategories
        );
    }
    for (const block of target.blocks) {
      const text = study?.richContent?.texts?.find(
        (t: any) => t.id === block.id && t.source === block.text
      );
      if (text)
        add(
          `text:${text.id}:sellingPoints`,
          text.sellingPoints,
          text.sellingPointCategories
        );
    }
    const original = output.sellingPoints.join("、"),
      edited = edits[`module:${target.id}:sellingPoints`];
    if (edited?.original === original)
      return {
        sellingPoints: edited.value
          .split(/[、，,\n]+/)
          .map(v => v.trim())
          .filter(Boolean),
        sellingPointCategories: [],
      };
  }
  if (!saved?.videoEvidenceHash)
    for (const hash of target.videoHashes || []) {
      const v = study?.videoAnalyses?.find((v: any) => v.hash === hash);
      if (v)
        add(
          "video:" + hash + ":sellingPoints",
          v.sellingPoints.map((p: any) => p.text)
        );
    }
  return output;
}

export function moduleAdjustmentKeys(
  target: RichModuleTarget,
  study: { richContent?: RichContentPresentation; videoAnalyses?: any[] }
) {
  return [
    ...(target.videoHashes || []).flatMap(hash => {
      const v = study.videoAnalyses?.find(v => v.hash === hash);
      return v
        ? [
            "video:" + hash + ":sellingPoints",
            ...v.cues.map(
              (c: any) => "subtitle:" + hash + ":" + c.id + ":translation"
            ),
          ]
        : [];
    }),
    `module:${target.id}:sellingPoints`,
    ...target.blocks.flatMap(b =>
      study.richContent?.texts.some(t => t.id === b.id && t.source === b.text)
        ? [`text:${b.id}:translation`]
        : []
    ),
    ...target.imageHashes.flatMap(hash =>
      (
        study.richContent?.images.find(i => i.sourceHash === hash)?.regions ||
        []
      ).map((_, i) => `region:${hash}:${i}:translation`)
    ),
  ];
}
