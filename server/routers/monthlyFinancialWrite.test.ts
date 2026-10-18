import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const mock = vi.hoisted(() => ({ options: vi.fn(), upload: vi.fn(), inspect: vi.fn(), confirm: vi.fn(), revoke: vi.fn(), recover: vi.fn(), download: vi.fn() }));
vi.mock("../domains/ops/monthlyFinancialWriteRepository", () => ({ monthlyFinancialWriteRepository: mock }));
import { monthlyFinancialWriteRouter } from "./monthlyFinancialWrite";
const context = { user: { id: 3, role: "ops_manager", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const operationId = "11111111-1111-4111-8111-111111111111", batchVersion = "a".repeat(64);
const mutation = { expectedWorkspaceId: 7, operationId, batchId: 100, expectedBatchVersion: batchVersion, expectedImpactKey: "b".repeat(64), fullScopeAcknowledged: true as const };
const inputs = { options: { expectedWorkspaceId: 7 }, upload: { expectedWorkspaceId: 7, operationId, fileName: "月报.csv", format: "csv" as const, base64: "YWJj" }, inspect: { expectedWorkspaceId: 7, batchId: 100 }, confirm: mutation, revoke: mutation, recover: { expectedWorkspaceId: 7, operationId, decision: "check" as const }, download: { expectedWorkspaceId: 7, batchId: 100, expectedBatchVersion: batchVersion } };
beforeEach(() => { vi.clearAllMocks(); Object.values(mock).forEach(fn => fn.mockResolvedValue({ status: "committed" })); });
describe("monthlyFinancialWrite seven authenticated explicit actions", () => {
  it("uses queries only for options/inspect; recovery and signed download are mutations", async () => {
    expect(Object.keys(monthlyFinancialWriteRouter._def.procedures)).toEqual(Object.keys(inputs));
    for (const [key, procedure] of Object.entries(monthlyFinancialWriteRouter._def.procedures)) expect(procedure._def.type).toBe(["options", "inspect"].includes(key) ? "query" : "mutation");
    await monthlyFinancialWriteRouter.createCaller(context).inspect(inputs.inspect); expect(mock.inspect).toHaveBeenCalledWith(context, { ...inputs.inspect, rowOffset: 0, cellOffset: 0, warningOffset: 0, pageSize: 50 });
  });
  it.each(Object.keys(inputs) as (keyof typeof inputs)[])("rejects anonymous %s", async key => { const caller = monthlyFinancialWriteRouter.createCaller({ ...context, user: null }); await expect((caller[key] as (input: unknown) => Promise<unknown>)(inputs[key])).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(mock[key]).not.toHaveBeenCalled(); });
  it.each([{ userId: 4 }, { ownerUserId: 4 }, { workspaceId: 8 }, { role: "admin" }, { force: true }, { fullScopeAcknowledged: false }, { expectedImpactKey: "stale-time" }, { expectedBatchVersion: "no" }])("rejects injection or missing exact-scope consent %j", async patch => { await expect(monthlyFinancialWriteRouter.createCaller(context).confirm({ ...mutation, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); });
  it.each([{ fileName: "../月报.csv" }, { format: "xlsx" }, { base64: "data:csv;base64,YWJj" }, { rows: [] }, { fileUrl: "https://untrusted.example" }])("rejects unsafe upload contract %j", async patch => { await expect(monthlyFinancialWriteRouter.createCaller(context).upload({ ...inputs.upload, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); });
  it.each(["check", "complete_upload", "cancel"] as const)("uses %s recovery without caller bytes or replacement UUID", async decision => { await monthlyFinancialWriteRouter.createCaller(context).recover({ ...inputs.recover, decision }); expect(mock.recover).toHaveBeenCalledWith(context, { ...inputs.recover, decision }); });
  it("rejects caller-provided object keys and arbitrary URLs for download", async () => { await expect(monthlyFinancialWriteRouter.createCaller(context).download({ ...inputs.download, url: "https://evil.example" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mock.download).not.toHaveBeenCalled(); });
});
