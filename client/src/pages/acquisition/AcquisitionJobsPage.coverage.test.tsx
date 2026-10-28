// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  retry: vi.fn(),
  deletion: vi.fn(),
  role: "user",
  jobCoverage: vi.fn(),
  jobs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: mocks.role } }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ acquisition: { listJobs: { invalidate: vi.fn() }, providerProfile: { invalidate: vi.fn() } } }),
    acquisition: {
      recollectJob: { useMutation: () => ({ mutate: mocks.retry, isPending: false }) },
      deleteJob: { useMutation: () => ({ mutate: mocks.deletion, isPending: false }) },
      collectKnowledge: { useMutation: () => ({ mutate: mocks.create, isPending: false }) },
      listJobs: { useQuery: () => ({ isLoading: false, isFetching: false, refetch: vi.fn(), data: mocks.jobs }) },
      jobCoverage: { useQuery: mocks.jobCoverage },
      providerProfile: { useQuery: () => ({ data: undefined }) },
      createJob: { useMutation: () => ({ mutate: mocks.create, isPending: false }) },
      saveProviderProfile: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      ingestLegacyPartialJob: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import AcquisitionJobsPage from "./AcquisitionJobsPage";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => { mocks.role = "user"; mocks.jobs = [{ id: 12, status: "confirmed", asin: "B000000000", marketplace: "US", consumerType: "kb_images",
  consumerRef: "manual:B000000000", requestedAt: new Date().toISOString() }]; });

