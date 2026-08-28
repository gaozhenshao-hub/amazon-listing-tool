import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, withDbTransaction, type DbExecutor } from "../../repositories/dbClient";
import {
  kbImageSets,
  kbImages,
  kbListingCopywriting,
  kbOperationSkills,
  kbProductInnovations,
  kbTransferItemReceipts,
  kbTransferStages,
  kbVideos,
} from "../../../drizzle/schema";
import { storageGet, storagePut } from "../../storage";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";
import {
  PRODUCT_KNOWLEDGE_TRANSFER_FORMAT,
  PRODUCT_KNOWLEDGE_TRANSFER_VERSION,
  contentHashForItem,
  validatePackageFileIndex,
  type ProductKnowledgeModule,
  type ProductKnowledgeTransferManifest,
  type TransferAttachment,
  type TransferDateField,
  type TransferFilter,
  type TransferItem,
} from "./productKnowledgeTransfer";
import {
  attachmentPath,
  cleanupExtractedTransferPackage,
  createProductKnowledgeTransferZip,
  extractProductKnowledgeTransferZip,
  fileNameForTransferPackage,
  sha256File,
  type ExtractedTransferFile,
  type TransferArchiveAttachment,
} from "./productKnowledgeTransferZip";

export type TransferFiltersInput = {
  modules: ProductKnowledgeModule[];
  dateField: TransferDateField;
  startAt?: Date;
  endAt?: Date;
  tags?: string[];
};

export type ExportPreview = {
  counts: Record<ProductKnowledgeModule, number>;
  totalItems: number;
  declaredAttachmentCandidates: number;
  filter: TransferFilter;
  completenessRule: string;
};

export type StagedTransferPreviewItem = {
  itemRef: string;
  module: ProductKnowledgeModule;
  label: string;
  asin: string | null;
  contentHash: string;
  action: "create" | "skip_identical" | "conflict";
  reason?: string;
};

export type StagedTransferPreview = {
  stageId: string;
  expiresAt: Date;
  originalFileName: string;
  packageSha256: string;
  summary: { itemCount: number; attachmentCount: number; totalBytes: number };
  items: StagedTransferPreviewItem[];
};

type StagedAttachment = {
  path: string;
  key: string;
  mimeType: string;
};

type DbRecord = Record<string, any>;

const EMPTY_COUNTS = (): Record<ProductKnowledgeModule, number> => ({
  products: 0,
  listings: 0,
  images: 0,
  skills: 0,
  videos: 0,
});

function asIsoDate(value: Date | string | null | undefined): string {
  const date = value instanceof Date ? value : new Date(value ?? 0);
  if (Number.isNaN(date.getTime())) throw new Error("知识库记录包含无效时间");
  return date.toISOString();
}

function cleanText(value: unknown, maxLength = 2048): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result ? result.slice(0, maxLength) : null;
}

function cleanJsonText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function cleanPublicUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  } catch {
    return [];
  }
}

function tagsMatch(row: DbRecord, tags: string[] | undefined): boolean {
  if (!tags?.length) return true;
  const values = [...parseStringArray(row.tags), ...parseStringArray(row.categories)].map((tag) => tag.toLocaleLowerCase());
  return tags.some((tag) => values.includes(tag.toLocaleLowerCase()));
}

function inDateRange(row: DbRecord, filters: TransferFiltersInput): boolean {
  const value = filters.dateField === "created_at" ? row.createdAt : row.updatedAt;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (!filters.startAt || date >= filters.startAt) && (!filters.endAt || date <= filters.endAt);
}

function filterToManifest(filters: TransferFiltersInput): TransferFilter {
  return {
    modules: filters.modules,
    dateField: filters.dateField,
    ...(filters.startAt ? { startAt: filters.startAt.toISOString() } : {}),
    ...(filters.endAt ? { endAt: filters.endAt.toISOString() } : {}),
    ...(filters.tags?.length ? { tags: [...new Set(filters.tags.map((tag) => tag.trim()).filter(Boolean))] } : {}),
  };
}

