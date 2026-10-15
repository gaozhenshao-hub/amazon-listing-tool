// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MonthlyFinancialFilePreview from "./MonthlyFinancialFilePreview";
import { MONTHLY_PREVIEW_METRICS, type MonthlyFinancialReportPreview } from "@shared/monthlyFinancialReportPreview";

const tasks = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("./monthlyFinancialPreviewTask", () => ({ startMonthlyFinancialPreview: tasks.start }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function deferred() {
  let resolve!: (preview: MonthlyFinancialReportPreview) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<MonthlyFinancialReportPreview>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject, cancel: vi.fn() };
}
function sample(title = "Raw source"): MonthlyFinancialReportPreview {
  const metrics = Object.fromEntries(MONTHLY_PREVIEW_METRICS.map(key => [key, {
    value: key === "financialProfit" ? "-2.1" : key === "salesQty" ? "0" : null,
    sources: ["D3"], unknownSources: [], absent: key !== "financialProfit" && key !== "salesQty",
  }])) as unknown as MonthlyFinancialReportPreview["rows"][number]["metrics"];
  const ratio = { numerator: null, denominator: "0", fraction: null, reason: "分母为零，不计算" };
  return {
    mode: "memory-preview-only", format: "csv", byteLength: 12, amountConvention: "source-signed-no-conversion",
    sheets: [{ name: "Report", range: "A1:F3", headerRows: [1, 2], columns: [] }],
    rows: [{ sheet: "Report", rowNumber: 3, kind: "data", yearMonth: "2026-09", asin: "B012345678",
      parentAsin: null, parentCandidates: [], sku: null, title, storeName: "Store", site: "US",
      currency: null, currencySource: "unknown", allocation: "asin", metrics,
      ratios: { profitMargin: ratio, refundRate: ratio, returnRate: ratio },
      cells: [{ address: "A3", value: title, formula: null, format: null, error: false }],
    }], summaries: [], warnings: [], excludedFromSummaries: [],
  };
}
function choose(name = "report.csv", size = 5) {
  const file = new File(["x".repeat(size)], name);
  fireEvent.change(screen.getByLabelText("选择本地月报文件"), { target: { files: [file] } });
  return file;
}

describe("local monthly report preview", () => {
  it("does not start reading without an explicit local file choice", () => {
    render(<MonthlyFinancialFilePreview scopeKey="user7-workspace1" />);
    expect(tasks.start).not.toHaveBeenCalled();
    expect(screen.getByText(/不上传、不保存/)).toBeInTheDocument();
  });
  it.each([["empty.csv", 0], ["large.xlsx", 5 * 1024 * 1024 + 1], ["old.xls", 3]])(
    "rejects unsupported or oversized %s before starting a worker", (name, size) => {
      render(<MonthlyFinancialFilePreview scopeKey="one" />); choose(name, size);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(tasks.start).not.toHaveBeenCalled();
    },
  );
  it("shows negative, zero, unknown and literal source cells without interpreting markup", async () => {
    const task = deferred(); tasks.start.mockReturnValue(task);
    render(<MonthlyFinancialFilePreview scopeKey="one" />); choose();
    await act(async () => task.resolve(sample("<img src=x onerror=alert(1)>")));
    expect(screen.getByText("-2.1")).toBeInTheDocument();
    expect(screen.getByText("0 / 未知")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看原字段" }));
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "所选月报原字段" }).querySelector("img")).toBeNull();
  });
  it("ignores a late result after selecting a different file", async () => {
    const first = deferred(), second = deferred(); tasks.start.mockReturnValueOnce(first).mockReturnValueOnce(second);
    render(<MonthlyFinancialFilePreview scopeKey="one" />); choose("first.csv"); choose("second.csv");
    expect(first.cancel).toHaveBeenCalledOnce();
    await act(async () => first.resolve(sample("old")));
    expect(screen.queryByText(/已解析 1 行/)).not.toBeInTheDocument();
    await act(async () => second.resolve(sample("new")));
    expect(screen.getByText(/已解析 1 行/)).toBeInTheDocument();
    expect(screen.getByText("当前本地文件：second.csv")).toBeInTheDocument();
  });
  it("clears and cancels without allowing a late result to restore a file", async () => {
    const task = deferred(); tasks.start.mockReturnValue(task);
    render(<MonthlyFinancialFilePreview scopeKey="one" />); choose();
    fireEvent.click(screen.getByRole("button", { name: "取消并清空预览" }));
    await act(async () => task.resolve(sample()));
    expect(task.cancel).toHaveBeenCalledOnce();
    expect(screen.queryByText(/当前本地文件/)).not.toBeInTheDocument();
    expect(screen.queryByText(/已解析 1 行/)).not.toBeInTheDocument();
  });
  it("destroys local file state and pending work on a scope change", async () => {
    const task = deferred(); tasks.start.mockReturnValue(task);
    const view = render(<MonthlyFinancialFilePreview scopeKey="user7-workspace1" />); choose();
    view.rerender(<MonthlyFinancialFilePreview scopeKey="user7-workspace2" />);
    expect(task.cancel).toHaveBeenCalledOnce();
    await act(async () => task.resolve(sample()));
    expect(screen.queryByText(/当前本地文件/)).not.toBeInTheDocument();
    expect(screen.queryByText(/已解析 1 行/)).not.toBeInTheDocument();
  });
  it("cancels its pending worker on unmount", () => {
    const task = deferred(); tasks.start.mockReturnValue(task);
    const view = render(<MonthlyFinancialFilePreview scopeKey="one" />); choose(); view.unmount();
    expect(task.cancel).toHaveBeenCalledOnce();
  });
  it("shows a parser failure without retrying or fabricating data", async () => {
    const task = deferred(); tasks.start.mockReturnValue(task);
    render(<MonthlyFinancialFilePreview scopeKey="one" />); choose();
    await act(async () => task.reject(new Error("ZIP CRC mismatch")));
    expect(screen.getByRole("alert")).toHaveTextContent("ZIP CRC mismatch");
    expect(tasks.start).toHaveBeenCalledOnce();
    expect(screen.queryByText(/已解析 1 行/)).not.toBeInTheDocument();
  });
});
