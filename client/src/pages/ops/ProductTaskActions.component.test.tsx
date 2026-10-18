// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadableStream } from "node:stream/web";
import {
  ProductTaskActions,
  readProductTaskPending,
  readBoundedTaskDownload,
  subscribeProductTaskChanges,
  validateTaskAttachment,
  type ProductTaskActionsProps,
} from "./ProductTaskActions";
import {
  buildProductTaskDetailResult,
  ProductTaskDetailInputSchema,
  type ProductTaskSourceRecord,
} from "@shared/productTaskRead";
import {
  ProductTaskWriteOptionsResultSchema,
  ProductTaskWriteProductsResultSchema,
  ProductTaskWriteResultSchema,
  productTaskProductKey,
  type ProductTaskWriteExecuteInput,
  type ProductTaskWriteProductsInput,
} from "@shared/productTaskWrite";

const calls = vi.hoisted(() => ({
  options: vi.fn(),
  products: vi.fn(),
  execute: vi.fn(),
  recover: vi.fn(),
  download: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        productTaskWrite: {
          options: { query: calls.options },
          products: { query: calls.products },
          execute: { mutate: calls.execute },
          recover: { mutate: calls.recover },
          download: { mutate: calls.download },
        },
      },
    }),
  },
}));
const owner = { userId: 7, workspaceId: 11, role: "admin" };
const product = {
  workspaceId: 11,
  storeName: "合成店",
  country: "US",
  parentAsin: "P001",
};
const identity = { userId: 7, workspaceId: 11 };
const cap = { status: "available" as const, reasonCode: null };
const unavailable = {
  status: "unavailable" as const,
  reasonCode: "RELEASE_GATE_DISABLED",
};
const timestamp = "2026-10-18 01:02:03.000000";
const operationId = "11111111-1111-4111-8111-111111111111";
const storageKey = "product-task-write-pending:v1:7:11";
function options(enabled = true) {
  return ProductTaskWriteOptionsResultSchema.parse({
    identity,
    members: [
      { id: 7, displayName: "合成甲" },
      { id: 8, displayName: "合成乙" },
    ],
    capabilities: {
      create: enabled ? cap : unavailable,
      update: enabled ? cap : unavailable,
      upload: enabled ? cap : unavailable,
      deleteAttachment: enabled ? cap : unavailable,
      download: enabled ? cap : unavailable,
      partners: unavailable,
    },
  });
}
function candidate(index = 1) {
  const item = {
    identity: { ...product, parentAsin: index === 1 ? "P001" : `P${index}` },
    profileId: index,
    source: "profile" as const,
    sourceMode: "profile" as const,
    sourceId: index,
    versionKey: "a".repeat(64),
    title: `合成商品${index}`,
    chineseName: null,
    imageUrl: null,
  };
  return { ...item, key: productTaskProductKey(item) };
}
function products(
  request: ProductTaskWriteProductsInput,
  count = 1,
  partial = false
) {
  return ProductTaskWriteProductsResultSchema.parse({
    identity,
    request,
    availability: cap,
    capabilities: {
      profiles: cap,
      saihuLatest: partial ? unavailable : cap,
      numericMappings: cap,
      manualOwners: cap,
      members: cap,
    },
    coverage: partial ? "partial" : "complete",
    viewKey: "a".repeat(64),
    items: Array.from({ length: count }, (_, index) =>
      candidate(index + 1)
    ).slice(request.offset, request.offset + request.limit),
    page: {
      offset: request.offset,
      limit: request.limit,
      total: count,
      hasMore: request.offset + request.limit < count,
      nextOffset:
        request.offset + request.limit < count
          ? request.offset + request.limit
          : null,
    },
  });
}
function detail(
  patch: Partial<ProductTaskSourceRecord> = {},
  attachmentName = "合成附件.pdf"
) {
  return buildProductTaskDetailResult({
    identity,
    input: ProductTaskDetailInputSchema.parse({
      expectedWorkspaceId: 11,
      taskId: 28,
      attachmentCursor: null,
      attachmentLimit: 20,
    }),
    capabilities: {
      boardProduct: "available",
      profiles: "available",
      attachments: "available",
      completionNotes: "available",
      partners: "unavailable",
    },
    access: { all: true, assigneeIds: [] },
    tasks: [
      {
        id: 28,
        workspaceId: 11,
        productProfileId: null,
        creatorId: 7,
        title: "合成任务",
        description: "原完整说明",
        status: "review",
        priority: "medium",
        category: "历史类别",
        assigneeId: 7,
        assigneeName: "合成甲",
        startDate: null,
        dueDate: "2026-10-20",
        completedAt: null,
        estimatedHours: null,
        actualHours: null,
        tags: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        completionNotes: "原完成说明",
        boardProduct: null,
        ...patch,
      },
    ],
    profiles: [],
    attachments: [
      {
        id: 1,
        taskId: 28,
        workspaceId: 11,
        name: attachmentName,
        byteSize: 5,
        uploadedBy: 7,
        createdAt: timestamp,
      },
    ],
    complete: true,
  });
}
const task = detail().task!;
function receipt(
  request: ProductTaskWriteExecuteInput,
  status: "committed" | "unknown" | "cancelled" = "committed",
  version = "b".repeat(64)
) {
  return ProductTaskWriteResultSchema.parse({
    identity,
    operationId: request.operationId,
    action: request.action,
    status,
    taskId: "taskId" in request ? request.taskId : 29,
    attachmentId:
      request.action === "deleteAttachment"
        ? request.attachmentId
        : request.action === "upload"
          ? 2
          : null,
    taskVersion: status === "committed" ? version : null,
    reasonCode: status === "committed" ? null : "AWAITING_FINAL_RESULT",
  });
}
function persisted(action: "create" | "upload" = "create") {
  return {
    version: 1,
    ...owner,
    role: undefined,
    product: null,
    operationId,
    action,
    taskId: action === "create" ? null : 28,
  };
}
function savePending(action: "create" | "upload" = "create") {
  const { role: _role, ...record } = persisted(action);
  void _role;
  localStorage.setItem(storageKey, JSON.stringify(record));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {
    resolve = yes;
  });
  return { promise, resolve };
}
function Harness(props: Partial<ProductTaskActionsProps> = {}) {
  const currentTask = props.detail?.task ?? task;
  return (
    <ProductTaskActions owner={owner} detail={detail()} {...props}>
      {actions => (
        <div>
          {actions.edit && (
            <button
              disabled={actions.busy}
              onClick={() => actions.edit?.(currentTask)}
            >
              打开编辑
            </button>
          )}
          {actions.quickUpdate && (
            <button
              disabled={actions.busy}
              onClick={() =>
                actions.quickUpdate?.(currentTask, { status: "backlog" })
              }
            >
              快速待规划
            </button>
          )}
          {actions.download && (
            <button
              disabled={actions.busy}
              onClick={() => actions.download?.(currentTask, 1)}
            >
              下载测试附件
            </button>
          )}
          <button onClick={actions.cancelDownloads}>切换详情任务</button>
          {actions.removeAttachment && (
            <button
              disabled={actions.busy}
              onClick={() =>
                actions.removeAttachment?.(currentTask, 1, "合成附件.pdf")
              }
            >
              解除测试附件
            </button>
          )}
        </div>
      )}
    </ProductTaskActions>
  );
}
async function enable() {
  fireEvent.click(screen.getByRole("button", { name: "检查任务操作权限" }));
  await screen.findByRole("button", { name: /^(新增运营任务|添加产品任务)$/ });
}
async function createForm() {
  await enable();
  fireEvent.click(
    screen.getByRole("button", { name: /^(新增运营任务|添加产品任务)$/ })
  );
  await waitFor(() => expect(calls.products).toHaveBeenCalled());
  return within(screen.getByRole("dialog"));
}
async function editForm() {
  await enable();
  fireEvent.click(screen.getByRole("button", { name: "打开编辑" }));
  return within(screen.getByRole("dialog"));
}
beforeEach(() => {
  localStorage.clear();
  for (const mock of Object.values(calls)) mock.mockReset();
  calls.options.mockResolvedValue(options());
  calls.products.mockImplementation(async request => products(request));
  calls.execute.mockImplementation(async request => receipt(request));
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("explicit task capabilities and create flow", () => {
  it("does not query on mount and keeps disabled release capabilities visible", async () => {
    calls.options.mockResolvedValue(options(false));
    render(<Harness />);
    expect(calls.options).not.toHaveBeenCalled();
    await enable();
    expect(screen.getByRole("button", { name: "新增运营任务" })).toBeDisabled();
    expect(screen.getAllByText(/RELEASE_GATE_DISABLED/)).toHaveLength(5);
    expect(
      screen.queryByRole("button", { name: "打开编辑" })
    ).not.toBeInTheDocument();
  });
  it("creates an unlinked five-state task and persists only recovery metadata until committed", async () => {
    const pending = deferred<ReturnType<typeof receipt>>();
    calls.execute.mockReturnValue(pending.promise);
    const listener = vi.fn(),
      stop = subscribeProductTaskChanges(listener);
    render(<Harness />);
    const dialog = await createForm();
    fireEvent.change(dialog.getByLabelText("新任务内容"), {
      target: { value: "不得持久化的任务正文" },
    });
    fireEvent.change(dialog.getByLabelText("新任务状态"), {
      target: { value: "review" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1));
    const request = calls.execute.mock.calls[0][0];
    expect(request).toMatchObject({
      action: "create",
      expectedWorkspaceId: 11,
      assigneeId: 7,
      productKey: null,
      status: "review",
      dueDate: null,
    });
    expect(localStorage.getItem(storageKey)).not.toContain("不得持久化");
    expect(
      Object.keys(JSON.parse(localStorage.getItem(storageKey)!)).sort()
    ).toEqual(
      [
        "version",
        "userId",
        "workspaceId",
        "product",
        "operationId",
        "action",
        "taskId",
      ].sort()
    );
    await act(async () => pending.resolve(receipt(request)));
    expect(readProductTaskPending(owner)).toBeNull();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ ...identity, kind: "committed" })
    );
    stop();
  });
  it("switching assignee clears product and aborts late candidates", async () => {
    const old = deferred<ReturnType<typeof products>>();
    calls.products
      .mockImplementationOnce(() => old.promise)
      .mockImplementation(async request => products(request, 0));
    render(<Harness product={product} />);
    const dialog = await createForm();
    fireEvent.change(dialog.getByLabelText("新任务运营负责人"), {
      target: { value: "8" },
    });
    await waitFor(() => expect(calls.products).toHaveBeenCalledTimes(2));
    expect(calls.products.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () =>
      old.resolve(products(calls.products.mock.calls[0][0]))
    );
    expect(dialog.getByLabelText("新任务关联商品")).toHaveValue("");
    expect(
      dialog.queryByRole("option", { name: /合成商品1/ })
    ).not.toBeInTheDocument();
  });
  it("embedded create preselects only the exact server candidate and can be made unlinked", async () => {
    render(<Harness product={product} />);
    const dialog = await createForm();
    await waitFor(() =>
      expect(dialog.getByLabelText("新任务关联商品")).toHaveValue(
        candidate().key
      )
    );
    fireEvent.change(dialog.getByLabelText("新任务关联商品"), {
      target: { value: "" },
    });
    fireEvent.change(dialog.getByLabelText("新任务内容"), {
      target: { value: "通用任务" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1));
    expect(calls.execute.mock.calls[0][0].productKey).toBeNull();
  });
  it("partial source is explicit and candidate pagination refuses a new source version", async () => {
    calls.products
      .mockImplementationOnce(async request => products(request, 21, true))
      .mockImplementationOnce(async request => ({
        ...products(request, 21, true),
        viewKey: "c".repeat(64),
      }));
    render(<Harness />);
    const dialog = await createForm();
    await dialog.findByText(/仅部分可信来源/);
    fireEvent.click(dialog.getByRole("button", { name: "商品候选下一页" }));
    await dialog.findByText(/商品候选读取失败或来源变化/);
    expect(dialog.getByLabelText("新任务关联商品")).toHaveValue("");
  });
  it("changed actor and scope cancel options and do not retain private forms", async () => {
    const old = deferred<ReturnType<typeof options>>();
    calls.options.mockReturnValue(old.promise);
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "检查任务操作权限" }));
    view.rerender(
      <Harness
        owner={{ ...owner, userId: 8 }}
        product={{ ...product, country: "CA" }}
      />
    );
    expect(calls.options.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => old.resolve(options()));
    expect(
      screen.queryByRole("button", { name: "新增运营任务" })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("edit, versions and irreversible uncertainty", () => {
  it("constrains the dialog grid and native date field without clipping narrow-screen content", async () => {
    render(<Harness />);
    const fields = await editForm();
    const dialog = screen.getByRole("dialog"),
      date = fields.getByLabelText("编辑任务预计完成日期");
    expect(dialog).toHaveClass("grid-cols-1", "min-w-0", "overflow-y-auto");
    expect(dialog).not.toHaveClass("overflow-hidden", "overflow-x-hidden");
    expect(date).toHaveClass("min-w-0", "max-w-full");
    expect(date.closest("label")?.parentElement).toHaveClass(
      "min-w-0",
      "w-full",
      "max-w-full"
    );
    expect(fields.getByRole("button", { name: "清除截止日期" })).toBeVisible();
    expect(fields.getByRole("button", { name: "保存任务" })).toBeVisible();
  });
  it("explicit clear deadline button submits null for an existing valid date", async () => {
    render(<Harness />);
    const dialog = await editForm();
    expect(dialog.getByLabelText("编辑任务预计完成日期")).toHaveValue(
      "2026-10-20"
    );
    fireEvent.click(dialog.getByRole("button", { name: "清除截止日期" }));
    expect(dialog.getByLabelText("编辑任务预计完成日期")).toHaveValue("");
    fireEvent.click(dialog.getByRole("button", { name: "保存任务" }));
    await waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1));
    expect(calls.execute.mock.calls[0][0].patch).toEqual({ dueDate: null });
  });
  it("unmount during execution retains the original recovery ID even if success arrives late", async () => {
    const pending = deferred<ReturnType<typeof receipt>>();
    calls.execute.mockReturnValue(pending.promise);
    const view = render(<Harness />);
    const dialog = await createForm();
    fireEvent.change(dialog.getByLabelText("新任务内容"), {
      target: { value: "仅当前内存正文" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1));
    const request = calls.execute.mock.calls[0][0];
    view.unmount();
    expect(calls.execute.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => pending.resolve(receipt(request)));
    expect(readProductTaskPending(owner)?.operationId).toBe(
      request.operationId
    );
    expect(localStorage.getItem(storageKey)).not.toContain("仅当前内存正文");
  });
  it("edits only whitelisted changed fields preserving five states and legacy category", async () => {
    render(<Harness />);
    const dialog = await editForm();
    expect(dialog.getByLabelText("编辑任务类型")).toHaveValue("历史类别");
    fireEvent.change(dialog.getByLabelText("编辑任务状态"), {
      target: { value: "backlog" },
    });
    fireEvent.change(dialog.getByLabelText("编辑任务预计完成日期"), {
      target: { value: "" },
    });
    fireEvent.change(dialog.getByLabelText("编辑完成说明"), {
      target: { value: "新完整说明" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "保存任务" }));
    await waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1));
    expect(calls.execute.mock.calls[0][0]).toMatchObject({
      action: "update",
      taskId: 28,
      expectedVersion: task.versionKey,
      patch: {
        status: "backlog",
        dueDate: null,
        completionNotes: "新完整说明",
      },
    });
    expect(calls.execute.mock.calls[0][0].patch).not.toHaveProperty(
      "assigneeId"
    );
    expect(calls.execute.mock.calls[0][0].patch).not.toHaveProperty("category");
  });
  it("preserves notes longer than 5000 characters and refuses UTF-8 overflow without truncating", async () => {
    const notes = "a".repeat(6000);
    render(<Harness detail={detail({ completionNotes: notes })} />);
    const dialog = await editForm();
    const field = dialog.getByLabelText("编辑完成说明");
    expect(field).toHaveValue(notes);
    expect(field).toHaveAttribute("maxlength", "65535");
    fireEvent.change(field, { target: { value: "中".repeat(22000) } });
    expect(dialog.getByRole("alert")).toHaveTextContent("UTF-8");
    fireEvent.click(dialog.getByRole("button", { name: "保存任务" }));
    await waitFor(() =>
      expect(screen.getByText(/输入不合法/)).toBeInTheDocument()
    );
    expect(calls.execute).not.toHaveBeenCalled();
    expect(field).toHaveValue("中".repeat(22000));
  });
  it("invalid historical due date is not silently cleared but supports explicit clearing", async () => {
    const original = detail({ dueDate: "2026-02-30" });
    render(<Harness detail={original} />);
    const dialog = await editForm();
    expect(dialog.getByText(/保存的原截止日不合法/)).toHaveTextContent(
      "2026-02-30"
    );
    fireEvent.click(dialog.getByLabelText("明确清空非法截止日"));
    fireEvent.click(dialog.getByRole("button", { name: "保存任务" }));
    await waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1));
    expect(calls.execute.mock.calls[0][0].patch).toEqual({ dueDate: null });
  });
  it("unknown execute retains UUID, blocks duplicates and recovers even after release rollback", async () => {
    calls.execute.mockRejectedValue(new Error("FORBIDDEN secret raw"));
    render(<Harness />);
    const dialog = await createForm();
    fireEvent.change(dialog.getByLabelText("新任务内容"), {
      target: { value: "敏感正文" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "创建任务" }));
    await screen.findByLabelText("未确认任务操作");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "核查原操作结果" })
      ).not.toBeDisabled()
    );
    const original = readProductTaskPending(owner)!;
    expect(screen.queryByText(/secret raw/)).not.toBeInTheDocument();
    calls.options.mockResolvedValue(options(false));
    await enable();
    expect(screen.getByRole("button", { name: "新增运营任务" })).toBeDisabled();
    calls.recover.mockResolvedValue(
      ProductTaskWriteResultSchema.parse({
        identity,
        operationId: original.operationId,
        action: null,
        status: "cancelled",
        taskId: null,
        attachmentId: null,
        taskVersion: null,
        reasonCode: "FENCED",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "请求取消原操作" }));
    await waitFor(() => expect(readProductTaskPending(owner)).toBeNull());
    expect(calls.recover.mock.calls[0][0]).toMatchObject({
      operationId: original.operationId,
      decision: "cancel",
    });
    expect(calls.execute).toHaveBeenCalledTimes(1);
  });
  it("unknown cancel does not release pending; malformed foreign receipt also fails closed", async () => {
    savePending();
    calls.recover
      .mockResolvedValueOnce({
        identity,
        operationId,
        action: null,
        status: "unknown",
        taskId: null,
        attachmentId: null,
        taskVersion: null,
        reasonCode: "WAIT",
      })
      .mockResolvedValueOnce({
        identity: { ...identity, userId: 99 },
        operationId,
        action: null,
        status: "cancelled",
        taskId: null,
        attachmentId: null,
        taskVersion: null,
        reasonCode: "FENCED",
      });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "请求取消原操作" }));
    await screen.findByText(/服务端尚不能确认/);
    expect(readProductTaskPending(owner)?.operationId).toBe(operationId);
    fireEvent.click(screen.getByRole("button", { name: "核查原操作结果" }));
    await screen.findByText(/恢复请求未得到有效确认/);
    expect(readProductTaskPending(owner)?.operationId).toBe(operationId);
  });
  it("persisted upload recovery exposes complete/check/cancel without requiring options", async () => {
    savePending("upload");
    calls.recover.mockResolvedValue({
      identity,
      operationId,
      action: "upload",
      status: "committed",
      taskId: 28,
      attachmentId: 2,
      taskVersion: "b".repeat(64),
      reasonCode: null,
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "完成原附件入库" }));
    await waitFor(() => expect(readProductTaskPending(owner)).toBeNull());
    expect(calls.options).not.toHaveBeenCalled();
    expect(calls.execute).not.toHaveBeenCalled();
  });
  it("cancelled deletion confirmation sends nothing; confirmation targets only exact attachment", async () => {
    render(<Harness />);
    await enable();
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "解除测试附件" }));
    expect(calls.execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "解除测试附件" }));
    await waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(1));
    expect(calls.execute.mock.calls[0][0]).toMatchObject({
      action: "deleteAttachment",
      taskId: 28,
      attachmentId: 1,
      expectedVersion: task.versionKey,
    });
  });
});