function attachmentLabel(sourceUrl: string, fallback: string): string {
  try {
    return new URL(sourceUrl).pathname.split("/").filter(Boolean).at(-1) || fallback;
  } catch {
    return fallback;
  }
}

async function captureAttachment(
  sourceUrl: string | null | undefined,
  module: ProductKnowledgeModule,
  itemRef: string,
  field: string,
  fallbackName: string,
  workspaceId: number,
): Promise<{ descriptor: TransferAttachment; archive?: TransferArchiveAttachment }> {
  if (!sourceUrl) {
    return {
      descriptor: { path: null, field, status: "external_reference", mimeType: null, size: null, sha256: null, fileName: null, note: "源记录未提供可导出的附件" },
    };
  }
  try {
    const response = await safeHttpRequest(sourceUrl, {
      timeoutMs: 45_000,
      maxRedirects: 2,
      maxResponseBytes: 200 * 1024 * 1024,
      auditContext: { operation: "knowledge_base.transfer_export_attachment", workspaceId },
    });
    if (!response.ok || response.body.length === 0) throw new Error("attachment unavailable");
    const path = attachmentPath(module, itemRef, field, attachmentLabel(sourceUrl, fallbackName));
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const descriptor: TransferAttachment = {
      path,
      field,
      status: "embedded",
      mimeType,
      size: response.body.length,
      sha256: "",
      fileName: attachmentLabel(sourceUrl, fallbackName),
    };
    const { sha256 } = await import("./productKnowledgeTransfer");
    descriptor.sha256 = sha256(response.body);
    return { descriptor, archive: { path, body: response.body } };
  } catch {
    return {
      descriptor: {
        path: null,
        field,
        status: "external_reference",
        mimeType: null,
        size: null,
        sha256: null,
        fileName: attachmentLabel(sourceUrl, fallbackName),
        note: "附件无法在安全下载限制内验证并打包",
      },
    };
  }
}

function baseItem(module: ProductKnowledgeModule, row: DbRecord, itemRef: string, record: Record<string, unknown>, attachments: TransferAttachment[]): TransferItem {
  const item: TransferItem = {
    module,
    itemRef,
    createdAt: asIsoDate(row.createdAt),
    updatedAt: asIsoDate(row.updatedAt),
    contentHash: "",
    record,
    attachments,
  };
  item.contentHash = contentHashForItem(item);
  return item;
}

function moduleLabel(item: TransferItem): string {
  const record = item.record;
  return String(record.productTitle || record.title || record.videoTitle || record.asin || item.itemRef);
}

function itemAsin(item: TransferItem): string | null {
  const asin = item.record.asin;
  return typeof asin === "string" && asin.trim() ? asin.trim().toUpperCase() : null;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  mapper: (value: T, index: number) => Promise<R>,
  concurrency = 4,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

async function loadSourceRows(workspaceId: number, filters: TransferFiltersInput): Promise<Record<ProductKnowledgeModule, DbRecord[]>> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const needs = new Set(filters.modules);
  const scoped = async (table: any) => {
    const column = filters.dateField === "created_at" ? table.createdAt : table.updatedAt;
    // 与产品知识库的“共享”范围保持一致：仅导出当前工作空间已确认的知识，
    // 且由路由层的超级管理员权限保证不会越过工作空间边界。
    const conditions = [eq(table.workspaceId, workspaceId), eq(table.status, "confirmed")];
    if (filters.startAt) conditions.push(gte(column, filters.startAt));
    if (filters.endAt) conditions.push(lte(column, filters.endAt));
    return db.select().from(table).where(and(...conditions));
  };
  const rows: Record<ProductKnowledgeModule, DbRecord[]> = {
    products: needs.has("products") ? await scoped(kbProductInnovations) : [],
    listings: needs.has("listings") ? await scoped(kbListingCopywriting) : [],
    images: needs.has("images") ? await scoped(kbImageSets) : [],
    skills: needs.has("skills") ? await scoped(kbOperationSkills) : [],
    videos: needs.has("videos") ? await scoped(kbVideos) : [],
  };
  for (const module of filters.modules) {
    rows[module] = rows[module].filter((row) => inDateRange(row, filters) && tagsMatch(row, filters.tags));
  }
  return rows;
}

