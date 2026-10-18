import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import {
  ProductTaskActions,
  subscribeProductTaskChanges,
  type ProductTaskActionBindings,
} from "./ProductTaskActions";
import { ProductTaskAttachmentNameSchema } from "@shared/productTaskWrite";
import {
  ProductTaskListInputSchema,
  ProductTaskListResultSchema,
  ProductTaskDetailInputSchema,
  ProductTaskDetailResultSchema,
  type ProductTaskListInput,
  type ProductTaskListResult,
  type ProductTaskDetailInput,
  type ProductTaskDetailResult,
  type ProductTaskReadItem,
  type ProductTaskCapabilities,
} from "@shared/productTaskRead";

type Owner = { userId: number; workspaceId: number; role: string };
export type ProductTasksReadScope = NonNullable<
  ProductTaskListInput["product"]
>;
type Direction = "next" | "previous" | "first";
const STATUS_LABELS = {
  backlog: "待规划",
  todo: "未开始",
  in_progress: "进行中",
  review: "待审核",
  done: "已完成",
} as const;
const STATUS_STYLE = {
  backlog: "bg-gray-100 text-gray-700",
  todo: "bg-slate-100 text-slate-700",
  in_progress: "bg-orange-50 text-orange-700",
  review: "bg-purple-50 text-purple-700",
  done: "bg-green-50 text-green-700",
} as const;
const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";
const inputClass =
  "mt-1 w-full min-w-0 rounded border bg-background px-3 py-2 text-sm";
const cellClass =
  "max-w-80 whitespace-pre-wrap break-words border-b px-4 py-3 align-top";
