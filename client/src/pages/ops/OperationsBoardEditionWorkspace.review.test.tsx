// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationsBoardEditionReadResultSchema, type OperationsBoardEditionReadResult } from "@shared/operationsBoardEdition";
import { OperationsBoardEditionWorkspaceController } from "./OperationsBoardEditionWorkspace";
import { publishBoardEditionChange } from "./operationsBoardEditionClientState";
import { syntheticOperationsBoardEdition } from "./operationsBoardEditionView.fixture";

const controls = vi.hoisted(() => ({ state: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { operationsBoard: {
  state: { query: controls.state }, read: { query: controls.read },
} } }) } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isLoading: false, canRead: () => true }) }));
vi.mock("./OperationsBoardPartnerEditor", () => ({ OperationsBoardPartnerEditor: () => null }));

const owner = { userId: 7, workspaceId: 11, role: "ops_specialist" };
const scope = { storeName: "SYNTHETIC 合成店铺", country: "US" };
const draftText = "SYNTHETIC 私有待保存草稿";
beforeEach(() => { controls.state.mockReset(); controls.read.mockReset(); localStorage.clear(); });
afterEach(cleanup);

function serve(value: OperationsBoardEditionReadResult) {
  controls.state.mockImplementation(async (request: unknown) => ({ identity: value.identity, scope: value.scope, request,
    state: value.state, capabilities: { initialize: { available: false, reasonCode: "already_initialized" }, publishRevision: { available: false, reasonCode: "writes_not_enabled" } } }));
  controls.read.mockResolvedValueOnce(value);
}
async function openDraft(groups = 1) {
  const synthetic = syntheticOperationsBoardEdition({ archived: false, groups });
  const initial = OperationsBoardEditionReadResultSchema.parse({ ...synthetic, visibility: "scoped",
    ownership: { ...synthetic.ownership, visibility: "scoped" }, notes: synthetic.notes.map(note => ({ ...note, editBasis: "responsible" })),
  });
  serve(initial);
  render(<OperationsBoardEditionWorkspaceController owner={owner} scope={scope} renderContent={(_result, renderNote) => renderNote("P00")} />);
  fireEvent.click(screen.getByRole("button", { name: "读取当前看板版本" }));
  fireEvent.click(await screen.findByRole("button", { name: "填写 / 编辑 · P00" }));
  const text = screen.getByRole("textbox", { name: "版本利润变化原因" });
  expect(text).toHaveValue("SYNTHETIC 已保存备注");
  fireEvent.change(text, { target: { value: draftText } });
  return initial;
}
async function refreshNote(value: OperationsBoardEditionReadResult) {
  serve(value);
  publishBoardEditionChange({ workspaceId: 11, scope, action: "partners" });
  fireEvent.click(await screen.findByRole("button", { name: "读取当前版本对照（保留草稿）" }));
  await waitFor(() => expect(controls.read).toHaveBeenCalledTimes(2));
}

describe("independent successful-read revocation review", () => {
  it("hides an opened private note when a fresh successful read no longer authorizes that edition", async () => {
    const initial = await openDraft();
    const hidden = OperationsBoardEditionReadResultSchema.parse({ ...initial,
      request: { ...initial.request, editionId: initial.edition!.id }, edition: null, status: "not_found", reasonCode: "edition_not_found",
      rows: [], sources: [], notes: [], ownership: null, coverage: { ...initial.coverage, rowCount: 0 }, viewKey: "f".repeat(64),
    });
    await refreshNote(hidden);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "版本利润变化原因" })).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue(draftText)).not.toBeInTheDocument();
  });
  it("hides the old note when the same edition remains readable only for another parent", async () => {
    const initial = await openDraft(2), rows = initial.rows.filter(row => row.parentAsin === "P01");
    const narrowed = OperationsBoardEditionReadResultSchema.parse({ ...initial,
      request: { ...initial.request, editionId: initial.edition!.id }, rows,
      sources: initial.sources.map(source => ({ ...source, rowCount: rows.filter(row => row.yearMonth === source.month).length })),
      ownership: { ...initial.ownership, parents: initial.ownership!.parents.filter(parent => parent.parentAsin === "P01") },
      notes: initial.notes.filter(note => note.parentAsin === "P01"), coverage: { ...initial.coverage, rowCount: rows.length }, viewKey: "e".repeat(64),
    });
    await refreshNote(narrowed);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "版本利润变化原因" })).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue(draftText)).not.toBeInTheDocument();
  });
  it("preserves a still-readable dirty draft but locks editing after the edit grant is revoked", async () => {
    const initial = await openDraft();
    const readonly = OperationsBoardEditionReadResultSchema.parse({ ...initial,
      request: { ...initial.request, editionId: initial.edition!.id },
      notes: initial.notes.map(note => ({ ...note, canEdit: false, editBasis: "readonly" })), viewKey: "d".repeat(64),
    });
    await refreshNote(readonly);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "版本利润变化原因" })).toHaveAttribute("readonly"));
    expect(screen.getByRole("textbox", { name: "版本利润变化原因" })).toHaveValue(draftText);
    const save = screen.queryByRole("button", { name: "保存版本备注" });
    if (save) expect(save).toBeDisabled();
  });
  it("retains an authorized conflicting draft and requires adopting the latest version before saving", async () => {
    const initial = await openDraft();
    const changed = OperationsBoardEditionReadResultSchema.parse({ ...initial,
      request: { ...initial.request, editionId: initial.edition!.id }, state: { ...initial.state, version: initial.state.version + 1 },
      edition: { ...initial.edition, version: initial.edition!.version + 1 },
      notes: initial.notes.map(note => ({ ...note, note: "SYNTHETIC 其他人刚更新的备注", version: note.version + 1 })), viewKey: "c".repeat(64),
    });
    await refreshNote(changed);
    await screen.findByText("服务器当前备注：SYNTHETIC 其他人刚更新的备注");
    expect(screen.getByRole("textbox", { name: "版本利润变化原因" })).toHaveValue(draftText);
    expect(screen.getByRole("button", { name: "保存版本备注" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "采用最新版本继续编辑（保留草稿正文）" }));
    expect(screen.getByRole("textbox", { name: "版本利润变化原因" })).toHaveValue(draftText);
    expect(screen.getByRole("button", { name: "保存版本备注" })).toBeEnabled();
  });
});