async function buildTransferItems(workspaceId: number, filters: TransferFiltersInput): Promise<{ items: TransferItem[]; archives: TransferArchiveAttachment[] }> {
  const rows = await loadSourceRows(workspaceId, filters);
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const items: TransferItem[] = [];
  const archives: TransferArchiveAttachment[] = [];
  let sequence = 0;
  const nextRef = (module: ProductKnowledgeModule) => `${module}-${String(++sequence).padStart(6, "0")}`;
  const addAttachments = (captures: Array<{ descriptor: TransferAttachment; archive?: TransferArchiveAttachment }>) => {
    for (const capture of captures) if (capture.archive) archives.push(capture.archive);
    return captures.map((capture) => capture.descriptor);
  };

  for (const row of rows.products) {
    const itemRef = nextRef("products");
    const captures = await mapWithConcurrency(
      parseStringArray(row.imageUrls),
      (url, index) => captureAttachment(url, "products", itemRef, `imageUrls-${index}`, `product-image-${index + 1}`, workspaceId),
    );
    items.push(baseItem("products", row, itemRef, {
      asin: cleanText(row.asin, 20), productUrl: cleanPublicUrl(row.productUrl), productTitle: cleanText(row.productTitle, 512),
      brand: cleanText(row.brand, 128), price: cleanText(row.price, 50), bsr: row.bsr ?? null, rating: cleanText(row.rating, 10), reviewCount: cleanText(row.reviewCount, 20),
      category: cleanText(row.category, 128), bulletPoints: cleanJsonText(row.bulletPoints), crawledData: cleanJsonText(row.crawledData), aiAnalysis: cleanJsonText(row.aiAnalysis),
      userEditedAnalysis: cleanJsonText(row.userEditedAnalysis), tags: cleanJsonText(row.tags), overallScore: row.overallScore ?? null,
    }, addAttachments(captures)));
  }

  for (const row of rows.listings) {
    const itemRef = nextRef("listings");
    items.push(baseItem("listings", row, itemRef, {
      asin: cleanText(row.asin, 20), productTitle: cleanText(row.productTitle, 512), category: cleanText(row.category, 128), brand: cleanText(row.brand, 128),
      titleText: cleanJsonText(row.titleText), bulletPoints: cleanJsonText(row.bulletPoints), longDescription: cleanJsonText(row.longDescription), aPlusContent: cleanJsonText(row.aPlusContent),
      qaContent: cleanJsonText(row.qaContent), crawledData: cleanJsonText(row.crawledData), aiAnalysis: cleanJsonText(row.aiAnalysis), userEditedAnalysis: cleanJsonText(row.userEditedAnalysis),
      tags: cleanJsonText(row.tags), overallScore: row.overallScore ?? null,
    }, []));
  }

  for (const row of rows.images) {
    const itemRef = nextRef("images");
    const children = await db.select().from(kbImages).where(eq(kbImages.imageSetId, row.id)).orderBy(kbImages.positionIndex);
    const captures = await mapWithConcurrency(
      children,
      (image, index) => captureAttachment(image.imageUrl, "images", itemRef, `images-${index}`, `image-${index + 1}`, workspaceId),
    );
    items.push(baseItem("images", row, itemRef, {
      asin: cleanText(row.asin, 20), productTitle: cleanText(row.productTitle, 512), category: cleanText(row.category, 128), brand: cleanText(row.brand, 128),
      overallAnalysis: cleanJsonText(row.overallAnalysis), userEditedOverallAnalysis: cleanJsonText(row.userEditedOverallAnalysis), overallScore: row.overallScore ?? null,
      setStyle: cleanText(row.setStyle, 30), setStyleParams: cleanJsonText(row.setStyleParams), setPrimaryColor: cleanText(row.setPrimaryColor, 20), setAccentColor: cleanText(row.setAccentColor, 20),
      setCategory: cleanText(row.setCategory, 30), setTargetAudience: cleanText(row.setTargetAudience, 200), setCategoryScene: cleanText(row.setCategoryScene, 200),
      images: children.map((image, index) => ({
        attachmentField: `images-${index}`, imagePosition: image.imagePosition, positionIndex: image.positionIndex,
        tagCategory: cleanText(image.tagCategory, 64), tagColorScheme: cleanText(image.tagColorScheme, 64), tagImageType: cleanText(image.tagImageType, 64), tagDesignStyle: cleanText(image.tagDesignStyle, 64),
        tagImageBelong: cleanText(image.tagImageBelong, 20), tagImageBelongSub: cleanText(image.tagImageBelongSub, 30), tagImageTypeMain: cleanText(image.tagImageTypeMain, 20), tagImageTypeSub: cleanText(image.tagImageTypeSub, 30),
        tagSellingPointCategory: cleanText(image.tagSellingPointCategory, 20), tagSellingPointDetail: cleanText(image.tagSellingPointDetail, 200), tagComposition: cleanText(image.tagComposition, 20),
        tagColorSchemeV2: cleanText(image.tagColorSchemeV2, 30), tagDesignStyleV2: cleanText(image.tagDesignStyleV2, 30), aiDimensionAnalysis: cleanJsonText(image.aiDimensionAnalysis), userEditedDimensionAnalysis: cleanJsonText(image.userEditedDimensionAnalysis),
        aplusModuleType: cleanText(image.aplusModuleType, 64), aplusModuleClass: cleanText(image.aplusModuleClass, 128), singleImageScore: image.singleImageScore ?? null, highlights: cleanJsonText(image.highlights),
        tagsConfirmed: image.tagsConfirmed ? 1 : 0, analysisConfirmed: image.analysisConfirmed ? 1 : 0,
      })),
    }, addAttachments(captures)));
  }

  for (const row of rows.skills) {
    const itemRef = nextRef("skills");
    const captures = [await captureAttachment(row.fileUrl, "skills", itemRef, "file", row.originalFileName || "sop-attachment", workspaceId)];
    const attachments = row.fileUrl ? addAttachments(captures) : [];
    items.push(baseItem("skills", row, itemRef, {
      title: cleanText(row.title, 256), sourceType: cleanText(row.sourceType, 30), sourceUrl: cleanPublicUrl(row.sourceUrl), originalFileName: cleanText(row.originalFileName, 256),
      extractedContent: cleanJsonText(row.extractedContent), aiSummary: cleanJsonText(row.aiSummary), userEditedSummary: cleanJsonText(row.userEditedSummary), categories: cleanJsonText(row.categories),
      tags: cleanJsonText(row.tags), practicalityScore: row.practicalityScore ?? null,
    }, attachments));
  }

  for (const row of rows.videos) {
    const itemRef = nextRef("videos");
    const captures = await Promise.all([
      captureAttachment(row.videoUrl, "videos", itemRef, "video", "video.mp4", workspaceId),
      ...(row.thumbnailUrl ? [captureAttachment(row.thumbnailUrl, "videos", itemRef, "thumbnail", "thumbnail.jpg", workspaceId)] : []),
      ...parseStringArray(row.keyframeUrls).map((url, index) => captureAttachment(url, "videos", itemRef, `keyframes-${index}`, `keyframe-${index + 1}.jpg`, workspaceId)),
    ]);
    items.push(baseItem("videos", row, itemRef, {
      asin: cleanText(row.asin, 20), videoTitle: cleanText(row.videoTitle, 512), category: cleanText(row.category, 128), duration: row.duration ?? null,
      transcriptText: cleanJsonText(row.transcriptText), aiAnalysis: cleanJsonText(row.aiAnalysis), userEditedAnalysis: cleanJsonText(row.userEditedAnalysis), tags: cleanJsonText(row.tags), overallScore: row.overallScore ?? null,
    }, addAttachments(captures)));
  }
  return { items, archives };
}

