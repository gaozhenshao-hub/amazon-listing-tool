import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../_core/context";

const board = vi.hoisted(() => ({ state: vi.fn(), read: vi.fn(), history: vi.fn(), preview: vi.fn(), execute: vi.fn(), saveNote: vi.fn(), recover: vi.fn() }));
const partners = vi.hoisted(() => ({ options: vi.fn(), execute: vi.fn(), recover: vi.fn() }));
vi.mock("../domains/ops/operationsBoardRepository", () => ({ operationsBoardRepository: board }));
vi.mock("../domains/ops/operationsBoardPartnerRepository", () => ({ operationsBoardPartnerRepository: partners }));
import { operationsBoardRouter } from "./operationsBoard";

const identity = { userId: 3, workspaceId: 7 }, scope = { workspaceId: 7, storeName: "SYNTHETIC exact store", country: "US" };
const ctx = { user: { id: 3, role: "admin", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
const operationId = "a0000000-0000-4000-8000-000000000001", hash = "a".repeat(64);
const base = { expectedWorkspaceId: 7, scope: { storeName: scope.storeName, country: scope.country } };
const requests = {
  state: base,
  read: { ...base, editionId: null },
  history: { ...base, cursor: null, limit: 10 },
  preview: { ...base, action: "initialize" as const, originalEditionId: null },
  execute: { ...base, action: "initialize" as const, originalEditionId: null, operationId, expectedStateVersion: 0, expectedSourceHash: hash, expectedPreviewKey: hash },
  saveNote: { ...base, operationId, editionId: 1, parentAsin: "SYNTHETIC-PARENT", note: "完整合成备注\n不在客户端截断", expectedEditionVersion: 1, expectedSourceHash: hash, expectedNoteVersion: 0 },
  recover: { ...base, operationId, decision: "check" as const },
  partnerOptions: { expectedWorkspaceId: 7 },
  setPartner: { expectedWorkspaceId: 7, operationId, firstUserId: 3, secondUserId: 4, isActive: true, expectedVersion: 0 },
  recoverPartner: { expectedWorkspaceId: 7, operationId, decision: "check" as const },
};
type Method = keyof typeof requests;
const names = Object.keys(requests) as Method[];
const state = { scope, version: 0, currentMonth: null, currentEditionId: null, status: "uninitialized" };
const unavailable = { available: false, reasonCode: "not_enabled_before_release" };
const boardUnknown = { identity, scope, operationId, action: null, status: "unknown", requestHash: null, stateVersion: null, editionId: null, editionVersion: null,
  sourceHash: null, parentAsin: null, noteVersion: null, reasonCode: "outcome_unknown_check_same_operation" };
const partnerUnknown = { identity, operationId, status: "unknown", requestHash: null, pair: null, reasonCode: "outcome_unknown_check_same_operation" };
const outputs = {
  state: { identity, scope, request: requests.state, state, capabilities: { initialize: unavailable, publishRevision: unavailable } },
  read: { identity, scope, request: requests.read, state, edition: null, status: "uninitialized", reasonCode: "not_initialized", visibility: "full", authorizationHash: hash,
    rows: [], sources: [], coverage: { complete: true, meaning: "all_currently_authorized_edition_rows", rowCount: 0 }, ownership: null, notes: [], viewKey: hash },
  history: { identity, scope, request: requests.history, state, historyVersion: hash, items: [], page: { nextCursor: null, hasMore: false } },
  preview: { identity, scope, request: requests.preview, state, original: null, targetMonth: null, sourceHash: null, sourceRowCount: null, previewKey: null,
    capability: unavailable, effects: { movesCurrent: true, preservesOriginal: true, copiesNotes: false, createsPastEditions: false } },
  execute: boardUnknown, saveNote: boardUnknown, recover: boardUnknown,
  partnerOptions: { identity, request: requests.partnerOptions, members: [{ userId: 3, displayName: "SYNTHETIC member" }], pairs: [], capability: unavailable },
  setPartner: partnerUnknown, recoverPartner: partnerUnknown,
};
const mockFor = (method: Method) => method === "partnerOptions" ? partners.options : method === "setPartner" ? partners.execute : method === "recoverPartner" ? partners.recover : board[method];
const calls = () => [...Object.values(board), ...Object.values(partners)].reduce((total, mock) => total + mock.mock.calls.length, 0);
beforeEach(() => { vi.resetAllMocks(); for (const method of names) mockFor(method).mockResolvedValue(outputs[method]); });

describe("operations board strict public boundary", () => {
  it("exposes exactly ten explicit procedures; recover is mutation even when checking", () => {
    expect(Object.keys(operationsBoardRouter._def.procedures)).toEqual(names);
    for (const method of names) expect(operationsBoardRouter._def.procedures[method]._def.type).toBe(["state", "read", "history", "preview", "partnerOptions"].includes(method) ? "query" : "mutation");
  });
  it.each(names)("%s forwards its exact parsed request and context to the right repository", async method => {
    const result = await operationsBoardRouter.createCaller(ctx)[method](requests[method] as never);
    expect(result).toEqual(outputs[method]); expect(mockFor(method)).toHaveBeenCalledWith(ctx, requests[method]); expect(calls()).toBe(1);
  });
  it.each(names)("%s rejects missing login before any repository access", async method => {
    await expect(operationsBoardRouter.createCaller({ ...ctx, user: null })[method](requests[method] as never)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(calls()).toBe(0);
  });
  it.each(names)("%s rejects client source snapshots, ownership and authority", async method => {
    for (const patch of [{ capture: {} }, { manager: true }, { ownerIds: [3, 4] }, { userId: 4 }, { actorRole: "super_admin" }, { partnerIds: [4] }, { force: true }, { rows: [] }])
      await expect(operationsBoardRouter.createCaller(ctx)[method]({ ...requests[method], ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls()).toBe(0);
  });
  it.each(names)("%s rejects malformed/missing workspace instead of coercing identity", async method => {
    for (const expectedWorkspaceId of [null, 0, "7", undefined, 2147483648])
      await expect(operationsBoardRouter.createCaller(ctx)[method]({ ...requests[method], expectedWorkspaceId } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls()).toBe(0);
  });
  it.each(names)("%s has strict output validation, never dropping a hidden field and pretending success", async method => {
    for (const patch of [{ capture: { privateRaw: "SYNTHETIC" } }, { manager: true }, { ownerIds: [3] }]) {
      mockFor(method).mockResolvedValue({ ...outputs[method], ...patch });
      await expect(operationsBoardRouter.createCaller(ctx)[method](requests[method] as never)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    }
    mockFor(method).mockResolvedValue({});
    await expect(operationsBoardRouter.createCaller(ctx)[method](requests[method] as never)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
  it.each(names)("%s preserves repository permission denial without calling another procedure", async method => {
    mockFor(method).mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "OPERATIONS_BOARD_ACCESS_RESOURCE_DENIED" }));
    await expect(operationsBoardRouter.createCaller(ctx)[method](requests[method] as never)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(calls()).toBe(1);
  });
});

describe("scope, optimistic versions and original UUID recovery", () => {
  it.each(["state", "read", "history", "preview", "execute", "saveNote", "recover"] as const)("%s rejects nested scope authority and noncanonical country", async method => {
    for (const scope of [{ ...base.scope, workspaceId: 8 }, { ...base.scope, country: "美国" }, { ...base.scope, storeName: "" }, { ...base.scope, ownerIds: [4] }])
      await expect(operationsBoardRouter.createCaller(ctx)[method]({ ...requests[method], scope } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls()).toBe(0);
  });
  it.each(["execute", "saveNote", "recover", "setPartner", "recoverPartner"] as const)("%s never normalizes uppercase or invalid operation IDs", async method => {
    for (const operationId of [requests.execute.operationId.toUpperCase(), "not-a-uuid", null])
      await expect(operationsBoardRouter.createCaller(ctx)[method]({ ...requests[method], operationId } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls()).toBe(0);
  });
  it("requires revision originals while initialization cannot smuggle an old edition", async () => {
    for (const method of ["preview", "execute"] as const) {
      await expect(operationsBoardRouter.createCaller(ctx)[method]({ ...requests[method], action: "publishRevision", originalEditionId: null } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(operationsBoardRouter.createCaller(ctx)[method]({ ...requests[method], originalEditionId: 5 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(calls()).toBe(0);
  });
  it("requires all execute preview/CAS evidence, not a guessed current snapshot", async () => {
    for (const patch of [{ expectedStateVersion: -1 }, { expectedSourceHash: "unsafe" }, { expectedPreviewKey: null }])
      await expect(operationsBoardRouter.createCaller(ctx).execute({ ...requests.execute, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(board.execute).not.toHaveBeenCalled();
  });
  it("notes preserve exact text and permit explicit clear, while rejecting client grant flags", async () => {
    await operationsBoardRouter.createCaller(ctx).saveNote({ ...requests.saveNote, note: "" });
    expect(board.saveNote).toHaveBeenCalledWith(ctx, { ...requests.saveNote, note: "" }); board.saveNote.mockClear();
    for (const patch of [{ note: "a".repeat(3001) }, { canEdit: true }, { expectedEditionVersion: 0 }, { expectedNoteVersion: -1 }])
      await expect(operationsBoardRouter.createCaller(ctx).saveNote({ ...requests.saveNote, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(board.saveNote).not.toHaveBeenCalled();
  });
  it("history carries the exact source-bound cursor and forbids unbounded page sizes", async () => {
    const request = { ...requests.history, cursor: { beforeId: 10, historyVersion: hash }, limit: 50 };
    board.history.mockResolvedValue({ ...outputs.history, request }); await operationsBoardRouter.createCaller(ctx).history(request);
    expect(board.history).toHaveBeenCalledWith(ctx, request); board.history.mockClear();
    for (const patch of [{ limit: 51 }, { limit: 0 }, { cursor: { beforeId: 10 } }, { cursor: { beforeId: 10, historyVersion: "unsafe" } }])
      await expect(operationsBoardRouter.createCaller(ctx).history({ ...requests.history, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(board.history).not.toHaveBeenCalled();
  });
  it.each(["recover", "recoverPartner"] as const)("%s check/cancel forwards original UUID without execute", async method => {
    for (const decision of ["check", "cancel"] as const) {
      await operationsBoardRouter.createCaller(ctx)[method]({ ...requests[method], decision } as never);
      expect(mockFor(method)).toHaveBeenLastCalledWith(ctx, { ...requests[method], decision });
    }
    expect(board.execute).not.toHaveBeenCalled(); expect(partners.execute).not.toHaveBeenCalled();
    for (const patch of [{ decision: "retry" }, { requestHash: hash }, { firstUserId: 3 }, { note: "hidden body" }])
      await expect(operationsBoardRouter.createCaller(ctx)[method]({ ...requests[method], ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("setPartner requires ordered distinct numeric IDs, boolean state and a nonnegative CAS version", async () => {
    for (const patch of [{ firstUserId: 4, secondUserId: 3 }, { firstUserId: 3, secondUserId: 3 }, { firstUserId: "3" }, { isActive: 1 }, { expectedVersion: -1 }, { firstUserName: "not authority" }])
      await expect(operationsBoardRouter.createCaller(ctx).setPartner({ ...requests.setPartner, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(partners.execute).not.toHaveBeenCalled();
  });
  it("a forged result with mismatched workspace is not exposed", async () => {
    for (const method of names) {
      mockFor(method).mockResolvedValue({ ...outputs[method], identity: { ...identity, workspaceId: 8 } });
      // Partner unknown receipts have no request or pair; binding to the input
      // is the repository's responsibility. Exercise all structurally scoped
      // outputs here, not a false claim of router-level request correlation.
      if (method !== "setPartner" && method !== "recoverPartner") await expect(operationsBoardRouter.createCaller(ctx)[method](requests[method] as never)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    }
  });
});
