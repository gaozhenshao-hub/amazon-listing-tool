import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ storageGet: vi.fn(), safeHttpRequest: vi.fn() }));
vi.mock("./storage", () => ({
  parseStorageUri: (uri: string) => uri.startsWith("storage://s3/") ? { provider: "s3", key: uri.slice(13) } : null,
  storageGet: mocks.storageGet,
}));
vi.mock("./infrastructure/http/safeHttpClient", () => ({ safeHttpRequest: mocks.safeHttpRequest }));

import { readCompleteAttributeText } from "./domains/listing/services/listingRawAttributeSource";

const sourceHash = (value: string) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storageGet.mockResolvedValue({ url: "https://storage.example.test/a?token=redacted" });
});

describe("完整原始产品属性读取", () => {
  it("短原文只读数据库内容，不请求外部存储", async () => {
    expect(await readCompleteAttributeText({ rawContent: "Power: [如：1200W]" }, 1)).toBe("Power: [如：1200W]");
    expect(mocks.storageGet).not.toHaveBeenCalled();
  });
  it("4KB预览不可代替原文，受控下载后验证hash并读取尾部示例", async () => {
    const full = "A".repeat(4_000) + "\nPower: 1200W (example)";
    mocks.safeHttpRequest.mockResolvedValue({ ok: true, text: () => Promise.resolve(full) });
    const result = await readCompleteAttributeText({ rawContent: full.slice(0, 4_000),
      rawContentHash: sourceHash(full), rawStorageUri: "storage://s3/project/attr" }, 2);
    expect(result).toContain("Power: 1200W (example)");
    expect(mocks.storageGet).toHaveBeenCalledOnce();
    expect(mocks.safeHttpRequest.mock.calls[0][1]).toMatchObject({ method: "GET", maxResponseBytes: 2 * 1024 * 1024,
      auditContext: { workspaceId: 2, operation: "listing.product_attribute_source.read" } });
  });
  it("与上传解析一致地规范化Windows CRLF后再核验hash和原文", async () => {
    const original = "  " + "A".repeat(4_000) + "\r\nPower: 1200W (example)  ";
    const normalized = original.replace(/\r\n?/gu, "\n").trim();
    mocks.safeHttpRequest.mockResolvedValue({ ok: true, text: () => Promise.resolve(original) });
    expect(await readCompleteAttributeText({ rawContent: normalized.slice(0, 4_000),
      rawContentHash: sourceHash(normalized), rawStorageUri: "storage://s3/project/attr" }, 2)).toBe(normalized);
  });
  it("无完整存储、非受控URI和hash不符均停止，绝不将截断预览送模型", async () => {
    const preview = "A".repeat(4_000);
    await expect(readCompleteAttributeText({ rawContent: preview }, 1)).rejects.toThrow(/截断预览/);
    await expect(readCompleteAttributeText({ rawContent: preview, rawStorageUri: "https://wrong.example.test", rawContentHash: "x" }, 1))
      .rejects.toThrow(/不受控/);
    mocks.safeHttpRequest.mockResolvedValue({ ok: true, text: () => Promise.resolve(preview + "other") });
    await expect(readCompleteAttributeText({ rawContent: preview, rawStorageUri: "storage://s3/project/attr", rawContentHash: "x" }, 1))
      .rejects.toThrow(/指纹不匹配/);
  });
});
