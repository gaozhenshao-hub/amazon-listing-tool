import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import type {
  ProductTaskReadItem,
  ProductTaskDetailResult,
} from "@shared/productTaskRead";
import { ProductTaskProductIdentitySchema } from "@shared/productTaskRead";
import {
  ProductTaskWriteOptionsResultSchema,
  ProductTaskWriteProductsInputSchema,
  ProductTaskWriteProductsResultSchema,
  ProductTaskWriteExecuteInputSchema,
  ProductTaskWriteResultSchema,
  ProductTaskWriteDownloadResultSchema,
  ProductTaskAttachmentNameSchema,
  productTaskWriteUtf8Bytes,
  PRODUCT_TASK_TEXT_MAX_BYTES,
  type ProductTaskWriteOptionsResult,
  type ProductTaskWriteProductsResult,
  type ProductTaskWriteProduct,
  type ProductTaskWriteExecuteInput,
  type ProductTaskWriteResult,
  type ProductTaskWriteAction,
} from "@shared/productTaskWrite";

export type ProductTaskActionOwner = {
  userId: number;
  workspaceId: number;
  role: string;
};
type ProductScope = {
  workspaceId: number;
  storeName: string;
  country: string;
  parentAsin: string;
};
type Status = ProductTaskReadItem["status"];
const STATUSES: Record<Status, string> = {
  backlog: "待规划",
  todo: "未开始",
  in_progress: "进行中",
  review: "待审核",
  done: "已完成",
};
const CATEGORIES = ["listing优化", "广告优化", "绩效处理", "其他"];
const inputClass =
  "min-h-10 w-full rounded border bg-background px-3 py-2 text-sm";
const FILE_LIMIT = 10 * 1024 * 1024;
const FILE_EXTENSIONS =
  /\.(png|jpe?g|webp|gif|pdf|xlsx?|csv|docx?|pptx?|txt|zip)$/i;
const FILE_ACCEPT =
  ".png,.jpg,.jpeg,.webp,.gif,.pdf,.xlsx,.xls,.csv,.doc,.docx,.ppt,.pptx,.txt,.zip";
type FileProgress = {
  id: string;
  name: string;
  state: "waiting" | "uploading" | "done" | "error" | "unknown";
  message: string;
};
type TaskDraft = {
  title: string;
  assigneeId: string;
  productKey: string;
  category: string;
  status: Status;
  dueDate: string;
  completionNotes: string;
};
const newDraft = (owner: ProductTaskActionOwner): TaskDraft => ({
  title: "",
  assigneeId: String(owner.userId),
  productKey: "",
  category: "其他",
  status: "todo",
  dueDate: "",
  completionNotes: "",
});

export type ProductTaskActionBindings = {
  edit?: (task: ProductTaskReadItem) => void;
  quickUpdate?: (
    task: ProductTaskReadItem,
    change: { status?: Status; category?: string }
  ) => void;
  download?: (task: ProductTaskReadItem, attachmentId: number) => void;
  removeAttachment?: (
    task: ProductTaskReadItem,
    attachmentId: number,
    name: string
  ) => void;
  cancelDownloads?: () => void;
  busy: boolean;
};

