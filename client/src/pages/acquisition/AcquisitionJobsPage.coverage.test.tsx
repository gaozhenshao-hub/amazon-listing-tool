// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  jobCoverage: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "user" } }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ acquisition: { listJobs: { invalidate: vi.fn() }, providerProfile: { invalidate: vi.fn() } } }),
    acquisition: {
      listJobs: { useQuery: () => ({ isLoading: false, isFetching: false, refetch: vi.fn(), data: [{
        id: 12, status: "confirmed", asin: "B000000000", marketplace: "US", consumerType: "competitor_monitor",
        consumerRef: "manual:B000000000", maxChargeUsd: "0.10", createdAt: new Date().toISOString(),
      }] }) },
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

describe("采集缺口补采交互", () => {
  it("预填未请求A+，但未经费用确认不会创建Provider Job", () => {
    mocks.jobCoverage.mockReturnValue({ isLoading: false, error: null, data: {
      status: "confirmed", isCurrent: true,
      coverage: [
        { capability: "image_gallery", state: "returned", storedCount: 2, failedCount: 0 },
        { capability: "aplus", state: "not_requested", storedCount: 0, failedCount: 0 },
        { capability: "brand_story", state: "not_requested", storedCount: 0, failedCount: 0 },
      ],
    } });
    render(<AcquisitionJobsPage />);
    fireEvent.click(screen.getByRole("button", { name: "查看入库范围与缺口" }));
    expect(screen.getAllByText("本次未请求")).toHaveLength(2);
    const fillButtons = screen.getAllByRole("button", { name: "预填补采" });
    fireEvent.click(fillButtons[0]);
    expect(screen.getByRole("textbox", { name: "竞品ASIN" })).toHaveValue("B000000000");
    expect(screen.getByText(/已预填本次缺口：A\+/)).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认补采A+" }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      asin: "B000000000", capabilities: ["catalog_basic", "aplus"], maxChargeUsd: 0.1,
    }));
  });
});
