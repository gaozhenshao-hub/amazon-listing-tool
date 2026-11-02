import { createHash } from "node:crypto";
import { parseStorageUri, storageGet } from "../../../storage";
import { safeHttpRequest } from "../../../infrastructure/http/safeHttpClient";

type RawAttributeFile = {
  rawContent?: string | null;
  rawContentHash?: string | null;
  rawStorageUri?: string | null;
};

/** projectFile.rawContent is only a 4,000-character preview. Never compare AI
 * extraction to that preview if its actual source may extend beyond 4,000. */
export async function readCompleteAttributeText(file: RawAttributeFile, workspaceId: number | null): Promise<string> {
  const preview = file.rawContent || "";
  if (preview.length > 0 && preview.length < 4_000) return preview;
  if (!file.rawStorageUri || !file.rawContentHash) {
    throw new Error("产品属性原始上传仅有截断预览或已失去完整来源；请重新上传或人工核实资料");
  }
  const parsed = parseStorageUri(file.rawStorageUri);
  if (!parsed || !new Set(["forge", "s3", "oss"]).has(parsed.provider)) {
    throw new Error("产品属性原始存储路径不受控，停止事实核验");
  }
  const { url: signedUrl } = await storageGet(parsed.key);
  const url = new URL(signedUrl);
  const response = await safeHttpRequest(url, {
    method: "GET", timeoutMs: 20_000, maxResponseBytes: 2 * 1024 * 1024,
    allowedHosts: [url.hostname],
    auditContext: { workspaceId, operation: "listing.product_attribute_source.read" },
  });
  if (!response.ok) throw new Error("完整属性原文暂时不可读取，停止事实核验");
  const full = await response.text();
  const normalized = full.replace(/\r\n?/gu, "\n").trim();
  const hash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  if (hash !== file.rawContentHash || (preview && !normalized.startsWith(preview))) {
    throw new Error("产品属性原始上传指纹不匹配，停止事实核验");
  }
  return normalized;
}