type ChangeNotice = {
  userId: number;
  workspaceId: number;
  kind: "committed" | "invalidated";
};
const taskChangeListeners = new Set<(notice: ChangeNotice) => void>();
export function subscribeProductTaskChanges(
  listener: (notice: ChangeNotice) => void
) {
  taskChangeListeners.add(listener);
  return () => {
    taskChangeListeners.delete(listener);
  };
}
function publishTaskChange(
  owner: ProductTaskActionOwner,
  kind: ChangeNotice["kind"] = "committed"
) {
  for (const listener of taskChangeListeners) listener({ ...owner, kind });
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 max-w-full space-y-1 text-sm">
      <span>{label}</span>
      {children}
    </label>
  );
}
function DraftFields({
  draft,
  onChange,
  editing,
  disabled,
  canComplete,
  members,
  products,
  loadingProducts,
}: {
  draft: TaskDraft;
  onChange: (patch: Partial<TaskDraft>) => void;
  editing: boolean;
  disabled: boolean;
  canComplete: boolean;
  members: { id: number; name: string }[];
  products: { key: string; label: string }[];
  loadingProducts: boolean;
}) {
  const categories = [...new Set([...CATEGORIES, draft.category])];
  return (
    <div className="min-w-0 w-full max-w-full space-y-4">
      <Field label="任务内容">
        <Textarea
          aria-label={editing ? "编辑任务内容" : "新任务内容"}
          value={draft.title}
          maxLength={200}
          disabled={disabled}
          onChange={event => onChange({ title: event.target.value })}
        />
      </Field>
      {!editing && (
        <>
          <Field label="运营负责人">
            <select
              aria-label="新任务运营负责人"
              className={inputClass}
              value={draft.assigneeId}
              disabled={disabled}
              onChange={event =>
                onChange({ assigneeId: event.target.value, productKey: "" })
              }
            >
              {members.map(member => (
                <option key={member.id} value={member.id}>
                  {member.name} · ID {member.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="关联商品（可选）">
            <select
              aria-label="新任务关联商品"
              className={inputClass}
              value={draft.productKey}
              disabled={disabled || loadingProducts}
              onChange={event => onChange({ productKey: event.target.value })}
            >
              <option value="">不关联商品</option>
              {products.map(product => (
                <option key={product.key} value={product.key}>
                  {product.label}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-muted-foreground">
            选择负责人会清除商品选择；通用任务可以不关联商品。商品仅来自当前负责人已核验的精确店铺、国家和父
            ASIN 范围。
          </p>
        </>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="任务类型">
          <select
            aria-label={editing ? "编辑任务类型" : "新任务类型"}
            value={draft.category}
            className={inputClass}
            disabled={disabled}
            onChange={event => onChange({ category: event.target.value })}
          >
            {categories.map(category => (
              <option key={category} value={category}>
                {category || "原空类型"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="任务状态">
          <select
            aria-label={editing ? "编辑任务状态" : "新任务状态"}
            value={draft.status}
            className={inputClass}
            disabled={disabled}
            onChange={event =>
              onChange({ status: event.target.value as Status })
            }
          >
            {Object.entries(STATUSES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="预计完成日期">
        <Input
          aria-label={editing ? "编辑任务预计完成日期" : "新任务预计完成日期"}
          type="date"
          className="min-w-0 max-w-full"
          value={draft.dueDate}
          disabled={disabled}
          onChange={event => onChange({ dueDate: event.target.value })}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !draft.dueDate}
          onClick={() => onChange({ dueDate: "" })}
        >
          清除截止日期
        </Button>
      </Field>
      {editing && (
        <Field label="完成说明">
          <Textarea
            aria-label="编辑完成说明"
            rows={5}
            maxLength={65535}
            value={draft.completionNotes}
            disabled={disabled || !canComplete}
            onChange={event =>
              onChange({ completionNotes: event.target.value })
            }
          />
          {productTaskWriteUtf8Bytes(draft.completionNotes) >
            PRODUCT_TASK_TEXT_MAX_BYTES && (
            <span role="alert">
              完成说明超过 65,535 UTF-8
              字节，必须自行缩短后保存；不会截断或覆盖原文。
            </span>
          )}
          {!canComplete && (
            <span className="text-xs text-amber-700">
              完成说明能力尚未接通，不会以空值覆盖未知内容。
            </span>
          )}
        </Field>
      )}
    </div>
  );
}

export function validateTaskAttachment(
  file: Pick<File, "name" | "size">
): string | null {
  if (!file.size) return "文件为空";
  if (
    !Number.isSafeInteger(file.size) ||
    file.size > FILE_LIMIT ||
    file.size < 0
  )
    return "每个附件最大 10MiB";
  if (
    !FILE_EXTENSIONS.test(file.name) ||
    !ProductTaskAttachmentNameSchema.safeParse(file.name).success
  )
    return "文件名称或格式不支持";
  return null;
}
export async function readBoundedTaskDownload(
  response: Response,
  signal: AbortSignal,
  isCurrent: () => boolean
): Promise<Blob> {
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get("content-length") ?? 0) > FILE_LIMIT
  ) {
    await response.body?.cancel();
    throw new Error("DOWNLOAD_INVALID_OR_TOO_LARGE");
  }
  const reader = response.body.getReader(),
    bytes = new Uint8Array(FILE_LIMIT);
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted || !isCurrent()) throw new Error("CANCELLED");
      const chunk = await reader.read();
      if (signal.aborted || !isCurrent()) throw new Error("CANCELLED");
      if (chunk.done) break;
      if (size + chunk.value.byteLength > FILE_LIMIT)
        throw new Error("DOWNLOAD_TOO_LARGE");
      bytes.set(chunk.value, size);
      size += chunk.value.byteLength;
    }
    return new Blob([bytes.subarray(0, size)], {
      type: "application/octet-stream",
    });
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

type PendingOperation = {
  version: 1;
  userId: number;
  workspaceId: number;
  product: ProductScope | null;
  operationId: string;
  action: ProductTaskWriteAction;
  taskId: number | null;
};
const pendingListeners = new Set<() => void>();
const pendingKey = (owner: ProductTaskActionOwner) =>
  `product-task-write-pending:v1:${owner.userId}:${owner.workspaceId}`;
const validId = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value > 0 &&
  value <= 2147483647;
/** Persist recovery identity only. Never serialize drafts, file names, bytes,
 * storage locations, or signed URLs into browser storage. */
export function readProductTaskPending(
  owner: ProductTaskActionOwner
): PendingOperation | null {
  const raw = localStorage.getItem(pendingKey(owner));
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingOperation;
  if (
    !value ||
    Object.keys(value).sort().join() !==
      [
        "version",
        "userId",
        "workspaceId",
        "product",
        "operationId",
        "action",
        "taskId",
      ]
        .sort()
        .join() ||
    value.version !== 1 ||
    value.userId !== owner.userId ||
    value.workspaceId !== owner.workspaceId ||
    !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
      value.operationId
    ) ||
    !["create", "update", "upload", "deleteAttachment"].includes(
      value.action
    ) ||
    (value.action === "create"
      ? value.taskId !== null
      : !validId(value.taskId)) ||
    (value.product !== null &&
      (!ProductTaskProductIdentitySchema.safeParse(value.product).success ||
        value.product.workspaceId !== owner.workspaceId))
  )
    throw new Error("INVALID_PENDING_METADATA");
  return value;
}
function savePending(owner: ProductTaskActionOwner, pending: PendingOperation) {
  const previous = readProductTaskPending(owner);
  if (previous && previous.operationId !== pending.operationId)
    throw new Error("ANOTHER_PENDING_OPERATION");
  localStorage.setItem(pendingKey(owner), JSON.stringify(pending));
  if (readProductTaskPending(owner)?.operationId !== pending.operationId)
    throw new Error("PENDING_STORAGE_FAILED");
  for (const listener of pendingListeners) listener();
}
function releasePending(owner: ProductTaskActionOwner, operationId: string) {
  if (readProductTaskPending(owner)?.operationId === operationId)
    localStorage.removeItem(pendingKey(owner));
  for (const listener of pendingListeners) listener();
}
type ExecuteDraft = ProductTaskWriteExecuteInput extends infer T
  ? T extends ProductTaskWriteExecuteInput
    ? Omit<T, "operationId" | "expectedWorkspaceId">
    : never
  : never;
function sameProduct(left: ProductScope, right: ProductScope) {
  return (
    left.workspaceId === right.workspaceId &&
    left.storeName === right.storeName &&
    left.country === right.country &&
    left.parentAsin === right.parentAsin
  );
}
function identityMatches(
  value: { identity: { userId: number; workspaceId: number } },
  owner: ProductTaskActionOwner
) {
  return (
    value.identity.userId === owner.userId &&
    value.identity.workspaceId === owner.workspaceId
  );
}
const safeReason = (value: string | null) =>
  value && /^[A-Z0-9_]{1,100}$/i.test(value) ? value : "NOT_AVAILABLE";

export type ProductTaskActionsProps = {
  owner: ProductTaskActionOwner;
  product?: ProductScope | null;
  detail?: ProductTaskDetailResult;
  onReadDetail?: (taskId: number) => void;
  onAttachmentPage?: (direction: "next" | "previous" | "first") => void;
  hasPreviousAttachmentPage?: boolean;
  children?: (actions: ProductTaskActionBindings) => ReactNode;
};

/** One operation controller is shared by global and exact-product task entry
 * points. Every mutation is authorized by the server, not displayed names. */
function OwnedProductTaskActions({
  owner,
  product = null,
  detail,
  onReadDetail,
  onAttachmentPage,
  hasPreviousAttachmentPage = false,
  children,
}: ProductTaskActionsProps) {
  const client = trpc.useUtils().client;
  const [options, setOptions] = useState<ProductTaskWriteOptionsResult | null>(
      null
    ),
    [checking, setChecking] = useState(false);
  const [pending, setPending] = useState<PendingOperation | null>(null),
    [storageError, setStorageError] = useState(false);
  const [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [mode, setMode] = useState<"create" | "edit" | null>(null),
    [task, setTask] = useState<ProductTaskReadItem | null>(null),
    [draft, setDraft] = useState(() => newDraft(owner));
  const [clearInvalidDueDate, setClearInvalidDueDate] = useState(false);
  const [products, setProducts] =
      useState<ProductTaskWriteProductsResult | null>(null),
    [selectedProduct, setSelectedProduct] =
      useState<ProductTaskWriteProduct | null>(null),
    [productSearch, setProductSearch] = useState(""),
    [productsLoading, setProductsLoading] = useState(false),
    [productError, setProductError] = useState("");
  const [busy, setBusy] = useState(false),
    [files, setFiles] = useState<FileProgress[]>([]);
  const alive = useRef(true),
    sequence = useRef(0),
    candidatesSequence = useRef(0),
    downloadSequence = useRef(0);
  const controller = useRef<AbortController | null>(null),
    candidateController = useRef<AbortController | null>(null),
    downloadController = useRef<AbortController | null>(null),
    fileInput = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  useEffect(() => {
    const recoveryOwner = {
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      role: owner.role,
    };
    const tickets = { sequence, candidatesSequence, downloadSequence };
    alive.current = true;
    const load = () => {
      try {
        setPending(readProductTaskPending(recoveryOwner));
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    };
    load();
    pendingListeners.add(load);
    const storage = (event: StorageEvent) => {
      if (event.key === pendingKey(recoveryOwner)) load();
    };
    window.addEventListener("storage", storage);
    return () => {
      alive.current = false;
      tickets.sequence.current++;
      tickets.candidatesSequence.current++;
      tickets.downloadSequence.current++;
      controller.current?.abort();
      candidateController.current?.abort();
      downloadController.current?.abort();
      pendingListeners.delete(load);
      window.removeEventListener("storage", storage);
    };
  }, [owner.userId, owner.workspaceId, owner.role]);
  const available = (
    action: keyof ProductTaskWriteOptionsResult["capabilities"]
  ) => options?.capabilities[action].status === "available";
  const blocked = busy || !!pending || storageError;
  function clearPrivate() {
    setMode(null);
    setTask(null);
    setDraft(newDraft(owner));
    setOptions(null);
    setProducts(null);
    setSelectedProduct(null);
    setFiles([]);
    candidateController.current?.abort();
    downloadController.current?.abort();
    candidatesSequence.current++;
    downloadSequence.current++;
    publishTaskChange(owner, "invalidated");
  }
  async function checkOptions() {
    if (busyRef.current) return;
    const ticket = ++sequence.current,
      abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setChecking(true);
    setError("");
    try {
      const data = ProductTaskWriteOptionsResultSchema.parse(
        await client.productTaskWrite.options.query(
          { expectedWorkspaceId: owner.workspaceId },
          { signal: abort.signal }
        )
      );
      if (!alive.current || abort.signal.aborted || sequence.current !== ticket)
        return;
      if (!identityMatches(data, owner)) throw new Error("SCOPE_CHANGED");
      setOptions(data);
    } catch {
      if (
        alive.current &&
        !abort.signal.aborted &&
        sequence.current === ticket
      ) {
        clearPrivate();
        setError("操作权限读取失败，原数据已隐藏；请重新核验后再操作。");
      }
    } finally {
      if (alive.current && sequence.current === ticket) setChecking(false);
    }
  }
  async function loadProducts(
    assigneeId: number,
    search = "",
    offset = 0,
    previous?: ProductTaskWriteProductsResult,
    allowPreselect = false
  ) {
    const ticket = ++candidatesSequence.current,
      abort = new AbortController();
    candidateController.current?.abort();
    candidateController.current = abort;
    setProductsLoading(true);
    setProductError("");
    setProducts(null);
    try {
      const request = ProductTaskWriteProductsInputSchema.parse({
        expectedWorkspaceId: owner.workspaceId,
        assigneeId,
        search,
        offset,
        limit: 20,
      });
      const data = ProductTaskWriteProductsResultSchema.parse(
        await client.productTaskWrite.products.query(request, {
          signal: abort.signal,
        })
      );
      if (
        !alive.current ||
        abort.signal.aborted ||
        candidatesSequence.current !== ticket
      )
        return;
      if (
        !identityMatches(data, owner) ||
        JSON.stringify(data.request) !== JSON.stringify(request) ||
        (previous && previous.viewKey !== data.viewKey)
      )
        throw new Error("PRODUCT_SOURCE_CHANGED");
      setProducts(data);
      if (allowPreselect && product) {
        const match = data.items.find(item =>
          sameProduct(item.identity, product)
        );
        if (match) {
          setSelectedProduct(match);
          setDraft(value => ({ ...value, productKey: match.key }));
        }
      }
    } catch {
      if (
        alive.current &&
        !abort.signal.aborted &&
        candidatesSequence.current === ticket
      ) {
        setProductError(
          "商品候选读取失败或来源变化，旧选择已清除；仍可明确选择不关联商品。"
        );
        setSelectedProduct(null);
        setDraft(value => ({ ...value, productKey: "" }));
      }
    } finally {
      if (alive.current && candidatesSequence.current === ticket)
        setProductsLoading(false);
    }
  }
  function startCreate() {
    if (!available("create") || blocked || !options) return;
    const assignee =
      options.members.find(member => member.id === owner.userId) ??
      options.members[0];
    if (!assignee) {
      setError("没有当前可分配的有效数字成员，无法创建任务。");
      return;
    }
    setMode("create");
    setTask(null);
    setDraft({ ...newDraft(owner), assigneeId: String(assignee.id) });
    setFiles([]);
    setSelectedProduct(null);
    setProducts(null);
    setProductSearch("");
    setError("");
    setMessage("");
    void loadProducts(
      assignee.id,
      product?.parentAsin ?? "",
      0,
      undefined,
      true
    );
    setProductSearch(product?.parentAsin ?? "");
  }
  function startEdit(value: ProductTaskReadItem) {
    if (
      !available("update") ||
      blocked ||
      value.workspaceId !== owner.workspaceId
    )
      return;
    downloadController.current?.abort();
    downloadSequence.current++;
    setTask(value);
    setClearInvalidDueDate(false);
    setDraft({
      ...newDraft(owner),
      title: value.title,
      assigneeId: String(value.assigneeId ?? ""),
      category: value.category ?? "",
      status: value.status,
      dueDate: value.dueDate.value ?? "",
      completionNotes: value.completionNotes.value ?? "",
    });
    setMode("edit");
    setFiles([]);
    setError("");
    setMessage("");
    onReadDetail?.(value.id);
  }
  function changeDraft(patch: Partial<TaskDraft>) {
    if (blocked) return;
    if (patch.assigneeId !== undefined) {
      setSelectedProduct(null);
      setProducts(null);
      setProductSearch("");
      setDraft(value => ({ ...value, ...patch, productKey: "" }));
      void loadProducts(Number(patch.assigneeId));
      return;
    }
    if (patch.productKey !== undefined)
      setSelectedProduct(
        products?.items.find(item => item.key === patch.productKey) ??
          (patch.productKey === selectedProduct?.key ? selectedProduct : null)
      );
    setDraft(value => ({ ...value, ...patch }));
  }
  function validReceipt(
    raw: unknown,
    operation: PendingOperation
  ): ProductTaskWriteResult {
    const result = ProductTaskWriteResultSchema.parse(raw);
    if (
      !identityMatches(result, owner) ||
      result.operationId !== operation.operationId ||
      (result.action !== null && result.action !== operation.action) ||
      (operation.taskId !== null &&
        result.taskId !== null &&
        result.taskId !== operation.taskId)
    )
      throw new Error("RECEIPT_SCOPE_CHANGED");
    return result;
  }
  async function perform(
    payload: ExecuteDraft,
    signal: AbortSignal,
    notify = true
  ): Promise<ProductTaskWriteResult | null> {
    const request = ProductTaskWriteExecuteInputSchema.parse({
      ...payload,
      expectedWorkspaceId: owner.workspaceId,
      operationId: crypto.randomUUID(),
    });
    const operation: PendingOperation = {
      version: 1,
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      product,
      operationId: request.operationId,
      action: request.action,
      taskId: "taskId" in request ? request.taskId : null,
    };
    savePending(owner, operation);
    try {
      const raw = await client.productTaskWrite.execute.mutate(request, {
        signal,
      });
      if (!alive.current || signal.aborted) return null;
      const result = validReceipt(raw, operation);
      if (
        request.action === "deleteAttachment" &&
        result.status === "committed" &&
        result.attachmentId !== request.attachmentId
      )
        throw new Error("RECEIPT_ATTACHMENT_CHANGED");
      if (result.status === "committed" || result.status === "cancelled")
        releasePending(owner, operation.operationId);
      if (result.status === "committed") {
        if (notify) publishTaskChange(owner);
        return result;
      }
      setError(
        result.status === "cancelled"
          ? "服务端已确认取消，本次没有继续执行；可重新核验后操作。"
          : "操作结果尚未确认。请使用恢复操作，不要重复提交。"
      );
      return result;
    } catch {
      if (alive.current && !signal.aborted) {
        clearPrivate();
        setError(
          "操作结果尚未确认或权限/版本已变化；已保留原操作 ID，请核查或取消，不能当作失败重新提交。"
        );
      }
      return null;
    }
  }
  async function run(payload: ExecuteDraft) {
    if (
      busyRef.current ||
      blocked ||
      !available(
        payload.action === "deleteAttachment"
          ? "deleteAttachment"
          : payload.action
      )
    )
      return;
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await perform(payload, abort.signal);
      if (
        alive.current &&
        !abort.signal.aborted &&
        result?.status === "committed"
      ) {
        setMode(null);
        setTask(null);
        setDraft(newDraft(owner));
        setMessage(
          payload.action === "create"
            ? "任务已创建。未关联或分配给他人的任务可能不在当前筛选内，请在相应授权范围查看。"
            : "操作已保存，已刷新当前用户各任务入口的读取范围。"
        );
      }
    } catch {
      if (alive.current && !abort.signal.aborted)
        setError("输入不合法或无法安全保存恢复标识，未提交新操作。");
    } finally {
      if (alive.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  function saveDraft() {
    if (mode === "create") {
      if (draft.productKey && selectedProduct?.key !== draft.productKey) {
        setError("商品选择已失效，请重新选择或明确不关联商品。");
        return;
      }
      void run({
        action: "create",
        title: draft.title,
        assigneeId: Number(draft.assigneeId),
        category: draft.category,
        status: draft.status,
        dueDate: draft.dueDate || null,
        productKey: draft.productKey || null,
      });
      return;
    }
    if (!task) return;
    const patch: Extract<
      ProductTaskWriteExecuteInput,
      { action: "update" }
    >["patch"] = {};
    if (draft.title !== task.title) patch.title = draft.title;
    if (draft.status !== task.status) patch.status = draft.status;
    if (draft.category !== (task.category ?? ""))
      patch.category = draft.category || null;
    if (clearInvalidDueDate || draft.dueDate !== (task.dueDate.value ?? ""))
      patch.dueDate = draft.dueDate || null;
    if (
      task.completionNotes.status === "available" &&
      draft.completionNotes !== (task.completionNotes.value ?? "")
    )
      patch.completionNotes = draft.completionNotes || null;
    if (!Object.keys(patch).length) {
      setMessage("没有修改内容，不会发送写入请求。");
      return;
    }
    void run({
      action: "update",
      taskId: task.id,
      expectedVersion: task.versionKey,
      patch,
    });
  }
  async function recover(decision: "check" | "complete_upload" | "cancel") {
    if (!pending || busyRef.current || storageError) return;
    if (
      decision === "cancel" &&
      !window.confirm(
        "取消这次未确认的任务操作？仅在服务端确认取消后才会释放原操作 ID。"
      )
    )
      return;
    const operation = pending,
      abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = validReceipt(
        await client.productTaskWrite.recover.mutate(
          {
            expectedWorkspaceId: owner.workspaceId,
            operationId: operation.operationId,
            decision,
          },
          { signal: abort.signal }
        ),
        operation
      );
      if (!alive.current || abort.signal.aborted) return;
      if (result.status === "committed" || result.status === "cancelled") {
        releasePending(owner, operation.operationId);
        setMode(null);
        setTask(null);
        setFiles([]);
        if (result.status === "committed") publishTaskChange(owner);
        setMessage(
          result.status === "committed"
            ? "服务端确认原操作已经保存，已刷新任务读取范围。"
            : "服务端已确认取消并阻止该操作 ID 的迟到执行；现在可重新核验后操作。"
        );
      } else
        setError(
          "服务端尚不能确认最终结果，原操作 ID 继续保留；请稍后核查或请求取消。"
        );
    } catch {
      if (alive.current && !abort.signal.aborted) {
        clearPrivate();
        setError("恢复请求未得到有效确认；原操作 ID 仍被保留，不能重新提交。");
      }
    } finally {
      if (alive.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  async function uploadFiles(list: FileList | null) {
    const selected = list ? Array.from(list) : [],
      target = task;
    if (
      !selected.length ||
      !target ||
      blocked ||
      busyRef.current ||
      !available("upload")
    )
      return;
    const progress = selected.map((file, index) => ({
      id: String(index),
      name: file.name,
      state: "waiting" as FileProgress["state"],
      message: "等待上传",
    }));
    setFiles(progress);
    setError("");
    setMessage("");
    busyRef.current = true;
    setBusy(true);
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    let version = target.versionKey,
      successes = 0;
    const mark = (
      index: number,
      state: FileProgress["state"],
      message: string
    ) => {
      if (alive.current && !abort.signal.aborted)
        setFiles(values =>
          values.map((value, position) =>
            position === index ? { ...value, state, message } : value
          )
        );
    };
    try {
      for (let index = 0; index < selected.length; index++) {
        if (!alive.current || abort.signal.aborted) break;
        const file = selected[index],
          invalid = validateTaskAttachment(file);
        if (invalid) {
          mark(index, "error", invalid);
          continue;
        }
        mark(index, "uploading", "正在读取并上传");
        let base64: string;
        try {
          base64 = await readFileBase64(file, abort.signal);
        } catch {
          mark(index, "error", "本地读取失败，未提交此文件");
          continue;
        }
        if (!alive.current || abort.signal.aborted) break;
        const result = await perform(
          {
            action: "upload",
            taskId: target.id,
            expectedVersion: version,
            name: file.name,
            base64,
          },
          abort.signal,
          false
        );
        if (!alive.current || abort.signal.aborted) break;
        if (result?.status === "committed" && result.taskVersion) {
          version = result.taskVersion;
          successes++;
          mark(index, "done", "已保存");
          setTask(value =>
            value?.id === target.id ? { ...value, versionKey: version } : value
          );
        } else {
          mark(
            index,
            result?.status === "cancelled" ? "error" : "unknown",
            result?.status === "cancelled"
              ? "服务端已取消；未继续剩余文件"
              : "结果未确认；已暂停剩余文件，请恢复原操作"
          );
          break;
        }
      }
      if (alive.current && !abort.signal.aborted) {
        setMessage(
          `本批已确认保存 ${successes} 个附件；未确认和未提交文件不会被当作成功，也不会自动重传。`
        );
        if (successes) publishTaskChange(owner);
      }
    } catch {
      if (alive.current && !abort.signal.aborted)
        setError("上传已暂停，未发送新的操作；请查看文件结果和未确认操作。");
    } finally {
      if (alive.current) {
        busyRef.current = false;
        setBusy(false);
        if (fileInput.current) fileInput.current.value = "";
      }
    }
  }
  async function download(target: ProductTaskReadItem, attachmentId: number) {
    if (
      !available("download") ||
      blocked ||
      target.workspaceId !== owner.workspaceId
    )
      return;
    const ticket = ++downloadSequence.current,
      abort = new AbortController();
    downloadController.current?.abort();
    downloadController.current = abort;
    setError("");
    let objectUrl: string | null = null;
    const current = () =>
      alive.current &&
      !abort.signal.aborted &&
      downloadSequence.current === ticket;
    try {
      const data = ProductTaskWriteDownloadResultSchema.parse(
        await client.productTaskWrite.download.mutate(
          {
            expectedWorkspaceId: owner.workspaceId,
            taskId: target.id,
            attachmentId,
          },
          { signal: abort.signal }
        )
      );
      if (!current()) return;
      if (
        !identityMatches(data, owner) ||
        data.taskId !== target.id ||
        data.attachmentId !== attachmentId
      )
        throw new Error("DOWNLOAD_SCOPE_CHANGED");
      const response = await fetch(data.url, {
        signal: abort.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        cache: "no-store",
      });
      if (!current()) return;
      const blob = await readBoundedTaskDownload(
        response,
        abort.signal,
        current
      );
      if (!current()) return;
      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = data.name;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      if (current()) {
        clearPrivate();
        setError(
          "附件下载未通过当前授权或读取失败；没有使用旧链接，请重新核验后再试。"
        );
      }
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }
  function removeAttachment(
    target: ProductTaskReadItem,
    attachmentId: number,
    name: string
  ) {
    if (
      !blocked &&
      available("deleteAttachment") &&
      window.confirm(
        `解除任务「${target.title}」（ID ${target.id}）的附件「${name}」关联？此操作不删除任务。`
      )
    )
      void run({
        action: "deleteAttachment",
        taskId: target.id,
        attachmentId,
        expectedVersion: target.versionKey,
      });
  }
  const currentDetail =
    task &&
    detail?.status === "ready" &&
    detail.task?.id === task.id &&
    detail.task.workspaceId === owner.workspaceId &&
    detail.task.versionKey === task.versionKey
      ? detail
      : null;
  const productChoices = [
    ...(selectedProduct &&
    !products?.items.some(item => item.key === selectedProduct.key)
      ? [selectedProduct]
      : []),
    ...(products?.items ?? []),
  ].map(item => ({
    key: item.key,
    label: `${item.chineseName || item.title || "名称未提供"} · ${item.identity.storeName} / ${item.identity.country} / ${item.identity.parentAsin}`,
  }));
  const bindings: ProductTaskActionBindings = {
    busy: blocked,
    cancelDownloads: () => {
      downloadController.current?.abort();
      downloadSequence.current++;
    },
    ...(available("update")
      ? {
          edit: startEdit,
          quickUpdate: (
            target: ProductTaskReadItem,
            patch: { status?: Status; category?: string }
          ) => {
            void run({
              action: "update",
              taskId: target.id,
              expectedVersion: target.versionKey,
              patch,
            });
          },
        }
      : {}),
    ...(available("download")
      ? {
          download: (target: ProductTaskReadItem, id: number) => {
            void download(target, id);
          },
        }
      : {}),
    ...(available("deleteAttachment") ? { removeAttachment } : {}),
  };
  return (
    <div className="manus-no-record min-w-0 space-y-3">
      <section
        aria-label="任务操作权限与恢复"
        className="space-y-2 rounded border bg-muted/20 p-3 text-sm"
      >
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={checking || busy}
            onClick={() => void checkOptions()}
          >
            {checking ? "正在核验操作权限…" : "检查任务操作权限"}
          </Button>
          {options && (
            <Button
              type="button"
              disabled={
                !available("create") || blocked || !options.members.length
              }
              onClick={startCreate}
            >
              {product ? "添加产品任务" : "新增运营任务"}
            </Button>
          )}
        </div>
        {!options && (
          <p className="text-xs">
            读取不自动开启写入。请显式核验当前授权；功能受服务端发布开关和真实存储能力控制。
          </p>
        )}
        {options && (
          <ul className="space-y-1 text-xs">
            {(
              [
                ["create", "创建"],
                ["update", "编辑"],
                ["upload", "上传附件"],
                ["download", "授权下载"],
                ["deleteAttachment", "解除附件关联"],
              ] as const
            ).map(([key, label]) => (
              <li key={key}>
                {label}：
                {available(key)
                  ? "当前可用，每次操作仍重新鉴权"
                  : `未启用 / 尚未接通（${safeReason(options.capabilities[key].reasonCode)}）`}
              </li>
            ))}
          </ul>
        )}
        {storageError && (
          <p role="alert">
            恢复标识无法安全读取或持久保存，已阻止新写入。不会丢弃未确认操作后重新提交。
          </p>
        )}
        {pending && (
          <div
            aria-label="未确认任务操作"
            className="space-y-2 rounded border border-amber-500 p-3"
          >
            <p>
              原操作 {pending.operationId} · {pending.action} ·{" "}
              {pending.taskId ? `任务 ${pending.taskId}` : "新建任务"}{" "}
              尚未确认。只保存身份、范围和操作 ID，不保存正文或附件内容。
            </p>
            <p className="text-xs">
              在服务端返回“已保存”或“已取消”的最终回执前，不会释放此 ID
              或发起重复操作。
            </p>
            {pending.action === "upload" && (
              <p className="text-xs">
                这里只恢复当前未确认附件；同批此前已确认保存的附件不会重传，剩余未提交文件需恢复后重新选择。权限或读取失败时，以重新授权后的附件列表核验已保存结果。
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy || storageError}
                onClick={() => void recover("check")}
              >
                核查原操作结果
              </Button>
              {pending.action === "upload" && (
                <Button
                  type="button"
                  disabled={busy || storageError}
                  onClick={() => void recover("complete_upload")}
                >
                  完成原附件入库
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={busy || storageError}
                onClick={() => void recover("cancel")}
              >
                请求取消原操作
              </Button>
            </div>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </section>
      {children?.(bindings)}
      <Dialog
        open={mode !== null}
        onOpenChange={open => {
          if (!open && !busy) {
            setMode(null);
            setTask(null);
            candidateController.current?.abort();
            downloadController.current?.abort();
            candidatesSequence.current++;
            downloadSequence.current++;
          }
        }}
      >
        <DialogContent className="min-w-0 grid-cols-1 max-h-[90vh] overflow-y-auto sm:max-w-2xl [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>
              {mode === "create"
                ? product
                  ? "添加产品任务"
                  : "新增运营任务"
                : "编辑任务"}
            </DialogTitle>
            <DialogDescription>
              {mode === "create"
                ? "创建时选择数字负责人，商品可选；不会根据姓名扩展权限。"
                : `任务 ${task?.id ?? ""}：只修改内容、五状态、类型、截止日期和完成说明，不重新分配或删除任务。`}
            </DialogDescription>
          </DialogHeader>
          <DraftFields
            draft={draft}
            onChange={changeDraft}
            editing={mode === "edit"}
            disabled={blocked}
            canComplete={task?.completionNotes.status === "available"}
            members={
              options?.members.map(member => ({
                id: member.id,
                name: member.displayName,
              })) ?? []
            }
            products={productChoices}
            loadingProducts={productsLoading}
          />
          {mode === "edit" && task?.dueDate.status === "invalid" && (
            <div className="rounded border border-amber-500 p-3 text-xs">
              <p>
                保存的原截止日不合法：{task.dueDate.raw}
                。未修改时保留原值；输入新日期可修正，或明确勾选清空。
              </p>
              <label>
                <input
                  type="checkbox"
                  aria-label="明确清空非法截止日"
                  checked={clearInvalidDueDate}
                  disabled={blocked}
                  onChange={event => {
                    setClearInvalidDueDate(event.target.checked);
                    if (event.target.checked)
                      setDraft(value => ({ ...value, dueDate: "" }));
                  }}
                />{" "}
                明确清空原截止日
              </label>
            </div>
          )}
          {mode === "create" && (
            <section
              aria-label="授权商品候选"
              className="space-y-2 rounded border p-3 text-sm"
            >
              <Field label="搜索可关联商品">
                <Input
                  aria-label="搜索创建任务商品"
                  value={productSearch}
                  disabled={blocked}
                  onChange={event => {
                    setProductSearch(event.target.value);
                    setSelectedProduct(null);
                    setDraft(value => ({ ...value, productKey: "" }));
                    setProducts(null);
                    candidateController.current?.abort();
                    candidatesSequence.current++;
                    setProductsLoading(false);
                  }}
                />
              </Field>
              <Button
                type="button"
                variant="outline"
                disabled={blocked || productsLoading}
                onClick={() =>
                  void loadProducts(Number(draft.assigneeId), productSearch)
                }
              >
                搜索授权商品
              </Button>
              {productsLoading && (
                <p role="status">正在核验该负责人的商品候选…</p>
              )}
              {productError && <p role="alert">{productError}</p>}
              {products && (
                <>
                  <p>
                    候选来源：
                    {products.coverage === "complete"
                      ? "已接通来源完整"
                      : products.coverage === "partial"
                        ? "仅部分可信来源，不能视作完整商品目录"
                        : "来源尚未接通"}
                    ；
                    {products.page.total === null
                      ? "总数未知"
                      : `当前 ${products.items.length} / 共 ${products.page.total}`}
                  </p>
                  {products.availability.status !== "available" && (
                    <p>
                      商品候选不可用（
                      {safeReason(products.availability.reasonCode)}
                      ）；可明确创建不关联商品的通用任务。
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        blocked || productsLoading || products.page.offset === 0
                      }
                      onClick={() =>
                        void loadProducts(
                          Number(draft.assigneeId),
                          productSearch,
                          Math.max(
                            0,
                            products.page.offset - products.page.limit
                          ),
                          products
                        )
                      }
                    >
                      商品候选上一页
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        blocked || productsLoading || !products.page.hasMore
                      }
                      onClick={() =>
                        void loadProducts(
                          Number(draft.assigneeId),
                          productSearch,
                          products.page.nextOffset!,
                          products
                        )
                      }
                    >
                      商品候选下一页
                    </Button>
                  </div>
                </>
              )}
            </section>
          )}
          {mode === "edit" && task && (
            <section
              aria-label="编辑任务附件"
              className="space-y-3 rounded border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">附件</h3>
                <Button
                  type="button"
                  variant="outline"
                  disabled={blocked || !available("upload")}
                  onClick={() => fileInput.current?.click()}
                >
                  上传多个附件
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept={FILE_ACCEPT}
                  aria-label="选择任务附件"
                  className="sr-only"
                  disabled={blocked || !available("upload")}
                  onChange={event => void uploadFiles(event.target.files)}
                />
              </div>
              <p className="text-xs">
                支持图片、文档、表格和 ZIP；每个文件最大
                10MiB。按文件顺序独立保存，部分成功如实显示。
              </p>
              {files.length > 0 && (
                <ul aria-label="附件上传结果" className="space-y-1 text-xs">
                  {files.map(file => (
                    <li key={file.id} className="break-all">
                      {file.name}：{file.message}
                    </li>
                  ))}
                </ul>
              )}
              {task.attachments.status !== "available" ? (
                <p>附件来源未接通，数量和内容未知。</p>
              ) : !currentDetail ? (
                <div>
                  <p>附件详情尚未完成当前任务版本核验。</p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={blocked}
                    onClick={() => onReadDetail?.(task.id)}
                  >
                    核验附件列表
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-xs">
                    本页 {currentDetail.page.returned} / 全部{" "}
                    {currentDetail.page.total} 个附件
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={blocked || !hasPreviousAttachmentPage}
                      onClick={() => onAttachmentPage?.("previous")}
                    >
                      编辑附件上一页
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={blocked || !currentDetail.page.hasMore}
                      onClick={() => onAttachmentPage?.("next")}
                    >
                      编辑附件下一页
                    </Button>
                  </div>
                  {currentDetail.attachments.map(file => (
                    <div
                      key={file.id}
                      className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 break-all">
                        {file.name} · {file.byteSize} 字节
                      </span>
                      {ProductTaskAttachmentNameSchema.safeParse(file.name)
                        .success ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={blocked || !available("download")}
                          onClick={() => void download(task, file.id)}
                        >
                          下载 {file.name}
                        </Button>
                      ) : (
                        <p className="text-xs text-amber-700">
                          旧附件名称或格式不符合当前安全下载规则，不能下载；元信息仍保留。
                        </p>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        disabled={blocked || !available("deleteAttachment")}
                        onClick={() =>
                          removeAttachment(task, file.id, file.name)
                        }
                      >
                        解除附件 {file.name}
                      </Button>
                    </div>
                  ))}
                </>
              )}
            </section>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setMode(null);
                setTask(null);
              }}
            >
              关闭
            </Button>
            <Button
              type="button"
              disabled={
                blocked ||
                !draft.title.trim() ||
                (mode === "create" &&
                  (!available("create") || !draft.assigneeId)) ||
                (mode === "edit" && !available("update"))
              }
              onClick={saveDraft}
            >
              {mode === "create" ? "创建任务" : "保存任务"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ProductTaskActions(props: ProductTaskActionsProps) {
  if (
    !validId(props.owner.userId) ||
    !validId(props.owner.workspaceId) ||
    !props.owner.role.trim() ||
    (props.product &&
      (!ProductTaskProductIdentitySchema.safeParse(props.product).success ||
        props.product.workspaceId !== props.owner.workspaceId))
  )
    return <p role="alert">任务操作身份或产品范围无效，未发起请求。</p>;
  return (
    <OwnedProductTaskActions
      key={JSON.stringify([props.owner, props.product ?? null])}
      {...props}
    />
  );
}
function readFileBase64(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => {
      reader.abort();
      reject(new Error("CANCELLED"));
    };
    if (signal.aborted) {
      reject(new Error("CANCELLED"));
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    const clean = () => signal.removeEventListener("abort", abort);
    reader.onerror = () => {
      clean();
      reject(new Error("FILE_READ_FAILED"));
    };
    reader.onload = () => {
      clean();
      const value = String(reader.result).split(",")[1];
      if (value && !signal.aborted) resolve(value);
      else reject(new Error("FILE_READ_FAILED"));
    };
    reader.readAsDataURL(file);
  });
}
