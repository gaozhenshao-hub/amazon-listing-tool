import { z } from "zod";

export const DESIGN_IMAGE_MODEL = "tt-image-2.5-token";
export const DESIGN_BANANA_MODEL = "banana-2.1-token";
export const designOptions = {
  count: [
    ["1", "1 张"],
    ["2", "2 张"],
    ["4", "4 张"],
    ["8", "8 张"],
  ],
  model: [
    [DESIGN_IMAGE_MODEL, "Image 2.5"],
    [DESIGN_BANANA_MODEL, "大香蕉 2.1"],
  ],
  thinking: [
    ["minimal", "快速思考"],
    ["high", "深度思考"],
  ],
  version: [
    ["flare", "标准版"],
    ["sunburst", "增强版"],
  ],
  aspect_ratio: [
    ["1:1", "1:1 正方形"],
    ["4:3", "4:3 横图"],
    ["3:4", "3:4 竖图"],
    ["16:9", "16:9 横屏"],
    ["9:16", "9:16 竖屏"],
    ["3:2", "3:2"],
    ["2:3", "2:3"],
    ["5:4", "5:4"],
    ["4:5", "4:5"],
    ["2:1", "2:1"],
    ["1:2", "1:2"],
    ["21:9", "21:9"],
    ["9:21", "9:21"],
    ["auto", "自动比例"],
    ["1:4", "1:4 超竖图"],
    ["4:1", "4:1 超横图"],
    ["1:8", "1:8 极竖图"],
    ["8:1", "8:1 极横图"],
  ],
  resolution: [
    ["1K", "1K"],
    ["2K", "2K"],
    ["4K", "4K"],
    ["auto", "自动分辨率"],
  ],
  quality: [
    ["auto", "自适应画质"],
    ["low", "低画质"],
    ["medium", "中等画质"],
    ["high", "高画质"],
    ["xhigh", "超高画质"],
    ["max", "最高画质"],
  ],
  background: [
    ["opaque", "不透明背景"],
    ["transparent", "透明背景"],
    ["auto", "自动背景"],
  ],
} as const;
export const designParamsSchema = z
  .object({
    count: z.enum(["1", "2", "4", "8"]).default("1"),
    model: z
      .enum([DESIGN_IMAGE_MODEL, DESIGN_BANANA_MODEL])
      .default(DESIGN_IMAGE_MODEL),
    thinking: z.enum(["minimal", "high"]).default("minimal"),
    version: z.enum(["flare", "sunburst"]),
    aspect_ratio: z.enum([
      "auto",
      "1:4",
      "4:1",
      "1:8",
      "8:1",
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "5:4",
      "4:5",
      "2:1",
      "1:2",
      "21:9",
      "9:21",
    ]),
    resolution: z.enum(["auto", "1K", "2K", "4K"]),
    quality: z.enum(["auto", "low", "medium", "high", "xhigh", "max"]),
    background: z.enum(["opaque", "transparent", "auto"]),
  })
  .refine(
    p =>
      p.model === DESIGN_BANANA_MODEL
        ? !["auto", "2:1", "1:2", "9:21"].includes(p.aspect_ratio) &&
          p.resolution !== "auto"
        : !["1:4", "4:1", "1:8", "8:1"].includes(p.aspect_ratio),
    "当前模型不支持所选比例或自动分辨率"
  )
  .refine(
    p => (p.aspect_ratio === "auto") === (p.resolution === "auto"),
    "自动比例和自动分辨率需要同时选择"
  );
export type DesignParams = z.infer<typeof designParamsSchema>;
export const sameDesignParams = (
  left: Partial<DesignParams>,
  right: Partial<DesignParams>
) =>
  (Object.keys(designOptions) as (keyof DesignParams)[]).every(
    key => left[key] === right[key]
  );
export const defaultDesignParams: DesignParams = {
  count: "1",
  model: DESIGN_IMAGE_MODEL,
  thinking: "minimal",
  version: "flare",
  aspect_ratio: "1:1",
  resolution: "2K",
  quality: "auto",
  background: "opaque",
};
export const designDraftSchema = z.object({
  prompt: z.string().trim().min(1, "请描述需要生成的画面").max(8000),
  params: designParamsSchema,
  references: z
    .array(z.string().uuid())
    .max(16)
    .refine(v => new Set(v).size === v.length, "参考图重复"),
});
const validReferenceCount = (value: {
  params: DesignParams;
  references: string[];
}) => value.references.length <= designReferenceLimit(value.params);
export const designRequestSchema = designDraftSchema
  .extend({ conversationId: z.string().uuid(), requestId: z.string().uuid() })
  .refine(validReferenceCount, "大香蕉最多支持 14 张参考图，请移除多余图片");
