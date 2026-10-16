// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DataFilesPage, { AnalysisResultCard } from "./DataFilesPage";

const mocks = vi.hoisted(() => ({ selectedProjectId: 7 as number | null, update: vi.fn(), restore: vi.fn(), noop: vi.fn() }));
vi.mock("@/contexts/ProjectContext", () => ({ useProject: () => ({ selectedProjectId: mocks.selectedProjectId }) }));
vi.mock("@/components/ProjectSelector", () => ({ default: () => <div>Project selector</div> }));
vi.mock("./listing/ProductProfileAttributeSource", () => ({ default: ({ projectId }: { projectId: number }) => <div data-testid="profile-source">Profile source for {projectId}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => {
  const noMutation = { useMutation: () => ({ mutate: mocks.noop, isPending: false }) };
  return { trpc: {
    useUtils: () => ({ projectFile: {
      listByType: { invalidate: mocks.noop }, listByProject: { invalidate: mocks.noop },
      getAnalysisSummary: { invalidate: mocks.noop }, getVersionHistory: { invalidate: mocks.noop },
    }, buyerQuestions: { list: { invalidate: mocks.noop }, getReadiness: { invalidate: mocks.noop } } }),
    projectFile: {
      getVersionHistory: { useQuery: () => ({ data: [], isLoading: false }) },
      restoreVersion: { useMutation: () => ({ mutate: mocks.restore, isPending: false }) },
      updateAnalysisResult: { useMutation: () => ({ mutate: mocks.update, isPending: false }) },
      uploadAndAnalyze: noMutation, analyze: noMutation, delete: noMutation,
      getAnalysisSummary: { useQuery: () => ({ data: { productAttributes: true } }) },
      listByType: { useQuery: ({ projectId }: { projectId: number }) => ({ data: [{ id: projectId * 10,
        filename: `Source ${projectId}`, status: "completed", fileSize: 100, createdAt: "2026-10-16T00:00:00Z",
        analysisResult: JSON.stringify({ productIdentity: { brand: `Brand ${projectId}` } }) }], isLoading: false }) },
    },
    buyerQuestions: {
      getReadiness: { useQuery: () => ({ data: { hasQuestions: false, count: 0 } }) },
      list: { useQuery: () => ({ data: [], isLoading: false }) }, importFromXlsx: noMutation, update: noMutation, delete: noMutation,
    },
  } };
});

const original = { productIdentity: { brand: "Original brand", productName: "Original product" } };
const replacement = { productIdentity: { brand: "Imported brand", productName: "Imported product" } };
beforeEach(() => { vi.clearAllMocks(); mocks.selectedProjectId = 7; });
afterEach(cleanup);

describe("DataFiles profile-source refresh and dirty drafts", () => {
  it("keeps the old dirty draft but refuses to retarget its save to a new source file", () => {
    const view = render(<AnalysisResultCard fileType="product_attributes" projectId={7} fileId={70} result={original} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByPlaceholderText("品牌"), { target: { value: "Unsaved draft" } });
    view.rerender(<AnalysisResultCard fileType="product_attributes" projectId={7} fileId={71} result={replacement} />);
    expect(screen.getByPlaceholderText("品牌")).toHaveValue("Unsaved draft");
    expect(screen.getByRole("alert")).toHaveTextContent("属性来源已更新，原编辑稿仍保留");
    const save = screen.getByRole("button", { name: "保存" }); expect(save).toBeDisabled(); fireEvent.click(save);
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByText("Imported brand")).toBeInTheDocument(); expect(screen.queryByDisplayValue("Unsaved draft")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑" })); expect(screen.getByPlaceholderText("品牌")).toHaveValue("Imported brand");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(mocks.update).toHaveBeenCalledWith({ fileId: 71, analysisResult: JSON.stringify(replacement), changeNote: "手动编辑" });
  });

  it("same-file refetch never replaces an existing draft or changes its save target", () => {
    const view = render(<AnalysisResultCard fileType="product_attributes" projectId={7} fileId={70} result={original} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByPlaceholderText("品牌"), { target: { value: "Unsaved draft" } });
    view.rerender(<AnalysisResultCard fileType="product_attributes" projectId={7} fileId={70} result={replacement} />);
    expect(screen.getByPlaceholderText("品牌")).toHaveValue("Unsaved draft"); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(mocks.update).toHaveBeenCalledWith({ fileId: 70,
      analysisResult: JSON.stringify({ productIdentity: { ...original.productIdentity, brand: "Unsaved draft" } }), changeNote: "手动编辑" });
  });

  it("a project prop change also fails closed even if the file id is accidentally reused", () => {
    const view = render(<AnalysisResultCard fileType="product_attributes" projectId={7} fileId={70} result={original} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    view.rerender(<AnalysisResultCard fileType="product_attributes" projectId={8} fileId={70} result={replacement} />);
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled(); expect(mocks.update).not.toHaveBeenCalled();
  });

  it("remounts the source card on project selection changes instead of leaking its old draft", () => {
    const view = render(<DataFilesPage />); fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByPlaceholderText("品牌"), { target: { value: "Project 7 private draft" } });
    mocks.selectedProjectId = 8; view.rerender(<DataFilesPage />);
    expect(screen.queryByDisplayValue("Project 7 private draft")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑" })); expect(screen.getByPlaceholderText("品牌")).toHaveValue("Brand 8");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("places profile selection before optional upload and exposes the current-source history anchor", () => {
    const view = render(<DataFilesPage />);
    expect(screen.getByText(/上传作为可选补充/)).toBeInTheDocument(); expect(screen.getByTestId("profile-source")).toHaveTextContent("Profile source for 7");
    expect(view.container.querySelector("#product-attributes-source-history")).toBeInTheDocument();
    expect(screen.getByText(/已有属性分析，不代表事实已确认/)).toBeInTheDocument();
    mocks.selectedProjectId = null; view.rerender(<DataFilesPage />); expect(screen.queryByTestId("profile-source")).not.toBeInTheDocument();
  });
});
