import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
// The repo-wide include list excludes shared/, so this focused entry executes
// the pure shared contract tests without changing global test configuration.
import "../../shared/operationsCostSheetRead.test";
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../domains/ops/costSheetReadRepository", () => ({ costSheetReadRepository: { read: mock.read } }));
import { productCostsReadOnlyRouter } from "./productCostsReadOnly";
const ctx = { user: { id: 3, role: "ops_manager", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const input = { parentAsin: "B000000001", storeName: "Exact", country: "US", expectedWorkspaceId: 7 };
beforeEach(() => { vi.clearAllMocks(); mock.read.mockResolvedValue({ status: "not_saved" }); });
describe("dedicated productCostsReadOnly.get", () => {
  it("forwards the exact protected scope to the safe repository", async () => {
    await expect(productCostsReadOnlyRouter.createCaller(ctx).get(input)).resolves.toEqual({ status: "not_saved" });
    expect(mock.read).toHaveBeenCalledWith(ctx, input);
    expect(Object.keys(productCostsReadOnlyRouter._def.procedures)).toEqual(["get"]);
    expect(productCostsReadOnlyRouter._def.procedures.get._def.type).toBe("query");
  });
  it("rejects unauthenticated caller before repository", async () => {
    await expect(productCostsReadOnlyRouter.createCaller({ ...ctx, user: null }).get(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mock.read).not.toHaveBeenCalled();
  });
  it.each([{}, { ...input, expectedWorkspaceId: undefined }, { ...input, expectedWorkspaceId: null }, { ...input, expectedWorkspaceId: 0 }, { ...input, expectedWorkspaceId: "7" },
    { ...input, parentAsin: "" }, { ...input, storeName: "" }, { ...input, country: "" }, { ...input, userId: 9 }, { ...input, asOfDate: "2020-01-01" },
    { ...input, payload: {} }, { ...input, version: 12 }])("rejects incomplete scope or write-like extra input %j", async malformed => {
    await expect(productCostsReadOnlyRouter.createCaller(ctx).get(malformed as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mock.read).not.toHaveBeenCalled();
  });
});
