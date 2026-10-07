// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    quality: {
      dashboard: {
        useQuery: mocks.query,
      },
    },
  },
}));

vi.mock("recharts", async () => {
  const React = await import("react");
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Bar: passthrough,
    BarChart: passthrough,
    CartesianGrid: passthrough,
    Cell: passthrough,
    Pie: passthrough,
    PieChart: passthrough,
    ResponsiveContainer: passthrough,
    Tooltip: passthrough,
    XAxis: passthrough,
    YAxis: passthrough,
  };
});

import QualityDashboard from "./QualityDashboard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const dashboardData = {
  listing: {
    factHumanConfirmation: { numeratorCount: 8, denominatorCount: 10, ratio: 0.8 },
    coreHumanConfirmation: { numeratorCount: 3, denominatorCount: 5, ratio: 0.6 },
    candidateHumanReview: { numeratorCount: 2, denominatorCount: 4, ratio: 0.5, recordedDecisionCount: 3 },
  },
  image: {
    policyHumanReview: { numeratorCount: 3, denominatorCount: 4, ratio: 0.75 },
    licenseEvidenceHumanReview: { numeratorCount: 1, denominatorCount: 2, ratio: 0.5 },
  },
  operations: {
    totalRunCount: 7,
    succeededRunCount: 4,
    failedRunCount: 2,
    activeRunCount: 1,
    canceledRunCount: 0,
    completedRunSuccessRatio: 4 / 6,
  },
  americanEnglishHumanReview: {
    sampleCount: 0,
    message: "样本不足，不能判断美语质量",
  },
};

describe("QualityDashboard", () => {
  it("renders only aggregate governance measures and never converts AI/gate data to American-English human review", () => {
    mocks.query.mockReturnValue({ data: dashboardData, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() });

    render(<QualityDashboard />);

    expect(screen.getByRole("heading", { name: "Listing 与图片质量仪表盘" })).toBeInTheDocument();
    expect(screen.getByText("事实人工确认")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("样本不足，不能判断美语质量")).toBeInTheDocument();
    expect(screen.getByText("Gate、AI 自评、运行成功状态均不等同于人审美语质量。")).toBeInTheDocument();
    expect(screen.queryByText(/B0[A-Z0-9]{8}/)).not.toBeInTheDocument();
  });

  it("shows a no-records state rather than placeholder metrics", () => {
    mocks.query.mockReturnValue({
      data: {
        ...dashboardData,
        listing: {
          factHumanConfirmation: { numeratorCount: 0, denominatorCount: 0, ratio: 0 },
          coreHumanConfirmation: { numeratorCount: 0, denominatorCount: 0, ratio: 0 },
          candidateHumanReview: { numeratorCount: 0, denominatorCount: 0, ratio: 0, recordedDecisionCount: 0 },
        },
        image: {
          policyHumanReview: { numeratorCount: 0, denominatorCount: 0, ratio: 0 },
          licenseEvidenceHumanReview: { numeratorCount: 0, denominatorCount: 0, ratio: 0 },
        },
        operations: { totalRunCount: 0, succeededRunCount: 0, failedRunCount: 0, activeRunCount: 0, canceledRunCount: 0, completedRunSuccessRatio: 0 },
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    render(<QualityDashboard />);

    expect(screen.getByText("当前工作空间暂无可汇总记录")).toBeInTheDocument();
    expect(screen.getByText(/不会填充示例或假数据/)).toBeInTheDocument();
    expect(screen.getByText(/样本不足，不能判断美语质量/)).toBeInTheDocument();
    expect(screen.queryByText("事实人工确认")).not.toBeInTheDocument();
  });

  it("includes canceled runs instead of hiding them from the run-state chart legend", () => {
    mocks.query.mockReturnValue({ data: {
      ...dashboardData,
      operations: { ...dashboardData.operations, totalRunCount: 8, canceledRunCount: 1, completedRunSuccessRatio: 4 / 7 },
    }, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() });

    render(<QualityDashboard />);

    expect(screen.getByText("已取消")).toBeInTheDocument();
  });

  it("shows an actionable error state", () => {
    mocks.query.mockReturnValue({ data: dashboardData, isLoading: false, isError: true, isFetching: false, refetch: vi.fn() });

    render(<QualityDashboard />);

    expect(screen.getByText("无法读取质量仪表盘")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByText("事实人工确认")).not.toBeInTheDocument();
  });
});