async function countAttachmentCandidates(rows: Record<ProductKnowledgeModule, DbRecord[]>): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const imageSetIds = rows.images.map((row) => Number(row.id)).filter(Number.isSafeInteger);
  const imageRows = imageSetIds.length
    ? await db.select({ count: sql<number>`COUNT(*)` }).from(kbImages).where(inArray(kbImages.imageSetId, imageSetIds))
    : [{ count: 0 }];
  const imageAttachments = Number(imageRows[0]?.count ?? 0);
  return rows.products.reduce((count, row) => count + parseStringArray(row.imageUrls).length, 0)
    + imageAttachments
    + rows.skills.filter((row) => Boolean(row.fileUrl)).length
    + rows.videos.reduce((count, row) => count + 1 + (row.thumbnailUrl ? 1 : 0) + parseStringArray(row.keyframeUrls).length, 0);
}

export async function previewProductKnowledgeTransfer(workspaceId: number, filters: TransferFiltersInput): Promise<ExportPreview> {
  const rows = await loadSourceRows(workspaceId, filters);
  const counts = EMPTY_COUNTS();
  for (const module of filters.modules) counts[module] = rows[module].length;
  return {
    counts,
    totalItems: Object.values(counts).reduce((total, value) => total + value, 0),
    declaredAttachmentCandidates: await countAttachmentCandidates(rows),
    filter: filterToManifest(filters),
    completenessRule: "完整包仅在所有声明附件均可安全读取、校验并嵌入ZIP时生成；外部或不可读取引用会阻断导出。",
  };
}