describe("采集历史范围", () => {
  it("starts successful records collapsed, including explicitly accepted missing media",()=>{
    mocks.jobs[0]={...mocks.jobs[0],acceptedMissing:1,missingMainVideos:1};
    render(<AcquisitionJobsPage/>);
    expect(screen.queryByRole("region",{name:"采集失败 / 待补录"})).toBeNull();
    expect(screen.queryByRole("link",{name:"查看采集情况"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"展开"}));
    expect(screen.getByRole("link",{name:"查看采集情况"})).toBeVisible();
  });
  it("keeps deletion admin-only and recollection requires an explicit action", () => {
    mocks.jobCoverage.mockReturnValue({ isLoading: false });
    const { rerender } = render(<AcquisitionJobsPage />);
    if(screen.queryByRole("button",{name:"展开"}))fireEvent.click(screen.getByRole("button",{name:"展开"}));
    expect(screen.queryByRole("button", { name: "删除记录" })).toBeNull();
    expect(mocks.retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新采集（缺失部分）" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("已保存的素材不变");
    fireEvent.click(screen.getByRole("button", { name: "确认重新采集" }));
    expect(mocks.retry).toHaveBeenCalledWith({ jobId: 12, requestId: expect.any(String) });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    mocks.role = "admin";
    rerender(<AcquisitionJobsPage />);
    if(screen.queryByRole("button",{name:"展开"}))fireEvent.click(screen.getByRole("button",{name:"展开"}));
    fireEvent.click(screen.getByRole("button", { name: "删除记录" }));
    expect(mocks.deletion).toHaveBeenCalledWith({ jobId: 12 });
  });
  it("disables destructive or repeated actions while collection is running", () => {
    mocks.role = "admin"; mocks.jobs[0].status = "running";
    render(<AcquisitionJobsPage />);
    if(screen.queryByRole("button",{name:"展开"}))fireEvent.click(screen.getByRole("button",{name:"展开"}));
    expect(screen.getByRole("button", { name: "重新采集（缺失部分）" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除记录" })).toBeDisabled();
  });
  it("失败和缺图置顶，成功放到最下方；状态变化后自动移组", () => {
    mocks.jobCoverage.mockReturnValue({ isLoading: false });
    mocks.jobs = ["confirmed", "running", "failed", "review_required", "queued", "canceled"].map((status, i) => ({
      id: i+1, asin: `B00000000${i}`, status, marketplace: "US", consumerType: "kb_images",
    }));
    const { rerender } = render(<AcquisitionJobsPage />);
    if(screen.queryByRole("button",{name:"展开"}))fireEvent.click(screen.getByRole("button",{name:"展开"}));
    expect(screen.getAllByRole("region").map(region => region.getAttribute("aria-labelledby"))).toEqual([
      "collection-attention", "collection-active", "collection-canceled", "collection-completed",
    ]);
    const attention = screen.getByRole("region", { name: "采集失败 / 待补录" });
    expect(within(attention).getAllByRole("link", { name: "查看采集情况" }).map(link => link.getAttribute("href")))
      .toEqual(["/knowledge/acquisition/job/3", "/knowledge/acquisition/job/4"]);
    mocks.jobs[3].status = "confirmed";
    rerender(<AcquisitionJobsPage />);
    if(screen.queryByRole("button",{name:"展开"}))fireEvent.click(screen.getByRole("button",{name:"展开"}));
    expect(within(screen.getByRole("region", { name: "采集成功" })).getAllByRole("link", { name: "查看采集情况" }))
      .toHaveLength(2);
  });
  it("keeps confirmed image sets with missing videos in attention until both video types are complete", () => {
    mocks.jobs = [
      { id: 1, asin: "B000000001", status: "confirmed", consumerType: "kb_images", missingMainVideos: 1, missingAplusVideos: 0 },
      { id: 2, asin: "B000000002", status: "confirmed", consumerType: "kb_images", missingMainVideos: 0, missingAplusVideos: 2 },
      { id: 3, asin: "B000000003", status: "confirmed", consumerType: "kb_images", missingMainVideos: 0, missingAplusVideos: 0 },
    ];
    const { rerender } = render(<AcquisitionJobsPage />);
    if(screen.queryByRole("button",{name:"展开"}))fireEvent.click(screen.getByRole("button",{name:"展开"}));
    const attention = screen.getByRole("region", { name: "采集失败 / 待补录" });
    expect(within(attention).getByText("待补录：主图视频 1 条 · 图片已入库")).toBeVisible();
    expect(within(attention).getByText("待补录：A+ 视频 2 条 · 图片已入库")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "采集成功" })).queryByText("B000000001")).toBeNull();
    mocks.jobs[0].missingMainVideos = 0;
    rerender(<AcquisitionJobsPage />);
    if(screen.queryByRole("button",{name:"展开"}))fireEvent.click(screen.getByRole("button",{name:"展开"}));
    expect(within(screen.getByRole("region", { name: "采集成功" })).getByText("B000000001")).toBeVisible();
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([false, true])("只读展示历史结果；缓存过期=%s 时显示正确说明", cacheExpired => {
    mocks.jobCoverage.mockReturnValue({ isLoading: false, error: null, data: {
      status: "confirmed", isCurrent: !cacheExpired, cacheExpired,
      coverage: [
        { capability: "image_gallery", state: "returned", storedCount: 2, failedCount: 0 },
        { capability: "aplus", state: "not_requested", storedCount: 0, failedCount: 0 },
        { capability: "brand_story", state: "not_requested", storedCount: 0, failedCount: 0 },
      ],
    } });
    render(<AcquisitionJobsPage />);
    if(screen.queryByRole("button",{name:"展开"}))fireEvent.click(screen.getByRole("button",{name:"展开"}));
    expect(screen.getByRole("link", { name: "查看采集情况" })).toHaveAttribute("href", "/knowledge/acquisition/job/12");
    fireEvent.click(screen.getByRole("button", { name: "查看入库范围与缺口" }));
    expect(screen.getAllByText("本次未请求")).toHaveLength(2);
    expect(screen.getByText("已安全保存 2 张")).toBeVisible();
    expect(screen.queryByText(/临时缓存已过期/)).toBe(cacheExpired ? screen.getByText(/临时缓存已过期/) : null);
    expect(screen.queryByText(/该快照已被更新版替代/)).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
