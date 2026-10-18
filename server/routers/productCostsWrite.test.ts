import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const mock = vi.hoisted(() => ({ options: vi.fn(), save: vi.fn(), recover: vi.fn() }));
vi.mock("../domains/ops/costSheetWriteRepository", () => ({ costSheetWriteRepository: mock }));
import { productCostsWriteRouter } from "./productCostsWrite";
const ctx = { user: { id: 3, role: "ops_specialist", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const scope = { expectedWorkspaceId: 7, parentAsin: "B000000001", storeName: "Exact store", country: "US" };
const operationId = "11111111-1111-4111-8111-111111111111";
const command = { ...scope, operationId, expectedVersion: 0, expectedSnapshotKey: "a".repeat(64), payload: { settings: { cnyPerCurrency: null, freightRate: 9, standardGoodsConfirmed: false }, rows: [] } };
beforeEach(() => { vi.clearAllMocks(); for (const fn of Object.values(mock)) fn.mockResolvedValue({ status: "committed" }); });
describe("productCostsWrite authenticated minimum complete surface", () => {
  it("has only options query and save/recover mutations", async () => {
    expect(Object.keys(productCostsWriteRouter._def.procedures)).toEqual(["options", "save", "recover"]);
    for (const [key, procedure] of Object.entries(productCostsWriteRouter._def.procedures)) expect(procedure._def.type).toBe(key === "options" ? "query" : "mutation");
    const caller = productCostsWriteRouter.createCaller(ctx);
    await caller.options(scope); await caller.save(command); await caller.recover({ ...scope, operationId, decision: "check" });
    expect(mock.options).toHaveBeenCalledWith(ctx, scope); expect(mock.save).toHaveBeenCalledWith(ctx, command); expect(mock.recover).toHaveBeenCalledTimes(1);
  });
  it.each(["options", "save", "recover"] as const)("rejects anonymous %s", async endpoint => {
    const inputs = { options: scope, save: command, recover: { ...scope, operationId, decision: "check" } };
    await expect((productCostsWriteRouter.createCaller({ ...ctx, user: null })[endpoint] as (value: unknown) => Promise<unknown>)(inputs[endpoint])).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mock[endpoint]).not.toHaveBeenCalled();
  });
  it.each([{ actorId: 4 }, { ownerUserId: 4 }, { role: "admin" }, { workspaceId: 8 }, { force: true }, { saved: {} }])("rejects caller authority/force fields %j", async extra => {
    await expect(productCostsWriteRouter.createCaller(ctx).save({ ...command, ...extra } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mock.save).not.toHaveBeenCalled();
  });
  it.each([{ expectedVersion: -1 }, { expectedVersion: 2147483647 }, { expectedSnapshotKey: "updated-at-only" }, { operationId: "retry-new" }, { payload: { ...command.payload, extra: 1 } }])("rejects invalid save contract %j", async patch => {
    await expect(productCostsWriteRouter.createCaller(ctx).save({ ...command, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("preserves nulls, decimals and canonical country without inventing zero", async () => {
    const input = { ...command, country: "美国", payload: { ...command.payload, rows: [{ key: "SKU-A", productCost: 1.2345, packagingCost: null, actualFreight: null, actualFba: 0, weightKg: null, lengthCm: null, widthCm: null, heightCm: null }] } };
    await productCostsWriteRouter.createCaller(ctx).save(input);
    expect(mock.save).toHaveBeenCalledWith(ctx, { ...input, country: "US" });
  });
  it("requires a concrete check/cancel decision and the same exact scope", async () => {
    await expect(productCostsWriteRouter.createCaller(ctx).recover({ ...scope, operationId, decision: "retry" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await productCostsWriteRouter.createCaller(ctx).recover({ ...scope, operationId, decision: "cancel" });
    expect(mock.recover).toHaveBeenCalledWith(ctx, { ...scope, operationId, decision: "cancel" });
  });
});
