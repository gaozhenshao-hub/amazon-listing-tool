import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const mock = vi.hoisted(() => ({ options: vi.fn(), products: vi.fn(), execute: vi.fn(), recover: vi.fn(), download: vi.fn() }));
vi.mock("../domains/ops/productTaskWriteRepository", () => ({ productTaskWriteRepository: mock }));
import { productTaskWriteRouter } from "./productTaskWrite";
const ctx = { user: { id: 3, role: "ops_specialist", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const operationId = "11111111-1111-4111-8111-111111111111";
const command = { expectedWorkspaceId: 7, operationId, action: "create" as const, title: "真实创建", assigneeId: 3, category: "自定义类型", status: "todo" as const, dueDate: null, productKey: null };
beforeEach(() => { vi.clearAllMocks(); for (const fn of Object.values(mock)) fn.mockResolvedValue({ status: "committed" }); });
describe("productTaskWrite exact authenticated surface", () => {
  it("routes the complete five endpoints without adding task deletion or reassignment", async () => {
    expect(Object.keys(productTaskWriteRouter._def.procedures)).toEqual(["options", "products", "execute", "recover", "download"]);
    for (const [key, procedure] of Object.entries(productTaskWriteRouter._def.procedures)) expect(procedure._def.type).toBe(["options", "products"].includes(key) ? "query" : "mutation");
    const caller = productTaskWriteRouter.createCaller(ctx);
    await caller.options({ expectedWorkspaceId: 7 }); await caller.products({ expectedWorkspaceId: 7, assigneeId: 3, search: "", offset: 0, limit: 20 }); await caller.execute(command); await caller.recover({ expectedWorkspaceId: 7, operationId, decision: "check" }); await caller.download({ expectedWorkspaceId: 7, taskId: 11, attachmentId: 31 });
    for (const fn of Object.values(mock)) expect(fn).toHaveBeenCalledTimes(1); expect(mock.execute).toHaveBeenCalledWith(ctx, command);
  });
  it.each(["options", "products", "execute", "recover", "download"] as const)("rejects unauthenticated %s", async endpoint => {
    const inputs = { options: { expectedWorkspaceId: 7 }, products: { expectedWorkspaceId: 7, assigneeId: 3, search: "", offset: 0, limit: 20 }, execute: command, recover: { expectedWorkspaceId: 7, operationId, decision: "check" }, download: { expectedWorkspaceId: 7, taskId: 11, attachmentId: 31 } };
    await expect((productTaskWriteRouter.createCaller({ ...ctx, user: null })[endpoint] as (input: unknown) => Promise<unknown>)(inputs[endpoint])).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(mock[endpoint]).not.toHaveBeenCalled();
  });
  it.each([{ userId: 4 }, { all: true }, { role: "admin" }, { boardProduct: {} }, { productProfileId: 12 }, { source: "saihu" }, { reminders: true }])("rejects caller-supplied authority or snapshot %j", async patch => { await expect(productTaskWriteRouter.createCaller(ctx).execute({ ...command, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); });
  it.each(["todo", "in_progress", "done"] as const)("preserves %s without collapsing", async status => { await productTaskWriteRouter.createCaller(ctx).execute({ ...command, status }); expect(mock.execute).toHaveBeenCalledWith(ctx, { ...command, status }); });
  it("requires full version for update, upload and attachment deletion", async () => {
    for (const value of [{ action: "update", patch: { title: "x" } }, { action: "upload", name: "x.txt", base64: "eA==" }, { action: "deleteAttachment", attachmentId: 31 }]) await expect(productTaskWriteRouter.createCaller(ctx).execute({ expectedWorkspaceId: 7, operationId, taskId: 11, ...value } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
