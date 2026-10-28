// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("wouter", async original => ({ ...await original<typeof import("wouter")>(), useParams: () => ({ jobId: "9" }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { acquisition: { jobDetails: { useQuery: mocks.query }, confirmCompletedCollection:{useMutation:()=>({mutate:vi.fn(),isPending:false})},retryMissingAsset:{useMutation:()=>({mutate:vi.fn(),isPending:false})},supplementMissingImage:{useMutation:()=>({mutateAsync:vi.fn(),isPending:false})} } } }));
vi.mock("./AcquisitionSupplementForm", () => ({ default: () => <p>补图上传表单</p> }));
vi.mock("./AcquisitionRecordActions", () => ({ default: () => <div>采集记录操作</div> }));
import AcquisitionJobDetailsPage from "./AcquisitionJobDetailsPage";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const data = { jobId: 9, asin: "B0G3WN7CL2", title: "Camping light", status: "confirmed", canSupplement: true, imageSetId: 21, total: 2, completed: 2, stored: 1, failed: 1, retried: 2, recovered: 1,
  assets: [{ id: 1, role: "main", position: 0, status: "saved", attempts: 2, previewUrl: "/preview" }, { id: 2, role: "aplus", position: 0, status: "failed", attempts: 2, previewUrl: null }] };
describe("collection detail view", () => {
  it("shows both missing video types and links to their covers after images are ingested", () => {
    mocks.query.mockReturnValue({data:{...data,missingMainVideos:1,missingAplusVideos:1,
      assets:[{id:3,role:"video",label:"主图视频",position:0,status:"failed",attempts:2,previewUrl:"/cover"},
        {id:4,role:"video",label:"A+视频",position:1,status:"failed",attempts:2,previewUrl:null}]},refetch:vi.fn()});
    render(<AcquisitionJobDetailsPage/>);
    expect(screen.getByRole("status")).toHaveTextContent("视频待补录：主图视频 1 条、A+ 视频 1 条");
    expect(screen.getByRole("status")).toHaveTextContent("图片已入库");
    expect(screen.getByRole("link",{name:"查看未取得的视频"})).toHaveAttribute("href","#collection-videos");
    expect(screen.queryByRole("button",{name:"确认入库"})).toBeNull();
  });
  it("explains expired previews without displaying missing-image cards", () => {
    mocks.query.mockReturnValue({ data: { ...data, cacheExpiredAt: new Date(), canSupplement: false, assets: [] }, refetch: vi.fn() });
    render(<AcquisitionJobDetailsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("临时采集缓存已过期");
    expect(screen.queryByRole("button", { name: "人工补图" })).toBeNull();
    expect(screen.queryByText("本次未取得此类素材。")).toBeNull();
  });
  it("shows failed videos without offering an image upload for them",()=>{
    mocks.query.mockReturnValue({data:{...data,status:"review_required",canConfirm:true,assets:[{id:3,role:"video",label:"A+ 视频",position:0,status:"failed",attempts:2,previewUrl:"/cover"}]},refetch:vi.fn()});
    render(<AcquisitionJobDetailsPage/>);
    expect(screen.getByText("A+ 视频 1")).toBeVisible();
    expect(screen.queryByText("上传对应图片")).toBeNull();
    expect(screen.getByRole("button",{name:"确认入库"})).toBeEnabled();
  });
  it("automatically reads results and exposes recovered images, remaining gaps and manual upload", () => {
    mocks.query.mockReturnValue({ data, refetch: vi.fn() }); render(<AcquisitionJobDetailsPage />);
    expect(screen.getByText("重试后已保存")).toBeVisible();
    expect(screen.getByText("已重试，仍未取得")).toBeVisible();
    expect(screen.queryByRole("button", { name: "人工补图" })).toBeNull();
    expect(screen.getByRole("button", {name:"重新采集该图片"})).toBeVisible();
    expect(screen.getByText("手动补图")).toBeVisible();
    const options = mocks.query.mock.calls[0][1];
    expect(options.refetchInterval({ state: { data: { status: "running" } } })).toBe(2500);
    expect(options.refetchInterval({ state: { data } })).toBe(false);
  });
  it("shows running progress but does not permit editing before collection finishes", () => {
    mocks.query.mockReturnValue({ data: { ...data, status: "running", canSupplement: false, completed: 1 }, refetch: vi.fn() }); render(<AcquisitionJobDetailsPage />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(screen.queryByRole("button", { name: "人工补图" })).toBeNull();
  });
  it("keeps polling after collection while automatic tags run and shows completion separately", () => {
    const tagged = { ...data, tagging: { status: "running", completed: 3, total: 8 } };
    mocks.query.mockReturnValue({ data: tagged, refetch: vi.fn() }); render(<AcquisitionJobDetailsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("小酷自动打标签 · 正在打标签");
    expect(screen.getByRole("status")).toHaveTextContent("3 / 8");
    expect(mocks.query.mock.calls[0][1].refetchInterval({ state: { data: tagged } })).toBe(2500);
    expect(mocks.query.mock.calls[0][1].refetchInterval({ state: { data: { ...tagged, tagging: { status: "completed" } } } })).toBe(false);
  });
});
