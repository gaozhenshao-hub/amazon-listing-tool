import { createHash } from "node:crypto";

export const PRODUCT_KNOWLEDGE_TRANSFER_FORMAT = "amz_product_knowledge_transfer" as const;
export const PRODUCT_KNOWLEDGE_TRANSFER_VERSION = 1 as const;
export const PRODUCT_KNOWLEDGE_TRANSFER_MANIFEST_PATH = "manifest.json" as const;
export const PRODUCT_KNOWLEDGE_TRANSFER_INTEGRITY_PATH = "integrity.json" as const;

export const PRODUCT_KNOWLEDGE_MODULES = [
  "products",
  "listings",
  "images",
  "skills",
  "videos",
] as const;

export type ProductKnowledgeModule = (typeof PRODUCT_KNOWLEDGE_MODULES)[number];
export type TransferDateField = "created_at" | "updated_at";
export type AttachmentTransferStatus = "embedded" | "external_reference";

/**
 * Limits are intentionally compatible with the current image KB baseline
 * (31 image sets / 561 child images) while blocking ZIP bombs and unbounded
 * server resource use. The import transport may impose a stricter upload cap.
 */
export const PRODUCT_KNOWLEDGE_TRANSFER_LIMITS = {
  maxArchiveFiles: 2_000,
  maxManifestBytes: 10 * 1024 * 1024,
  maxSingleFileBytes: 200 * 1024 * 1024,
  maxUncompressedBytes: 2 * 1024 * 1024 * 1024,
  maxItems: 1_000,
  maxPathLength: 240,
} as const;

export type TransferFilter = {
  modules: ProductKnowledgeModule[];
  dateField: TransferDateField;
  startAt?: string;
  endAt?: string;
  tags?: string[];
};

export type TransferAttachment = {
  /** Stable path relative to the ZIP root. Null is only permitted for a declared external reference. */
  path: string | null;
  field: string;
  status: AttachmentTransferStatus;
  mimeType: string | null;
  size: number | null;
  sha256: string | null;
  fileName: string | null;
  note?: string;
};

export type TransferItem = {
  module: ProductKnowledgeModule;
  /** Per-package opaque reference; never a source database ID or user/workspace identifier. */
  itemRef: string;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
  /** Only allowlisted business fields and human-approved content are allowed here. */
  record: Record<string, unknown>;
  attachments: TransferAttachment[];
};

export type ProductKnowledgeTransferManifest = {
  format: typeof PRODUCT_KNOWLEDGE_TRANSFER_FORMAT;
  formatVersion: typeof PRODUCT_KNOWLEDGE_TRANSFER_VERSION;
  exportedAt: string;
  source: {
    application: "amazon-listing-tool";
    packageLabel: string;
  };
  filter: TransferFilter;
  counts: {
    items: number;
    embeddedAttachments: number;
    externalReferences: number;
  };
  /** A complete transfer is only true when all declared attachments are embedded. */
  isComplete: boolean;
  items: TransferItem[];
};

export type IntegrityFile = {
  path: string;
  size: number;
  sha256: string;
};

export type ProductKnowledgeTransferIntegrity = {
  format: typeof PRODUCT_KNOWLEDGE_TRANSFER_FORMAT;
  formatVersion: typeof PRODUCT_KNOWLEDGE_TRANSFER_VERSION;
  files: IntegrityFile[];
  totalFiles: number;
  totalBytes: number;
};

export type PackageValidationSummary = {
  itemCount: number;
  attachmentCount: number;
  externalReferenceCount: number;
  totalBytes: number;
};

