// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  invalidate: vi.fn(),
}));

const currentListing = {
  id: 401,
  projectId: 17,
  version: 4,
  createdAt: new Date("2026-10-07T00:00:00.000Z"),
  updatedAt: new Date("2026-10-07T00:00:00.000Z"),
  title: "Current title",
  itemHighlights: "Current highlights",
  bulletPoints: "[]",
  description: "<p>Current description</p>",
  searchTerms: "current search",
  imageAdvice: null,
  imageAdviceCn: null,
  titleCn: "当前标题",
  itemHighlightsCn: null,
  bulletPointsCn: "[]",
  descriptionCn: "<p>当前描述</p>",
  searchTermsCn: null,
  qaContent: "[]",
  qaContentCn: "[]",
  lockedSteps: "[]",
  checklistScores: null,
  agentRunId: null,
  isActive: 1,
};

const previewResponse = {
  restoreToken: "signed-server-token",
  expiresAt: new Date(Date.now() + 9 * 60 * 1000),
  preview: {
    sourceSnapshot: {
      id: 501,
      listingId: 401,
      contentVersion: 3,
      fullHash: "b".repeat(64),
      humanApprovalRef: "listing_review:701",
      changeType: "candidate_apply",
      status: "approved",
      expectedListingVersion: 3,
      listingVersion: 4,
      createdBy: 31,
      approvedBy: 31,
      approvedAt: new Date("2026-10-07T00:00:00.000Z"),
      createdAt: new Date("2026-10-07T00:00:00.000Z"),
    },
    sourceFullPayload: { ...currentListing, title: "Approved title" },
    currentFullPayload: currentListing,
    proposedFullPayload: { ...currentListing, title: "Approved title", version: 5 },
    restoredFieldNames: ["title", "qaContent", "lockedSteps"],
    changedFields: ["title", "version", "updatedAt"],
    serverAssignedFields: ["version", "updatedAt"],
    listingId: 401,
    projectId: 17,
    expectedListingVersion: 4,
    expectedFullHash: "a".repeat(64),
    currentFullHash: "a".repeat(64),
    expectedSourceFullHash: "b".repeat(64),
    nextListingVersion: 5,
    humanApprovalRef: `listing_restore:501:${"b".repeat(64)}`,
  },
};

vi.mock("@/components/ProjectSelector", () => ({ default: () => <div>项目已选择</div> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      listing: {
        getActive: { invalidate: mocks.invalidate },
        getVersionHistory: { invalidate: mocks.invalidate },
        listGovernedCompleteRestoreSnapshots: { invalidate: mocks.invalidate },
      },
    }),
    listing: {
      getActive: { useQuery: () => ({ data: currentListing, isLoading: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      translateToChinese: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      getVersionHistory: { useQuery: () => ({ data: [], isLoading: false }) },
      listGovernedCompleteRestoreSnapshots: {
        useQuery: () => ({
          data: [{ ...previewResponse.preview.sourceSnapshot }],
          isLoading: false,
          isFetching: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      previewGovernedCompleteRestore: {
        useQuery: (input: { sourceSnapshotId: number }) => ({
          data: input.sourceSnapshotId === 501 ? previewResponse : undefined,
          isFetching: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      restoreGovernedCompleteSnapshot: {
        useMutation: () => ({ mutate: mocks.restore, isPending: false }),
      },
    },
  },
}));

import { ProjectProvider } from "@/contexts/ProjectContext";
import PreviewPage from "./PreviewPage";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("受治理完整快照恢复交互", () => {
  it("选中完整快照后展示服务端CAS差异，最终确认只提交签名令牌", async () => {
    localStorage.setItem("selectedProjectId", "17");
    render(<ProjectProvider><PreviewPage /></ProjectProvider>);

    const historyTab = screen.getByRole("tab", { name: "版本历史" });
    fireEvent.mouseDown(historyTab, { button: 0, ctrlKey: false });
    fireEvent.click(historyTab);
    fireEvent.click(await screen.findByRole("button", { name: /完整快照 #501/ }));

    expect(await screen.findByText("完整恢复预览：快照 #501")).toBeInTheDocument();
    expect(screen.getByText(/服务端检测到的版本差异（3 项）/)).toBeInTheDocument();
    expect(screen.getByText("英文 Listing")).toBeInTheDocument();
    expect(screen.getAllByText("图片建议").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("QA 与审核状态")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "审核后确认完整恢复" }));
    fireEvent.click(screen.getByRole("button", { name: "我已审核，确认完整恢复" }));

    expect(mocks.restore).toHaveBeenCalledWith({ restoreToken: "signed-server-token" });
    expect(mocks.restore).not.toHaveBeenCalledWith(expect.objectContaining({ projectId: 17 }));
  });
});
