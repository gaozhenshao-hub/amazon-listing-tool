import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Tests for the PlatformHome page and DashboardLayout home navigation.
 * These are structural tests that verify the component files contain
 * the expected content and configuration.
 */

const platformHomePath = resolve(__dirname, "../client/src/pages/PlatformHome.tsx");
const dashboardLayoutPath = resolve(__dirname, "../client/src/components/DashboardLayout.tsx");
const indexHtmlPath = resolve(__dirname, "../client/index.html");

describe("PlatformHome page", () => {
  const source = readFileSync(platformHomePath, "utf-8");

  it("should display the correct platform title", () => {
    expect(source).toContain("亚马逊全链路智能工具");
  });

  it("should show user greeting with name", () => {
    expect(source).toContain("欢迎回来");
    expect(source).toContain("user?.name");
  });

  it("should display 4 stats cards", () => {
    expect(source).toContain("工具模块");
    expect(source).toContain("AI能力");
    expect(source).toContain("数据接口");
    expect(source).toContain("支持站点");
  });

  it("should define 5 module cards", () => {
    expect(source).toContain("产品开发AI分析工具");
    expect(source).toContain("Listing智能生成工具");
    expect(source).toContain("运营AI提效工具");
    expect(source).toContain("售后服务与客户管理");
    expect(source).toContain("知识库");
  });

  it("should have correct status badges for each module", () => {
    // 3 completed, 1 developing, 1 planned
    // Count only data entries (exclude type definition line)
    // The type definition line has the pattern: status: "completed" | "developing" | "planned"
    // Data entries have the pattern: status: "completed",
    const completedCount = (source.match(/status: "completed",/g) || []).length;
    const developingCount = (source.match(/status: "developing",/g) || []).length;
    const plannedCount = (source.match(/status: "planned",/g) || []).length;
    expect(completedCount).toBe(3);
    expect(developingCount).toBe(1);
    expect(plannedCount).toBe(1);
  });

  it("should have correct module paths", () => {
    expect(source).toContain('path: "/dev"');
    expect(source).toContain('path: "/listing"');
    expect(source).toContain('path: "/ops"');
    expect(source).toContain('path: "/service"');
    expect(source).toContain('path: "/knowledge"');
  });

  it("should display workflow steps section", () => {
    expect(source).toContain("全链路工作流");
    expect(source).toContain("STEP 01");
    expect(source).toContain("STEP 02");
    expect(source).toContain("STEP 03");
    expect(source).toContain("STEP 04");
    expect(source).toContain("STEP 05");
  });

  it("should have correct workflow step titles", () => {
    expect(source).toContain("选品分析");
    expect(source).toContain("上架优化");
    expect(source).toContain("日常运营");
    expect(source).toContain("售后维护");
    expect(source).toContain("知识沉淀");
  });

  it("should display feature tags for each module", () => {
    expect(source).toContain("选品分析");
    expect(source).toContain("竞品调研");
    expect(source).toContain("标题生成");
    expect(source).toContain("广告优化");
    expect(source).toContain("客服邮件");
    expect(source).toContain("产品创意库");
  });

  it("should have action labels for each module", () => {
    expect(source).toContain("进入工具");
    expect(source).toContain("查看进度");
    expect(source).toContain("了解详情");
  });
});

describe("DashboardLayout home button", () => {
  const source = readFileSync(dashboardLayoutPath, "utf-8");

  it("should import Home icon from lucide-react", () => {
    expect(source).toContain("Home");
    expect(source).toContain("lucide-react");
  });

  it("should have home module detection for root path", () => {
    expect(source).toContain('if (location === "/") return "home"');
  });

  it("should include home in ModuleId type", () => {
    expect(source).toContain('"home"');
  });

  it("should have handleHomeClick function", () => {
    expect(source).toContain("handleHomeClick");
    expect(source).toContain('setLocation("/")');
  });

  it("should render Home icon button in desktop module rail", () => {
    // Home button should be rendered before the module separator
    const homeButtonIndex = source.indexOf("<Home");
    const separatorIndex = source.indexOf("border-t border-border");
    expect(homeButtonIndex).toBeGreaterThan(-1);
    expect(separatorIndex).toBeGreaterThan(homeButtonIndex);
  });

  it("should hide feature sidebar on home page", () => {
    expect(source).toContain("isHomePage");
    expect(source).toContain("!isHomePage && activeModule");
  });

  it("should display correct title on login page", () => {
    expect(source).toContain("亚马逊全链路智能工具");
  });
});

describe("HTML title", () => {
  const html = readFileSync(indexHtmlPath, "utf-8");

  it("should have the correct page title", () => {
    expect(html).toContain("<title>亚马逊全链路智能工具</title>");
  });
});