export async function exportProductKnowledgeTransfer(userId: number, workspaceId: number, filters: TransferFiltersInput) {
  const { items, archives } = await buildTransferItems(workspaceId, filters);
  const externalReferences = items.flatMap((item) => item.attachments).filter((attachment) => attachment.status === "external_reference").length;
  if (externalReferences > 0) {
    throw new Error(`有${externalReferences}个附件无法安全读取并嵌入完整ZIP；请先在源知识库补齐实际文件后重试。`);
  }
  const exportedAt = new Date();
  const manifest: ProductKnowledgeTransferManifest = {
    format: PRODUCT_KNOWLEDGE_TRANSFER_FORMAT,
    formatVersion: PRODUCT_KNOWLEDGE_TRANSFER_VERSION,
    exportedAt: exportedAt.toISOString(),
    source: { application: "amazon-listing-tool", packageLabel: "产品知识库跨实例完整包" },
    filter: filterToManifest(filters),
    counts: { items: items.length, embeddedAttachments: archives.length, externalReferences: 0 },
    isComplete: true,
    items,
  };
  const { body, integrity } = await createProductKnowledgeTransferZip(manifest, archives);
  const fileName = fileNameForTransferPackage(exportedAt);
  const object = await storagePut(`kb-transfer-exports/${workspaceId}/${userId}/${randomUUID()}/${fileName}`, body, "application/zip");
  return { fileName, url: object.url, itemCount: items.length, attachmentCount: archives.length, bytes: body.length, integrity };
}

async function listExistingReceipts(workspaceId: number, items: TransferItem[]) {
  const db = await getDb();
  if (!db || items.length === 0) return new Set<string>();
  const hashes = [...new Set(items.map((item) => item.contentHash))];
  const receipts = await db.select({ contentHash: kbTransferItemReceipts.contentHash, module: kbTransferItemReceipts.module })
    .from(kbTransferItemReceipts)
    .where(and(eq(kbTransferItemReceipts.workspaceId, workspaceId), inArray(kbTransferItemReceipts.contentHash, hashes)));
  return new Set(receipts.map((receipt) => `${receipt.module}:${receipt.contentHash}`));
}

async function findBusinessConflict(workspaceId: number, item: TransferItem): Promise<string | null> {
  const asin = itemAsin(item);
  if (!asin) return null;
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const table = item.module === "products" ? kbProductInnovations
    : item.module === "listings" ? kbListingCopywriting
      : item.module === "images" ? kbImageSets
        : item.module === "videos" ? kbVideos : null;
  if (!table) return null;
  const rows = await db.select({ id: table.id }).from(table).where(and(eq(table.workspaceId, workspaceId), eq(table.asin, asin))).limit(1);
  return rows.length ? `目标知识库已存在ASIN ${asin}` : null;
}

