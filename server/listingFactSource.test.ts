import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const deps = vi.hoisted(() => ({ files: vi.fn(), raw: vi.fn() }));
vi.mock("./domains/listing/repository", () => ({ getProjectFilesByProject: deps.files }));
vi.mock("./domains/listing/services/listingRawAttributeSource", () => ({ readCompleteAttributeText: deps.raw }));
import { getCurrentRawFactSuggestions } from "./domains/listing/services/listingFactSource";

const hashOf = (text: string) => createHash("sha256").update(JSON.stringify(text)).digest("hex");
const raw = "颜色: 深蓝\n功率：[如：1200W]\n净重：2 kg";
const file = { id: 7, workspaceId: 2, projectId: 3, fileType: "product_attributes", lifecycleState: "hot", status: "completed",
  rawContentHash: hashOf(raw), createdAt: new Date("2026-01-01") };

describe("current product fact suggestions", () => {
  beforeEach(() => { vi.clearAllMocks(); deps.files.mockResolvedValue([file]); deps.raw.mockResolvedValue(raw); });
  it("returns only rows in the current verified upload and never treats templates as confirmed", async () => {
    const result = await getCurrentRawFactSuggestions(3, 2);
    expect(result).toMatchObject({ status: "reviewable", file: { id: 7, rawHash: file.rawContentHash } });
    expect(result.suggestions.map(({ attributeKey }) => attributeKey)).toEqual(["颜色", "净重"]);
    expect(deps.raw).toHaveBeenCalledWith(file, 2);
  });
  it("fails closed for a mismatched workspace or changed raw contents", async () => {
    await expect(getCurrentRawFactSuggestions(3, 9)).rejects.toThrow("工作空间");
    deps.raw.mockResolvedValueOnce("颜色: 红色");
    await expect(getCurrentRawFactSuggestions(3, 2)).rejects.toThrow("原文已变化");
  });
  it("does not reinterpret legacy uploads without their source hash", async () => {
    deps.files.mockResolvedValueOnce([{ ...file, rawContentHash: null }]);
    expect((await getCurrentRawFactSuggestions(3, 2)).status).toBe("legacy_unverified");
    expect(deps.raw).not.toHaveBeenCalled();
  });
  it.each(["uploaded", "parsing", "parsed", "analyzing", "failed"])("blocks latest %s upload instead of falling back to older confirmed content", async (status) => {
    deps.files.mockResolvedValueOnce([{ ...file, id: 8, status }, file]);
    expect((await getCurrentRawFactSuggestions(3, 2)).status).toBe("source_not_ready");
    expect(deps.raw).not.toHaveBeenCalled();
  });
  it("fails closed for unscoped legacy and deleted latest uploads", async () => {
    deps.files.mockResolvedValueOnce([{ ...file, workspaceId: null }]);
    await expect(getCurrentRawFactSuggestions(3, 2)).rejects.toThrow("未绑定当前工作空间");
    deps.files.mockResolvedValueOnce([{ ...file, lifecycleState: "deleted" }, file]);
    expect((await getCurrentRawFactSuggestions(3, 2)).status).toBe("no_source");
    expect(deps.raw).not.toHaveBeenCalled();
  });
});
