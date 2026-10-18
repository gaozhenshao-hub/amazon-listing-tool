// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcquisitionReviewReadResultSchema, acquisitionReviewRequestHash, acquisitionReviewImageRequestHash, type AcquisitionReviewWriteInput } from "@shared/acquisitionReview";
import AcquisitionReviewPage from "./AcquisitionReviewPage";
import { readReviewImageBytes } from "./AcquisitionReviewImageForm";
import { acquisitionReviewPendingKey, readAcquisitionReviewPending, reserveAcquisitionReviewPending } from "./acquisitionReviewPending";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), confirm: vi.fn(), reject: vi.fn(), recover: vi.fn(), locate: vi.fn(), image: vi.fn(), recoverImage: vi.fn(),
  params: { snapshotId: "19" } as { snapshotId?: string; jobId?: string },
  auth: { user: { id: 7, defaultWorkspaceId: 11, role: "admin" }, loading: false, error: null as Error | null } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("wouter", () => ({ useParams: () => mocks.params }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { acquisition: {
  review: { query: mocks.read }, saveReview: { mutate: mocks.save }, confirmReview: { mutate: mocks.confirm },
  rejectReview: { mutate: mocks.reject }, recoverReview: { mutate: mocks.recover },
  reviewJob: { query: mocks.locate }, recoverReviewImage: { mutate: mocks.image }, recoverReviewImageOperation: { mutate: mocks.recoverImage },
} } }) } }));
const identity = { userId: 7, workspaceId: 11 }, scope = { expectedWorkspaceId: 11, expectedProjectId: 5, snapshotId: 19 };
const context = { ...identity, projectId: 5, snapshotId: 19 }, uuid = "11111111-1111-4111-8111-111111111111";
const original = { title: "原始标题", brand: "原品牌", category: null, description: "原说明<script>原文</script>", bulletPoints: ["原卖点"], price: null, rating: null, reviewCount: null, variantAsins: [] };
function view(available = true) {
  const cap = { available, reasonCode: available ? null : "WRITES_DISABLED" };
  return AcquisitionReviewReadResultSchema.parse({ identity, scope,
    snapshot: { id: 19, jobId: 20, asin: "B000000019", marketplace: "US", status: "confirmed", jobStatus: "confirmed", consumerType: "project_competitor", consumerRef: "project:5", sourceHash: "a".repeat(64) },
    original, effectiveDraft: { ...original, title: "已保存人工标题" }, revision: { id: 22, version: 2, hash: "b".repeat(64), status: "pending_review", note: "已保存备注" }, revisionHash: "c".repeat(64),
    assets: [{ id: 33, role: "main", positionIndex: 0, fieldStatus: "pending_review", storageAvailable: true, contentHash: "d".repeat(64), decision: "keep", origin: "original", replacesAssetId: null, previewUrl: "https://example.test/synthetic.png", width: 500, height: 500 },
      { id: 34, role: "secondary", positionIndex: 1, fieldStatus: "download_failed", storageAvailable: false, contentHash: null, decision: "delete", origin: "original", replacesAssetId: null, previewUrl: null, width: null, height: null }],
    capabilities: { save: cap, confirm: cap, reject: cap, image: cap } });
}
function receipt(input: AcquisitionReviewWriteInput) {
  return { identity, scope, operationId: input.operationId, action: input.action, status: "committed", requestHash: acquisitionReviewRequestHash(identity, input),
    revisionId: 23, revisionVersion: 3, committedRevisionHash: "e".repeat(64), confirmedSnapshotId: input.action === "confirm" ? 24 : null, reasonCode: null };
}
function terminal(status: "unknown" | "cancelled") {
  return { identity, scope, operationId: readAcquisitionReviewPending(context)!.operationId, action: null, status, requestHash: null,
    revisionId: null, revisionVersion: null, committedRevisionHash: null, confirmedSnapshotId: null, reasonCode: status === "unknown" ? "OUTCOME_UNKNOWN" : "OPERATION_CANCELLED" };
}
const mount = () => render(<AcquisitionReviewPage snapshotId={19} projectId={5} />);
async function read() { fireEvent.click(screen.getByRole("button", { name: "读取原始采集与当前修订" })); await screen.findByRole("textbox", { name: "标题" }); }
const edit = (text = "本地未保存稿") => fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: text } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "保存审核草稿" }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); window.history.replaceState({}, "", "/");
  mocks.params = { snapshotId: "19" };
  mocks.auth = { user: { id: 7, defaultWorkspaceId: 11, role: "admin" }, loading: false, error: null };
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn(async (_key, _options, work) => work()) } });
  mocks.read.mockReset().mockResolvedValue(view()); mocks.save.mockReset().mockImplementation(async input => receipt(input));
  mocks.confirm.mockReset().mockImplementation(async input => receipt(input)); mocks.reject.mockReset().mockImplementation(async input => receipt(input)); mocks.recover.mockReset();
  mocks.locate.mockReset().mockResolvedValue({ identity, jobId: 20, status: "confirmed", snapshotId: 19, projectId: 5 });
  mocks.image.mockReset(); mocks.recoverImage.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("optional snapshot human review", () => {
  it("resolves a route snapshot's actual project before any editable source read", async () => {
    render(<AcquisitionReviewPage />); expect(mocks.locate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "读取任务对应的快照" })); await screen.findByRole("button", { name: "读取原始采集与当前修订" });
    expect(mocks.locate).toHaveBeenCalledWith({ expectedWorkspaceId: 11, snapshotId: 19 }, expect.anything());
    expect(mocks.read).not.toHaveBeenCalled(); await read(); expect(mocks.read.mock.calls[0][0]).toEqual(scope);
  });
  it("exact job route waits while running and query failure is not an empty terminal snapshot", async () => {
    mocks.params = { jobId: "20" }; mocks.locate.mockResolvedValueOnce({ identity, jobId: 20, status: "running", snapshotId: null, projectId: 5 }).mockRejectedValueOnce(new Error("network"));
    render(<AcquisitionReviewPage />); fireEvent.click(screen.getByRole("button", { name: "读取任务对应的快照" }));
    await screen.findByText(/采集仍在排队／运行，请等待后重新读取/); expect(mocks.locate.mock.calls[0][0]).toEqual({ expectedWorkspaceId: 11, jobId: 20 });
    fireEvent.click(screen.getByRole("button", { name: "读取任务对应的快照" })); await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("不能据此判定采集结束"); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("location response from another actor/job never opens a snapshot", async () => {
    mocks.params = { jobId: "20" }; mocks.locate.mockResolvedValue({ identity: { ...identity, userId: 8 }, jobId: 21, status: "confirmed", snapshotId: 19, projectId: 5 });
    render(<AcquisitionReviewPage />); fireEvent.click(screen.getByRole("button", { name: "读取任务对应的快照" })); await screen.findByText(/任务范围或身份不可核验/);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("does no automatic write or query, reads full original and distinct editable saved draft", async () => {
    mount(); expect(mocks.read).not.toHaveBeenCalled(); await read();
    expect(mocks.read).toHaveBeenCalledWith(scope, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByLabelText("原始采集完整内容")).toHaveTextContent("原始标题");
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("已保存人工标题");
    expect(screen.getByRole("textbox", { name: "审核备注／拒绝原因" })).toHaveValue("已保存备注");
    expect(screen.getByRole("textbox", { name: "页面评价数量" })).toHaveValue(""); expect(document.querySelector("script")).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("saves a sparse field patch and complete decisions without mutation retries or changing raw data", async () => {
    mount(); await read(); edit(); save(); await screen.findByText(/原保存请求已核验/);
    expect(mocks.save).toHaveBeenCalledTimes(1); expect(mocks.save.mock.calls[0][0]).toMatchObject({ ...scope, action: "save", expectedRevisionHash: "c".repeat(64), patch: { title: "本地未保存稿" },
      assetDecisions: [{ assetId: 33, decision: "keep" }, { assetId: 34, decision: "delete" }], note: "已保存备注" });
    expect(mocks.confirm).not.toHaveBeenCalled(); expect(readAcquisitionReviewPending(context)).toBeNull();
  });
  it("requires saved revision plus all decisions, safe gallery and explicit acknowledgement for confirmation", async () => {
    mount(); await read(); const confirm = screen.getByRole("button", { name: "确认已保存修订（不调用模型）" }); expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /我已核对已保存/ })); expect(confirm).toBeEnabled();
    fireEvent.click(confirm); await screen.findByText(/原确认请求已核验/); expect(mocks.confirm).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("unsafe assets cannot be kept and undo-delete returns a gap to pending", async () => {
    mount(); await read(); expect(screen.getAllByRole("button", { name: "保留" })[1]).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "撤销删除" }));
    expect(screen.getByRole("checkbox", { name: /我已核对已保存/ })).toBeDisabled(); save(); await screen.findByText(/原保存请求已核验/);
    expect(mocks.save.mock.calls[0][0].assetDecisions).toContainEqual({ assetId: 34, decision: "pending" });
  });
  it("reject requires a reason; it does not delete an old image or trigger confirmation", async () => {
    mount(); await read(); fireEvent.change(screen.getByRole("textbox", { name: "审核备注／拒绝原因" }), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "拒绝当前修订" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "审核备注／拒绝原因" }), { target: { value: "来源不符" } });
    fireEvent.click(screen.getByRole("button", { name: "拒绝当前修订" })); await screen.findByText(/原拒绝请求已核验/);
    expect(mocks.reject.mock.calls[0][0]).toMatchObject({ action: "reject", note: "来源不符" }); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("terminal revisions can start a new draft, but confirmed source is not removed", async () => {
    const next = view(); next.revision!.status = "confirmed"; mocks.read.mockResolvedValue(next); mount(); await read();
    fireEvent.click(screen.getByRole("button", { name: "保存为新的人工修订" })); await screen.findByText(/原保存请求已核验/);
    expect(mocks.save.mock.calls[0][0].patch).toEqual({});
  });
  it("uploads exact file bytes only after explicit action; metadata excludes file content", async () => {
    mocks.image.mockRejectedValueOnce(new Error("lost image ACK")); mount(); await read();
    const file = new File([new Uint8Array([137, 80, 78, 71, 0, 255, 12])], "original.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("原图文件（最多 8 MiB）"), { target: { files: [file] } });
    expect(mocks.image).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "保存审核草稿" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "明确上传原图" })); await screen.findByText(/本次结果尚未核验/);
    expect(mocks.image).toHaveBeenCalledOnce(); const request = mocks.image.mock.calls[0][0];
    expect(request).toMatchObject({ ...scope, mode: "supplement", role: "secondary", sourceAssetId: null, fileName: "original.png", expectedRevisionHash: "c".repeat(64), base64: "iVBORwD/DA==" });
    const bytes = await readReviewImageBytes(file, new AbortController().signal), pending = readAcquisitionReviewPending(context)!;
    expect(pending.requestHash).toBe(acquisitionReviewImageRequestHash(identity, request, { contentHash: bytes.contentHash, byteSize: bytes.byteSize }));
    expect(localStorage.getItem(acquisitionReviewPendingKey(context))).not.toMatch(/original\.png|base64|iVBORwD/);
    mocks.recoverImage.mockImplementation(async input => input.decision === "complete_image" ? { ...receipt({ ...scope, action: "confirm", operationId: pending.operationId, expectedRevisionHash: pending.expectedRevisionHash, note: null }), action: "image", requestHash: pending.requestHash, confirmedSnapshotId: null } : terminal("unknown"));
    fireEvent.click(screen.getByRole("button", { name: "核对原审核请求" })); await screen.findByText(/原请求结果未知/);
    expect(mocks.recoverImage.mock.calls[0][0]).toEqual({ ...scope, operationId: pending.operationId, decision: "check" }); expect(mocks.image).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "明确验证原件并完成原补图请求" })).toBeDisabled(); mocks.read.mockResolvedValue(view(false)); await read();
    expect(screen.getByRole("button", { name: "明确上传原图" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "明确验证原件并完成原补图请求" })); await screen.findByText(/原补图请求已核验/);
    expect(mocks.recoverImage.mock.calls[1][0]).toEqual({ ...scope, operationId: pending.operationId, decision: "complete_image" }); expect(readAcquisitionReviewPending(context)).toBeNull();
  });
  it("pasting chooses one original file without uploading; dirty review disables image writes", async () => {
    mount(); await read(); const file = new File([new Uint8Array([1, 2, 3])], "clipboard.png", { type: "image/png" });
    fireEvent.paste(screen.getByRole("textbox", { name: "粘贴原图区域" }), { clipboardData: { files: [file] } });
    expect(screen.getByText(/已选择：clipboard.png/)).toBeInTheDocument(); expect(mocks.image).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "放弃已选文件" })); edit();
    expect(screen.getByRole("button", { name: "恢复此图原始下载（不重采集）" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "明确上传原图" })).toBeDisabled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("original retry uses one fixed image UUID; missing evidence explains supplement and gateoff retains recovery", async () => {
    mocks.image.mockRejectedValueOnce(new Error("ACQUISITION_IMAGE_ORIGINAL_REQUIRES_SUPPLEMENT")); const mounted = mount(); await read();
    fireEvent.click(screen.getByRole("button", { name: "恢复此图原始下载（不重采集）" })); await screen.findByText(/原始证据无法安全恢复/);
    const request = mocks.image.mock.calls[0][0]; expect(request).toMatchObject({ ...scope, mode: "retry_original", sourceAssetId: 34 });
    expect(readAcquisitionReviewPending(context)?.requestHash).toBe(acquisitionReviewImageRequestHash(identity, request)); mounted.unmount();
    mocks.read.mockResolvedValue(view(false)); mocks.recoverImage.mockResolvedValue(terminal("cancelled")); mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /确认只取消上述/ })); fireEvent.click(screen.getByRole("button", { name: "取消原审核请求" }));
    await screen.findByText(/已核验取消原请求/); expect(mocks.recoverImage.mock.calls[0][0]).toEqual({ ...scope, operationId: request.operationId, decision: "cancel" }); expect(mocks.image).toHaveBeenCalledOnce();
  });
  it("same-owner auth refresh keeps selected original bytes but hides the whole form", async () => {
    const mounted = mount(); await read(); fireEvent.change(screen.getByLabelText("原图文件（最多 8 MiB）"), { target: { files: [new File(["pixels"], "kept.png", { type: "image/png" })] } });
    mocks.auth.loading = true; mounted.rerender(<AcquisitionReviewPage snapshotId={19} projectId={5} />); expect(screen.queryByRole("button", { name: "明确上传原图" })).toBeNull();
    mocks.auth.loading = false; mounted.rerender(<AcquisitionReviewPage snapshotId={19} projectId={5} />); expect(screen.getByText(/已选择：kept.png/)).toBeVisible(); expect(mocks.image).not.toHaveBeenCalled();
  });
  it("unknown ACK retains only metadata and recovers the same operation while new writes are disabled", async () => {
    mocks.save.mockRejectedValueOnce(new Error("lost ACK")); const mounted = mount(); await read(); edit(); save(); await screen.findByText(/本次结果尚未核验/);
    const input = mocks.save.mock.calls[0][0], stored = localStorage.getItem(acquisitionReviewPendingKey(context))!;
    expect(stored).not.toContain("本地未保存稿"); expect(stored).not.toContain("已保存备注"); mounted.unmount();
    mocks.read.mockResolvedValue(view(false)); mocks.recover.mockResolvedValue(receipt(input)); mount();
    fireEvent.click(screen.getByRole("button", { name: "核对原审核请求" })); await screen.findByText(/原保存请求已核验/);
    expect(mocks.recover.mock.calls[0][0]).toEqual({ ...scope, operationId: input.operationId, decision: "check" }); expect(mocks.save).toHaveBeenCalledOnce();
  });
  it("unknown check is not terminal, explicit cancel must receive original UUID acknowledgement", async () => {
    mocks.save.mockRejectedValueOnce(new Error("lost ACK")); mount(); await read(); edit(); save(); await screen.findByText(/本次结果尚未核验/);
    mocks.recover.mockImplementation(async input => terminal(input.decision === "check" ? "unknown" : "cancelled"));
    fireEvent.click(screen.getByRole("button", { name: "核对原审核请求" })); await screen.findByText(/原请求结果未知/); expect(readAcquisitionReviewPending(context)).not.toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /确认只取消上述/ })); fireEvent.click(screen.getByRole("button", { name: "取消原审核请求" }));
    await screen.findByText(/已核验取消原请求/); expect(readAcquisitionReviewPending(context)).toBeNull(); expect(mocks.save).toHaveBeenCalledOnce();
  });
  it("draft survives current-source refresh and only explicit adopt allows a new CAS", async () => {
    mount(); await read(); edit(); const next = view(); next.revisionHash = "f".repeat(64); mocks.read.mockResolvedValue(next);
    await read(); expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("本地未保存稿"); expect(screen.getByRole("button", { name: "保存审核草稿" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "采用此版本，保留本地草稿" })); save(); await screen.findByText(/原保存请求已核验/);
    expect(mocks.save.mock.calls[0][0].expectedRevisionHash).toBe("f".repeat(64));
  });
  it("same-owner auth refresh hides without unmounting or losing dirty state", async () => {
    const mounted = mount(); await read(); edit(); mocks.auth.loading = true; mounted.rerender(<AcquisitionReviewPage snapshotId={19} projectId={5} />);
    expect(screen.queryByRole("textbox", { name: "标题" })).not.toBeInTheDocument();
    mocks.auth.loading = false; mounted.rerender(<AcquisitionReviewPage snapshotId={19} projectId={5} />);
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("本地未保存稿"); expect(screen.getByRole("button", { name: "保存审核草稿" })).toBeDisabled();
  });
  it("owner switch clears private drafts and ignores late old reads", async () => {
    const delayed = deferred<unknown>(); mocks.read.mockReturnValueOnce(delayed.promise); const mounted = mount(); fireEvent.click(screen.getByRole("button", { name: "读取原始采集与当前修订" }));
    mocks.auth.user = { id: 8, defaultWorkspaceId: 12, role: "admin" }; mounted.rerender(<AcquisitionReviewPage snapshotId={19} projectId={5} />);
    await act(async () => delayed.resolve(view())); expect(screen.queryByDisplayValue("已保存人工标题")).not.toBeInTheDocument();
  });
  it.each(["identity", "scope", "duplicate"])("invalid %s response hides old private material", async kind => {
    mount(); await read(); edit(); const next = view(); if (kind === "identity") next.identity.userId = 8; else if (kind === "scope") next.scope.expectedProjectId = 6; else next.assets.push(next.assets[0]);
    mocks.read.mockResolvedValue(next); fireEvent.click(screen.getByRole("button", { name: "读取原始采集与当前修订" }));
    await screen.findByText(/旧资料已隐藏/); expect(screen.queryByDisplayValue("本地未保存稿")).not.toBeInTheDocument();
  });
  it("mismatched receipt cannot release the original pending operation", async () => {
    mocks.save.mockImplementation(async input => ({ ...receipt(input), requestHash: "0".repeat(64) })); mount(); await read(); edit(); save();
    await screen.findByText(/旧资料已隐藏/); expect(readAcquisitionReviewPending(context)).not.toBeNull();
  });
  it("running remains waiting and read failure cannot become an empty or terminal success", async () => {
    const next = view(); next.snapshot.jobStatus = "running"; mocks.read.mockResolvedValue(next); mount(); await read();
    expect(screen.getByText(/采集仍在排队／运行/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "保存审核草稿" })).toBeDisabled();
    mocks.read.mockRejectedValueOnce(new Error("network")); fireEvent.click(screen.getByRole("button", { name: "读取原始采集与当前修订" })); await screen.findByText(/读取失败不代表任务结束/);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("external operation acknowledgement never discards this component's unsent draft", async () => {
    mount(); await read(); edit(); const input: AcquisitionReviewWriteInput = { ...scope, operationId: uuid, expectedRevisionHash: "c".repeat(64), action: "save", patch: {}, assetDecisions: [], note: null };
    act(() => reserveAcquisitionReviewPending(context, { version: 1, context, operationId: uuid, action: "save", expectedRevisionHash: input.expectedRevisionHash, requestHash: acquisitionReviewRequestHash(identity, input) }));
    mocks.recover.mockResolvedValue(receipt(input)); fireEvent.click(screen.getByRole("button", { name: "核对原审核请求" })); await screen.findByText(/原保存请求已核验/);
    fireEvent.click(screen.getByRole("button", { name: "读取原始采集与当前修订" })); await screen.findByText(/已读取新版本/);
    fireEvent.click(screen.getByRole("button", { name: "采用此版本，保留本地草稿" })); expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("本地未保存稿");
  });
});