const positiveId = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= 2147483647;
function Shell({
  children,
  embedded = false,
}: {
  children: ReactNode;
  embedded?: boolean;
}) {
  return (
    <section
      aria-label={embedded ? "产品内嵌任务只读区域" : "产品任务只读查看"}
      className="manus-no-record min-w-0 max-w-full space-y-4 overflow-hidden rounded-xl border bg-card p-4"
    >
      <header className="space-y-2">
        <h2 className="text-lg font-semibold">
          {embedded ? "当前产品 · 运营任务" : "运营任务看板 · 已保存任务只读"}
        </h2>
        <p className="text-sm text-muted-foreground">
          保留负责人、类型、状态、搜索与分组；待规划、未开始、进行中、待审核都属于未完成，不改写为“未开始”。
        </p>
        <p className="text-xs text-muted-foreground">
          读取与操作分别核验授权。创建、编辑及附件操作需显式检查服务端发布开关；未启用时保持只读，不提供任务删除或重新分配。
        </p>
      </header>
      {children}
    </section>
  );
}
function PageControls({
  label,
  hasPrevious,
  hasNext,
  onPage,
}: {
  label: string;
  hasPrevious: boolean;
  hasNext: boolean;
  onPage?: (direction: Direction) => void;
}) {
  return (
    <nav aria-label={`${label}分页`} className="flex flex-wrap gap-2">
      <button
        type="button"
        className={buttonClass}
        disabled={!onPage || !hasPrevious}
        onClick={() => onPage?.("first")}
      >
        {label}首页
      </button>
      <button
        type="button"
        className={buttonClass}
        disabled={!onPage || !hasPrevious}
        onClick={() => onPage?.("previous")}
      >
        {label}上一页
      </button>
      <button
        type="button"
        className={buttonClass}
        disabled={!onPage || !hasNext}
        onClick={() => onPage?.("next")}
      >
        {label}下一页
      </button>
    </nav>
  );
}
const initialInput = (
  workspaceId: number,
  product: ProductTasksReadScope | null
): ProductTaskListInput => ({
  expectedWorkspaceId: workspaceId,
  product,
  association: "all",
  assigneeId: null,
  unassignedOnly: false,
  status: null,
  category: null,
  search: "",
  groupBy: "none",
  cursor: null,
  limit: 20,
});
const productName = (task: ProductTaskReadItem) => {
  const source =
    task.product.basis === "saved_snapshot"
      ? task.product.snapshot
      : task.product.basis === "current_profile"
        ? task.product.currentProfile
        : null;
  return source?.chineseName || source?.title || "商品名称未提供";
};
function CapabilityNotice({ value }: { value: ProductTaskCapabilities }) {
  return (
    <aside
      aria-label="任务能力与缺失说明"
      className="space-y-1 rounded border bg-muted/30 p-3 text-xs"
    >
      <p>
        完成说明：
        {value.completionNotes === "available"
          ? "已接通"
          : "列尚未接通，内容未知"}
        ；产品快照：
        {value.boardProduct === "available"
          ? "已接通"
          : "列尚未接通，不能当成未关联"}
        ；产品档案：
        {value.profiles === "available"
          ? "已接通"
          : "表尚未接通，不能猜测产品归属"}
        。
      </p>
      <p>
        附件：
        {value.attachments === "available"
          ? "元信息已接通；不返回存储位置或签名链接"
          : "附件表尚未接通，数量与内容未知，不是零附件"}
        。
      </p>
      <p>
        搭档关系：
        {value.partners === "available"
          ? "只采用服务端当前数字身份授权"
          : "当前无可核验数字关系，未扩展搭档可见范围"}
        。负责人姓名及保存的产品元信息不是授权依据。
      </p>
    </aside>
  );
}
function ProductAssociation({ task }: { task: ProductTaskReadItem }) {
  const value = task.product,
    identity = value.identity;
  if (value.status === "unlinked") return <p>未关联商品</p>;
  if (value.status !== "linked" || !identity)
    return (
      <div>
        <p>
          产品关联
          {value.status === "conflict"
            ? "冲突"
            : value.status === "incomplete"
              ? "不完整"
              : "尚未接通"}
          ；不能归为未关联商品
        </p>
        <p className="text-xs">依据：{value.reasonCode ?? "不可核验"}</p>
      </div>
    );
  return (
    <div className="space-y-1">
      <p>{productName(task)}</p>
      <p className="text-xs">
        {identity.parentAsin} · {identity.storeName} · {identity.country}
      </p>
      <p className="text-xs">
        工作区 {identity.workspaceId} ·{" "}
        {value.basis === "saved_snapshot"
          ? "任务保存时产品快照"
          : "同工作区当前产品档案"}
      </p>
      {value.profileMismatch && (
        <p className="text-xs text-amber-700">
          当前产品档案与已保存快照不一致，保留任务原关联。
        </p>
      )}
    </div>
  );
}
function CompletionNotes({ task }: { task: ProductTaskReadItem }) {
  return (
    <p className="whitespace-pre-wrap break-words">
      {task.completionNotes.status !== "available"
        ? "完成说明列尚未接通，内容未知"
        : task.completionNotes.value?.trim()
          ? task.completionNotes.value
          : "已接通，尚未填写完成说明"}
    </p>
  );
}
function TaskDetail({
  task,
  detail,
  detailState,
  onAttachmentPage,
  hasPreviousAttachmentPage = false,
  actions,
}: {
  task: ProductTaskReadItem;
  detail?: ProductTaskDetailResult;
  detailState?: "idle" | "loading" | "error";
  onAttachmentPage?: (direction: Direction) => void;
  hasPreviousAttachmentPage?: boolean;
  actions?: ProductTaskActionBindings;
}) {
  const matched =
    detail?.status === "ready" &&
    detail.task?.id === task.id &&
    detail.task.workspaceId === task.workspaceId &&
    detail.task.versionKey === task.versionKey
      ? detail
      : undefined;
  return (
    <section
      aria-label={`任务 ${task.id} 完整详情`}
      className="min-w-0 space-y-4 rounded border bg-background p-4 text-sm"
    >
      <h4 className="font-semibold">{task.title}</h4>
      {actions?.edit && (
        <button
          type="button"
          className={buttonClass}
          disabled={actions.busy}
          onClick={() => actions.edit?.(task)}
        >
          编辑任务 {task.id}
        </button>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <strong>任务原文</strong>
          <p className="whitespace-pre-wrap break-words">
            {task.description ?? "未填写描述"}
          </p>
        </div>
        <div>
          <strong>产品关联</strong>
          <ProductAssociation task={task} />
        </div>
      </div>
      <p>
        {STATUS_LABELS[task.status]} · 原状态 {task.status} · 类型{" "}
        {task.category ?? "未填写"} · 优先级 {task.priority ?? "未填写"}
      </p>
      <p>
        负责人{" "}
        {task.assigneeId === null
          ? "未分配数字负责人"
          : `ID ${task.assigneeId}`}{" "}
        · 保存姓名 {task.assigneeName ?? "未填写"} · 创建者 ID {task.creatorId}
      </p>
      <p>
        创建 {task.createdAt} · 更新 {task.updatedAt} · 完成{" "}
        {task.completedAt ?? "未记录"}；数据库原文时间，时区未声明。
      </p>
      <p>
        预计完成：
        {task.dueDate.status === "valid"
          ? task.dueDate.value
          : task.dueDate.status === "invalid"
            ? `原日期不合法（保留原文）：${task.dueDate.raw}`
            : "未填写"}
      </p>
      <div>
        <strong>完整完成说明</strong>
        <CompletionNotes task={task} />
      </div>
      <details>
        <summary className="cursor-pointer">
          其他已保存任务字段与产品关联依据
        </summary>
        <pre className="max-w-3xl whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(
            {
              legacy: task.legacy,
              product: {
                ...task.product,
                snapshot: task.product.snapshot && {
                  ...task.product.snapshot,
                  imageUrl: undefined,
                },
                currentProfile: task.product.currentProfile && {
                  ...task.product.currentProfile,
                  imageUrl: undefined,
                },
              },
            },
            null,
            2
          )}
        </pre>
      </details>
      <section aria-label={`任务 ${task.id} 附件元信息`} className="space-y-2">
        <h5 className="font-semibold">附件名称与字节元信息</h5>
        {detailState === "error" ? (
          <p role="alert">
            详情读取失败或来源已变化；未展示旧附件，请重新读取任务列表。
          </p>
        ) : detailState === "loading" ? (
          <p role="status">正在核验任务版本并读取附件元信息…</p>
        ) : detail && !matched ? (
          <p role="alert">详情任务、版本或来源不一致；未显示该附件结果。</p>
        ) : task.attachments.status !== "available" ? (
          <p>附件表尚未接通，数量与内容未知，不是零附件。</p>
        ) : !matched ? (
          <p>
            已核验附件数量 {task.attachments.total}
            {actions?.download
              ? "；完整名称需显式读取详情，下载每次重新核验当前授权。"
              : "；完整名称需显式读取详情，本区不提供下载。"}
          </p>
        ) : matched.capabilities.attachments !== "available" ? (
          <p>附件元信息未接通，不能解释为零附件。</p>
        ) : (
          <>
            <p>
              本页 {matched.page.returned} / 全部 {matched.page.total}{" "}
              个附件；只显示名称、字节数与保存时间，不提供链接或执行文件。
            </p>
            <PageControls
              label="任务附件"
              hasPrevious={hasPreviousAttachmentPage}
              hasNext={matched.page.hasMore}
              onPage={onAttachmentPage}
            />
            {!matched.attachments.length ? (
              <p>
                {matched.page.total === 0
                  ? "附件表已接通，该任务确无已保存附件。"
                  : "本页无附件；请返回首页查看，不解释为零附件。"}
              </p>
            ) : (
              <div
                role="region"
                aria-label={`任务 ${task.id} 附件表`}
                tabIndex={0}
                className="max-h-[400px] max-w-full overflow-auto rounded border"
              >
                <table className="w-full min-w-[650px] text-left text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      {["附件名称", "字节数", "保存时间", "上传者数字 ID"].map(
                        label => (
                          <th className="p-3" key={label}>
                            {label}
                          </th>
                        )
                      )}
                      {(actions?.download || actions?.removeAttachment) && (
                        <th className="p-3">授权附件操作</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {matched.attachments.map(file => (
                      <tr key={file.id}>
                        <td className={cellClass}>{file.name}</td>
                        <td className={cellClass}>
                          {file.byteSize.toLocaleString("zh-CN")} 字节
                        </td>
                        <td className={cellClass}>{file.createdAt}</td>
                        <td className={cellClass}>
                          {file.uploadedBy ?? "未知"}
                        </td>
                        {(actions?.download || actions?.removeAttachment) && (
                          <td className={cellClass}>
                            <div className="space-y-2">
                              {actions.download &&
                                (ProductTaskAttachmentNameSchema.safeParse(
                                  file.name
                                ).success ? (
                                  <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={actions.busy}
                                    onClick={() =>
                                      actions.download?.(task, file.id)
                                    }
                                  >
                                    下载 {file.name}
                                  </button>
                                ) : (
                                  <p>
                                    旧附件名称或格式不符合当前安全下载规则，不能下载；元信息仍保留。
                                  </p>
                                ))}
                              {actions.removeAttachment && (
                                <button
                                  type="button"
                                  className={buttonClass}
                                  disabled={actions.busy}
                                  onClick={() =>
                                    actions.removeAttachment?.(
                                      task,
                                      file.id,
                                      file.name
                                    )
                                  }
                                >
                                  解除附件 {file.name}
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </section>
  );
}
export type ProductTasksReadOnlyContentProps = {
  result: ProductTaskListResult;
  detail?: ProductTaskDetailResult;
  detailState?: "idle" | "loading" | "error";
  onPage?: (direction: Direction) => void;
  hasPreviousPage?: boolean;
  onDetail?: (taskId: number) => void;
  onAttachmentPage?: (direction: Direction) => void;
  hasPreviousAttachmentPage?: boolean;
  embedded?: boolean;
  actions?: ProductTaskActionBindings;
};
/** Pure read-only presentation. The server computes full-scope statistics and
 * page membership; neither displayed names nor product snapshots grant access. */
export function ProductTasksReadOnlyContent({
  result,
  detail,
  detailState = "idle",
  onPage,
  hasPreviousPage = false,
  onDetail,
  onAttachmentPage,
  hasPreviousAttachmentPage = false,
  embedded = false,
  actions,
}: ProductTasksReadOnlyContentProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null),
    [showDone, setShowDone] = useState(false);
  if (embedded && result.request.product === null)
    return <p role="alert">产品内嵌任务缺少精确四元组，未展示全局任务。</p>;
  if (result.status !== "ready" || !result.stats)
    return (
      <div role={result.status === "invalid" ? "alert" : "status"}>
        <p>
          {result.status === "missing"
            ? "任务来源表尚未接通，不是零任务。"
            : result.status === "not_found"
              ? "没有当前可读取任务来源，不推断无任务。"
              : "任务来源或完整性无法核验；未返回部分列表。"}
        </p>
        <p>{result.missingReason}</p>
        <p>状态依据：{result.reasonCode}</p>
        <CapabilityNotice value={result.capabilities} />
      </div>
    );
  const stats = result.stats;
  const selectTask = (id: number) => {
    actions?.cancelDownloads?.();
    if (selectedId === id) {
      setSelectedId(null);
      return;
    }
    setSelectedId(id);
    onDetail?.(id);
  };
  function taskDetail(task: ProductTaskReadItem) {
    return (
      <TaskDetail
        task={task}
        detail={detail}
        detailState={detailState}
        onAttachmentPage={onAttachmentPage}
        hasPreviousAttachmentPage={hasPreviousAttachmentPage}
        actions={actions}
      />
    );
  }
  function embeddedRows(items: ProductTaskReadItem[]) {
    return items.map(task => (
      <article
        className="min-w-0 rounded border bg-background p-3"
        key={task.id}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-2 py-1 text-xs ${STATUS_STYLE[task.status]}`}
          >
            {STATUS_LABELS[task.status]}
          </span>
          <button
            type="button"
            className="min-w-0 flex-1 break-words text-left font-medium underline decoration-dotted"
            aria-expanded={selectedId === task.id}
            onClick={() => selectTask(task.id)}
          >
            {selectedId === task.id ? "收起" : "查看"}任务 {task.id}：
            {task.title}
          </button>
          <span className="text-xs">
            {task.category ?? "未填写类型"} ·{" "}
            {task.assigneeName ??
              (task.assigneeId === null ? "未分配" : `ID ${task.assigneeId}`)}
          </span>
          <span className="text-xs">
            预计{" "}
            {task.dueDate.value ??
              (task.dueDate.status === "invalid" ? "原日期不合法" : "未填写")}
          </span>
          {actions?.edit && (
            <button
              type="button"
              className={buttonClass}
              disabled={actions.busy}
              onClick={() => actions.edit?.(task)}
            >
              编辑任务 {task.id}
            </button>
          )}
        </div>
        {selectedId === task.id && (
          <div className="mt-3">{taskDetail(task)}</div>
        )}
      </article>
    ));
  }
  return (
    <div className="min-w-0 space-y-4">
      <CapabilityNotice value={result.capabilities} />
      <p className="text-xs">
        工作区 {result.identity.workspaceId} · 当前用户 {result.identity.userId}{" "}
        ·{" "}
        {result.request.product
          ? `${result.request.product.storeName} / ${result.request.product.country} / ${result.request.product.parentAsin} 精确产品范围`
          : "当前授权任务范围"}
        。按创建时间及任务 ID 倒序；统计来自全部授权筛选结果，分组成员仅当前页。
      </p>
      <div
        aria-label="任务五状态统计"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
      >
        {[
          ["全部任务", stats.total],
          ["未完成（四态）", stats.pending],
          ...Object.entries(STATUS_LABELS).map(([key, label]) => [
            label,
            stats.byStatus[key as keyof typeof STATUS_LABELS],
          ]),
        ].map(([label, count]) => (
          <div key={label} className="rounded border bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{count}</p>
          </div>
        ))}
      </div>
      <p className="text-xs">
        全筛选关联状态：已关联 {stats.byAssociation.linked} · 未关联{" "}
        {stats.byAssociation.unlinked} · 不完整 {stats.byAssociation.incomplete}{" "}
        · 冲突 {stats.byAssociation.conflict} · 来源未接通{" "}
        {stats.byAssociation.unavailable}。
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">
          {embedded ? "此产品任务" : "任务列表"} · 本页 {result.page.returned} /
          全筛选 {stats.total}
        </h3>
        <PageControls
          label="任务列表"
          hasPrevious={hasPreviousPage}
          hasNext={result.page.hasMore}
          onPage={onPage}
        />
      </div>
      {!result.items.length ? (
        <p>
          {stats.total === 0
            ? "已完成当前授权范围读取，没有符合筛选条件的任务。"
            : "本页没有任务，请返回首页；不能将全筛选任务数解释为零。"}
        </p>
      ) : embedded ? (
        <>
          <section aria-label="产品未完成任务" className="space-y-2">
            <h4 className="font-semibold">
              未完成 · 全筛选 {stats.pending} 项 / 本页{" "}
              {result.items.filter(task => task.status !== "done").length} 项
            </h4>
            {embeddedRows(result.items.filter(task => task.status !== "done"))}
            {!result.items.some(task => task.status !== "done") && (
              <p>本页没有未完成任务，其他页请按全筛选数量继续查看。</p>
            )}
          </section>
          <section aria-label="产品已完成任务" className="space-y-2">
            <button
              type="button"
              className={buttonClass}
              aria-expanded={showDone}
              onClick={() => setShowDone(value => !value)}
            >
              已完成任务 · 全筛选 {stats.done} 项 / 本页{" "}
              {result.items.filter(task => task.status === "done").length} 项 ·{" "}
              {showDone ? "收起" : "展开"}
            </button>
            {showDone && (
              <>
                {embeddedRows(
                  result.items.filter(task => task.status === "done")
                )}
                {!result.items.some(task => task.status === "done") && (
                  <p>本页没有已完成任务；不代表全部页均无已完成任务。</p>
                )}
              </>
            )}
          </section>
        </>
      ) : (
        result.groups.map(group => (
          <section
            key={group.key}
            aria-label={`任务分组 ${group.label || "全部任务"}`}
            className="min-w-0 space-y-2 rounded border"
          >
            <h4 className="bg-muted/50 px-4 py-3 font-medium">
              {group.label || "全部任务"} · 本页 {group.pageCount} / 全筛选组{" "}
              {group.total}
            </h4>
            <div
              role="region"
              aria-label={`任务表 ${group.label || "全部任务"}`}
              tabIndex={0}
              className="max-h-[560px] max-w-full overflow-auto"
            >
              <table className="w-full min-w-[1400px] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    {[
                      "任务内容 / 详情",
                      "任务类型",
                      "关联商品",
                      "运营负责人",
                      "任务状态",
                      "创建日期",
                      "预计完成日期",
                      "完成日期",
                      "完成说明 / 附件",
                    ].map(label => (
                      <th className="p-3" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.taskIds.map(id => {
                    const task = result.items.find(item => item.id === id)!;
                    return (
                      <Fragment key={task.id}>
                        <tr>
                          <th scope="row" className={cellClass}>
                            <button
                              type="button"
                              className="text-left underline decoration-dotted"
                              aria-label={`查看任务 ${task.id} 详情`}
                              aria-expanded={selectedId === task.id}
                              onClick={() => selectTask(task.id)}
                            >
                              {task.title}
                            </button>
                            <p className="mt-1 text-xs font-normal">
                              任务 ID {task.id} ·{" "}
                              {selectedId === task.id
                                ? "点击收起"
                                : "点击查看完整详情"}
                            </p>
                            {actions?.edit && (
                              <button
                                type="button"
                                className={buttonClass}
                                disabled={actions.busy}
                                onClick={() => actions.edit?.(task)}
                              >
                                编辑任务 {task.id}
                              </button>
                            )}
                          </th>
                          <td className={cellClass}>
                            {actions?.quickUpdate ? (
                              <select
                                aria-label={`任务 ${task.id} 快速类型`}
                                className={inputClass}
                                value={task.category ?? ""}
                                disabled={actions.busy}
                                onChange={event =>
                                  actions.quickUpdate?.(task, {
                                    category: event.target.value,
                                  })
                                }
                              >
                                {[
                                  ...new Set([
                                    task.category ?? "",
                                    "listing优化",
                                    "广告优化",
                                    "绩效处理",
                                    "其他",
                                  ]),
                                ].map(category => (
                                  <option key={category} value={category}>
                                    {category || "未填写（保留原值）"}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              (task.category ?? "未填写")
                            )}
                          </td>
                          <td className={cellClass}>
                            <ProductAssociation task={task} />
                          </td>
                          <td className={cellClass}>
                            {task.assigneeName ?? "姓名未提供"}
                            <br />
                            {task.assigneeId === null
                              ? "未分配数字负责人"
                              : `ID ${task.assigneeId}`}
                          </td>
                          <td className={cellClass}>
                            {actions?.quickUpdate ? (
                              <select
                                aria-label={`任务 ${task.id} 快速状态`}
                                className={inputClass}
                                value={task.status}
                                disabled={actions.busy}
                                onChange={event =>
                                  actions.quickUpdate?.(task, {
                                    status: event.target
                                      .value as ProductTaskReadItem["status"],
                                  })
                                }
                              >
                                {Object.entries(STATUS_LABELS).map(
                                  ([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  )
                                )}
                              </select>
                            ) : (
                              <span
                                className={`rounded px-2 py-1 ${STATUS_STYLE[task.status]}`}
                              >
                                {STATUS_LABELS[task.status]}
                              </span>
                            )}
                            <p className="mt-1">{task.status}</p>
                          </td>
                          <td className={cellClass}>{task.createdAt}</td>
                          <td className={cellClass}>
                            {task.dueDate.value ??
                              (task.dueDate.status === "invalid"
                                ? `原日期不合法：${task.dueDate.raw}`
                                : "未填写")}
                          </td>
                          <td className={cellClass}>
                            {task.completedAt ?? "未记录"}
                          </td>
                          <td className={cellClass}>
                            <CompletionNotes task={task} />
                            <p className="mt-2">
                              {task.attachments.status === "available"
                                ? `${task.attachments.total} 个已保存附件（仅元信息）`
                                : "附件来源未接通，数量未知"}
                            </p>
                          </td>
                        </tr>
                        {selectedId === task.id && (
                          <tr>
                            <td
                              colSpan={9}
                              className="border-b bg-muted/20 p-3"
                            >
                              {taskDetail(task)}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
      <p className="text-xs">
        创建 / 完成时间保持数据库原文，不假定
        UTC；未填写、非法日期、来源尚未接通分别显示。
        {actions?.edit ||
        actions?.quickUpdate ||
        actions?.download ||
        actions?.removeAttachment
          ? "附件操作按当前授权执行，未知结果不自动重试；原操作 ID 保留用于恢复。"
          : "页面不上传、下载或执行附件。"}
      </p>
    </div>
  );
}
type ListState =
  | { status: "idle" | "loading" | "error" | "invalid" }
  | { status: "ready"; result: ProductTaskListResult };
type DetailState =
  | { status: "idle" | "loading" | "error" }
  | { status: "ready"; result: ProductTaskDetailResult };
function OwnedProductTasks({
  owner,
  product = null,
}: {
  owner: Owner;
  product?: ProductTasksReadScope | null;
}) {
  const client = trpc.useUtils().client,
    embedded = product !== null;
  const [filters, setFilters] = useState(() =>
    initialInput(owner.workspaceId, product)
  );
  const [productScope, setProductScope] = useState({
    enabled: false,
    storeName: "",
    country: "",
    parentAsin: "",
  });
  const [state, setState] = useState<ListState>({ status: "idle" }),
    [detailState, setDetailState] = useState<DetailState>({ status: "idle" });
  const [listTrail, setListTrail] = useState<ProductTaskListInput["cursor"][]>(
      []
    ),
    [attachmentTrail, setAttachmentTrail] = useState<
      ProductTaskDetailInput["attachmentCursor"][]
    >([]);
  const sequence = useRef(0),
    detailSequence = useRef(0),
    pending = useRef<AbortController | null>(null),
    detailPending = useRef<AbortController | null>(null);
  const latest = useRef<ProductTaskListResult | null>(null);
  const hasRead = useRef(false);
  const noticeRef = useRef<(kind: "committed" | "invalidated") => void>(
    () => {}
  );
  useEffect(
    () =>
      subscribeProductTaskChanges(notice => {
        if (
          notice.userId === owner.userId &&
          notice.workspaceId === owner.workspaceId
        )
          noticeRef.current(notice.kind);
      }),
    [owner.userId, owner.workspaceId]
  );
  function clear() {
    sequence.current++;
    detailSequence.current++;
    pending.current?.abort();
    detailPending.current?.abort();
    pending.current = null;
    detailPending.current = null;
    latest.current = null;
    setState({ status: "idle" });
    setDetailState({ status: "idle" });
    setListTrail([]);
    setAttachmentTrail([]);
  }
  useEffect(
    () => () => {
      sequence.current++;
      detailSequence.current++;
      pending.current?.abort();
      detailPending.current?.abort();
    },
    []
  );
  function change(patch: Partial<ProductTaskListInput>) {
    clear();
    setFilters(value => ({ ...value, ...patch, cursor: null }));
  }
  async function readList(
    input?: ProductTaskListInput,
    previous?: ProductTaskListResult,
    trail: ProductTaskListInput["cursor"][] = []
  ) {
    hasRead.current = true;
    clear();
    const parsed = ProductTaskListInputSchema.safeParse(
      input ?? {
        ...filters,
        product:
          product ??
          (productScope.enabled
            ? {
                workspaceId: owner.workspaceId,
                storeName: productScope.storeName,
                country: productScope.country,
                parentAsin: productScope.parentAsin,
              }
            : null),
        cursor: null,
      }
    );
    if (!parsed.success) {
      setState({ status: "invalid" });
      return;
    }
    const request = parsed.data,
      ticket = ++sequence.current,
      controller = new AbortController();
    pending.current = controller;
    const current = () =>
      sequence.current === ticket && !controller.signal.aborted;
    setState({ status: "loading" });
    try {
      const raw = await client.productTaskRead.list.query(request, {
        signal: controller.signal,
      });
      if (!current()) return;
      const result = ProductTaskListResultSchema.parse(raw);
      if (
        result.identity.userId !== owner.userId ||
        result.identity.workspaceId !== owner.workspaceId ||
        JSON.stringify(result.request) !== JSON.stringify(request)
      )
        throw new Error("TASK_SCOPE_CHANGED");
      if (
        !["super_admin", "admin"].includes(owner.role) &&
        (result.items.some(task => task.assigneeId !== owner.userId) ||
          result.stats?.byAssignee.some(row => row.assigneeId !== owner.userId))
      )
        throw new Error("TASK_ASSIGNEE_CHANGED");
      if (
        previous &&
        (result.status !== "ready" || previous.viewKey !== result.viewKey)
      )
        throw new Error("TASK_LIST_VERSION_CHANGED");
      if (current()) {
        latest.current = result;
        setListTrail(trail);
        setState({ status: "ready", result });
      }
    } catch {
      if (current()) setState({ status: "error" });
    } finally {
      if (current()) pending.current = null;
    }
  }
  async function readDetail(
    taskId: number,
    cursor: ProductTaskDetailInput["attachmentCursor"] = null,
    previous?: ProductTaskDetailResult,
    trail: ProductTaskDetailInput["attachmentCursor"][] = []
  ) {
    detailSequence.current++;
    detailPending.current?.abort();
    detailPending.current = null;
    setDetailState({ status: "idle" });
    setAttachmentTrail([]);
    const list = latest.current,
      task = list?.items.find(item => item.id === taskId);
    if (!list || list.status !== "ready" || !task) {
      clear();
      setState({ status: "error" });
      return;
    }
    const request = ProductTaskDetailInputSchema.parse({
      expectedWorkspaceId: owner.workspaceId,
      taskId,
      attachmentCursor: cursor,
      attachmentLimit: 20,
    });
    const ticket = ++detailSequence.current,
      controller = new AbortController();
    detailPending.current = controller;
    const current = () =>
      detailSequence.current === ticket &&
      !controller.signal.aborted &&
      latest.current === list;
    setDetailState({ status: "loading" });
    try {
      const raw = await client.productTaskRead.detail.query(request, {
        signal: controller.signal,
      });
      if (!current()) return;
      const result = ProductTaskDetailResultSchema.parse(raw);
      if (
        result.identity.userId !== owner.userId ||
        result.identity.workspaceId !== owner.workspaceId ||
        JSON.stringify(result.request) !== JSON.stringify(request) ||
        result.status !== "ready" ||
        result.task?.id !== task.id ||
        result.task.versionKey !== task.versionKey
      )
        throw new Error("TASK_DETAIL_CHANGED");
      if (previous && previous.viewKey !== result.viewKey)
        throw new Error("TASK_ATTACHMENTS_CHANGED");
      if (current()) {
        setAttachmentTrail(trail);
        setDetailState({ status: "ready", result });
      }
    } catch {
      if (current()) {
        clear();
        setState({ status: "error" });
      }
    } finally {
      if (current()) detailPending.current = null;
    }
  }
  function listPage(direction: Direction) {
    if (state.status !== "ready") return;
    const result = state.result;
    if (direction === "next" && result.page.nextCursor)
      void readList(
        { ...result.request, cursor: result.page.nextCursor },
        result,
        [...listTrail, result.request.cursor]
      );
    if (direction === "previous" && listTrail.length)
      void readList(
        { ...result.request, cursor: listTrail.at(-1)! },
        result,
        listTrail.slice(0, -1)
      );
    if (direction === "first")
      void readList({ ...result.request, cursor: null }, result, []);
  }
  function attachmentPage(direction: Direction) {
    if (detailState.status !== "ready") return;
    const result = detailState.result;
    if (direction === "next" && result.page.nextCursor)
      void readDetail(result.request.taskId, result.page.nextCursor, result, [
        ...attachmentTrail,
        result.request.attachmentCursor,
      ]);
    if (direction === "previous" && attachmentTrail.length)
      void readDetail(
        result.request.taskId,
        attachmentTrail.at(-1)!,
        result,
        attachmentTrail.slice(0, -1)
      );
    if (direction === "first")
      void readDetail(result.request.taskId, null, result, []);
  }
  const visible = state.status === "ready" ? state.result : null;
  noticeRef.current = kind => {
    clear();
    if (kind === "invalidated") setState({ status: "error" });
    else if (hasRead.current) void readList();
  };
  const assigneeIds = [
    ...new Set([
      owner.userId,
      ...(filters.assigneeId === null ? [] : [filters.assigneeId]),
      ...(visible?.stats?.byAssignee.flatMap(value =>
        value.assigneeId === null ? [] : [value.assigneeId]
      ) ?? []),
    ]),
  ];
  const categories = [
    ...new Set([
      "listing优化",
      "广告优化",
      "绩效处理",
      "其他",
      ...(filters.category === null ? [] : [filters.category]),
      ...(visible?.stats?.byCategory.flatMap(value =>
        value.category === null ? [] : [value.category]
      ) ?? []),
    ]),
  ];
  return (
    <Shell embedded={embedded}>
      {product && (
        <p className="text-sm">
          锁定产品：工作区 {product.workspaceId} · {product.storeName} /{" "}
          {product.country} / {product.parentAsin}
          。只按完整四元组读取，不跨店铺或国家匹配同名 ASIN。
        </p>
      )}
      <form
        aria-label={embedded ? "当前产品任务筛选" : "运营任务筛选"}
        className="space-y-3"
        onSubmit={event => {
          event.preventDefault();
          void readList();
        }}
      >
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="min-w-0 text-sm">
            运营负责人
            <select
              aria-label="筛选运营负责人"
              className={inputClass}
              value={
                filters.unassignedOnly
                  ? "unassigned"
                  : (filters.assigneeId ?? "all")
              }
              onChange={event =>
                change({
                  assigneeId: ["all", "unassigned"].includes(event.target.value)
                    ? null
                    : Number(event.target.value),
                  unassignedOnly: event.target.value === "unassigned",
                })
              }
            >
              <option value="all">当前全部授权负责人</option>
              <option value="unassigned">未分配数字负责人</option>
              {assigneeIds.map(id => (
                <option key={id} value={id}>
                  {visible?.items.find(task => task.assigneeId === id)
                    ?.assigneeName || `负责人 ID ${id}`}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 text-sm">
            任务类型
            <select
              aria-label="筛选任务类型"
              className={inputClass}
              value={
                filters.category === null
                  ? "all"
                  : `category:${filters.category}`
              }
              onChange={event =>
                change({
                  category:
                    event.target.value === "all"
                      ? null
                      : event.target.value.slice("category:".length),
                })
              }
            >
              <option value="all">全部类型（保留原值）</option>
              {categories.map(value => (
                <option key={value} value={`category:${value}`}>
                  {value || "空字符串类型"}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 text-sm">
            任务状态
            <select
              aria-label="筛选任务状态"
              className={inputClass}
              value={filters.status ?? "all"}
              onChange={event =>
                change({
                  status:
                    event.target.value === "all"
                      ? null
                      : (event.target.value as ProductTaskListInput["status"]),
                })
              }
            >
              <option value="all">全部五状态</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 text-sm">
            搜索任务或商品
            <input
              aria-label="搜索任务或商品"
              autoComplete="off"
              className={inputClass}
              value={filters.search}
              onChange={event => change({ search: event.target.value })}
              placeholder="任务、商品名称、ASIN"
            />
          </label>
          <label className="min-w-0 text-sm">
            分组
            <select
              aria-label="任务分组"
              className={inputClass}
              value={filters.groupBy}
              onChange={event =>
                change({
                  groupBy: event.target
                    .value as ProductTaskListInput["groupBy"],
                })
              }
            >
              <option value="none">不分组</option>
              <option value="type">按任务类型</option>
              <option value="status">按任务状态</option>
              <option value="product">按精确关联商品</option>
            </select>
          </label>
        </div>
        {!embedded && (
          <div className="space-y-3 rounded border p-3">
            <div className="flex flex-wrap gap-4">
              <label className="text-sm">
                <input
                  type="checkbox"
                  aria-label="按精确产品筛选任务"
                  checked={productScope.enabled}
                  onChange={event => {
                    clear();
                    setProductScope(value => ({
                      ...value,
                      enabled: event.target.checked,
                    }));
                    setFilters(value => ({ ...value, association: "all" }));
                  }}
                />{" "}
                按精确产品筛选
              </label>
              <label className="text-sm">
                关联状态
                <select
                  aria-label="筛选任务关联状态"
                  className={inputClass}
                  value={filters.association}
                  disabled={productScope.enabled}
                  onChange={event =>
                    change({
                      association: event.target
                        .value as ProductTaskListInput["association"],
                    })
                  }
                >
                  <option value="all">全部关联状态</option>
                  <option value="unlinked">明确未关联商品</option>
                  <option value="issues">关联不完整 / 冲突 / 未接通</option>
                </select>
              </label>
            </div>
            {productScope.enabled && (
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["storeName", "店铺"],
                    ["country", "国家 / 站点"],
                    ["parentAsin", "父 ASIN"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="text-sm">
                    {label}
                    <input
                      aria-label={`任务产品${label}`}
                      autoComplete="off"
                      className={inputClass}
                      value={productScope[key]}
                      onChange={event => {
                        const value = event.target.value;
                        clear();
                        setProductScope(old => ({ ...old, [key]: value }));
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={buttonClass}>
            {embedded ? "读取此产品任务" : "读取已有任务"}
          </button>
          <button type="button" className={buttonClass} onClick={clear}>
            取消并清除任务
          </button>
        </div>
        <p className="text-xs">
          修改筛选立即清除旧结果，点击读取后更新；筛选不是授权。任务/附件只按当前读取版本逐页查看，变化时须回首页重新读取。
        </p>
      </form>
      {state.status === "loading" && (
        <p role="status">正在核验当前授权任务和完整分页来源…</p>
      )}
      {state.status === "invalid" && (
        <p role="alert">任务筛选或产品四元组不完整 / 不合法，未发送请求。</p>
      )}
      {state.status === "error" && (
        <p role="alert">
          任务或详情读取失败，或身份、权限、范围、来源版本及回包完整性已变化；旧列表、正文和附件均已清除，请显式重新读取。
        </p>
      )}
      <ProductTaskActions
        key={JSON.stringify([filters, productScope, state.status === "error"])}
        owner={owner}
        product={product}
        detail={detailState.status === "ready" ? detailState.result : undefined}
        onReadDetail={id => {
          void readDetail(id);
        }}
        onAttachmentPage={attachmentPage}
        hasPreviousAttachmentPage={attachmentTrail.length > 0}
      >
        {actions =>
          state.status === "ready" && (
            <ProductTasksReadOnlyContent
              key={sequence.current}
              result={state.result}
              embedded={embedded}
              detail={
                detailState.status === "ready" ? detailState.result : undefined
              }
              detailState={
                detailState.status === "ready" ? "idle" : detailState.status
              }
              onPage={listPage}
              hasPreviousPage={listTrail.length > 0}
              onDetail={id => {
                void readDetail(id);
              }}
              onAttachmentPage={attachmentPage}
              hasPreviousAttachmentPage={attachmentTrail.length > 0}
              actions={actions}
            />
          )
        }
      </ProductTaskActions>
    </Shell>
  );
}
function AuthorizedProductTasks({
  product,
}: {
  product?: ProductTasksReadScope;
}) {
  const auth = useAuth(),
    permissions = usePermissions(),
    embedded = product !== undefined;
  if (auth.loading)
    return (
      <Shell embedded={embedded}>
        <p role="status">正在确认任务读取身份…</p>
      </Shell>
    );
  if (auth.error)
    return (
      <Shell embedded={embedded}>
        <p role="alert">身份读取失败，任务已隐藏。</p>
      </Shell>
    );
  const user = auth.user;
  if (
    !user ||
    !positiveId(user.id) ||
    !positiveId(user.defaultWorkspaceId) ||
    typeof user.role !== "string" ||
    !user.role.trim()
  )
    return (
      <Shell embedded={embedded}>
        <p role="alert">需要有效用户及明确工作区，未回退全局或旧任务范围。</p>
      </Shell>
    );
  if (permissions.isLoading)
    return (
      <Shell embedded={embedded}>
        <p role="status">正在确认运营任务读取权限…</p>
      </Shell>
    );
  if (
    !permissions.canRead("ops", "ops_dashboard") ||
    !permissions.canRead("ops", "ops_tasks")
  )
    return (
      <Shell embedded={embedded}>
        <p role="alert">运营数据或运营任务读取权限尚未批准，旧任务已隐藏。</p>
      </Shell>
    );
  const parsed = ProductTaskListInputSchema.safeParse(
    initialInput(user.defaultWorkspaceId, product ?? null)
  );
  if (!parsed.success)
    return (
      <Shell embedded={embedded}>
        <p role="alert">当前产品四元组不合法或工作区不一致，未读取任何任务。</p>
      </Shell>
    );
  const owner = {
    userId: user.id,
    workspaceId: user.defaultWorkspaceId,
    role: user.role,
  };
  return (
    <OwnedProductTasks
      key={JSON.stringify([owner, parsed.data.product])}
      owner={owner}
      product={parsed.data.product}
    />
  );
}
export function ProductTasksEmbeddedReadOnly({
  product,
}: {
  product: ProductTasksReadScope;
}) {
  return <AuthorizedProductTasks product={product} />;
}
export default function ProductTasksReadOnly() {
  return <AuthorizedProductTasks />;
}
