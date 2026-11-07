import { z } from "zod";

export const PICK_FILE_BYTES = 8 * 1024 * 1024;
export const PICK_MAX_ROWS = 5000;
export const pickStatus = ["draft", "pending", "approved", "passed"] as const;
export const pickReview = ["approve", "reject", "pass", "hold"] as const;
export const PICK_STATUS_LABELS = {
  draft: "草稿",
  pending: "待审核",
  approved: "审核通过",
  passed: "PASS（淘汰）",
} as const;
export const PICK_REVIEW_LABELS = {
  approve: "通过",
  reject: "拒绝，退回补充",
  pass: "PASS（淘汰）",
  hold: "待定",
} as const;

export const PICK_BADGES = ["BS", "AC", "CPF", "NR"] as const;
export const PICK_LISTING = ["A+", "视频", "品牌故事"] as const;
export const pickAsin = z.string().regex(/^[A-Z0-9]{10}$/);
export const pickMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const pickDate = z.iso.date();
const amount = z.number().min(0).max(100_000_000);
const count = amount.int();
const dimension = z.number().positive().max(10_000);
const nullableAmount = amount.nullable();
const text = (max: number) => z.string().trim().max(max);
const dimensions = z.tuple([dimension, dimension, dimension]).nullable();

export const pickCompetitorSchema = z.object({
  asin: pickAsin,
  parentAsin: pickAsin,
  title: text(1500),
  brand: text(250),
  sku: text(1000),
  spec: text(1200),
  image: text(2000),
  category: text(300),
  rank: count.nullable(),
  parentSales: count.nullable(),
  childSales: count.nullable(),
  price: nullableAmount,
  rating: z.number().min(0).max(5).nullable(),
  reviews: count.nullable(),
  listedOn: pickDate.nullable(),
  sellerCountry: text(80),
  fulfillment: text(80),
  fbaFee: nullableAmount,
  packageCm: dimensions,
  packageKg: dimension.nullable(),
  productCm: dimensions,
  productKg: dimension.nullable(),
  sizeTier: text(80),
  badges: z.array(z.enum(PICK_BADGES)).max(4),
  listing: z.array(z.enum(PICK_LISTING)).max(3),
});
export type PickCompetitor = z.infer<typeof pickCompetitorSchema>;

const importSource = z.object({
  name: text(180),
  count: count,
  asOf: pickDate,
});
export const pickImportSchema = z.object({
  snapshot: importSource.nullable(),
  history: importSource.nullable(),
  rows: z.array(pickCompetitorSchema).max(PICK_MAX_ROWS),
  historyRows: z
    .array(
      z.object({
        asin: pickAsin,
        parentAsin: pickAsin.nullable(),
        values: z
          .record(pickMonth, count)
          .refine(months => Object.keys(months).length <= 12),
      })
    )
    .max(PICK_MAX_ROWS),
});
export type PickImport = z.infer<typeof pickImportSchema>;

export const pickTagSchema = z.object({
  id: z.string().uuid(),
  dimension: text(40).min(1),
  name: text(40).min(1),
  description: text(250),
});
export const pickTagsSchema = z
  .array(pickTagSchema)
  .max(60)
  .refine(
    tags =>
      new Set(tags.map(tag => tag.id)).size === tags.length &&
      new Set(tags.map(tag => [tag.dimension, tag.name].join("\0"))).size ===
        tags.length,
    "同一维度中的标签不能重名"
  );
export type PickTag = z.infer<typeof pickTagSchema>;

export const PICK_QUOTE_TERMS = ["含税含运", "含税不含运", "不含税运"] as const;
export const PICK_PACKAGING = [
  "包含内盒外箱",
  "包含内盒",
  "包含外箱",
  "无包装",
] as const;
export const pickSupplierSchema = z.object({
  availability: z.enum(["in_stock", "unavailable"]).nullable(),
  quotes: z
    .array(
      z.object({
        id: z.string().uuid(),
        specification: text(200),
        configuration: text(400),
        supplier: text(200),
        price: nullableAmount,
        terms: z.enum(PICK_QUOTE_TERMS),
        packaging: z.enum(PICK_PACKAGING),
      })
    )
    .max(100),
  estimatedPrice: nullableAmount,
  moldCost: nullableAmount,
});
export const pickProfitSchema = z.object({
  product: text(200),
  parameters: text(2000),
  price: nullableAmount,
  packageLength: dimension.nullable(),
  packageWidth: dimension.nullable(),
  packageHeight: dimension.nullable(),
  packageKg: dimension.nullable(),
  purchaseCny: nullableAmount,
  inboundRate: amount,
  otherCny: amount,
  inboundMode: z.enum(["actual", "chargeable"]),
  category: text(80).min(1),
  commissionOverride: z.number().min(0).max(100).nullable(),
  apparel: z.boolean(),
  storageMonths: z.number().min(0).max(60),
  returnRate: z.number().min(0).max(100),
  extraPerReturnUsd: amount,
  exchangeOverride: z.number().positive().max(1000).nullable(),
  fulfillmentOverrideUsd: nullableAmount,
});
export type PickProfit = z.infer<typeof pickProfitSchema>;
export const initialPickProfit: PickProfit = {
  product: "",
  parameters: "",
  price: null,
  packageLength: null,
  packageWidth: null,
  packageHeight: null,
  packageKg: null,
  purchaseCny: null,
  inboundRate: 12,
  inboundMode: "actual",
  otherCny: 0,
  category: "general",
  commissionOverride: null,
  apparel: false,
  storageMonths: 1,
  returnRate: 8,
  extraPerReturnUsd: 0,
  exchangeOverride: null,
  fulfillmentOverrideUsd: null,
};

const pickPatentSchema = z.object({
  id: z.string().uuid(),
  name: text(180),
  mime: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  storageUri: text(500),
  size: count,
  uploadedAt: z.iso.datetime(),
});
export type PickPatent = z.infer<typeof pickPatentSchema>;

export const pickDetailsSchema = z.object({
  nameZh: text(200),
  nameEn: text(300),
  notes: text(4000),
  suppliers: pickSupplierSchema,
  profit: pickProfitSchema,
});
export const pickSheetDataSchema = pickDetailsSchema.extend({
  imported: pickImportSchema,
  tags: pickTagsSchema,
  rowTags: z.record(pickAsin, z.array(z.string().uuid()).max(60)),
  manualTagAsins: z.array(pickAsin).max(PICK_MAX_ROWS),
  manualSales: z.record(pickAsin, count),
  patents: z.array(pickPatentSchema).max(20),
});
export type PickSheetData = z.infer<typeof pickSheetDataSchema>;
export type PickStatus = (typeof pickStatus)[number];
export type PickReview = (typeof pickReview)[number];

export function createPickSheet(name: string, notes: string): PickSheetData {
  const english = /^[\x00-\x7f]+$/.test(name);
  return {
    nameZh: english ? "" : name.slice(0, 200),
    nameEn: english ? name.slice(0, 300) : "",
    notes,
    suppliers: {
      availability: null,
      quotes: [],
      estimatedPrice: null,
      moldCost: null,
    },
    profit: { ...initialPickProfit, product: name.slice(0, 200) },
    imported: { snapshot: null, history: null, rows: [], historyRows: [] },
    tags: [],
    rowTags: {},
    manualTagAsins: [],
    manualSales: {},
    patents: [],
  };
}

export function pickStatusAfterReview(review: PickReview): PickStatus {
  switch (review) {
    case "approve":
      return "approved";
    case "reject":
      return "draft";
    case "pass":
      return "passed";
    case "hold":
      return "pending";
  }
}
