import { describe, expect, it } from "vitest";
import {
  PRODUCT_KNOWLEDGE_TRANSFER_FORMAT,
  PRODUCT_KNOWLEDGE_TRANSFER_INTEGRITY_PATH,
  PRODUCT_KNOWLEDGE_TRANSFER_MANIFEST_PATH,
  PRODUCT_KNOWLEDGE_TRANSFER_VERSION,
  assertSafeTransferPath,
  buildIntegrity,
  contentHashForItem,
  stableStringify,
  validatePackageContract,
  type ProductKnowledgeTransferManifest,
} from "./productKnowledgeTransfer";

function createManifest(): ProductKnowledgeTransferManifest {
  const attachment = {
    path: "attachments/images/asset-001.png",
    field: "images[0]",
    status: "embedded" as const,
    mimeType: "image/png",
    size: 4,
    sha256: "",
    fileName: "asset.png",
  };
  const body = Buffer.from("test");
  attachment.sha256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  const item = {
    module: "products" as const,
    itemRef: "item-001",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    contentHash: "",
    record: { asin: "B000TEST01", productTitle: "Test product", tags: ["home"] },
    attachments: [attachment],
  };
  item.contentHash = contentHashForItem(item);
  return {
    format: PRODUCT_KNOWLEDGE_TRANSFER_FORMAT,
    formatVersion: PRODUCT_KNOWLEDGE_TRANSFER_VERSION,
    exportedAt: "2026-08-27T00:00:00.000Z",
    source: { application: "amazon-listing-tool", packageLabel: "产品知识库完整包" },
    filter: { modules: ["products"], dateField: "updated_at" },
    counts: { items: 1, embeddedAttachments: 1, externalReferences: 0 },
    isComplete: true,
    items: [item],
  };
}

describe("productKnowledgeTransfer contract", () => {
  it("generates deterministic content hashes despite record key order", () => {
    const first = { module: "listings" as const, record: { asin: "B001", title: "A" }, attachments: [] };
    const second = { module: "listings" as const, record: { title: "A", asin: "B001" }, attachments: [] };
    expect(contentHashForItem(first)).toBe(contentHashForItem(second));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("accepts a self-consistent complete package", () => {
    const manifest = createManifest();
    const manifestBuffer = Buffer.from(JSON.stringify(manifest));
    const attachmentBody = Buffer.from("test");
    const integrity = buildIntegrity(manifestBuffer, [{ path: "attachments/images/asset-001.png", body: attachmentBody }]);
    const files = new Map([
      [PRODUCT_KNOWLEDGE_TRANSFER_MANIFEST_PATH, manifestBuffer],
      [PRODUCT_KNOWLEDGE_TRANSFER_INTEGRITY_PATH, Buffer.from(JSON.stringify(integrity))],
      ["attachments/images/asset-001.png", attachmentBody],
    ]);
    integrity.files.push({
      path: PRODUCT_KNOWLEDGE_TRANSFER_INTEGRITY_PATH,
      size: files.get(PRODUCT_KNOWLEDGE_TRANSFER_INTEGRITY_PATH)!.length,
      sha256: "", // the integrity file is intentionally not self-checksummed
    });
    integrity.files.pop();
    expect(validatePackageContract(manifest, integrity, new Map([
      [PRODUCT_KNOWLEDGE_TRANSFER_MANIFEST_PATH, manifestBuffer],
      ["attachments/images/asset-001.png", attachmentBody],
    ]))).toMatchObject({ itemCount: 1, attachmentCount: 1 });
  });

  it("rejects traversal paths and modified attachment bytes", () => {
    expect(() => assertSafeTransferPath("../secrets.txt")).toThrow(/路径穿越/);
    expect(() => assertSafeTransferPath("attachments\\evil.txt")).toThrow(/不安全/);

    const manifest = createManifest();
    const manifestBuffer = Buffer.from(JSON.stringify(manifest));
    const integrity = buildIntegrity(manifestBuffer, [{ path: "attachments/images/asset-001.png", body: Buffer.from("test") }]);
    expect(() => validatePackageContract(manifest, integrity, new Map([
      [PRODUCT_KNOWLEDGE_TRANSFER_MANIFEST_PATH, manifestBuffer],
      ["attachments/images/asset-001.png", Buffer.from("changed")],
    ]))).toThrow(/完整性校验失败/);
  });

  it("rejects externally referenced attachments from a required complete package", () => {
    const manifest = createManifest();
    manifest.isComplete = false;
    manifest.counts.externalReferences = 1;
    manifest.items[0]!.attachments = [{
      path: null,
      field: "videoUrl",
      status: "external_reference",
      mimeType: null,
      size: null,
      sha256: null,
      fileName: null,
      note: "源系统只保存外部链接",
    }];
    manifest.items[0]!.contentHash = contentHashForItem(manifest.items[0]!);
    const manifestBuffer = Buffer.from(JSON.stringify(manifest));
    const integrity = buildIntegrity(manifestBuffer, []);
    expect(() => validatePackageContract(manifest, integrity, new Map([
      [PRODUCT_KNOWLEDGE_TRANSFER_MANIFEST_PATH, manifestBuffer],
    ]))).toThrow(/未嵌入/);
  });
});
