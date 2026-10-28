import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
const mocks = vi.hoisted(() => ({ job: null as any, update: vi.fn(), set: vi.fn(), where: vi.fn(), retry: vi.fn(), guard: vi.fn() }));
vi.mock("../../repositories/dbClient", () => ({ requireDb: async () => ({ update: mocks.update }),
  withDbTransaction: async (_:string,fn:any) => fn({update:mocks.update,execute:async()=>[[]]}) }));
vi.mock("./collectionRepairState",()=>({assertNoCollectionRepair:mocks.guard}));
vi.mock("./repository", () => ({ getAcquisitionJob: async () => mocks.job }));
vi.mock("./missingAssetRepair", () => ({ enqueueMissingAssetRepair: mocks.retry }));
import { deleteAcquisitionRecord, recollectAcquisitionRecord } from "./jobActions";
const actor = { workspaceId: 1, userId: 7, role: "admin" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.job = { id: 9, asin: "新B0FH1LZLD9", requestedBy: 7, consumerType: "kb_images", status: "confirmed" };
  mocks.update.mockReturnValue({ set: mocks.set });
  mocks.set.mockReturnValue({ where: mocks.where });
  mocks.where.mockResolvedValue([{ affectedRows: 1 }]);
  mocks.guard.mockResolvedValue(undefined);
});
describe("acquisition record actions", () => {
  it("does not hide a record while its missing media is being repaired", async () => {
    mocks.guard.mockRejectedValue(new Error("正在补采"));
    await expect(deleteAcquisitionRecord(actor,9)).rejects.toThrow("正在补采");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("deletes only the history visibility fields, preserving all knowledge data and request identities", async () => {
    await expect(deleteAcquisitionRecord(actor, 9)).resolves.toEqual({ deleted: true });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(getTableName(mocks.update.mock.calls[0][0])).toBe("acquisition_jobs");
    expect(mocks.set).toHaveBeenCalledWith({ deletedAt: expect.any(Date), deletedBy: 7 });
  });
  it.each([{ role: "user" }, { userId: 8 }])("rejects unauthorized deletion %j", async override => {
    await expect(deleteAcquisitionRecord({ ...actor, ...override }, 9)).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([{ status: "running" }, { status: "queued" }, { deletedAt: new Date() }])("rejects actions on unavailable records %j", async override => {
    Object.assign(mocks.job, override);
    await expect(deleteAcquisitionRecord(actor, 9)).rejects.toThrow();
    await expect(recollectAcquisitionRecord(actor, 9, crypto.randomUUID())).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("recollects through the durable batch with the canonical ASIN and a stable request ID", async () => {
    const requestId = crypto.randomUUID();
    await recollectAcquisitionRecord(actor, 9, requestId);
    expect(mocks.retry).toHaveBeenCalledWith({...actor,jobId:9},requestId);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
