import { createHash } from "node:crypto";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ storageGet: vi.fn(), safeHttpRequest: vi.fn(), db: vi.fn(), select: vi.fn(),
  from: vi.fn(), where: vi.fn(), limit: vi.fn(), files: vi.fn() }));
vi.mock("./repositories/dbClient", () => ({ getDb: mocks.db }));
vi.mock("./domains/listing/repository", () => ({ getDb: mocks.db, getProjectFilesByProject: mocks.files }));
vi.mock("./storage", () => ({
  parseStorageUri: (uri: string) => uri.startsWith("storage://s3/") ? { provider: "s3", key: uri.slice(13) } : null,
  storageGet: mocks.storageGet,
}));
vi.mock("./infrastructure/http/safeHttpClient", () => ({ safeHttpRequest: mocks.safeHttpRequest }));

import { readCompleteAttributeText } from "./domains/listing/services/listingRawAttributeSource";
import { getCurrentRawFactSuggestions } from "./domains/listing/services/listingFactSource";

const sourceHash = (value: string) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storageGet.mockResolvedValue({ url: "https://storage.example.test/a?token=redacted" });
  mocks.db.mockResolvedValue({ select: mocks.select }); mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ where: mocks.where }); mocks.where.mockReturnValue({ limit: mocks.limit }); mocks.limit.mockResolvedValue([]);
});

const fullSource = "用途: " + "A".repeat(4_100) + "\n功率: 1200W";
function inlineFile(full = fullSource) {
  const normalized = full.replace(/\r\n?/gu, "\n").trim();
  return { id: 101, projectId: 11, userId: 3, workspaceId: 7 as number | null, fileType: "product_attributes", rawStorageUri: null,
    rawContent: normalized.slice(0, 4_000), rawContentHash: sourceHash(normalized) };
}
function inlineArtifact(full = fullSource) {
  return { workspaceId: 7 as number | null, domain: "listing", artifactKey: "project_file.product_attributes.raw",
    sourceTable: "projectFiles", sourceRowId: "101", sourceId: "101", projectId: 11, userId: 3, runId: null,
    nodeId: null, status: "final", isCurrent: 1, contentHash: sourceHash(full.replace(/\r\n?/gu, "\n").trim()), contentJsonText: JSON.stringify(full) };
}

