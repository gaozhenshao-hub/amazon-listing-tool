// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGE_TAGGING_OPTIONS, IMAGE_TAGGING_TAG_FIELDS, ImageTaggingPreviewSchema, ImageTaggingJobViewSchema,
  imageTaggingHash as hash, type ImageTaggingPreviewInput, type ImageTaggingSubmitInput, type ImageTaggingOperationInput,
  type ImageTaggingApplyInput, type ImageTaggingApplyOperationInput, type ImageTaggingTags } from "@shared/imageTagging";
import ImageTaggingWorkflow from "./ImageTaggingWorkflow";
import { imageTaggingPendingKey, imageTaggingPendingCanonical, readImageTaggingPending, reserveImageTaggingPending, type ImageTaggingPending } from "./imageTaggingPending";
const state = vi.hoisted(() => ({ preview: vi.fn(), start: vi.fn(), check: vi.fn(), cancel: vi.fn(), history: vi.fn(), apply: vi.fn(), applyCheck: vi.fn(), applyCancel: vi.fn(), applied: vi.fn(), dirty: vi.fn(),
  auth: { user: { id: 7, defaultWorkspaceId: 11, role: "admin" }, loading: false, error: null as Error | null }, permissionLoading: false, read: true, edit: true }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isLoading: state.permissionLoading, canRead: () => state.read, canEdit: () => state.edit }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { kbImages: {
  taggingPreview: { query: state.preview }, taggingStart: { mutate: state.start }, taggingCheck: { query: state.check }, taggingCancel: { mutate: state.cancel },
  taggingHistory: { query: state.history }, taggingApply: { mutate: state.apply }, taggingApplyCheck: { query: state.applyCheck }, taggingApplyCancel: { mutate: state.applyCancel },
} } }) } }));
const identity = { userId: 7, workspaceId: 11 }, scope = { expectedWorkspaceId: 11, imageSetId: 19 }, context = { ...identity, imageSetId: 19 };
const sourceHash = "a".repeat(64), runtimeHash = "b".repeat(64), resultHash = "c".repeat(64), revisionHash = "d".repeat(64);
const op = "11111111-1111-4111-8111-111111111111", otherOp = "22222222-2222-4222-8222-222222222222";
const tags = (): ImageTaggingTags => ({ tagCategory: IMAGE_TAGGING_OPTIONS.categories[0], tagImageTypeMain: "", tagImageTypeSub: "", tagSellingPointCategory: "", tagSellingPointDetail: "", tagComposition: "", tagColorSchemeV2: "", tagDesignStyleV2: "" });
const candidate = () => ({ ...tags(), accentColor: "", evidence: "SYNTHETIC 可见产品外观，卖点未知" });
function preview(input: ImageTaggingPreviewInput, count = 1, available = true) {
  return ImageTaggingPreviewSchema.parse({ identity, scope: input, sourceHash, title: "SYNTHETIC 私有图片集", configuration: { revision: 3, hash: revisionHash }, runtimeHash,
    skillSlug: "knowledge.images.tag", modelSlug: "synthetic-vision", budget: { currency: "USD", maxCalls: count, maxCostCentsPerImage: 2, maxCostCentsTotal: count * 2, maxImageBytes: 8388608,
      note: "授权费用上限，不是实际账单；已派发但结果未知的图片不会自动重试" }, capability: { available, reasonCode: available ? null : "WRITES_DISABLED" },
    images: Array.from({ length: count }, (_, index) => ({ imageId: index + 1, revisionHash, previewUrl: `https://synthetic.invalid/${index + 1}.png`, imagePosition: index ? "secondary" : "main", positionIndex: index,
      tags: Object.fromEntries(IMAGE_TAGGING_TAG_FIELDS.map(field => [field, null])), eligibility: "pending" })) });
}
function job(input: ImageTaggingOperationInput, status: "queued" | "succeeded" | "outcome_unknown" | "not_found" | "canceled" | "partial" = "succeeded", count = 1) {
  return ImageTaggingJobViewSchema.parse({ identity, scope: input, runId: status === "not_found" ? null : "synthetic-run", state: status,
    sourceHash: status === "not_found" ? null : sourceHash, currentSourceHash: sourceHash, sourceChanged: false, runtimeHash: status === "not_found" ? null : runtimeHash,
    resultHash: status === "succeeded" || status === "partial" ? resultHash : null, configuration: { revision: 3, hash: revisionHash }, maxCostCents: 2, reasonCode: null,
    images: status === "not_found" ? [] : Array.from({ length: count }, (_, index) => ({ imageId: index + 1,
      state: status === "queued" ? "pending" : status === "outcome_unknown" ? "outcome_unknown" : status === "canceled" ? "canceled" : "succeeded",
      candidate: ["succeeded", "partial"].includes(status) ? candidate() : null, candidateHash: ["succeeded", "partial"].includes(status) ? hash(candidate()) : null, reasonCode: null, afterImageRevision: null })) });
}
function receipt(input: ImageTaggingApplyInput) {
  return { identity, scope: { ...scope, operationId: input.operationId, runOperationId: input.runOperationId }, status: "committed", requestHash: hash({ identity, request: input }), afterSourceHash: "e".repeat(64),
    appliedCount: input.decisions.filter(item => item.decision === "accept").length, excludedCount: input.decisions.filter(item => item.decision === "exclude").length, reasonCode: null };
}
function applyOutcome(input: ImageTaggingApplyOperationInput, status = "outcome_unknown") { return { identity, scope: input, status, requestHash: null, afterSourceHash: null, appliedCount: null, excludedCount: null, reasonCode: "OPERATION_UNKNOWN" }; }
function mount(setId = 19) { return render(<ImageTaggingWorkflow setId={setId} onApplied={state.applied} onDirtyChange={state.dirty} />); }
async function open() { fireEvent.click(screen.getByRole("button", { name: "预览整套图片与费用" })); await screen.findByText(/完整图片集预览/); }
async function start() { await open(); fireEvent.click(screen.getByRole("checkbox", { name: /同意本次可能产生模型费用/ })); fireEvent.click(screen.getByRole("button", { name: "确认费用并启动一次识别" })); await screen.findByText(/识别任务：/); }
function decide(id = 1, choice = "accept") { fireEvent.change(screen.getByRole("combobox", { name: `图片 ${id} 人工决定` }), { target: { value: choice } }); }
function applySelected() { fireEvent.click(screen.getByRole("checkbox", { name: /我已逐图核对本次选中的/ })); fireEvent.click(screen.getByRole("button", { name: "人工确认并应用所选候选" })); }
function pendingStart(): ImageTaggingPending { return { version: 1, context, kind: "start", operationId: op, runOperationId: op, sourceHash, runtimeHash, resultHash: null, requestHash: "f".repeat(64) }; }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); state.auth = { user: { id: 7, defaultWorkspaceId: 11, role: "admin" }, loading: false, error: null }; state.permissionLoading = false; state.read = true; state.edit = true;
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn(async (_key, _options, work) => work()) } }); vi.spyOn(window, "confirm").mockReturnValue(true);
  state.preview.mockImplementation((input: ImageTaggingPreviewInput) => Promise.resolve(preview(input)));
  state.start.mockImplementation((input: ImageTaggingSubmitInput) => Promise.resolve(job({ ...scope, operationId: input.operationId })));
  state.check.mockImplementation((input: ImageTaggingOperationInput) => Promise.resolve(job(input)));
  state.cancel.mockImplementation((input: ImageTaggingOperationInput) => Promise.resolve(job(input, "canceled")));
  state.history.mockResolvedValue({ identity, scope, complete: true, operations: [{ operationId: op, runId: "synthetic-run", state: "succeeded", sourceHash, createdAt: "2026-10-19T02:00:00.000Z" }] });
  state.apply.mockImplementation((input: ImageTaggingApplyInput) => Promise.resolve(receipt(input)));
  state.applyCheck.mockImplementation((input: ImageTaggingApplyOperationInput) => Promise.resolve(applyOutcome(input)));
  state.applyCancel.mockImplementation((input: ImageTaggingApplyOperationInput) => Promise.resolve(applyOutcome(input, "cancelled")));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("image tagger real business controller", () => {
  it("mount and preview do not start or apply; requires explicit cost confirmation", async () => {
    mount(); expect(state.preview).not.toHaveBeenCalled(); expect(state.start).not.toHaveBeenCalled(); await open();
    expect(screen.getByText(/本批最多 1 次模型调用；授权费用上限 USD 0.02/)).toBeVisible(); expect(screen.getByText(/配置版本：3/)).toBeVisible();
    expect(screen.getByRole("button", { name: "确认费用并启动一次识别" })).toBeDisabled(); expect(state.apply).not.toHaveBeenCalled();
  });
  it("uses exactly the preview UUID/source/runtime/fee cap and produces candidates only", async () => {
    mount(); await start(); const previewInput = state.preview.mock.calls[0][0], input = state.start.mock.calls[0][0];
    expect(input).toEqual({ ...previewInput, expectedSourceHash: sourceHash, expectedRuntimeHash: runtimeHash, maxCostCents: 2, chargeConfirmed: true });
    expect(screen.getByRole("heading", { name: "识别任务：候选已保存，未应用" })).toBeVisible(); expect(state.start).toHaveBeenCalledOnce(); expect(state.apply).not.toHaveBeenCalled(); expect(readImageTaggingPending(context)).toBeNull();
    expect(screen.getByRole("button", { name: "确认费用并启动一次识别" })).toBeDisabled();
  });
  it("preserves all preview images across local pages including confirmed/intentional unknown", async () => {
    state.preview.mockImplementation((input: ImageTaggingPreviewInput) => { const value = preview(input, 14); value.images[0].eligibility = "skipped_confirmed"; value.images[1].eligibility = "skipped_complete";
      value.images[1].tags = Object.fromEntries(IMAGE_TAGGING_TAG_FIELDS.map(field => [field, ""])) as typeof value.images[1]["tags"];
      value.budget!.maxCalls = 12; value.budget!.maxCostCentsTotal = 24; return value; });
    mount(); await open(); expect(screen.getByText(/完整图片集预览：14 张/)).toBeVisible(); expect(screen.getByText(/图片 #1 · main · 保留已人工确认标签/)).toBeVisible();
    expect(screen.getAllByText("已识别但未知")).toHaveLength(8); expect(screen.getAllByRole("img")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "下一页图片" })); expect(screen.getAllByRole("img")).toHaveLength(2); expect(screen.getByText(/图片 #14/)).toBeVisible();
  });
  it("keeps unknown start UUID on lost ACK and does not retry on reread or remount", async () => {
    state.start.mockRejectedValue(new Error("network")); const view = mount(); await open(); fireEvent.click(screen.getByRole("checkbox", { name: /同意本次/ })); fireEvent.click(screen.getByRole("button", { name: "确认费用并启动一次识别" }));
    await screen.findByText(/结果尚未核验/); const pending = readImageTaggingPending(context)!; expect(pending).not.toBeNull(); state.check.mockImplementation(input => job(input, "not_found"));
    fireEvent.click(screen.getByRole("button", { name: "核对原请求" })); await screen.findByText(/尚未观察到原请求，不代表未收费/); expect(readImageTaggingPending(context)?.operationId).toBe(pending.operationId);
    view.unmount(); mount(); expect(screen.getByText(pending.operationId)).toBeVisible(); expect(state.start).toHaveBeenCalledOnce(); expect(state.apply).not.toHaveBeenCalled();
  });
  it("explicitly cancels original unknown UUID with writes disabled", async () => {
    reserveImageTaggingPending(context, pendingStart()); state.edit = false; mount();
    expect(screen.getByRole("button", { name: "取消原请求" })).toBeDisabled(); fireEvent.click(screen.getByRole("checkbox", { name: /确认取消此原请求/ })); fireEvent.click(screen.getByRole("button", { name: "取消原请求" }));
    await waitFor(() => expect(readImageTaggingPending(context)).toBeNull()); expect(state.cancel).toHaveBeenCalledWith({ ...scope, operationId: op }); expect(state.start).not.toHaveBeenCalled();
  });
  it("polls queued only by check of the original UUID", async () => {
    state.start.mockImplementation(input => job({ ...scope, operationId: input.operationId }, "queued")); mount(); await start();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5100)); });
    expect(state.check).toHaveBeenCalledOnce(); expect(state.check.mock.calls[0][0].operationId).toBe(state.start.mock.calls[0][0].operationId); expect(state.start).toHaveBeenCalledOnce();
  }, 8000);
  it("requires separate human decisions and applies only selected edited tags without model calls", async () => {
    mount(); await start(); expect(screen.getByRole("button", { name: "人工确认并应用所选候选" })).toBeDisabled(); decide();
    fireEvent.change(screen.getByRole("combobox", { name: "图片 1 产品类目" }), { target: { value: IMAGE_TAGGING_OPTIONS.categories[1] } }); applySelected();
    await waitFor(() => expect(state.applied).toHaveBeenCalledOnce()); const input = state.apply.mock.calls[0][0];
    expect(input.operationId).not.toBe(input.runOperationId); expect(input.expectedSourceHash).toBe(sourceHash); expect(input.expectedResultHash).toBe(resultHash);
    expect(input.decisions).toEqual([{ imageId: 1, candidateHash: hash(candidate()), decision: "accept", tags: { ...tags(), tagCategory: IMAGE_TAGGING_OPTIONS.categories[1] } }]);
    expect(state.start).toHaveBeenCalledOnce(); expect(readImageTaggingPending(context)).toBeNull();
  });
  it("explicit exclusion applies null tags and never deletes a source image", async () => {
    mount(); await start(); decide(1, "exclude"); applySelected(); await waitFor(() => expect(state.apply).toHaveBeenCalledOnce());
    expect(state.apply.mock.calls[0][0].decisions[0]).toEqual({ imageId: 1, candidateHash: hash(candidate()), decision: "exclude", tags: null });
  });
  it("allows human apply independent of a new-generation release capability", async () => {
    state.preview.mockImplementation(input => preview(input, 1, false)); mount(); await open(); expect(screen.getByText("新标签任务写入尚未启用")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "读取标签任务历史" })); await screen.findByRole("button", { name: "查看此任务与候选" });
    fireEvent.click(screen.getByRole("button", { name: "查看此任务与候选" })); await screen.findByRole("combobox", { name: "图片 1 人工决定" }); decide(); applySelected();
    await waitFor(() => expect(state.apply).toHaveBeenCalledOnce()); expect(state.start).not.toHaveBeenCalled();
  });
  it("uses the fresh validated source hash for a later subset rather than the run's original source hash", async () => {
    const currentHash = "6".repeat(64);
    state.preview.mockImplementation(input => ({ ...preview(input, 1, false), sourceHash: currentHash }));
    state.check.mockImplementation(input => ({ ...job(input), currentSourceHash: currentHash, sourceChanged: false }));
    mount(); await open(); fireEvent.click(screen.getByRole("button", { name: "读取标签任务历史" })); await screen.findByRole("button", { name: "查看此任务与候选" });
    fireEvent.click(screen.getByRole("button", { name: "查看此任务与候选" })); await screen.findByRole("combobox", { name: "图片 1 人工决定" }); decide(); applySelected();
    await waitFor(() => expect(state.apply).toHaveBeenCalledOnce()); expect(state.apply.mock.calls[0][0].expectedSourceHash).toBe(currentHash);
  });
  it("a history-only candidate requires explicit complete source preview before human apply", async () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "读取标签任务历史" })); await screen.findByRole("button", { name: "查看此任务与候选" });
    fireEvent.click(screen.getByRole("button", { name: "查看此任务与候选" })); await screen.findByRole("combobox", { name: "图片 1 人工决定" }); decide();
    expect(screen.getByText(/请先显式预览整套图片并核对当前来源/)).toBeVisible(); expect(screen.getByRole("checkbox", { name: /我已逐图核对/ })).toBeDisabled();
    await open(); expect(screen.getByRole("img", { name: "图片 1 人工核对原图" })).toBeVisible(); applySelected(); await waitFor(() => expect(state.apply).toHaveBeenCalledOnce());
  });
  it("retains unresolved apply and original request hash through check/cancel", async () => {
    state.apply.mockRejectedValue(new Error("lost ack")); mount(); await start(); decide(); applySelected(); await screen.findByText(/结果尚未核验/);
    const pending = readImageTaggingPending(context)!; expect(pending.kind).toBe("apply"); expect(JSON.stringify(pending)).not.toContain("tagCategory");
    fireEvent.click(screen.getByRole("button", { name: "核对原请求" })); await screen.findByText(/应用结果未知/); expect(state.apply).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("checkbox", { name: /确认取消此原请求/ })); fireEvent.click(screen.getByRole("button", { name: "取消原请求" }));
    await waitFor(() => expect(readImageTaggingPending(context)).toBeNull()); expect(state.applyCancel).toHaveBeenCalledWith({ ...scope, operationId: pending.operationId, runOperationId: pending.runOperationId });
  });
  it("checks committed apply exact requestHash before releasing original UUID", async () => {
    state.apply.mockImplementation(input => ({ ...receipt(input), requestHash: "9".repeat(64) })); mount(); await start(); decide(); applySelected();
    await screen.findByText(/已隐藏旧资料/); expect(readImageTaggingPending(context)).not.toBeNull(); expect(state.applied).not.toHaveBeenCalled(); expect(screen.queryByRole("combobox", { name: "图片 1 人工决定" })).toBeNull();
  });
  it("shows bounded history honestly and recovers discovered unknown without inventing a submit", async () => {
    state.history.mockResolvedValue({ identity, scope, complete: false, operations: [{ operationId: op, runId: "synthetic-run", state: "outcome_unknown", sourceHash, createdAt: "2026-10-19" }] });
    state.check.mockImplementation(input => job(input, "outcome_unknown")); mount(); fireEvent.click(screen.getByRole("button", { name: "读取标签任务历史" }));
    await screen.findByText(/不是完整历史/); fireEvent.click(screen.getByRole("button", { name: "查看此任务与候选" })); await screen.findByText(/未决识别请求/);
    expect(readImageTaggingPending(context)).toMatchObject({ kind: "observed", operationId: op, requestHash: null }); expect(state.start).not.toHaveBeenCalled();
  });
  it("keeps unsent candidate edits across same-owner auth loading and fresh recheck", async () => {
    const view = mount(); await start(); decide(); fireEvent.change(screen.getByRole("combobox", { name: "图片 1 产品类目" }), { target: { value: IMAGE_TAGGING_OPTIONS.categories[1] } });
    state.auth.loading = true; view.rerender(<ImageTaggingWorkflow setId={19} />); expect(screen.queryByRole("combobox", { name: "图片 1 产品类目" })).toBeNull();
    state.auth.loading = false; view.rerender(<ImageTaggingWorkflow setId={19} />); expect(screen.getByRole("combobox", { name: "图片 1 产品类目" })).toHaveValue(IMAGE_TAGGING_OPTIONS.categories[1]);
    expect(screen.getByRole("button", { name: "人工确认并应用所选候选" })).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "重新读取此任务（不调用模型）" }));
    await waitFor(() => expect(screen.queryByText(/当前资格需重新核对/)).toBeNull()); expect(screen.getByRole("combobox", { name: "图片 1 产品类目" })).toHaveValue(IMAGE_TAGGING_OPTIONS.categories[1]);
  });
  it.each(["owner", "workspace", "role", "set"] as const)("clears private content on %s change", async change => {
    const view = mount(); await start(); decide();
    if (change === "owner") state.auth.user.id = 8; if (change === "workspace") state.auth.user.defaultWorkspaceId = 12; if (change === "role") state.auth.user.role = "ops_manager";
    view.rerender(<ImageTaggingWorkflow setId={change === "set" ? 20 : 19} />); expect(screen.queryByText(/SYNTHETIC 私有图片集/)).toBeNull(); expect(screen.queryByText(/SYNTHETIC 可见产品外观/)).toBeNull();
  });
  it.each(["auth", "permissions", "denied", "error"] as const)("no initial reads with %s not ready", kind => {
    if (kind === "auth") state.auth.loading = true; if (kind === "permissions") state.permissionLoading = true; if (kind === "denied") state.read = false; if (kind === "error") state.auth.error = new Error("unavailable");
    mount(); expect(screen.queryByRole("button", { name: "预览整套图片与费用" })).toBeNull(); expect(state.preview).not.toHaveBeenCalled();
  });
  it("revoked read permission clears private candidate content", async () => {
    const view = mount(); await start(); state.read = false; view.rerender(<ImageTaggingWorkflow setId={19} />); expect(screen.queryByText(/SYNTHETIC 可见/)).toBeNull();
  });
  it("late old set preview cannot enter the new set", async () => {
    let resolve!: (value: unknown) => void; state.preview.mockImplementation(() => new Promise(value => { resolve = value; })); const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "预览整套图片与费用" })); const input = state.preview.mock.calls[0][0]; view.rerender(<ImageTaggingWorkflow setId={20} />);
    await act(async () => resolve(preview(input))); expect(screen.queryByText(/SYNTHETIC 私有图片集/)).toBeNull();
  });
  it.each(["owner", "scope", "operation", "candidateHash"] as const)("rejects mixed %s in a successful job response", async field => {
    state.start.mockImplementation(input => { const value = job({ ...scope, operationId: input.operationId }); if (field === "owner") value.identity.userId = 8; if (field === "scope") value.scope.imageSetId = 20;
      if (field === "operation") value.scope.operationId = otherOp; if (field === "candidateHash") value.images[0].candidateHash = "8".repeat(64); return value; });
    mount(); await open(); fireEvent.click(screen.getByRole("checkbox", { name: /同意本次/ })); fireEvent.click(screen.getByRole("button", { name: "确认费用并启动一次识别" }));
    await screen.findByText(/已隐藏旧资料/); expect(readImageTaggingPending(context)).not.toBeNull(); expect(state.apply).not.toHaveBeenCalled();
  });
  it("does not silently clear dirty candidate changes when a fresh result hash changes", async () => {
    mount(); await start(); decide(); state.check.mockImplementation(input => ({ ...job(input), resultHash: "7".repeat(64) }));
    fireEvent.click(screen.getByRole("button", { name: "重新读取此任务（不调用模型）" })); await screen.findByText(/新读回的候选版本与草稿不同/);
    expect(screen.getByRole("combobox", { name: "图片 1 人工决定" })).toHaveValue("accept"); expect(screen.getByRole("button", { name: "人工确认并应用所选候选" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "丢弃草稿，采用当前候选" })); expect(window.confirm).toHaveBeenCalled(); expect(screen.getByRole("combobox", { name: "图片 1 人工决定" })).toHaveValue("pending");
  });
  it("source changes invalidate save eligibility without silently overwriting drafts", async () => {
    mount(); await start(); decide(); state.check.mockImplementation(input => ({ ...job(input), sourceChanged: true, currentSourceHash: "7".repeat(64) }));
    fireEvent.click(screen.getByRole("button", { name: "重新读取此任务（不调用模型）" })); await screen.findByText(/旧候选不能直接应用/);
    expect(screen.getByRole("combobox", { name: "图片 1 人工决定" })).toHaveValue("accept"); expect(screen.getByRole("button", { name: "人工确认并应用所选候选" })).toBeDisabled();
  });
  it("a same-workspace update from another actor retains dirty edits until explicit fresh comparison", async () => {
    mount(); await start(); const operationId = state.start.mock.calls[0][0].operationId; decide();
    fireEvent.change(screen.getByRole("combobox", { name: "图片 1 产品类目" }), { target: { value: IMAGE_TAGGING_OPTIONS.categories[1] } });
    act(() => window.dispatchEvent(new CustomEvent("image-tagging-source-changed-v1", { detail: { workspaceId: 11, imageSetId: 19, userId: 8 } })));
    expect(screen.queryByRole("combobox", { name: "图片 1 产品类目" })).toBeNull();
    state.history.mockResolvedValue({ identity, scope, complete: true, operations: [{ operationId, runId: "synthetic-run", state: "succeeded", sourceHash, createdAt: "2026-10-19" }] });
    fireEvent.click(screen.getByRole("button", { name: "读取标签任务历史" })); await screen.findByRole("button", { name: "查看此任务与候选" }); fireEvent.click(screen.getByRole("button", { name: "查看此任务与候选" }));
    await screen.findByRole("button", { name: "核对新版本并保留匹配的人工草稿" }); fireEvent.click(screen.getByRole("button", { name: "核对新版本并保留匹配的人工草稿" }));
    expect(screen.getByRole("combobox", { name: "图片 1 产品类目" })).toHaveValue(IMAGE_TAGGING_OPTIONS.categories[1]); expect(state.apply).not.toHaveBeenCalled();
  });
  it("rejects even a terminal cancellation receipt with conflicting known source identity", async () => {
    reserveImageTaggingPending(context, pendingStart()); state.cancel.mockImplementation(input => ({ ...job(input, "canceled"), sourceHash: "9".repeat(64) })); mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /确认取消此原请求/ })); fireEvent.click(screen.getByRole("button", { name: "取消原请求" }));
    await screen.findByText(/已隐藏旧资料/); expect(readImageTaggingPending(context)?.operationId).toBe(op);
  });
  it("does not reuse a cancellation checkbox for another tab's replacement UUID", async () => {
    reserveImageTaggingPending(context, pendingStart()); mount(); fireEvent.click(screen.getByRole("checkbox", { name: /确认取消此原请求/ }));
    // No StorageEvent: action-time comparison must still reject the stale UI UUID.
    localStorage.removeItem(imageTaggingPendingKey(context)); const value = { ...pendingStart(), operationId: otherOp, runOperationId: otherOp };
    localStorage.setItem(imageTaggingPendingKey(context), imageTaggingPendingCanonical(value));
    fireEvent.click(screen.getByRole("button", { name: "取消原请求" })); await waitFor(() => expect(screen.getByRole("checkbox", { name: /确认取消此原请求/ })).not.toBeChecked()); expect(state.cancel).not.toHaveBeenCalled();
  });
  it("refuses a new mutation when Web Locks are unavailable", async () => {
    mount(); await open(); Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    fireEvent.click(screen.getByRole("checkbox", { name: /同意本次/ })); fireEvent.click(screen.getByRole("button", { name: "确认费用并启动一次识别" }));
    await screen.findByText(/浏览器安全锁或恢复存储不可用/); expect(state.start).not.toHaveBeenCalled(); expect(readImageTaggingPending(context)).toBeNull();
  });
  it("retains every candidate across pagination and selected decisions are not page-local", async () => {
    state.preview.mockImplementation(input => preview(input, 14)); state.start.mockImplementation(input => job({ ...scope, operationId: input.operationId }, "succeeded", 14)); mount(); await start(); decide(1);
    expect(screen.getAllByRole("article", { name: /标签候选/ })).toHaveLength(12); fireEvent.click(screen.getByRole("button", { name: "下一页候选" })); decide(14);
    expect(within(screen.getByRole("article", { name: "图片 14 标签候选" })).getByText(/可见证据与不确定性/)).toBeVisible(); applySelected();
    await waitFor(() => expect(state.apply).toHaveBeenCalledOnce()); expect(state.apply.mock.calls[0][0].decisions.map((item: { imageId: number }) => item.imageId)).toEqual([1, 14]);
  });
  it("network read errors do not claim an empty history or invoke mutations", async () => {
    state.history.mockRejectedValue(new Error("network")); mount(); fireEvent.click(screen.getByRole("button", { name: "读取标签任务历史" })); await screen.findByText(/结果尚未核验/);
    expect(screen.queryByText(/本次成功读取未返回历史任务/)).toBeNull(); expect(state.start).not.toHaveBeenCalled(); expect(state.apply).not.toHaveBeenCalled();
  });
});