describe("attachment upload and authorized bounded downloads", () => {
  it.each([
    { name: "empty.txt", size: 0 },
    { name: "big.zip", size: 10485761 },
    { name: "bad.exe", size: 2 },
    { name: "../bad.pdf", size: 2 },
  ])("rejects invalid file %j before upload", file => {
    expect(validateTaskAttachment(file)).not.toBeNull();
  });
  it("uploads multiple files sequentially with new versions and reports invalid file separately", async () => {
    calls.execute.mockImplementation(async request =>
      receipt(
        request,
        "committed",
        (calls.execute.mock.calls.length === 1 ? "b" : "c").repeat(64)
      )
    );
    render(<Harness />);
    const dialog = await editForm();
    const valid1 = new File(["first"], "first.txt"),
      invalid = new File(["bad"], "bad.exe"),
      valid2 = new File(["second"], "second.pdf");
    fireEvent.change(dialog.getByLabelText("选择任务附件"), {
      target: { files: [valid1, invalid, valid2] },
    });
    await waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(2));
    await dialog.findByText(/second.pdf：已保存/);
    expect(calls.execute.mock.calls[0][0].expectedVersion).toBe(
      task.versionKey
    );
    expect(calls.execute.mock.calls[1][0].expectedVersion).toBe("b".repeat(64));
    expect(calls.execute.mock.calls[0][0].operationId).not.toBe(
      calls.execute.mock.calls[1][0].operationId
    );
    expect(
      dialog.getByText(/bad.exe：文件名称或格式不支持/)
    ).toBeInTheDocument();
    expect(readProductTaskPending(owner)).toBeNull();
  });
  it("unknown first upload stops remaining files and stores no file bytes or name", async () => {
    calls.execute.mockImplementation(async request =>
      receipt(request, "unknown")
    );
    render(<Harness />);
    const dialog = await editForm();
    fireEvent.change(dialog.getByLabelText("选择任务附件"), {
      target: {
        files: [
          new File(["secret-content"], "secret-name.txt"),
          new File(["next"], "next.pdf"),
        ],
      },
    });
    await screen.findByText(/本批已确认保存 0 个附件/);
    expect(calls.execute).toHaveBeenCalledTimes(1);
    const stored = localStorage.getItem(storageKey)!;
    expect(stored).not.toContain("secret");
    expect(stored).not.toContain("base64");
    expect(readProductTaskPending(owner)?.action).toBe("upload");
  });
  it("old unsupported attachment names stay visible with explicit download limitation", async () => {
    render(<Harness detail={detail({}, "旧附件.exe")} />);
    const dialog = await editForm();
    expect(dialog.getByText(/旧附件.exe · 5 字节/)).toBeInTheDocument();
    expect(dialog.getByText(/不能下载；元信息仍保留/)).toBeInTheDocument();
    expect(
      dialog.queryByRole("button", { name: "下载 旧附件.exe" })
    ).not.toBeInTheDocument();
  });
  it("every download reauthorizes, uses a private bounded stream and releases the object URL", async () => {
    calls.download.mockResolvedValue({
      identity,
      taskId: 28,
      attachmentId: 1,
      name: "合成附件.pdf",
      url: "https://example.test/short-signed",
      expiresSeconds: 60,
    });
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      headers: new Headers(),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const create = vi.fn().mockReturnValue("blob:test"),
      revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: create,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revoke,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<Harness />);
    await enable();
    fireEvent.click(screen.getByRole("button", { name: "下载测试附件" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "下载测试附件" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(2));
    expect(calls.download).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
  it("task switch discards a late authorized URL before fetch", async () => {
    const old = deferred<unknown>();
    calls.download.mockReturnValue(old.promise);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    await enable();
    fireEvent.click(screen.getByRole("button", { name: "下载测试附件" }));
    fireEvent.click(screen.getByRole("button", { name: "切换详情任务" }));
    expect(calls.download.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () =>
      old.resolve({
        identity,
        taskId: 28,
        attachmentId: 1,
        name: "合成附件.pdf",
        url: "https://example.test/private",
        expiresSeconds: 60,
      })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([null, "1"])(
    "bounds actual bytes without trusting content-length %s",
    async length => {
      const cancel = vi.fn(),
        headers = new Headers();
      if (length) headers.set("content-length", length);
      let produced = 0;
      const body = new ReadableStream({
        pull(controller) {
          produced++;
          controller.enqueue(new Uint8Array(6 * 1024 * 1024));
        },
        cancel,
      });
      const response = { ok: true, headers, body } as unknown as Response;
      await expect(
        readBoundedTaskDownload(
          response,
          new AbortController().signal,
          () => true
        )
      ).rejects.toThrow("DOWNLOAD_TOO_LARGE");
      expect(cancel).toHaveBeenCalled();
      expect(produced).toBeLessThanOrEqual(3);
    }
  );
  it("scope changes during streamed reading cancel before producing a blob", async () => {
    let current = true;
    const cancel = vi.fn();
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
        current = false;
      },
      cancel,
    });
    await expect(
      readBoundedTaskDownload(
        { ok: true, headers: new Headers(), body } as unknown as Response,
        new AbortController().signal,
        () => current
      )
    ).rejects.toThrow("CANCELLED");
    expect(cancel).toHaveBeenCalled();
  });
});
