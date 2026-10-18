import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import "../../shared/productTaskRead.test";
const mock = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
vi.mock("../domains/ops/productTaskReadRepository", () => ({ productTaskReadRepository: mock }));
import { productTaskReadRouter } from "./productTaskRead";
const ctx = { user: { id: 3, role: "ops_manager", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const input = { expectedWorkspaceId: 7, product: null, association: "all" as const, assigneeId: null, unassignedOnly: false, status: null, category: null, search: "", groupBy: "none" as const, cursor: null, limit: 20 };
const detail = { expectedWorkspaceId: 7, taskId: 11, attachmentCursor: null, attachmentLimit: 20 };
beforeEach(() => { vi.clearAllMocks(); mock.list.mockResolvedValue({ status: "ready" }); mock.detail.mockResolvedValue({ status: "ready" }); });
describe("productTaskRead protected query-only surface", () => {
  it("exposes only list and detail, with no directory expansion, mutations or object URL endpoint", async () => {
    expect(Object.keys(productTaskReadRouter._def.procedures)).toEqual(["list", "detail"]);
    expect(Object.values(productTaskReadRouter._def.procedures).every(procedure => procedure._def.type === "query")).toBe(true);
    expect(await productTaskReadRouter.createCaller(ctx).list(input)).toEqual({ status: "ready" }); expect(mock.list).toHaveBeenCalledWith(ctx, input);
    expect(await productTaskReadRouter.createCaller(ctx).detail(detail)).toEqual({ status: "ready" }); expect(mock.detail).toHaveBeenCalledWith(ctx, detail);
  });
  it("rejects no-login callers", async () => {
    const caller = productTaskReadRouter.createCaller({ ...ctx, user: null }); await expect(caller.list(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); await expect(caller.detail(detail)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(mock.list).not.toHaveBeenCalled(); expect(mock.detail).not.toHaveBeenCalled();
  });
  it.each([{ ownerIds: [3] }, { partnerIds: [9] }, { userId: 3 }, { role: "admin" }, { refresh: true }, { title: "write" }, { payload: {} }, { storageRef: "secret" }])("rejects list caller authority or mutation fields %j", async patch => {
    await expect(productTaskReadRouter.createCaller(ctx).list({ ...input, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.list).not.toHaveBeenCalled();
  });
  it.each([{ assigneeId: 9 }, { workspaceId: 7 }, { url: "https://example.test" }, { fileId: 5 }, { status: "done" }])("rejects detail caller authority, object URL and write fields %j", async patch => {
    await expect(productTaskReadRouter.createCaller(ctx).detail({ ...detail, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.detail).not.toHaveBeenCalled();
  });
  it.each([{ expectedWorkspaceId: null }, { limit: 51 }, { limit: 0 }, { status: "unknown" }, { search: "x".repeat(201) }, { product: { workspaceId: 8, parentAsin: "P", storeName: "S", country: "US" } }, { cursor: { id: 1, createdAt: "2026-02-30 00:00:00.000000" } }])("rejects invalid list input %j", async patch => {
    await expect(productTaskReadRouter.createCaller(ctx).list({ ...input, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.list).not.toHaveBeenCalled();
  });
  it.each(["backlog", "todo", "in_progress", "review", "done"] as const)("retains original %s status", async status => {
    await productTaskReadRouter.createCaller(ctx).list({ ...input, status }); expect(mock.list).toHaveBeenCalledWith(ctx, { ...input, status });
  });
  it("canonicalizes country and parent without merging store identity", async () => {
    await productTaskReadRouter.createCaller(ctx).list({ ...input, product: { workspaceId: 7, parentAsin: "b000000001", storeName: "Exact Store", country: "美国站" } });
    expect(mock.list).toHaveBeenCalledWith(ctx, { ...input, product: { workspaceId: 7, parentAsin: "B000000001", storeName: "Exact Store", country: "US" } });
  });
});
