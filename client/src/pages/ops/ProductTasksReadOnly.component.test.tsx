// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductTasksReadOnly, { ProductTasksEmbeddedReadOnly, ProductTasksReadOnlyContent } from "./ProductTasksReadOnly";
import { ProductTaskListInputSchema, ProductTaskDetailInputSchema, buildProductTaskListResult, buildProductTaskDetailResult, buildProductTaskReadFailure, type ProductTaskListInput, type ProductTaskDetailInput, type ProductTaskListResult, type ProductTaskDetailResult, type ProductTaskReadSource, type ProductTaskSourceRecord, type ProductTaskCapabilities } from "@shared/productTaskRead";

const controls = vi.hoisted(() => ({ auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null }, permissions: { isLoading: false, canRead: vi.fn() }, list: vi.fn(), detail: vi.fn(), options: vi.fn(), execute: vi.fn() }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { productTaskRead: { list: { query: controls.list }, detail: { query: controls.detail } }, productTaskWrite: { options: { query: controls.options }, execute: { mutate: controls.execute } } } }) } }));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const product = { workspaceId: 11, storeName: "合成店A", country: "US", parentAsin: "P001" };
const capabilities: ProductTaskCapabilities = { completionNotes: "available", boardProduct: "available", profiles: "available", attachments: "available", partners: "unavailable" };
const timestamp = "2026-10-18 01:02:03.000000";
function input(patch: Partial<ProductTaskListInput> = {}) { return ProductTaskListInputSchema.parse({ expectedWorkspaceId: 11, product: null, association: "all", assigneeId: null, unassignedOnly: false, status: null, category: null, search: "", groupBy: "none", cursor: null, limit: 20, ...patch }); }
function detailInput(taskId = 28, patch: Partial<ProductTaskDetailInput> = {}) { return ProductTaskDetailInputSchema.parse({ expectedWorkspaceId: 11, taskId, attachmentCursor: null, attachmentLimit: 20, ...patch }); }
type Options = { count?: number; fileCount?: number; capabilities?: Partial<ProductTaskCapabilities>; label?: string; version?: string; profileMismatch?: boolean; missingTitle?: boolean; userId?: number; assigneeId?: number; scoped?: boolean };
/** UI fixtures use the actual shared task source parser/builders. No test
 * replaces result validation or invents hand-computed task statistics. */
function source<I extends ProductTaskListInput | ProductTaskDetailInput>(request: I, options: Options = {}): ProductTaskReadSource<I> {
  const caps = { ...capabilities, ...options.capabilities }, count = options.count ?? 28, tasks: ProductTaskSourceRecord[] = Array.from({ length: count }, (_, index) => {
    const id = index + 1, state = (["backlog", "todo", "in_progress", "review", "done"] as const)[index % 5];
    return { id, workspaceId: request.expectedWorkspaceId, productProfileId: options.profileMismatch && id === count ? id : null, creatorId: 7, title: options.label ? `${options.label} ${id}` : `合成任务 ${id}`, description: `任务 ${id} 完整描述\n<script>bad()</script> https://example.test/not-open`, status: state, priority: "medium", category: id === 1 ? "历史自定义类型" : id % 2 ? "listing优化" : "广告优化", assigneeId: options.assigneeId ?? 7, assigneeName: "原姓名不授权", startDate: "2026-10-01", dueDate: id === 2 ? "2026-02-30" : "2026-10-20", completedAt: state === "done" ? timestamp : null, estimatedHours: "2.5", actualHours: null, tags: '["保留原文"]', createdAt: timestamp, updatedAt: options.version ?? timestamp, completionNotes: caps.completionNotes === "available" ? `任务 ${id} 完整完成说明\n保留第二行` : null, boardProduct: caps.boardProduct !== "available" || id === 1 ? null : id === 2 ? { parentAsin: "P001" } : { ...product, workspaceId: request.expectedWorkspaceId, site: id === 4 ? "CA" : "US", storeName: id === 3 ? "合成店B" : "合成店A", ...(options.missingTitle && id === count ? {} : { title: `任务商品 ${id}` }) } };
  });
  return { identity: { userId: options.userId ?? 7, workspaceId: request.expectedWorkspaceId }, input: request, capabilities: caps, access: { all: !options.scoped, assigneeIds: options.scoped ? [options.userId ?? 7] : [] }, tasks, profiles: options.profileMismatch && caps.profiles === "available" ? [{ id: count, workspaceId: request.expectedWorkspaceId, parentAsin: "B-NEW", storeName: "别的店铺", site: "CA", title: "禁止跨来源名称B", chineseName: null, imageUrl: "https://example.test/private-image" }] : [], attachments: caps.attachments === "available" && count ? Array.from({ length: options.fileCount ?? 25 }, (_, index) => ({ id: index + 1, workspaceId: request.expectedWorkspaceId, taskId: count, name: `合成附件-${index + 1}.xlsx`, byteSize: index === 0 ? 0 : 1024 + index, uploadedBy: 7, createdAt: timestamp })) : [], complete: true };
}
const result = (request = input(), options: Options = {}) => buildProductTaskListResult(source(request, options));
const detailResult = (request = detailInput(), options: Options = {}) => buildProductTaskDetailResult(source(request, options));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

