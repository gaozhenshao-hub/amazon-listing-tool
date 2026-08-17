// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { normalizeFinalImageSuggestions, Step5AplusModuleDetails } from "../ImageWorkflowPage";

describe("Step5历史结果归一化", () => {
  it("将历史aPlusModules连续映射为前台A+ 1至7并保留独立品牌故事", () => {
    const normalized = normalizeFinalImageSuggestions({
      aPlusModules: [
        { moduleNumber: 1, title: "模块一", content: "内容一" },
        { moduleNumber: 2, title: "模块二", content: "内容二" },
        { moduleNumber: 3, title: "模块三", content: "内容三" },
        { moduleNumber: 4, title: "模块四", content: "内容四" },
        { moduleNumber: 5, title: "模块五", content: "内容五" },
        { moduleNumber: 6, title: "模块六", content: "内容六" },
        { moduleNumber: 7, title: "模块七", content: "内容七" },
        { moduleNumber: 8, title: "品牌故事", purpose: "品牌价值" },
      ],
    });

    expect(normalized.aPlusContent.sections.map((section: any) => section.moduleNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(normalized.aPlusContent.sections[6]).toMatchObject({ title: "模块七", content: "内容七" });
    expect(normalized.brandStory).toMatchObject({ title: "品牌故事", purpose: "品牌价值" });
  });

  it("优先保留新版aPlusContent.sections，避免历史aPlusModules覆盖当前分段结果", () => {
    const normalized = normalizeFinalImageSuggestions({
      aPlusModules: [{ moduleNumber: 1, title: "历史模块" }],
      aPlusContent: { sections: [{ moduleNumber: 1, title: "当前分段模块", content: "当前内容" }] },
      brandStory: { title: "当前品牌故事" },
    });

    expect(normalized.aPlusContent.sections).toEqual([{ moduleNumber: 1, title: "当前分段模块", content: "当前内容" }]);
    expect(normalized.brandStory).toEqual({ title: "当前品牌故事" });
  });

  it("保留标题含品牌故事字样但编号为7的合法A+模块", () => {
    const normalized = normalizeFinalImageSuggestions({
      aPlusContent: {
        sections: Array.from({ length: 7 }, (_, index) => ({
          moduleNumber: index + 1,
          title: index === 6 ? "品牌故事与售后承诺" : `模块${index + 1}`,
          content: `模块${index + 1}内容`,
        })),
      },
      brandStory: { title: "独立品牌故事", purpose: "品牌价值" },
    });

    expect(normalized.aPlusContent.sections).toHaveLength(7);
    expect(normalized.aPlusContent.sections[6]).toMatchObject({ moduleNumber: 7, title: "品牌故事与售后承诺", content: "模块7内容" });
    expect(normalized.brandStory).toMatchObject({ title: "独立品牌故事" });
  });

  it("在真实前台模块区块渲染第7模块的Purpose、Content、构图与作图建议", () => {
    render(
      <Step5AplusModuleDetails
        moduleNumber={7}
        section={{
          title: "品牌故事与售后承诺",
          purpose: "巩固客户信任",
          content: "以四个面板收束品牌价值",
          composition: "1464x600px导航轮播布局",
          imageDescription: "工业科技风作图建议",
          subModules: [{ subModuleNumber: 1, title: "Quality Assurance", composition: "保障构图", imageDescription: "保障作图建议" }],
        }}
      />,
    );

    expect(screen.getByText("品牌故事与售后承诺")).toBeInTheDocument();
    expect(screen.getByText("巩固客户信任")).toBeInTheDocument();
    expect(screen.getByText("以四个面板收束品牌价值")).toBeInTheDocument();
    expect(screen.getByText("1464x600px导航轮播布局")).toBeInTheDocument();
    expect(screen.getByText("工业科技风作图建议")).toBeInTheDocument();
    expect(screen.getByText(/A\+ 模块 7\.1/)).toBeInTheDocument();
  });
});
