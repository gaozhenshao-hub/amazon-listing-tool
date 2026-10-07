// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Search } from "lucide-react";
import { ListingGenerationPreparationSummary } from "./ListingGenerationPreparationSummary";

describe("Listing 准备概览与人审事实边界", () => {
  it("显示项目范围与分析就绪状态，但不再宣传自由文本重点强调可作为AI事实", () => {
    const onManageKeywords = vi.fn();
    render(<ListingGenerationPreparationSummary
      project={{ name: "合成测试项目", brand: "Test Brand", productName: "Case" }}
      analysisCount={1}
      fileSummary={{ fileCount: 1, hasAllFiles: false, productAttributes: true }}
      kwReadiness={{ completedSteps: 1, total: 4, allDone: false, steps: [
        { key: "import", label: "关键词导入", done: true, icon: Search, count: 2 },
      ] }}
      onManageKeywords={onManageKeywords}
    />);
    expect(screen.getByText("合成测试项目")).toBeTruthy();
    expect(screen.getByText(/1\/4 分析模块/)).toBeTruthy();
    expect(screen.getByText(/关键词报告仅供人工审阅/)).toBeTruthy();
    expect(screen.getByText(/旧“重点强调”自由文本不再作为 AI 产品事实输入/)).toBeTruthy();
    expect(screen.queryByText(/AI将在生成内容中优先体现/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "前往关键词管理" }));
    expect(onManageKeywords).toHaveBeenCalledOnce();
  });
});