async function classifyItems(workspaceId: number, items: TransferItem[]): Promise<StagedTransferPreviewItem[]> {
  const receipts = await listExistingReceipts(workspaceId, items);
  const preview: StagedTransferPreviewItem[] = [];
  for (const item of items) {
    if (receipts.has(`${item.module}:${item.contentHash}`)) {
      preview.push({ itemRef: item.itemRef, module: item.module, label: moduleLabel(item), asin: itemAsin(item), contentHash: item.contentHash, action: "skip_identical", reason: "目标工作空间已导入相同内容哈希" });
      continue;
    }
    const conflict = await findBusinessConflict(workspaceId, item);
    preview.push({ itemRef: item.itemRef, module: item.module, label: moduleLabel(item), asin: itemAsin(item), contentHash: item.contentHash, action: conflict ? "conflict" : "create", ...(conflict ? { reason: conflict } : {}) });
  }
  return preview;
}

async function stageAttachments(
  stageId: string,
  workspaceId: number,
  extractedFiles: Map<string, ExtractedTransferFile>,
  manifest: ProductKnowledgeTransferManifest,
): Promise<StagedAttachment[]> {
  const staged: StagedAttachment[] = [];
  for (const item of manifest.items) {
    for (const attachment of item.attachments.filter((candidate) => candidate.status === "embedded" && candidate.path)) {
      const file = extractedFiles.get(attachment.path!);
      if (!file) throw new Error(`知识包附件预检缺失：${attachment.path}`);
      const body = await import("node:fs/promises").then(({ readFile }) => readFile(file.filePath));
      const object = await storagePut(
        `kb-transfer-staging/${workspaceId}/${stageId}/${attachment.path}`,
        body,
        attachment.mimeType || "application/octet-stream",
      );
      staged.push({ path: attachment.path!, key: object.key, mimeType: attachment.mimeType || "application/octet-stream" });
    }
  }
  return staged;
}

export async function preflightProductKnowledgeTransfer(
  userId: number,
  workspaceId: number,
  archivePath: string,
  originalFileName: string,
): Promise<StagedTransferPreview> {
  const extracted = await extractProductKnowledgeTransferZip(archivePath);
  try {
    const summary = validatePackageFileIndex(
      extracted.manifest,
      extracted.integrity,
      new Map([...extracted.dataFiles.entries()].map(([path, file]) => [path, { size: file.size, sha256: file.sha256 }])),
    );
    const stageId = `kbtx_${randomUUID().replaceAll("-", "")}`;
    const items = await classifyItems(workspaceId, extracted.manifest.items);
    const attachments = await stageAttachments(stageId, workspaceId, extracted.dataFiles, extracted.manifest);
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const preview: StagedTransferPreview = {
      stageId,
      expiresAt,
      originalFileName: cleanText(originalFileName, 255) || "product-knowledge-transfer.zip",
      packageSha256: await sha256File(archivePath),
      summary: { itemCount: summary.itemCount, attachmentCount: summary.attachmentCount, totalBytes: summary.totalBytes },
      items,
    };
    await db.insert(kbTransferStages).values({
      id: stageId,
      userId,
      workspaceId,
      packageSha256: preview.packageSha256,
      originalFileName: preview.originalFileName,
      manifestJson: JSON.stringify(extracted.manifest),
      attachmentStorageJson: JSON.stringify(attachments),
      previewJson: JSON.stringify(preview),
      expiresAt,
    });
    return preview;
  } finally {
    await cleanupExtractedTransferPackage(extracted);
  }
}

function attachmentKeyByField(item: TransferItem, attachments: StagedAttachment[]): Map<string, string> {
  const keys = new Map<string, string>();
  for (const descriptor of item.attachments) {
    if (descriptor.status !== "embedded" || !descriptor.path) continue;
    const staged = attachments.find((candidate) => candidate.path === descriptor.path);
    if (!staged) throw new Error(`导入暂存附件缺失：${descriptor.path}`);
    keys.set(descriptor.field, staged.key);
  }
  return keys;
}

async function urlForStagedKey(key: string): Promise<string> {
  return (await storageGet(key)).url;
}

