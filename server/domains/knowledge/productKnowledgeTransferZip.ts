import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { finished } from "node:stream/promises";
import { ZipArchive } from "archiver";
import yauzl from "yauzl";
import {
  PRODUCT_KNOWLEDGE_TRANSFER_INTEGRITY_PATH,
  PRODUCT_KNOWLEDGE_TRANSFER_LIMITS,
  PRODUCT_KNOWLEDGE_TRANSFER_MANIFEST_PATH,
  assertSafeTransferPath,
  buildIntegrity,
  type ProductKnowledgeTransferIntegrity,
  type ProductKnowledgeTransferManifest,
} from "./productKnowledgeTransfer";

export const PRODUCT_KNOWLEDGE_TRANSFER_MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export type TransferArchiveAttachment = {
  path: string;
  body: Buffer;
};

export type ExtractedTransferFile = {
  path: string;
  filePath: string;
  size: number;
  sha256: string;
};

export type ExtractedTransferPackage = {
  tempDir: string;
  manifest: ProductKnowledgeTransferManifest;
  integrity: ProductKnowledgeTransferIntegrity;
  dataFiles: Map<string, ExtractedTransferFile>;
};

function parseJson<T>(body: Buffer, label: string): T {
  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    throw new Error(`知识包${label}不是有效JSON`);
  }
}

function archiveToBuffer(
  manifestBuffer: Buffer,
  integrityBuffer: Buffer,
  attachments: TransferArchiveAttachment[],
): Promise<Buffer> {
  return new Promise((resolveArchive, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on("error", reject);
    archive.on("warning", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") reject(error);
    });
    archive.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    archive.on("end", () => resolveArchive(Buffer.concat(chunks)));
    archive.append(manifestBuffer, { name: PRODUCT_KNOWLEDGE_TRANSFER_MANIFEST_PATH });
    archive.append(integrityBuffer, { name: PRODUCT_KNOWLEDGE_TRANSFER_INTEGRITY_PATH });
    for (const attachment of attachments) {
      assertSafeTransferPath(attachment.path);
      archive.append(attachment.body, { name: attachment.path });
    }
    void archive.finalize();
  });
}

export async function createProductKnowledgeTransferZip(
  manifest: ProductKnowledgeTransferManifest,
  attachments: TransferArchiveAttachment[],
): Promise<{ body: Buffer; integrity: ProductKnowledgeTransferIntegrity }> {
  const uniquePaths = new Set<string>();
  for (const attachment of attachments) {
    assertSafeTransferPath(attachment.path);
    if (uniquePaths.has(attachment.path)) throw new Error("知识包附件路径重复");
    uniquePaths.add(attachment.path);
  }
  const manifestBuffer = Buffer.from(JSON.stringify(manifest), "utf8");
  if (manifestBuffer.length > PRODUCT_KNOWLEDGE_TRANSFER_LIMITS.maxManifestBytes) {
    throw new Error("知识包清单超过安全上限");
  }
  const integrity = buildIntegrity(manifestBuffer, attachments);
  const body = await archiveToBuffer(manifestBuffer, Buffer.from(JSON.stringify(integrity), "utf8"), attachments);
  if (body.length > PRODUCT_KNOWLEDGE_TRANSFER_MAX_UPLOAD_BYTES) {
    throw new Error("完整知识包超过512MB上传上限，请缩小模块或日期范围后分批导出");
  }
  return { body, integrity };
}

function openZip(archivePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolveZip, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, validateEntrySizes: true, autoClose: true }, (error, zipFile) => {
      if (error || !zipFile) reject(error ?? new Error("无法打开知识包ZIP"));
      else resolveZip(zipFile);
    });
  });
}

function openReadStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolveStream, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error("无法读取知识包文件"));
      else resolveStream(stream);
    });
  });
}

async function extractEntry(
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry,
  destination: string,
): Promise<{ size: number; sha256: string }> {
  const input = await openReadStream(zipFile, entry);
  const output = createWriteStream(destination, { flags: "wx" });
  const digest = createHash("sha256");
  let size = 0;
  input.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > PRODUCT_KNOWLEDGE_TRANSFER_LIMITS.maxSingleFileBytes) {
      input.destroy(new Error("知识包单个文件超过安全上限"));
      return;
    }
    digest.update(chunk);
  });
  input.pipe(output);
  await finished(output);
  if (size !== entry.uncompressedSize) throw new Error("知识包文件长度与目录记录不一致");
  return { size, sha256: digest.digest("hex") };
}

/**
 * Extracts only into a per-request tmp directory. Every archive entry is
 * validated before it can influence a filesystem path. Call cleanupExtracted
 * in a finally block after attachment staging is completed.
 */
