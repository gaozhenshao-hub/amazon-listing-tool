// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const jobs: any[] = [];
  const start = vi.fn();
  const previewReviews = vi.fn();
  const previewSellerSprite = vi.fn();
  const mutationOptions = vi.fn();
  const invalidateAnalyses = vi.fn().mockResolvedValue(undefined);
  const invalidateJobs = vi.fn().mockResolvedValue(undefined);
  const utils = {
    analysis: {
      listByProject: { invalidate: invalidateAnalyses },
      listImportJobs: {
        invalidate: invalidateJobs,
        setData: vi.fn((_input: unknown, updater: (previous: any[]) => any[]) => {
          state.jobs = updater(state.jobs);
        }),
      },
    },
  };
  const state = { jobs, otherProjectJobs: [] as any[], projectId: 1, queryError: null as any };
  return { state, start, previewReviews, previewSellerSprite, mutationOptions, utils, invalidateAnalyses, success: vi.fn(), info: vi.fn(), error: vi.fn() };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => mocks.utils,
    analysis: {
      listByProject: { useQuery: () => ({ data: [], isLoading: false }) },
      listImportJobs: { useQuery: ({ projectId }: { projectId: number }) => ({ data: projectId === 1 ? mocks.state.jobs : mocks.state.otherProjectJobs, isLoading: false, error: mocks.state.queryError, refetch: vi.fn() }) },
      analyzeAsin: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      analyzeManual: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      delete: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      startImportJob: { useMutation: (options: unknown) => { mocks.mutationOptions(options); return { mutateAsync: mocks.start }; } },
      previewReviewFile: { useMutation: () => ({ mutateAsync: mocks.previewReviews }) },
      previewSellerSpriteFile: { useMutation: () => ({ mutateAsync: mocks.previewSellerSprite }) },
    },
  },
}));
vi.mock("@/contexts/ProjectContext", () => ({ useProject: () => ({ selectedProjectId: mocks.state.projectId }) }));
vi.mock("@/components/ProjectSelector", () => ({ default: () => null }));
vi.mock("@/pages/listing/CompetitorAnalysisSummaryEditor", () => ({ CompetitorAnalysisSummaryEditor: () => null }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, info: mocks.info, error: mocks.error } }));

import AnalysisPage from "./AnalysisPage";

const queuedJob = {
  runId: "job-1", kind: "sellersprite", filename: "竞品.csv", status: "queued", progress: 0,
  result: null, error: null, createdAt: "2026-10-09T08:00:00Z", updatedAt: "2026-10-09T08:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.jobs = [];
  mocks.state.otherProjectJobs = [];
  mocks.state.projectId = 1;
  mocks.state.queryError = null;
  mocks.start.mockReset().mockResolvedValue(queuedJob);
  mocks.previewSellerSprite.mockReset().mockResolvedValue({ success: true, products: [{ asin: "B000000001" }, { asin: "B000000002" }] });
  mocks.previewReviews.mockReset().mockResolvedValue({ totalRows: 2, parsedRows: 2, skippedRows: 0, columns: ["ASIN"], detectedFormat: "CSV", detectedAsins: ["B000000001"], previewReviews: [] });
});
afterEach(cleanup);

async function upload(container: HTMLElement, mode: "卖家精灵" | "评论导入") {
  fireEvent.click(screen.getByRole("button", { name: mode }));
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["asin,content\nB000000001,good"], "竞品.csv", { type: "text/csv" })] } });
  await waitFor(() => expect(mode === "卖家精灵" ? mocks.previewSellerSprite : mocks.previewReviews).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByText(/正在解析文件|解析文件中/)).not.toBeInTheDocument());
}

