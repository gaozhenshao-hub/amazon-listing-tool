import { describe, expect, it } from "vitest";
import { ProductTaskWriteExecuteInputSchema, ProductTaskWriteRecoverInputSchema, ProductTaskWriteResultSchema, ProductTaskWriteProductsResultSchema, ProductTaskWriteDownloadResultSchema, productTaskWriteCanonical, productTaskProductKey, PRODUCT_TASK_ATTACHMENT_MAX_BYTES, ProductTaskAttachmentBase64Schema } from "./productTaskWrite";

const identity = { userId: 3, workspaceId: 7 }, operationId = "11ad21b6-18f1-4d4f-8ddf-000000000001", version = "a".repeat(64);
const create = { expectedWorkspaceId: 7, operationId, action: "create", title: "Original", assigneeId: 3, category: "原类别", status: "in_progress", dueDate: "2028-02-29", productKey: null };
const available = { status: "available" as const, reasonCode: null };
const product = { identity: { workspaceId: 7, storeName: "Exact", country: "US", parentAsin: "P" }, profileId: 10, source: "profile" as const, sourceMode: "profile" as const, sourceId: 10, versionKey: version, title: "Product", chineseName: null, imageUrl: null };
const products = () => structuredClone({ identity, request: { expectedWorkspaceId: 7, assigneeId: 3, search: "", offset: 0, limit: 20 }, availability: available, capabilities: { profiles: { ...available }, saihuLatest: { ...available }, numericMappings: { ...available }, manualOwners: { ...available }, members: { ...available } }, coverage: "complete", viewKey: version, items: [{ ...product, key: productTaskProductKey(product) }], page: { offset: 0, limit: 20, total: 1, hasMore: false, nextOffset: null } });
describe("product task write shared contract", () => {
  it.each(["todo", "in_progress", "done"])("accepts original five-state %s and unlinked create", status => expect(ProductTaskWriteExecuteInputSchema.parse({ ...create, status }).status).toBe(status));
  it.each([{ dueDate: "2026-02-29" }, { dueDate: "2026-13-01" }, { dueDate: "" }, { role: "admin" }, { productKey: "profile:10" }, { assigneeId: "3" }, { operationId: "new" }, { title: " " }, { category: "x".repeat(101) }, { status: "finished" }])("rejects invalid create %j", patch => expect(ProductTaskWriteExecuteInputSchema.safeParse({ ...create, ...patch }).success).toBe(false));
  it("accepts a real patch and full old notes without collapsing category or facts", () => {
    const result = ProductTaskWriteExecuteInputSchema.parse({ expectedWorkspaceId: 7, operationId, action: "update", taskId: 10, expectedVersion: version, patch: { category: "旧自定义", completionNotes: "原文\n".repeat(5000), dueDate: null } });
    expect(result.action).toBe("update"); expect(JSON.stringify(result)).toContain("旧自定义");
  });
  it("checks MySQL TEXT bytes rather than JS characters for Chinese and emoji", () => {
    for (const completionNotes of ["中".repeat(21846), "😀".repeat(16384)]) expect(ProductTaskWriteExecuteInputSchema.safeParse({ expectedWorkspaceId: 7, operationId, action: "update", taskId: 1, expectedVersion: version, patch: { completionNotes } }).success).toBe(false);
  });
  it.each([{}, { status: undefined }, { assigneeId: 0 }, { boardProduct: {} }, { completionNotes: "x".repeat(65536) }])("rejects empty or expanded patch %j", patch => expect(ProductTaskWriteExecuteInputSchema.safeParse({ expectedWorkspaceId: 7, operationId, action: "update", taskId: 1, expectedVersion: version, patch }).success).toBe(false));
  it("enforces the decoded 10 MiB bound and strict alphabet", () => {
    expect(ProductTaskAttachmentBase64Schema.safeParse(Buffer.alloc(PRODUCT_TASK_ATTACHMENT_MAX_BYTES).toString("base64")).success).toBe(true);
    expect(ProductTaskAttachmentBase64Schema.safeParse(Buffer.alloc(PRODUCT_TASK_ATTACHMENT_MAX_BYTES + 1).toString("base64")).success).toBe(false);
    for (const value of ["", "AA", "AA==\n", "data:a;base64,AA==", "====", "AAAA="]) expect(ProductTaskAttachmentBase64Schema.safeParse(value).success).toBe(false);
  });
  it.each(["check", "complete_upload", "cancel"])("supports explicit recovery %s without file bodies", decision => expect(ProductTaskWriteRecoverInputSchema.safeParse({ expectedWorkspaceId: 7, operationId, decision }).success).toBe(true));
  it("validates success versions and unknown/cancelled receipts", () => {
    const success = { identity, operationId, action: "create", status: "committed", taskId: 10, attachmentId: null, taskVersion: version, reasonCode: null };
    expect(ProductTaskWriteResultSchema.safeParse(success).success).toBe(true);
    expect(ProductTaskWriteResultSchema.safeParse({ ...success, taskVersion: null }).success).toBe(false);
    expect(ProductTaskWriteResultSchema.safeParse({ ...success, action: "upload" }).success).toBe(false);
    for (const status of ["unknown", "cancelled"]) expect(ProductTaskWriteResultSchema.safeParse({ ...success, status, action: null, taskId: null, taskVersion: null, reasonCode: "unconfirmed" }).success).toBe(true);
  });
  it("binds candidate content, source, store and market in its hash", () => {
    expect(ProductTaskWriteProductsResultSchema.safeParse(products()).success).toBe(true);
    for (const patch of [{ identity: { ...product.identity, country: "CA" } }, { title: "Changed" }, { versionKey: "b".repeat(64) }]) expect(productTaskProductKey({ ...product, ...patch })).not.toBe(productTaskProductKey(product));
  });
  it.each(["scope", "key", "count", "offset", "more", "coverage", "source"])("rejects candidate result mutation %s", kind => {
    const result = products(); if (kind === "scope") result.identity.workspaceId = 8; if (kind === "key") result.items[0].key = "b".repeat(64); if (kind === "count") result.page.total = 2; if (kind === "offset") result.page.offset = 1; if (kind === "more") result.page.hasMore = true; if (kind === "coverage") result.coverage = "unavailable"; if (kind === "source") Object.assign(result.capabilities.profiles, { status: "unavailable", reasonCode: "missing" });
    expect(ProductTaskWriteProductsResultSchema.safeParse(result).success).toBe(false);
  });
  it("allows visibly partial legacy weekly candidates, never complete", () => {
    const result = products(), legacy = { ...product, profileId: null, source: "saihu" as const, sourceMode: "legacy_weekly" as const }; Object.assign(result.items[0], legacy, { key: productTaskProductKey(legacy) });
    expect(ProductTaskWriteProductsResultSchema.safeParse(result).success).toBe(false); result.coverage = "partial"; expect(ProductTaskWriteProductsResultSchema.safeParse(result).success).toBe(true);
  });
  it.each(["http://example.test/a", "https://user:pass@example.test/a", "https://example.test/a#secret"])("rejects unsafe download URL %s", url => expect(ProductTaskWriteDownloadResultSchema.safeParse({ identity, taskId: 1, attachmentId: 2, name: "safe.pdf", url, expiresSeconds: 60 }).success).toBe(false));
  it("canonical content hashes reject non-JSON values and accessors", () => {
    expect(productTaskWriteCanonical({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    for (const value of [undefined, NaN, Infinity, new Date(), { a: undefined }, [, 1], Object.defineProperty({}, "a", { get: () => 1 })]) expect(() => productTaskWriteCanonical(value)).toThrow();
  });
});