export type PackageFileIndexEntry = {
  size: number;
  sha256: string;
};

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Produces a canonical JSON string so content fingerprints do not depend on key insertion order. */
export function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")} ]`.replace(", ]", "]");
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
      .filter((key) => objectValue[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
      .join(",")}}`;
  }
  throw new Error(`Unsupported value in canonical transfer payload: ${typeof value}`);
}

export function canonicalItemPayload(item: Pick<TransferItem, "module" | "record" | "attachments">): string {
  return stableStringify({
    module: item.module,
    record: item.record,
    attachments: item.attachments.map((attachment) => ({
      field: attachment.field,
      status: attachment.status,
      mimeType: attachment.mimeType,
      size: attachment.size,
      sha256: attachment.sha256,
      fileName: attachment.fileName,
    })),
  });
}

export function contentHashForItem(item: Pick<TransferItem, "module" | "record" | "attachments">): string {
  return sha256(canonicalItemPayload(item));
}

export function assertSafeTransferPath(value: string): void {
  if (!value || value.length > PRODUCT_KNOWLEDGE_TRANSFER_LIMITS.maxPathLength) {
    throw new Error("知识包包含无效或过长的文件路径");
  }
  if (value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw new Error("知识包包含不安全的文件路径");
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("知识包包含路径穿越条目");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)) {
    throw new Error("知识包文件路径包含不支持的字符");
  }
}

export function buildIntegrity(
  manifestBuffer: Buffer,
  attachments: Array<{ path: string; body: Buffer }>,
): ProductKnowledgeTransferIntegrity {
  const files: IntegrityFile[] = [
    {
      path: PRODUCT_KNOWLEDGE_TRANSFER_MANIFEST_PATH,
      size: manifestBuffer.length,
      sha256: sha256(manifestBuffer),
    },
    ...attachments.map((attachment) => {
      assertSafeTransferPath(attachment.path);
      return {
        path: attachment.path,
        size: attachment.body.length,
        sha256: sha256(attachment.body),
      };
    }),
  ].sort((left, right) => left.path.localeCompare(right.path));

  return {
    format: PRODUCT_KNOWLEDGE_TRANSFER_FORMAT,
    formatVersion: PRODUCT_KNOWLEDGE_TRANSFER_VERSION,
    files,
    totalFiles: files.length,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
  };
}

export function validatePackageFileIndex(
  manifest: ProductKnowledgeTransferManifest,
  integrity: ProductKnowledgeTransferIntegrity,
  files: Map<string, PackageFileIndexEntry>,
): PackageValidationSummary {
  if (manifest.format !== PRODUCT_KNOWLEDGE_TRANSFER_FORMAT || manifest.formatVersion !== PRODUCT_KNOWLEDGE_TRANSFER_VERSION) {
    throw new Error("不支持的产品知识库知识包版本");
  }
  if (integrity.format !== PRODUCT_KNOWLEDGE_TRANSFER_FORMAT || integrity.formatVersion !== PRODUCT_KNOWLEDGE_TRANSFER_VERSION) {
    throw new Error("知识包完整性清单版本不匹配");
  }
  if (!Array.isArray(manifest.items) || manifest.items.length > PRODUCT_KNOWLEDGE_TRANSFER_LIMITS.maxItems) {
    throw new Error("知识包条目数量无效或超出上限");
  }
  if (!manifest.isComplete || manifest.counts.externalReferences > 0) {
    throw new Error("知识包含有未嵌入的外部附件，不能按完整包导入");
  }
  if (integrity.totalFiles !== integrity.files.length || integrity.totalFiles > PRODUCT_KNOWLEDGE_TRANSFER_LIMITS.maxArchiveFiles) {
    throw new Error("知识包文件数量无效或超出上限");
  }
  if (integrity.totalBytes > PRODUCT_KNOWLEDGE_TRANSFER_LIMITS.maxUncompressedBytes) {
    throw new Error("知识包解压后体积超出安全上限");
  }

  const expectedPaths = new Set<string>();
  let totalBytes = 0;
  for (const file of integrity.files) {
    assertSafeTransferPath(file.path);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > PRODUCT_KNOWLEDGE_TRANSFER_LIMITS.maxSingleFileBytes) {
      throw new Error("知识包包含超限文件");
    }
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("知识包包含无效SHA-256校验值");
    if (expectedPaths.has(file.path)) throw new Error("知识包完整性清单含重复路径");
    expectedPaths.add(file.path);
    totalBytes += file.size;
    const actual = files.get(file.path);
    if (!actual || actual.size !== file.size || actual.sha256 !== file.sha256) {
      throw new Error(`知识包文件完整性校验失败：${file.path}`);
    }
  }
  if (totalBytes !== integrity.totalBytes) throw new Error("知识包总体积校验失败");
  if (files.size !== expectedPaths.size || [...files.keys()].some((path) => !expectedPaths.has(path))) {
    throw new Error("知识包包含未声明文件");
  }

  const manifestFile = files.get(PRODUCT_KNOWLEDGE_TRANSFER_MANIFEST_PATH);
  if (!manifestFile) throw new Error("知识包缺少manifest.json");
  if (manifestFile.size > PRODUCT_KNOWLEDGE_TRANSFER_LIMITS.maxManifestBytes) throw new Error("知识包清单超过安全上限");

  let embeddedAttachments = 0;
  let externalReferences = 0;
  const itemRefs = new Set<string>();
  for (const item of manifest.items) {
    if (!PRODUCT_KNOWLEDGE_MODULES.includes(item.module)) throw new Error("知识包包含未知业务模块");
    if (!item.itemRef || itemRefs.has(item.itemRef)) throw new Error("知识包条目引用无效或重复");
    itemRefs.add(item.itemRef);
    if (!/^[a-f0-9]{64}$/.test(item.contentHash) || item.contentHash !== contentHashForItem(item)) {
      throw new Error(`知识包条目内容校验失败：${item.itemRef}`);
    }
    for (const attachment of item.attachments) {
      if (attachment.status === "embedded") {
        embeddedAttachments += 1;
        if (!attachment.path || !attachment.sha256 || attachment.size === null) {
          throw new Error(`知识包附件描述不完整：${item.itemRef}`);
        }
        assertSafeTransferPath(attachment.path);
        const body = files.get(attachment.path);
        if (!body || body.size !== attachment.size || body.sha256 !== attachment.sha256) {
          throw new Error(`知识包附件内容校验失败：${attachment.path}`);
        }
      } else {
        externalReferences += 1;
        if (attachment.path !== null || attachment.sha256 !== null || attachment.size !== null) {
          throw new Error(`外部引用附件描述无效：${item.itemRef}`);
        }
      }
    }
  }
  if (manifest.counts.items !== manifest.items.length
    || manifest.counts.embeddedAttachments !== embeddedAttachments
    || manifest.counts.externalReferences !== externalReferences) {
    throw new Error("知识包统计与条目内容不一致");
  }

  return {
    itemCount: manifest.items.length,
    attachmentCount: embeddedAttachments,
    externalReferenceCount: externalReferences,
    totalBytes,
  };
}

export function validatePackageContract(
  manifest: ProductKnowledgeTransferManifest,
  integrity: ProductKnowledgeTransferIntegrity,
  files: Map<string, Buffer>,
): PackageValidationSummary {
  return validatePackageFileIndex(
    manifest,
    integrity,
    new Map([...files.entries()].map(([path, body]) => [path, { size: body.length, sha256: sha256(body) }])),
  );
}