describe("AnalysisPage durable import submission", () => {
  it("queues once, releases submission loading, and retains only failed SellerSprite rows for manual retry", async () => {
    let resolveSubmit!: (value: unknown) => void;
    mocks.start.mockImplementationOnce(() => new Promise(resolve => { resolveSubmit = resolve; }));
    const view = render(<AnalysisPage />);
    await upload(view.container, "卖家精灵");
    const submit = screen.getByRole("button", { name: /提交后台分析/ });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.mutationOptions).toHaveBeenCalledWith({ retry: false });
    resolveSubmit(queuedJob);
    await waitFor(() => expect(screen.getByRole("button", { name: "已提交后台，请查看任务进度" })).toBeDisabled());
    expect(screen.queryByText("正在上传文件并提交后台任务...")).not.toBeInTheDocument();
    mocks.success.mockClear();
    mocks.state.jobs = [{ ...queuedJob, status: "failed", progress: 100, result: {
      succeeded: 1, failed: 1, results: [{ asin: "B000000001", status: "success" }, { asin: "B000000002", status: "failed", failure: { message: "provider timed out", retryable: true } }],
    } }];
    view.rerender(<AnalysisPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "提交后台分析 (1 条)" })).toBeEnabled());
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.invalidateAnalyses).toHaveBeenCalledWith({ projectId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "提交后台分析 (1 条)" }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
    expect(mocks.start.mock.calls[1][0]).toMatchObject({ selectedAsins: ["B000000002"], fileBase64: mocks.start.mock.calls[0][0].fileBase64 });
  });

  it.each(["卖家精灵", "评论导入"] as const)("retains the %s file after preview timeout and explicitly retries the same payload", async mode => {
    const preview = mode === "卖家精灵" ? mocks.previewSellerSprite : mocks.previewReviews;
    preview.mockRejectedValueOnce(new Error("请求超时"));
    const { container } = render(<AnalysisPage />);
    await upload(container, mode);
    expect(screen.getByText(/请求超时/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试文件预览" }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(preview.mock.calls[1][0]).toEqual(preview.mock.calls[0][0]);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("does not mark zero-row review previews successful or enable submission", async () => {
    mocks.previewReviews.mockResolvedValueOnce({ parsedRows: 0 });
    const { container } = render(<AnalysisPage />);
    await upload(container, "评论导入");
    expect(screen.getByText("未找到有效评论，请检查文件内容与格式")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /提交评论后台导入/ })).toBeDisabled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("keeps a partially failed review file available for explicit resubmission without a success toast", async () => {
    mocks.start.mockResolvedValueOnce({ ...queuedJob, kind: "reviews" });
    const view = render(<AnalysisPage />);
    await upload(view.container, "评论导入");
    fireEvent.click(screen.getByRole("button", { name: /提交评论后台导入/ }));
    await waitFor(() => expect(screen.getByText("已提交后台")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /提交评论后台导入/ })).toBeDisabled();
    mocks.success.mockClear();
    mocks.state.jobs = [{ ...queuedJob, kind: "reviews", status: "failed", progress: 100, result: {
      succeeded: 1, failed: 1, results: [{ asin: "B000000001", status: "matched" }, { asin: "B000000002", status: "failed", error: "AI 调用超时" }],
    } }];
    view.rerender(<AnalysisPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /提交评论后台导入/ })).toBeEnabled());
    expect(mocks.success).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /提交评论后台导入/ }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
    expect(mocks.start.mock.calls[1][0]).toEqual(mocks.start.mock.calls[0][0]);
  });

  it("clears file-reading loading state on FileReader errors", async () => {
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      this.dispatchEvent(new ProgressEvent("error"));
    });
    try {
      const { container } = render(<AnalysisPage />);
      fireEvent.click(screen.getByRole("button", { name: "评论导入" }));
      fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["data"], "竞品.csv")] } });
      expect(screen.getByText("无法读取文件，请重新选择原文件")).toBeInTheDocument();
      expect(screen.queryByText("解析文件中...")).not.toBeInTheDocument();
      expect(mocks.previewReviews).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it("restores an existing job on page load without any new mutation", () => {
    mocks.state.jobs = [{ ...queuedJob, status: "running", progress: 25 }];
    render(<AnalysisPage />);
    expect(screen.getByText("后台分析中")).toBeInTheDocument();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each(["卖家精灵", "评论导入"] as const)("scopes %s uploads and submitted locks to their project while restoring background history", async mode => {
    const kind = mode === "卖家精灵" ? "sellersprite" : "reviews";
    mocks.start.mockResolvedValueOnce({ ...queuedJob, kind });
    const view = render(<AnalysisPage />);
    await upload(view.container, mode);
    fireEvent.click(screen.getByRole("button", { name: mode === "卖家精灵" ? /提交后台分析/ : /提交评论后台导入/ }));
    await waitFor(() => expect(screen.getByText("后台排队中")).toBeInTheDocument());

    mocks.state.projectId = 2;
    view.rerender(<AnalysisPage />);
    fireEvent.click(screen.getByRole("button", { name: mode }));
    expect(screen.queryByText("后台排队中")).not.toBeInTheDocument();
    expect(screen.queryByText("竞品.csv")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "已提交后台，请查看任务进度" })).not.toBeInTheDocument();
    expect(view.container.querySelector('input[type="file"]')).toBeEnabled();
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.start.mock.calls[0][0].projectId).toBe(1);

    mocks.state.projectId = 1;
    view.rerender(<AnalysisPage />);
    expect(screen.getByText("后台排队中")).toBeInTheDocument();
    expect(screen.getByText("竞品.csv")).toBeInTheDocument();
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it("ignores a late upload response in a newly selected project's form", async () => {
    let resolveSubmit!: (value: unknown) => void;
    mocks.start.mockImplementationOnce(() => new Promise(resolve => { resolveSubmit = resolve; }));
    const view = render(<AnalysisPage />);
    await upload(view.container, "卖家精灵");
    fireEvent.click(screen.getByRole("button", { name: /提交后台分析/ }));
    mocks.state.projectId = 2;
    view.rerender(<AnalysisPage />);
    resolveSubmit(queuedJob);
    await waitFor(() => expect(mocks.utils.analysis.listImportJobs.setData).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "卖家精灵" }));
    expect(screen.queryByText("竞品.csv")).not.toBeInTheDocument();
    expect(screen.queryByText("后台排队中")).not.toBeInTheDocument();
    expect(view.container.querySelector('input[type="file"]')).toBeEnabled();
  });
});
