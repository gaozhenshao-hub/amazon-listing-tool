import { randomUUID } from "node:crypto";
import { writeFile, readFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ZipArchive } from "archiver";
import { describe, expect, it } from "vitest";
import {
  PRODUCT_KNOWLEDGE_TRANSFER_FORMAT,
  PRODUCT_KNOWLEDGE_TRANSFER_VERSION,
  contentHashForItem,
  validatePackageFileIndex,
  type ProductKnowledgeTransferManifest,
} from "./productKnowledgeTransfer";
import {
  cleanupExtractedTransferPackage,
  createProductKnowledgeTransferZip,
  extractProductKnowledgeTransferZip,
} from "./productKnowledgeTransferZip";

function manifestWithOneAttachment(): ProductKnowledgeTransferManifest {
  const attachment = {
    path: "attachments/images/item-001/images-0-pic.png",
    field: "imageUrls[0]",
    status: "embedded" as const,
    mimeType: "image/png",
    size: 5,
    sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    fileName: "pic.png",
  };
  const item = {
    module: "products" as const,
    itemRef: "item-001",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    contentHash: "",
    record: { asin: "B000TEST01", productTitle: "Test" },
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

async function writeArchive(entries: Array<{ name: string; body: string }>): Promise<string> {
  const path = join(tmpdir(), `product-transfer-${randomUUID()}.zip`);
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(path);
    const archive = new ZipArchive();
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    for (const entry of entries) archive.append(entry.body, { name: entry.name });
    void archive.finalize();
  });
  return path;
}

describe("productKnowledgeTransfer ZIP", () => {
  it("round-trips a complete package while keeping validation file index based", async () => {
    const manifest = manifestWithOneAttachment();
    const { body } = await createProductKnowledgeTransferZip(manifest, [
      { path: "attachments/images/item-001/images-0-pic.png", body: Buffer.from("hello") },
    ]);
    const path = join(tmpdir(), `product-transfer-${randomUUID()}.zip`);
    await writeFile(path, body);
    const extracted = await extractProductKnowledgeTransferZip(path);
    try {
      const summary = validatePackageFileIndex(
        extracted.manifest,
        extracted.integrity,
        new Map([...extracted.dataFiles.entries()].map(([key, value]) => [key, { size: value.size, sha256: value.sha256 }])),
      );
      expect(summary).toMatchObject({ itemCount: 1, attachmentCount: 1, totalBytes: expect.any(Number) });
      expect(extracted.dataFiles.get("attachments/images/item-001/images-0-pic.png")?.size).toBe(5);
    } finally {
      await cleanupExtractedTransferPackage(extracted);
      await rm(path, { force: true });
    }
  });

  it("rejects Zip Slip filenames before writing them to the temporary extraction directory", async () => {
    const path = await writeArchive([{ name: "outside.txt", body: "blocked" }]);
    // archiver normalizes traversal names. Replace the local and central directory
    // filenames with a same-length traversal name to exercise untrusted ZIP input.
    const archive = await readFile(path);
    const original = Buffer.from("outside.txt");
    const replacement = Buffer.from("../evil.txt");
    for (let index = archive.indexOf(original); index >= 0; index = archive.indexOf(original, index + replacement.length)) {
      replacement.copy(archive, index);
    }
    await writeFile(path, archive);
    await expect(extractProductKnowledgeTransferZip(path)).rejects.toThrow(/路径穿越|invalid relative path/);
    await rm(path, { force: true });
  });

  it("rejects an archive that omits the required integrity manifest", async () => {
    const path = await writeArchive([{ name: "manifest.json", body: "{}" }]);
    await expect(extractProductKnowledgeTransferZip(path)).rejects.toThrow(/必须包含/);
    await rm(path, { force: true });
  });
});