beforeEach(()=>{
 localStorage.clear();controls.auth={loading:false,error:null,user:{id:7,defaultWorkspaceId:11,role:"admin"}};
 controls.permissions.isLoading=false;controls.permissions.canRead.mockReset().mockReturnValue(true);
 controls.list.mockReset().mockImplementation(async request=>result(request));controls.detail.mockReset().mockImplementation(async request=>detailResult(request));
 controls.options.mockReset().mockResolvedValue({identity:{userId:7,workspaceId:11},members:[{id:7,displayName:"运营甲"},{id:8,displayName:"运营乙"}],capabilities:Object.fromEntries(["create","update","upload","download","deleteAttachment","partners"].map(key=>[key,{status:"available",reasonCode:null}]))});controls.execute.mockReset();
});
afterEach(cleanup);
describe("task board automatic workflow",()=>{
 it("loads tasks and actions on entry without technical controls",async()=>{
  const view=render(<ProductTasksReadOnly/>);await screen.findByText("合成任务 28");
  expect(controls.options).toHaveBeenCalledTimes(1);expect(controls.list).toHaveBeenCalledTimes(1);
  for(const label of ["读取已有任务","取消并清除任务","检查任务操作权限"])expect(screen.queryByRole("button",{name:label})).not.toBeInTheDocument();
  expect(view.container.querySelector("pre")).toBeNull();expect(screen.queryByText(/任务 ID|任务保存时产品快照|原状态|工作区 11/)).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:/新增运营任务/})).toBeEnabled();
  expect(within(screen.getByLabelText("筛选任务状态")).getAllByRole("option").map(x=>x.textContent)).toEqual(["全部状态","未开始","进行中","已完成"]);
  expect(screen.getByRole("columnheader",{name:"协助人"})).toBeInTheDocument();
 });
 it("refreshes automatically after filters change and names members",async()=>{
  render(<ProductTasksReadOnly/>);await screen.findByText("合成任务 28");
  expect(screen.getByRole("option",{name:"运营乙"})).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("筛选任务状态"),{target:{value:"done"}});
  await waitFor(()=>expect(controls.list).toHaveBeenCalledTimes(2));expect(controls.list.mock.calls[1][0].status).toBe("done");
 });
 it.each(["loading","error","logout","workspace","permissions","denied"])("does not request tasks for %s",async kind=>{
  if(kind==="loading")controls.auth.loading=true;if(kind==="error")controls.auth.error=new Error("private");if(kind==="logout")controls.auth.user=null;if(kind==="workspace")controls.auth.user!.defaultWorkspaceId=null;if(kind==="permissions")controls.permissions.isLoading=true;if(kind==="denied")controls.permissions.canRead.mockReturnValue(false);
  render(<ProductTasksReadOnly/>);await new Promise(resolve=>setTimeout(resolve,250));expect(controls.list).not.toHaveBeenCalled();expect(controls.options).not.toHaveBeenCalled();
 });
 it("embedded tasks preserve their exact product request",async()=>{
  render(<ProductTasksEmbeddedReadOnly product={product}/>);await waitFor(()=>expect(controls.list).toHaveBeenCalled());expect(controls.list.mock.calls[0][0].product).toEqual(product);
 });
 it("shows edit next to content and delegates the exact task",()=>{
  const edit=vi.fn();render(<ProductTasksReadOnlyContent result={result()} actions={{busy:false,edit}}/>);fireEvent.click(screen.getByRole("button",{name:"编辑任务：合成任务 28"}));expect(edit).toHaveBeenCalledWith(expect.objectContaining({id:28}));
 });
 it("ignores an older filter response after a newer one",async()=>{
  const old=deferred<ProductTaskListResult>();controls.list.mockReturnValueOnce(old.promise).mockImplementation(async request=>result(request,{label:"新结果"}));render(<ProductTasksReadOnly/>);
  await waitFor(()=>expect(controls.list).toHaveBeenCalledTimes(1));const request=controls.list.mock.calls[0][0];
  fireEvent.change(screen.getByLabelText("筛选任务类型"),{target:{value:"category:listing优化"}});await screen.findByText("新结果 27");await act(async()=>old.resolve(result(request,{label:"过期"})));expect(screen.queryByText(/过期/)).not.toBeInTheDocument();
 });
 it("rejects a mismatched workspace response",async()=>{
  controls.list.mockImplementation(async request=>({...result(request),identity:{userId:7,workspaceId:12}}));render(<ProductTasksReadOnly/>);await screen.findByRole("alert");expect(screen.queryByText("合成任务 28")).not.toBeInTheDocument();
 });
 it("loads attachments on opening details and rejects a changed version",async()=>{
  controls.detail.mockImplementation(async request=>detailResult(request,{version:"2026-10-20 00:00:00.000000"}));render(<ProductTasksReadOnly/>);await screen.findByText("合成任务 28");fireEvent.click(screen.getByRole("button",{name:"查看任务 28 详情"}));await screen.findByRole("alert");expect(screen.queryByText("合成附件-1.xlsx")).not.toBeInTheDocument();
 });
});
