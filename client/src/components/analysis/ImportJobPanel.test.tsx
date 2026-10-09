// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ImportJobPanel, getImportJobOutcome, type ImportJobView } from "./ImportJobPanel";

afterEach(cleanup);

const job: ImportJobView = {
  runId: "import-1", kind: "sellersprite", filename: "竞品.xlsx", status: "queued", progress: 0,
  result: null, error: null, createdAt: "2026-10-09T08:00:00Z", updatedAt: "2026-10-09T08:00:00Z",
};

describe("ImportJobPanel", () => {
  it("restores active tasks without receiving or posting the original file", () => {
    const onRefresh = vi.fn();
    render(<ImportJobPanel jobs={[job]} isLoading={false} onRefresh={onRefresh} />);
    expect(screen.getByText("后台排队中")).toBeInTheDocument();
    expect(screen.getByText("竞品.xlsx")).toBeInTheDocument();
    expect(screen.getByText(/刷新或离开页面后仍可回来查看/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新导入任务" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("shows partial results and the provider failure per ASIN, never as all complete", () => {
    render(<ImportJobPanel jobs={[{
      ...job, status: "failed", progress: 100, result: {
        succeeded: 1, failed: 1, results: [
          { asin: "B000000001", status: "success" },
          { asin: "B000000002", status: "failed", failure: { code: "TIMEOUT", message: "模型响应超时", retryable: true } },
        ],
      },
    }]} isLoading={false} onRefresh={vi.fn()} />);
    expect(screen.getByText("部分完成")).toBeInTheDocument();
    expect(screen.getByText("已完成 1 条 · 未完成 1 条")).toBeInTheDocument();
    expect(screen.getByText("B000000002")).toBeInTheDocument();
    expect(screen.getByText(/模型响应超时/)).toBeInTheDocument();
    expect(screen.queryByText("全部完成")).not.toBeInTheDocument();
  });

  it("keeps stale progress visible and distinguishes polling errors from failed jobs", () => {
    render(<ImportJobPanel jobs={[{ ...job, status: "running", progress: 40 }]} error="请求超时" isLoading={false} onRefresh={vi.fn()} />);
    expect(screen.getByText("后台分析中")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("已提交任务仍在后台继续");
  });

  it("does not treat a nominal success with failed rows as complete", () => {
    expect(getImportJobOutcome({ ...job, status: "succeeded", result: { results: [{ asin: "B000000001", status: "failed", error: "失败" }] } }).complete).toBe(false);
  });
});