export const designStatusLabels: Record<string, string> = {
  queued: "等待生成",
  submitting: "正在提交",
  running: "正在生成",
  succeeded: "已完成",
  failed: "生成失败",
  unknown: "需要核对",
};
export const isDesignPending = (status: string) =>
  ["queued", "submitting", "running"].includes(status);

export const designChatRequestSchema = designDraftSchema
  .extend({
    conversationId: z.string().uuid(),
    requestId: z.string().uuid(),
    referenceMode: z.enum(["append", "replace"]).default("append"),
  })
  .refine(validReferenceCount, "当前模型的参考图数量超出限制");
export const designConfirmSchema = z.object({
  conversationId: z.string().uuid(),
  requestId: z.string().uuid(),
  planId: z.string().uuid(),
  draft: designDraftSchema
    .refine(validReferenceCount, "大香蕉最多支持 14 张参考图，请移除多余图片")
    .optional(),
});
export const designPlanSchema = z.object({
  reply: z.string().trim().min(1).max(6000),
  ready: z.boolean(),
  prompt: z.string().trim().max(8000),
  promptTranslation: z.string().trim().max(8000).default(""),
  referenceIndexes: z.array(z.number().int().min(1).max(16)).max(16),
});
export type DesignChatPlan = {
  ready: boolean;
  prompt: string;
  referenceIds: string[];
  promptTranslation?: string;
};

export type DesignDraft = Pick<
  z.infer<typeof designRequestSchema>,
  "prompt" | "params" | "references"
>;
export function changeDesignOption(
  previous: DesignParams,
  key: keyof DesignParams,
  value: string
): DesignParams {
  const next = {
    ...defaultDesignParams,
    ...previous,
    [key]: value,
  } as DesignParams;
  if (key === "model") {
    if (
      !designParameterOptions(next, "aspect_ratio").some(
        option => option[0] === next.aspect_ratio
      )
    )
      next.aspect_ratio = "1:1";
    if (next.model === DESIGN_BANANA_MODEL && next.resolution === "auto")
      next.resolution = "2K";
    return next;
  }
  if (key === "aspect_ratio" && value === "auto") next.resolution = "auto";
  if (key === "resolution" && value === "auto") next.aspect_ratio = "auto";
  if (key === "aspect_ratio" && value !== "auto" && next.resolution === "auto")
    next.resolution = "2K";
  if (key === "resolution" && value !== "auto" && next.aspect_ratio === "auto")
    next.aspect_ratio = "1:1";
  return next;
}

export const designReferenceLimit = (params: Partial<DesignParams>) =>
  params.model === DESIGN_BANANA_MODEL ? 14 : 16;
export const designModelLabel = (params: Partial<DesignParams>) =>
  params.model === DESIGN_BANANA_MODEL ? "大香蕉 2.1" : "Image 2.5";
export function designParameterKeys(
  params: Partial<DesignParams>
): (keyof DesignParams)[] {
  return params.model === DESIGN_BANANA_MODEL
    ? ["model", "count", "aspect_ratio", "resolution", "thinking"]
    : [
        "model",
        "count",
        "version",
        "aspect_ratio",
        "resolution",
        "quality",
        "background",
      ];
}
export function designParameterOptions(
  params: Partial<DesignParams>,
  key: keyof DesignParams
): readonly (readonly [string, string])[] {
  const banana = params.model === DESIGN_BANANA_MODEL;
  if (key === "aspect_ratio")
    return designOptions.aspect_ratio.filter(([value]) =>
      banana
        ? !["auto", "2:1", "1:2", "9:21"].includes(value)
        : !["1:4", "4:1", "1:8", "8:1"].includes(value)
    );
  if (key === "resolution" && banana)
    return designOptions.resolution.filter(([value]) => value !== "auto");
  return designOptions[key];
}
