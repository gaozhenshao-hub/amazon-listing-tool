import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: [] as unknown[][], db: vi.fn() }));
vi.mock("./domains/listing/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/listing/repository")>();
  return { ...actual, getDb: state.db };
});
import { resolveConfirmedListingCore } from "./domains/listing/services/listingConfirmedCore";
const hash = "a".repeat(64);
const core = { id: 12, coreId: "d66ca938-9146-4767-88c5-397039296153", projectId: 3, workspaceId: 7,
  confirmedBy: 9, confirmedAt: new Date(), status: "confirmed", inputHash: hash, factRevisionIdsJson: [22],
  sellingPointIndex: 0, buyerReason: "Easy everyday setup" };
const fact = { id: 22, projectId: 3, workspaceId: 7, status: "confirmed", confirmedBy: 9,
  confirmedAt: new Date(), sourceFileId: 31, rawHash: hash, attributeKey: "Width", value: "25 cm" };
const file = { id: 31, hash, workspaceId: 7, status: "completed", lifecycleState: "hot" };
const makeBuilder = (data: unknown[]) => {
  const builder: any = { from: () => builder, where: () => builder, orderBy: () => builder,
    limit: async () => data, then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(data).then(resolve) };
  return builder;
};
const input = { projectId: 3, workspaceId: 7, coreRevisionId: 12, coreInputHash: hash };

describe("confirmed core selected fact boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); state.data = [[core], [{ id: 12 }], [fact], [file]];
    state.db.mockImplementation(async () => ({ select: () => makeBuilder(state.data.shift() || []) })); });
  it("reconstructs model input only from current human-confirmed fact values", async () => {
    const result = await resolveConfirmedListingCore(input);
    expect(result.sellingPoint.description).toBe("Width: 25 cm");
    expect(result.sellingPoint.fabeDirection.evidence).toBe("Width: 25 cm");
    expect(result.sellingPoint.targetKeywords).toEqual([]);
  });
  it("rejects a superseded core revision even if browser retained its id and hash", async () => {
    state.data[1] = [{ id: 13 }];
    await expect(resolveConfirmedListingCore(input)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rejects a source file that was replaced after human review", async () => {
    state.data[3] = [{ ...file, id: 32, hash: "b".repeat(64) }];
    await expect(resolveConfirmedListingCore(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it.each([
    { workspaceId: null, status: "completed", lifecycleState: "hot" },
    { workspaceId: 7, status: "parsed", lifecycleState: "hot" },
    { workspaceId: 7, status: "completed", lifecycleState: "deleted" },
  ])("rejects an unscoped or incomplete latest raw upload: %j", async (fileStatus) => {
    state.data[3] = [{ ...file, ...fileStatus }];
    await expect(resolveConfirmedListingCore(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("rejects unconfirmed fact even if old core is still marked confirmed", async () => {
    state.data[2] = [{ ...fact, status: "stale" }];
    await expect(resolveConfirmedListingCore(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("rejects a cross-project core before any model input is assembled", async () => {
    state.data[0] = [];
    await expect(resolveConfirmedListingCore(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