describe("事务保存的完整inline属性来源", () => {
  it("按文件、owner和精确workspace读取完整JSON字符串，不调用通用resolver或外网", async () => {
    mocks.limit.mockResolvedValue([inlineArtifact()]);
    expect(await readCompleteAttributeText(inlineFile(), 7)).toBe(fullSource);
    expect(mocks.limit).toHaveBeenCalledWith(2); expect(getTableName(mocks.from.mock.calls[0][0])).toBe("ai_artifacts");
    const dialect = new MySqlDialect(), where = dialect.sqlToQuery(mocks.where.mock.calls[0][0] as SQL);
    for (const field of ["workspaceId", "domain", "artifactKey", "sourceTable", "sourceRowId", "sourceId", "projectId", "userId", "runId", "nodeId", "status", "isCurrent"])
      expect(where.sql).toContain("`ai_artifacts`.`" + field + "`");
    expect(where.params).toEqual([7, "listing", "project_file.product_attributes.raw", "projectFiles", "101", "101", 11, 3, "final", 1]);
    expect(where.sql).toContain("`runId` is null"); expect(where.sql).toContain("`nodeId` is null");
    const cast = dialect.sqlToQuery(mocks.select.mock.calls[0][0].contentJsonText as SQL);
    expect(cast.sql).toBe("CAST(`ai_artifacts`.`contentJson` AS CHAR CHARACTER SET utf8mb4)");
    expect(mocks.storageGet).not.toHaveBeenCalled(); expect(mocks.safeHttpRequest).not.toHaveBeenCalled();
  });

  it("合法NULL workspace使用IS NULL，不能退到共享或其它工作区", async () => {
    mocks.limit.mockResolvedValue([{ ...inlineArtifact(), workspaceId: null }]);
    expect(await readCompleteAttributeText({ ...inlineFile(), workspaceId: null }, null)).toBe(fullSource);
    const where = new MySqlDialect().sqlToQuery(mocks.where.mock.calls[0][0] as SQL);
    expect(where.sql).toContain("`workspaceId` is null"); expect(where.params).not.toContain(null);
    expect(where.params).toEqual(["listing", "project_file.product_attributes.raw", "projectFiles", "101", "101", 11, 3, "final", 1]);
  });

  it("空预览也必须取得完整来源并核验，而不是返回空字符串", async () => {
    mocks.limit.mockResolvedValue([inlineArtifact()]);
    expect(await readCompleteAttributeText({ ...inlineFile(), rawContent: "" }, 7)).toBe(fullSource);
    expect(mocks.limit).toHaveBeenCalledTimes(1);
  });

  it("完整inline原文规范化CRLF和首尾空白后与生产hash一致", async () => {
    const full = "  " + fullSource.replace(/\n/gu, "\r\n") + "\r\n  ";
    mocks.limit.mockResolvedValue([inlineArtifact(full)]);
    expect(await readCompleteAttributeText(inlineFile(full), 7)).toBe(fullSource);
  });

  it("保留原受控存储优先路径，不在下载错误时改找inline内容", async () => {
    mocks.limit.mockResolvedValue([inlineArtifact()]); mocks.safeHttpRequest.mockResolvedValue({ ok: false });
    await expect(readCompleteAttributeText({ ...inlineFile(), rawStorageUri: "storage://s3/project/attr" }, 7)).rejects.toThrow(/暂时不可读取/);
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.limit).not.toHaveBeenCalled();
  });

  it.each([
    { id: 0 }, { id: Number.MAX_SAFE_INTEGER + 1 }, { projectId: 0 }, { userId: 0 }, { workspaceId: 8 },
    { workspaceId: undefined }, { fileType: "competitor_listings" }, { rawContentHash: null }, { rawContentHash: "A".repeat(64) },
  ])("文件身份不完整或scope不符时拒绝且不查询 %j", async patch => {
    await expect(readCompleteAttributeText({ ...inlineFile(), ...patch }, 7)).rejects.toThrow(/截断预览/);
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1])("无效认证workspace %s不能读取inline原文", async workspaceId => {
    await expect(readCompleteAttributeText({ ...inlineFile(), workspaceId }, workspaceId)).rejects.toThrow(/截断预览/);
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it.each([
    { workspaceId: 8 }, { workspaceId: null }, { userId: 99 }, { projectId: 12 }, { sourceTable: "other" },
    { sourceRowId: "102" }, { sourceId: "102" }, { domain: "image" }, { artifactKey: "project_file.product_attributes.analysis" },
    { runId: "foreign-agent" }, { nodeId: "N3" }, { status: "superseded" }, { status: "draft" }, { isCurrent: 0 },
    { contentHash: "b".repeat(64) },
  ])("即使mock/存储返回越界artifact也独立拒绝 %j", async patch => {
    mocks.limit.mockResolvedValue([{ ...inlineArtifact(), ...patch }]);
    await expect(readCompleteAttributeText(inlineFile(), 7)).rejects.toThrow(/截断预览/);
    expect(mocks.storageGet).not.toHaveBeenCalled(); expect(mocks.safeHttpRequest).not.toHaveBeenCalled();
  });

  it("NULL认证scope同样拒绝非NULL artifact", async () => {
    mocks.limit.mockResolvedValue([inlineArtifact()]);
    await expect(readCompleteAttributeText({ ...inlineFile(), workspaceId: null }, null)).rejects.toThrow(/截断预览/);
  });

  it.each([{ rows: [] }, { rows: [inlineArtifact(), inlineArtifact()] }, { rows: null }])("缺失或重复raw artifact不退回截断预览 %#", async ({ rows }) => {
    mocks.limit.mockResolvedValue(rows);
    await expect(readCompleteAttributeText(inlineFile(), 7)).rejects.toThrow(/截断预览/);
    expect(mocks.safeHttpRequest).not.toHaveBeenCalled();
  });

  it.each([null, "bad JSON", "null", "{}", "[]", "false", "0", '""', '"   "'])("无效或空的inline JSON %s不能作为原文", async contentJsonText => {
    mocks.limit.mockResolvedValue([{ ...inlineArtifact(), contentJsonText }]);
    await expect(readCompleteAttributeText(inlineFile(), 7)).rejects.toThrow(/截断预览/);
  });

  it("实际全文hash不符即使两份声明hash相同也拒绝", async () => {
    mocks.limit.mockResolvedValue([{ ...inlineArtifact(), contentJsonText: JSON.stringify(fullSource + "changed") }]);
    await expect(readCompleteAttributeText(inlineFile(), 7)).rejects.toThrow(/指纹不匹配/);
  });

  it("正确全文hash也不能掩盖不匹配的预览前缀", async () => {
    mocks.limit.mockResolvedValue([inlineArtifact()]);
    await expect(readCompleteAttributeText({ ...inlineFile(), rawContent: "X".repeat(4_000) }, 7)).rejects.toThrow(/指纹不匹配/);
  });

  it("全文以UTF8字节而非字符数限制2MiB", async () => {
    const full = "你".repeat(Math.floor(2 * 1024 * 1024 / 3) + 1); mocks.limit.mockResolvedValue([inlineArtifact(full)]);
    await expect(readCompleteAttributeText(inlineFile(full), 7)).rejects.toThrow(/截断预览/);
  });

  it("数据库或查询不可用直接拒绝，不退到预览或外网", async () => {
    mocks.db.mockResolvedValueOnce(null); await expect(readCompleteAttributeText(inlineFile(), 7)).rejects.toThrow(/截断预览/);
    mocks.limit.mockRejectedValue(new Error("offline query failed")); await expect(readCompleteAttributeText(inlineFile(), 7)).rejects.toThrow("offline query failed");
    expect(mocks.safeHttpRequest).not.toHaveBeenCalled();
  });

  it("真实事实消费器读取4000字后的人工事实，仍只提供待审核suggestions", async () => {
    const file = { ...inlineFile(), status: "completed", lifecycleState: "hot", createdAt: new Date("2026-10-16T00:00:00Z") };
    mocks.files.mockResolvedValue([file]); mocks.limit.mockResolvedValue([inlineArtifact()]);
    const result = await getCurrentRawFactSuggestions(11, 7);
    expect(result.status).toBe("reviewable"); expect(result.file).toMatchObject({ id: 101, rawHash: file.rawContentHash });
    expect(result.suggestions).toEqual([expect.objectContaining({ attributeKey: "功率", value: "1200W", sourceLine: 2 })]);
    expect(result.suggestions[0]).not.toHaveProperty("confirmedBy");
    expect(mocks.storageGet).not.toHaveBeenCalled(); expect(mocks.safeHttpRequest).not.toHaveBeenCalled();
  });
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
