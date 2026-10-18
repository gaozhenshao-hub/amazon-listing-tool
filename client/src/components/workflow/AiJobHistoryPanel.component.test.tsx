// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: { data: undefined as unknown, isLoading: false, isFetching: false, isError: false, isSuccess: true, refetch: vi.fn() },
  cancel: vi.fn(),
  retry: vi.fn(),
  cancelOptions: vi.fn(),
  retryOptions: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ aiJobs: { list: { invalidate: vi.fn() } } }),
    aiJobs: {
      list: { useQuery: () => mocks.query },
      bindingIntegrity: { useQuery: () => ({ isSuccess: true, data: { healthy: true } }) },
      cancel: { useMutation: (options: unknown) => { mocks.cancelOptions(options); return { isPending: false, mutate: mocks.cancel }; } },
      retry: { useMutation: (options: unknown) => { mocks.retryOptions(options); return { isPending: false, mutate: mocks.retry }; } },
    },
  },
}));

import { AiJobHistoryPanel } from "./AiJobHistoryPanel";

const failed = { runId: "synthetic-failed", kind: "SYNTHETIC failed", status: "failed", attempt: 1, maxAttempts: 3, timeoutSeconds: 300 };
const running = { ...failed, runId: "synthetic-running", kind: "SYNTHETIC running", status: "running" };
function openPanel() {
  const view = render(<AiJobHistoryPanel module="operations" title="运营后台任务历史" />);
  fireEvent.click(screen.getByRole("button", { name: /运营后台任务历史/ }));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.query, { data: [], isLoading: false, isFetching: false, isError: false, isSuccess: true });
});
afterEach(cleanup);

describe("AiJobHistoryPanel query truthfulness", () => {
  it("explicitly disables global automatic retries for both recovery and cancellation", () => {
    openPanel();
    expect(mocks.retryOptions).toHaveBeenCalledWith(expect.objectContaining({ retry: false }));
    expect(mocks.cancelOptions).toHaveBeenCalledWith(expect.objectContaining({ retry: false }));
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("shows only a successful empty response as empty, with the paid-recovery explanation", () => {
    openPanel();
    expect(screen.getByText("暂无后台任务记录")).toBeInTheDocument();
    expect(screen.getByText("恢复会新建关联任务，可能重新调用AI产生费用，不是原回执查询。")).toBeInTheDocument();
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("distinguishes initial loading from an empty history", () => {
    Object.assign(mocks.query, { data: undefined, isSuccess: false, isLoading: true, isFetching: true });
    openPanel();
    expect(screen.getByRole("status")).toHaveTextContent("正在读取任务历史");
    expect(screen.queryByText("暂无后台任务记录")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复任务" })).not.toBeInTheDocument();
  });

  it.each([undefined, null, []])("does not turn query failure with %j into an empty history", data => {
    Object.assign(mocks.query, { data, isSuccess: false, isError: true });
    openPanel();
    expect(screen.getByRole("alert")).toHaveTextContent("任务历史读取失败");
    expect(screen.queryByText("暂无后台任务记录")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("刷新任务历史"));
    expect(mocks.query.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("hides stale cached jobs and both write actions after a failed refresh", () => {
    mocks.query.data = [failed, running];
    const view = openPanel();
    expect(screen.getByRole("button", { name: "恢复任务" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^取消$/ })).toBeEnabled();
    Object.assign(mocks.query, { isError: true, isSuccess: false });
    view.rerender(<AiJobHistoryPanel module="operations" title="运营后台任务历史" />);
    expect(screen.getByRole("alert")).toHaveTextContent("未展示旧缓存");
    expect(screen.queryByText(failed.kind)).not.toBeInTheDocument();
    expect(screen.queryByText(running.kind)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复任务" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^取消$/ })).not.toBeInTheDocument();
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("does not use cached rows as fresh write authority while rereading", () => {
    Object.assign(mocks.query, { data: [failed, running], isFetching: true });
    openPanel();
    expect(screen.getByRole("status")).toHaveTextContent("正在读取任务历史");
    expect(screen.queryByText(failed.kind)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^取消$/ })).not.toBeInTheDocument();
    expect(screen.queryByText("暂无后台任务记录")).not.toBeInTheDocument();
  });

  it("treats a malformed successful payload as unavailable, not empty", () => {
    mocks.query.data = null;
    openPanel();
    expect(screen.getByRole("alert")).toHaveTextContent("任务历史读取失败");
    expect(screen.queryByText("暂无后台任务记录")).not.toBeInTheDocument();
  });
});