async function createTargetRecord(userId: number, workspaceId: number, item: TransferItem, stagedAttachments: StagedAttachment[], executor?: DbExecutor): Promise<number> {
  const db = executor ?? await getDb();
  if (!db) throw new Error("数据库不可用");
  const record = item.record as Record<string, any>;
  const files = attachmentKeyByField(item, stagedAttachments);
  const pending = { userId, workspaceId, status: "pending_review" as const, reviewStatus: "draft" as const, visibility: "private" as const };
  if (item.module === "products") {
    const imageUrls = await Promise.all([...files.entries()].filter(([field]) => field.startsWith("imageUrls-")).map(([, key]) => urlForStagedKey(key)));
    const [result] = await db.insert(kbProductInnovations).values({ ...pending, asin: String(record.asin || "").toUpperCase(), productUrl: record.productUrl, productTitle: record.productTitle, brand: record.brand, price: record.price, bsr: record.bsr, rating: record.rating, reviewCount: record.reviewCount, category: record.category, bulletPoints: record.bulletPoints, imageUrls: JSON.stringify(imageUrls), crawledData: record.crawledData, aiAnalysis: record.aiAnalysis, userEditedAnalysis: record.userEditedAnalysis, tags: record.tags, overallScore: record.overallScore });
    return Number(result.insertId);
  }
  if (item.module === "listings") {
    const [result] = await db.insert(kbListingCopywriting).values({ ...pending, asin: String(record.asin || "").toUpperCase(), productTitle: record.productTitle, category: record.category, brand: record.brand, titleText: record.titleText, bulletPoints: record.bulletPoints, longDescription: record.longDescription, aPlusContent: record.aPlusContent, qaContent: record.qaContent, crawledData: record.crawledData, aiAnalysis: record.aiAnalysis, userEditedAnalysis: record.userEditedAnalysis, tags: record.tags, overallScore: record.overallScore });
    return Number(result.insertId);
  }
  if (item.module === "images") {
    const [setResult] = await db.insert(kbImageSets).values({ ...pending, asin: String(record.asin || "").toUpperCase(), productTitle: record.productTitle, category: record.category, brand: record.brand, overallAnalysis: record.overallAnalysis, userEditedOverallAnalysis: record.userEditedOverallAnalysis, overallScore: record.overallScore, setStyle: record.setStyle, setStyleParams: record.setStyleParams, setPrimaryColor: record.setPrimaryColor, setAccentColor: record.setAccentColor, setCategory: record.setCategory, setTargetAudience: record.setTargetAudience, setCategoryScene: record.setCategoryScene });
    const setId = Number(setResult.insertId);
    for (const image of Array.isArray(record.images) ? record.images : []) {
      const key = files.get(String(image.attachmentField));
      if (!key) throw new Error("图片知识包缺少子图片附件映射");
      await db.insert(kbImages).values({ imageSetId: setId, imageUrl: await urlForStagedKey(key), imagePosition: image.imagePosition, positionIndex: image.positionIndex, tagCategory: image.tagCategory, tagColorScheme: image.tagColorScheme, tagImageType: image.tagImageType, tagDesignStyle: image.tagDesignStyle, tagImageBelong: image.tagImageBelong, tagImageBelongSub: image.tagImageBelongSub, tagImageTypeMain: image.tagImageTypeMain, tagImageTypeSub: image.tagImageTypeSub, tagSellingPointCategory: image.tagSellingPointCategory, tagSellingPointDetail: image.tagSellingPointDetail, tagComposition: image.tagComposition, tagColorSchemeV2: image.tagColorSchemeV2, tagDesignStyleV2: image.tagDesignStyleV2, aiDimensionAnalysis: image.aiDimensionAnalysis, userEditedDimensionAnalysis: image.userEditedDimensionAnalysis, aplusModuleType: image.aplusModuleType, aplusModuleClass: image.aplusModuleClass, singleImageScore: image.singleImageScore, highlights: image.highlights, tagsConfirmed: image.tagsConfirmed, analysisConfirmed: image.analysisConfirmed });
    }
    return setId;
  }
  if (item.module === "skills") {
    const fileKey = files.get("file");
    const [result] = await db.insert(kbOperationSkills).values({ ...pending, title: String(record.title || "未命名SOP"), sourceType: record.sourceType || "manual", sourceUrl: record.sourceUrl, fileUrl: fileKey ? await urlForStagedKey(fileKey) : null, originalFileName: record.originalFileName, extractedContent: record.extractedContent, aiSummary: record.aiSummary, userEditedSummary: record.userEditedSummary, categories: record.categories, tags: record.tags, practicalityScore: record.practicalityScore, accessLevel: "team", allowedRoles: null });
    return Number(result.insertId);
  }
  const videoKey = files.get("video");
  if (!videoKey) throw new Error("视频知识包缺少实际视频附件");
  const thumbnailKey = files.get("thumbnail");
  const keyframes = await Promise.all([...files.entries()].filter(([field]) => field.startsWith("keyframes-")).map(([, key]) => urlForStagedKey(key)));
  const [result] = await db.insert(kbVideos).values({ ...pending, asin: record.asin, videoUrl: await urlForStagedKey(videoKey), videoTitle: record.videoTitle, category: record.category, duration: record.duration, thumbnailUrl: thumbnailKey ? await urlForStagedKey(thumbnailKey) : null, transcriptText: record.transcriptText, keyframeUrls: JSON.stringify(keyframes), aiAnalysis: record.aiAnalysis, userEditedAnalysis: record.userEditedAnalysis, tags: record.tags, overallScore: record.overallScore });
  return Number(result.insertId);
}

