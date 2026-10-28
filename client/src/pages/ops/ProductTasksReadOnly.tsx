import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { ProductTaskActions, subscribeProductTaskChanges, type ProductTaskActionBindings } from "./ProductTaskActions";
import { ProductTaskAttachmentNameSchema } from "@shared/productTaskWrite";
import { ProductTaskListInputSchema, ProductTaskListResultSchema, ProductTaskDetailInputSchema, ProductTaskDetailResultSchema,
  type ProductTaskListInput, type ProductTaskListResult, type ProductTaskDetailInput, type ProductTaskDetailResult, type ProductTaskReadItem } from "@shared/productTaskRead";
type Owner = { userId: number; workspaceId: number; role: string };
export type ProductTasksReadScope = NonNullable<ProductTaskListInput["product"]>;
type Direction = "next" | "previous" | "first";
const STATUS_LABELS = { todo: "未开始", in_progress: "进行中", done: "已完成" } as const;
const statusLabel = (status: string) => status === "done" ? "已完成" : ["review", "in_progress"].includes(status) ? "进行中" : "未开始";
const buttonClass = "rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50 whitespace-nowrap";
const inputClass = "mt-1 w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm";
const cellClass = "max-w-80 whitespace-pre-wrap break-words border-b px-4 py-4 align-top";
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const dateText = (value?: string | null) => value ? value.slice(0, 10) : "—";
function Shell({children, embedded = false}: {children: ReactNode; embedded?: boolean}) {
 return <section aria-label={embedded ? "产品运营任务" : "运营任务看板"} className="manus-no-record relative min-w-0 max-w-full space-y-5 rounded-xl border bg-card p-5">
  <header className="space-y-2 pr-44"><h2 className="text-xl font-semibold">{embedded ? "当前产品 · 运营任务" : "运营任务看板"}</h2>
  <p className="text-sm text-muted-foreground">管理员查看和编辑全部任务；运营与搭档可以互相查看和编辑任务。</p></header>{children}</section>;
}
function PageControls({label, hasPrevious, hasNext, onPage}: {label: string; hasPrevious: boolean; hasNext: boolean; onPage?: (direction: Direction) => void}) {
 if (!hasPrevious && !hasNext) return null;
 return <nav aria-label={`${label}分页`} className="flex gap-2"><button className={buttonClass} disabled={!onPage || !hasPrevious} onClick={()=>onPage?.("previous")}>上一页</button><button className={buttonClass} disabled={!onPage || !hasNext} onClick={()=>onPage?.("next")}>下一页</button></nav>;
}
const initialInput = (workspaceId: number, product: ProductTasksReadScope | null): ProductTaskListInput => ({expectedWorkspaceId: workspaceId, product, association:"all",assigneeId:null,unassignedOnly:false,status:null,category:null,search:"",groupBy:"none",cursor:null,limit:20});
const productName = (task: ProductTaskReadItem) => {
 const source = task.product.basis === "saved_snapshot" ? task.product.snapshot : task.product.currentProfile;
 return source?.chineseName || source?.title || "商品名称待补充";
};
function ProductAssociation({task}: {task: ProductTaskReadItem}) {
 if (task.product.status === "unlinked") return <span className="text-muted-foreground">未关联商品</span>;
 if (!task.product.identity) return <span className="text-amber-700">商品信息待核对</span>;
 return <div><p>{productName(task)}</p><p className="mt-1 text-xs text-muted-foreground">{task.product.identity.parentAsin}</p></div>;
}
function TaskDetail({task,detail,detailState,actions,onAttachmentPage,hasPreviousAttachmentPage}: {task:ProductTaskReadItem;detail?:ProductTaskDetailResult;detailState?:string;actions?:ProductTaskActionBindings;onAttachmentPage?:(direction:Direction)=>void;hasPreviousAttachmentPage?:boolean}) {
 const matched = detail?.status === "ready" && detail.task?.id === task.id && detail.task.workspaceId === task.workspaceId && detail.task.versionKey === task.versionKey ? detail : undefined;
 return <section aria-label="任务详情" className="space-y-4 p-4 text-sm">
  <div><h4 className="font-semibold">任务说明</h4><p className="mt-1 whitespace-pre-wrap">{task.description || "暂无补充说明"}</p></div>
  <div><h4 className="font-semibold">完成情况</h4><p className="mt-1 whitespace-pre-wrap">{task.completionNotes.value || "尚未填写"}</p></div>
  <div><h4 className="font-semibold">附件</h4>
  {detailState === "loading" ? <p role="status">正在加载附件…</p> : detailState === "error" ? <p role="alert">附件加载失败，请刷新后重试。</p> : matched ? <>
   {!matched.attachments.length && <p className="text-muted-foreground">暂无附件</p>}
   {matched.attachments.map(file=><div key={file.id} className="mt-2 flex items-center gap-3 rounded-lg border bg-background p-3"><span className="flex-1 break-all">{file.name}</span><span className="text-xs text-muted-foreground">{Math.ceil(file.byteSize / 1024)} KB</span>{actions?.download && ProductTaskAttachmentNameSchema.safeParse(file.name).success && <button className={buttonClass} disabled={actions.busy} onClick={()=>actions.download?.(task,file.id)}>下载</button>}{actions?.removeAttachment && <button className={buttonClass} disabled={actions.busy} onClick={()=>actions.removeAttachment?.(task,file.id,file.name)}>删除</button>}</div>)}
   <PageControls label="附件" hasPrevious={!!hasPreviousAttachmentPage} hasNext={matched.page.hasMore} onPage={onAttachmentPage}/>
  </> : <p className="text-muted-foreground">{task.attachments.total ? `${task.attachments.total} 个附件` : "暂无附件"}</p>}</div>
 </section>;
}
export type ProductTasksReadOnlyContentProps = {result:ProductTaskListResult;detail?:ProductTaskDetailResult;detailState?:"idle"|"loading"|"error";onPage?:(direction:Direction)=>void;hasPreviousPage?:boolean;onDetail?:(id:number)=>void;onAttachmentPage?:(direction:Direction)=>void;hasPreviousAttachmentPage?:boolean;embedded?:boolean;actions?:ProductTaskActionBindings};
export function ProductTasksReadOnlyContent({result,detail,detailState,onPage,hasPreviousPage=false,onDetail,onAttachmentPage,hasPreviousAttachmentPage=false,embedded=false,actions}:ProductTasksReadOnlyContentProps) {
 const [selectedId,setSelectedId]=useState<number|null>(null),[showDone,setShowDone]=useState(false);
 if (embedded && !result.request.product) return <p role="alert">未找到当前产品，请刷新页面。</p>;
 if (result.status !== "ready" || !result.stats) return <p role="alert">任务暂时无法加载，请稍后刷新重试。</p>;
 const stats=result.stats;
 function selectTask(id:number){actions?.cancelDownloads?.();setSelectedId(selectedId===id?null:id);if(selectedId!==id)onDetail?.(id);}
 const visibleItems=embedded?result.items.filter(task=>showDone||task.status!=="done"):result.items;
 const byId=new Map(visibleItems.map(task=>[task.id,task]));
 const groups=result.request.groupBy==="none"?[]:result.groups.map(group=>({...group,taskIds:group.taskIds.filter(id=>byId.has(id))})).filter(group=>group.taskIds.length);
 const displayed=groups.length?groups.flatMap(group=>group.taskIds.map(id=>byId.get(id)!)):visibleItems;
 const groupHeaders=new Map(groups.map(group=>[group.taskIds[0],group.label]));
 return <div className="space-y-5">
  {!embedded && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["全部任务",stats.total],["未开始",stats.byStatus.todo+stats.byStatus.backlog],["进行中",stats.byStatus.in_progress+stats.byStatus.review],["已完成",stats.done]].map(([label,count])=><div key={label} className="rounded-xl border bg-background p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{count}</p></div>)}</div>}
  <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">任务列表 <span className="ml-2 text-sm font-normal text-muted-foreground">共 {stats.total} 项</span></h3><PageControls label="任务列表" hasPrevious={hasPreviousPage} hasNext={result.page.hasMore} onPage={onPage}/></div>
  {embedded && stats.done>0 && <button className={buttonClass} aria-expanded={showDone} onClick={()=>setShowDone(!showDone)}>{showDone?"收起":"展开"}已完成任务（{stats.done}）</button>}
  {!displayed.length ? <p className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">暂无符合条件的任务</p> : <div className="max-w-full overflow-x-auto rounded-xl border"><table className="w-full min-w-[1200px] text-left text-sm"><thead className="bg-muted/60"><tr>{["任务内容 / 详情","任务类型","关联商品","运营负责人","协助人","任务状态","创建日期","预计完成日期","完成日期","完成说明 / 附件"].map(label=><th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>
  {displayed.map(task=><Fragment key={task.id}>{groupHeaders.has(task.id) && <tr><td colSpan={10} className="bg-muted/50 px-4 py-2 font-medium">{groupHeaders.get(task.id)}</td></tr>}<tr className="hover:bg-muted/20"><td className={cellClass}><div className="flex min-w-56 items-start gap-3"><button className="flex-1 text-left font-medium hover:text-primary" aria-label={`查看任务 ${task.id} 详情`} aria-expanded={selectedId===task.id} onClick={()=>selectTask(task.id)}>{task.title}</button>{actions?.edit && <button className="shrink-0 rounded-md border border-primary/30 px-2 py-1 text-xs text-primary hover:bg-primary/10" aria-label={`编辑任务：${task.title}`} disabled={actions.busy} onClick={()=>actions.edit?.(task)}>编辑</button>}</div></td>
   <td className={cellClass}>{task.category||"其他"}</td><td className={cellClass}><ProductAssociation task={task}/></td><td className={cellClass}>{task.assigneeName||"未分配"}</td><td className={cellClass}>{task.assistantName||"—"}</td><td className={cellClass}><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${task.status==="done"?"bg-green-50 text-green-700":task.status==="in_progress"?"bg-orange-50 text-orange-700":"bg-slate-100 text-slate-600"}`}>{statusLabel(task.status)}</span></td>
   <td className={cellClass}>{dateText(task.createdAt)}</td><td className={cellClass}>{dateText(task.dueDate.value)}</td><td className={cellClass}>{dateText(task.completedAt)}</td><td className={cellClass}><p className="line-clamp-3">{task.completionNotes.value||"—"}</p>{!!task.attachments.total && <button className="mt-2 text-primary" onClick={()=>selectTask(task.id)}>{task.attachments.total} 个附件</button>}</td></tr>
   {selectedId===task.id && <tr><td colSpan={10} className="border-b bg-muted/20"><TaskDetail task={task} detail={detail} detailState={detailState} actions={actions} onAttachmentPage={onAttachmentPage} hasPreviousAttachmentPage={hasPreviousAttachmentPage}/></td></tr>}
  </Fragment>)}</tbody></table></div>}
 </div>;
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
  const [members, setMembers] = useState<{id:number;displayName:string}[]>([]);
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
        result.capabilities.partners !== "available" &&
        (result.items.some(task => task.assigneeId !== owner.userId && task.assistantId !== owner.userId))
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
  useEffect(() => {
    const timer = setTimeout(() => void readList(), 200);
    return () => { clearTimeout(timer); pending.current?.abort(); };
  }, [filters]);
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
      ...members.map(member => member.id),
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
              <option value="all">全部运营</option>
              <option value="unassigned">未分配</option>
              {assigneeIds.map(id => (
                <option key={id} value={id}>
                  {members.find(member => member.id === id)?.displayName || visible?.items.find(task => task.assigneeId === id)?.assigneeName || "未命名成员"}
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
              <option value="all">全部类型</option>
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
              <option value="all">全部状态</option>
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
              <option value="product">按关联商品</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end"><button type="submit" className={buttonClass}>刷新</button></div>
      </form>
      {state.status === "loading" && (
        <p role="status">正在加载任务…</p>
      )}
      {state.status === "invalid" && (
        <p role="alert">筛选条件有误，请重新选择。</p>
      )}
      {state.status === "error" && (
        <p role="alert">
          任务加载失败，请点击刷新重试。
        </p>
      )}
      <ProductTaskActions
        key={JSON.stringify([owner, product])}
        owner={owner}
        onMembers={setMembers}
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