export async function extractProductKnowledgeTransferZip(archivePath: string): Promise<ExtractedTransferPackage> {
  const archiveStat = await stat(archivePath);
  if (archiveStat.size === 0 || archiveStat.size > PRODUCT_KNOWLEDGE_TRANSFER_MAX_UPLOAD_BYTES) {
    throw new Error("知识包大小无效或超过512MB上传上限");
  }
  const tempDir = await mkdtemp(join(tmpdir(), "product-kb-transfer-"));
  const files = new Map<string, ExtractedTransferFile>();
  let totalBytes = 0;
  let entryCount = 0;
  try {
    const zipFile = await openZip(archivePath);
    await new Promise<void>((resolveEntries, rejectEntries) => {
      zipFile.on("error", rejectEntries);
      zipFile.on("entry", async (entry: yauzl.Entry) => {
        try {
          entryCount += 1;
          if (entryCount > PRODUCT_KNOWLEDGE_TRANSFER_LIMITS.maxArchiveFiles + 1) {
            throw new Error("知识包文件数量超过安全上限");
          }
          if (entry.fileName.endsWith("/")) throw new Error("知识包不允许目录条目");
          assertSafeTransferPath(entry.fileName);
          if (files.has(entry.fileName)) throw new Error("知识包包含重复文件路径");
          if (entry.uncompressedSize > PRODUCT_KNOWLEDGE_TRANSFER_LIMITS.maxSingleFileBytes) {
            throw new Error("知识包单个文件超过安全上限");
          }
          totalBytes += entry.uncompressedSize;
          if (totalBytes > PRODUCT_KNOWLEDGE_TRANSFER_LIMITS.maxUncompressedBytes) {
            throw new Error("知识包解压后体积超过安全上限");
          }
          const destination = resolve(tempDir, entry.fileName);
          if (!destination.startsWith(`${tempDir}${sep}`)) throw new Error("知识包包含路径穿越条目");
          await mkdir(dirname(destination), { recursive: true });
          const digest = await extractEntry(zipFile, entry, destination);
          files.set(entry.fileName, { path: entry.fileName, filePath: destination, ...digest });
          zipFile.readEntry();
        } catch (error) {
          zipFile.close();
          rejectEntries(error);
        }
      });
      zipFile.on("end", resolveEntries);
      zipFile.readEntry();
    });

    const manifestFile = files.get(PRODUCT_KNOWLEDGE_TRANSFER_MANIFEST_PATH);
    const integrityFile = files.get(PRODUCT_KNOWLEDGE_TRANSFER_INTEGRITY_PATH);
    if (!manifestFile || !integrityFile) throw new Error("知识包必须包含manifest.json和integrity.json");
    if (manifestFile.size > PRODUCT_KNOWLEDGE_TRANSFER_LIMITS.maxManifestBytes || integrityFile.size > PRODUCT_KNOWLEDGE_TRANSFER_LIMITS.maxManifestBytes) {
      throw new Error("知识包清单超过安全上限");
    }
    const manifest = parseJson<ProductKnowledgeTransferManifest>(await readFile(manifestFile.filePath), "manifest");
    const integrity = parseJson<ProductKnowledgeTransferIntegrity>(await readFile(integrityFile.filePath), "完整性清单");
    if (integrity.files.some((file) => file.path === PRODUCT_KNOWLEDGE_TRANSFER_INTEGRITY_PATH)) {
      throw new Error("知识包完整性清单不得校验自身");
    }
    const dataFiles = new Map(files);
    dataFiles.delete(PRODUCT_KNOWLEDGE_TRANSFER_INTEGRITY_PATH);
    return { tempDir, manifest, integrity, dataFiles };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export async function materializeExtractedFiles(files: Map<string, ExtractedTransferFile>): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  for (const [path, file] of files) {
    result.set(path, await readFile(file.filePath));
  }
  return result;
}

export async function cleanupExtractedTransferPackage(extracted: Pick<ExtractedTransferPackage, "tempDir">): Promise<void> {
  await rm(extracted.tempDir, { recursive: true, force: true });
}

export async function sha256File(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

export function fileNameForTransferPackage(exportedAt: Date): string {
  return `product-knowledge-transfer-${exportedAt.toISOString().replace(/[:.]/g, "-")}.zip`;
}

export function attachmentPath(module: string, itemRef: string, field: string, originalFileName?: string | null): string {
  const safeFileName = basename(originalFileName || "attachment.bin")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "") || "attachment.bin";
  const safeField = field.replace(/[^A-Za-z0-9_-]/g, "-");
  const path = `attachments/${module}/${itemRef}/${safeField}-${safeFileName}`;
  assertSafeTransferPath(path);
  return path;
}
