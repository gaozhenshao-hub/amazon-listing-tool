import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Crawler Manager Frontend Page", () => {
  const pagePath = path.resolve(__dirname, "../client/src/pages/ops/OpsCrawlerManager.tsx");

  it("OpsCrawlerManager.tsx file exists", () => {
    expect(fs.existsSync(pagePath)).toBe(true);
  });

  it("exports a default component", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("export default function OpsCrawlerManager");
  });

  it("contains SchedulerPanel component", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("function SchedulerPanel");
    expect(content).toContain("SchedulerPanel");
  });

  it("contains CompetitorCrawlPanel component", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("function CompetitorCrawlPanel");
  });

  it("contains KeywordCrawlPanel component", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("function KeywordCrawlPanel");
  });

  it("uses crawler tRPC endpoints", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("trpc.crawler.getSchedulerStatus");
    expect(content).toContain("trpc.crawler.startScheduler");
    expect(content).toContain("trpc.crawler.stopScheduler");
    expect(content).toContain("trpc.crawler.crawlCompetitor");
    expect(content).toContain("trpc.crawler.crawlKeyword");
    expect(content).toContain("trpc.crawler.crawlAllCompetitors");
    expect(content).toContain("trpc.crawler.crawlAllKeywords");
    expect(content).toContain("trpc.crawler.getCrawlHistory");
  });

  it("has three tabs: overview, competitor, keyword", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain('value="overview"');
    expect(content).toContain('value="competitor"');
    expect(content).toContain('value="keyword"');
  });

  it("contains history dialog components", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("CompetitorHistoryDialog");
    expect(content).toContain("KeywordHistoryDialog");
  });

  it("uses Recharts for data visualization", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("LineChart");
    expect(content).toContain("BarChart");
    expect(content).toContain("ResponsiveContainer");
  });

  it("has batch crawl functionality", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("crawlAll");
    expect(content).toContain("全部抓取");
  });

  it("has helper components for price and rank changes", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("function PriceChange");
    expect(content).toContain("function RankChange");
  });
});

describe("Crawler Manager Route Registration", () => {
  const appPath = path.resolve(__dirname, "../client/src/App.tsx");

  it("App.tsx imports OpsCrawlerManager", () => {
    const content = fs.readFileSync(appPath, "utf-8");
    expect(content).toContain('import OpsCrawlerManager from "./pages/ops/OpsCrawlerManager"');
  });

  it("App.tsx has /ops/crawler route", () => {
    const content = fs.readFileSync(appPath, "utf-8");
    expect(content).toContain('path="/ops/crawler"');
  });
});

describe("Crawler Manager Sidebar Navigation", () => {
  const layoutPath = path.resolve(__dirname, "../client/src/components/DashboardLayout.tsx");

  it("DashboardLayout has crawler nav item", () => {
    const content = fs.readFileSync(layoutPath, "utf-8");
    expect(content).toContain('label: "爬虫引擎"');
    expect(content).toContain('path: "/ops/crawler"');
  });
});

describe("Crawler Router Backend", () => {
  const routerPath = path.resolve(__dirname, "./routers/crawler.ts");

  it("crawler router file exists", () => {
    expect(fs.existsSync(routerPath)).toBe(true);
  });

  it("has all required procedures", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("crawlCompetitor:");
    expect(content).toContain("crawlKeyword:");
    expect(content).toContain("crawlAllCompetitors:");
    expect(content).toContain("crawlAllKeywords:");
    expect(content).toContain("getSchedulerStatus:");
    expect(content).toContain("startScheduler:");
    expect(content).toContain("stopScheduler:");
    expect(content).toContain("getCrawlHistory:");
  });
});