export async function confirmProductKnowledgeTransfer(
  userId: number,
  workspaceId: number,
  stageId: string,
  conflictPolicy: "skip_conflicts" | "create_version" = "skip_conflicts",
) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const rows = await db.select().from(kbTransferStages).where(and(eq(kbTransferStages.id, stageId), eq(kbTransferStages.userId, userId), eq(kbTransferStages.workspaceId, workspaceId))).limit(1);
  const stage = rows[0];
  if (!stage) throw new Error("导入预览不存在或无权限");
  if (stage.status !== "previewed") throw new Error("该知识包已导入、失效或不可再次确认");
  if (stage.expiresAt.getTime() <= Date.now()) {
    await db.update(kbTransferStages).set({ status: "expired" }).where(eq(kbTransferStages.id, stageId));
    throw new Error("导入预览已过期，请重新上传知识包");
  }
  const manifest = JSON.parse(stage.manifestJson) as ProductKnowledgeTransferManifest;
  const attachments = JSON.parse(stage.attachmentStorageJson) as StagedAttachment[];
  const preview = await classifyItems(workspaceId, manifest.items);
  const created: Array<{ itemRef: string; module: ProductKnowledgeModule; targetRecordId: number }> = [];
  const skipped: StagedTransferPreviewItem[] = [];
  await db.update(kbTransferStages).set({ status: "importing" }).where(eq(kbTransferStages.id, stageId));
  try {
    await withDbTransaction("ProductKnowledgeTransfer.confirm", async (tx) => {
      for (const item of manifest.items) {
        const decision = preview.find((candidate) => candidate.itemRef === item.itemRef);
        const mayCreate = decision?.action === "create" || (decision?.action === "conflict" && conflictPolicy === "create_version");
        if (!decision || !mayCreate) {
          if (decision) skipped.push(decision);
          continue;
        }
        const targetRecordId = await createTargetRecord(userId, workspaceId, item, attachments, tx);
        await tx.insert(kbTransferItemReceipts).values({ stageId, workspaceId, module: item.module, contentHash: item.contentHash, targetRecordId });
        created.push({ itemRef: item.itemRef, module: item.module, targetRecordId, ...(decision.action === "conflict" ? { importedAsNewVersion: true } : {}) });
      }
    });
    const result = {
      created,
      skipped,
      conflicts: preview.filter((item) => item.action === "conflict"),
      conflictPolicy,
    };
    await db.update(kbTransferStages).set({ status: "completed", importResultJson: JSON.stringify(result) }).where(eq(kbTransferStages.id, stageId));
    return result;
  } catch (error) {
    await db.update(kbTransferStages).set({ status: "failed", importResultJson: JSON.stringify({ error: error instanceof Error ? error.message : String(error), created }) }).where(eq(kbTransferStages.id, stageId));
    throw error;
  }
}
