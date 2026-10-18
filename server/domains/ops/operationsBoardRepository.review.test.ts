import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../_core/context";
import type { DbExecutor } from "../../repositories/dbClient";
import { MONTHLY_FINANCIAL_METRICS, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import type { OperationsBoardEdition, OperationsBoardEditionState, OperationsBoardEditionWriteResult } from "../../../shared/operationsBoardEdition";
import type { OperationsBoardAccessSession } from "./operationsBoardAccess";
import { prepareOperationsBoardHistoryCapture } from "./monthlyBoardHistoryCapture";
import { OperationsBoardNoteStoreError } from "./operationsBoardNoteStore";
import { createOperationsBoardRepository } from "./operationsBoardRepository";

const identity = { workspaceId: 7, userId: 3 };
const scope = { workspaceId: 7, storeName: "SYNTHETIC private shop", country: "US" };
const request = { expectedWorkspaceId: 7, scope: { storeName: scope.storeName, country: scope.country } };
const stamp = "2026-10-18 12:00:00.000000";
const uuid = "eacbcf36-f736-4b21-944f-30f3a88a8067";
function edition(month: string, id: number, archived = false): OperationsBoardEdition {
  const payload = [{ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(metric => [metric, 0])), yearMonth: month,
    parentAsin: "PRIVATE-PARENT", asin: "PRIVATE-CHILD", sku: "PRIVATE-SKU", title: "PRIVATE-TITLE",
    storeName: scope.storeName, site: "US", operator: "PRIVATE-OWNER", raw: { currency: "USD", hidden: "PRIVATE-RAW" } }];
  const batch: MonthlyFinancialBatchRecord = { id, workspaceId: 7, userId: 6, fileName: "PRIVATE-FILE.csv", fileHash: "a".repeat(64), status: "completed",
    totalRows: 1, skippedRows: 0, unallocatedRows: 0, months: [month], payload, createdAt: stamp, confirmedAt: stamp, fileReferenceKind: "storage", sourceRunId: null };
  const capture = prepareOperationsBoardHistoryCapture([batch], 7).capture({ ...request.scope, month });
  return { id, scope, month, revision: 1, version: 1, kind: "original", status: archived ? "archived" : "current", originalEditionId: null,
    sourceHash: capture.sourceHash, createdAt: stamp, updatedAt: stamp, archivedAt: archived ? stamp : null, capture };
}
type Dependencies = NonNullable<Parameters<typeof createOperationsBoardRepository>[0]>;
function fixture() {
  const current = edition("2026-10", 11), historical = edition("2026-09", 9, true);
  const state: OperationsBoardEditionState = { scope, version: 2, currentMonth: current.month, currentEditionId: current.id, status: "current" };
  const execute = vi.fn(async () => [[], []]);
  const tx = { execute } as DbExecutor;
  const session: OperationsBoardAccessSession = { tx, identity, actor: { id: 3, role: "ops_specialist", defaultWorkspaceId: 7 }, role: "ops_specialist",
    manager: false, operation: "read", write: false, authorizationEvidence: { workspaceId: 7, membershipId: 73, directoryHash: "c".repeat(64), grants: ["ops_data:read", "ops_board:read"] }, authorizationHash: "b".repeat(64) };
  const authorize: NonNullable<Dependencies["authorize"]> = vi.fn(async (_tx, input) => ({ ...session, identity: input.identity, operation: input.operation, write: input.write ?? input.operation !== "read" }));
  const authorizeCapture: NonNullable<Dependencies["authorizeCapture"]> = vi.fn(async () => ({ authorizedRows: [], sources: [], responsibleUserIdsByParent: new Map<string, number[]>(), canEditParents: new Set<string>(), authorizationHash: "d".repeat(64), ownership: null, visibility: "scoped" as const }));
  const load = vi.fn(async () => ({ stateId: 1, state, currentEdition: current }));
  const get = vi.fn(async (_scope: unknown, id: number) => id === historical.id ? historical : id === current.id ? current : null);
  const store = vi.fn(() => ({ load, get })) as unknown as NonNullable<Dependencies["store"]>;
  const directForUser = vi.fn(async () => []);
  const partners = vi.fn(() => ({ directForUser })) as unknown as NonNullable<Dependencies["partners"]>;
  const journalRead = vi.fn(async (): Promise<{ final: OperationsBoardEditionWriteResult | null }> => ({ final: null }));
  const finalize = vi.fn(async (value: OperationsBoardEditionWriteResult) => value);
  const journal = vi.fn(() => ({ read: journalRead, finalize })) as unknown as NonNullable<Dependencies["journal"]>;
  const save = vi.fn(async () => { throw new OperationsBoardNoteStoreError("EDIT_DENIED"); });
  const notes = vi.fn(() => ({ save })) as unknown as NonNullable<Dependencies["notes"]>;
  const admit = vi.fn(async () => {}), canUpdate = vi.fn(async () => false);
  const dependencies: Dependencies = { database: async () => ({ transaction: async body => body(tx) }), enabled: () => true,
    authorize, authorizeCapture, admit, canUpdate, store, partners, journal, notes };
  const ctx = { user: { id: 3, defaultWorkspaceId: 7, role: "ops_specialist" }, workspaceId: 7 } as TrpcContext;
  return { current, historical, state, ctx, tx, execute, load, get, store, session, authorize, authorizeCapture, directForUser, partners, journalRead, finalize, save, admit, dependencies,
    repository: createOperationsBoardRepository(dependencies) };
}

describe("independent public archive boundary regressions", () => {
  it("does not reveal an archived edition summary by guessing its ID when zero rows are authorized", async () => {
    const f = fixture();
    const result = await f.repository.read(f.ctx, { ...request, editionId: f.historical.id });
    expect(result).toMatchObject({ status: "not_found", edition: null, rows: [], sources: [], notes: [] });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(f.historical.sourceHash);
    expect(serialized).not.toContain(f.historical.month);
    expect(serialized).not.toContain("PRIVATE-RAW");
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("passes readOnly to the edition adapter and reads neither sources nor mutators", async () => {
    const f = fixture();
    await f.repository.read(f.ctx, { ...request, editionId: 999 });
    expect(f.store).toHaveBeenCalledWith({ tx: f.tx, identity, role: "ops_specialist", readOnly: true });
    expect(f.save).not.toHaveBeenCalled(); expect(f.finalize).not.toHaveBeenCalled();
  });
  it("fails deterministic note owner revocation as forbidden, not as an unknown commit", async () => {
    const f = fixture();
    await expect(f.repository.saveNote(f.ctx, { ...request, operationId: uuid, editionId: f.current.id, parentAsin: "PRIVATE-PARENT", note: "new note",
      expectedEditionVersion: 1, expectedSourceHash: f.current.sourceHash, expectedNoteVersion: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.finalize).not.toHaveBeenCalled();
  });
  it("fails a deterministic note CAS conflict as conflict rather than asking to recover an uncommitted UUID", async () => {
    const f = fixture(); f.save.mockRejectedValue(new OperationsBoardNoteStoreError("STATE_CONFLICT"));
    await expect(f.repository.saveNote(f.ctx, { ...request, operationId: uuid, editionId: f.current.id, parentAsin: "PRIVATE-PARENT", note: "new note",
      expectedEditionVersion: 1, expectedSourceHash: f.current.sourceHash, expectedNoteVersion: 0 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.finalize).not.toHaveBeenCalled();
  });
});
