import { describe, expect, it } from "vitest";
import {
  normalizeWorkspaceHref,
  readWorkspaceTabs,
  removeWorkspaceTab,
  resolveWorkspaceTabLabel,
  upsertWorkspaceTab,
} from "./workspaceTabState";

describe("global workspace tabs", () => {
  it("preserves route parameters used by projects and Agent nodes", () => {
    expect(normalizeWorkspaceHref(
      "/listing/analysis",
      "?agentRunId=run_1&nodeId=N1&projectId=8",
    )).toBe("/listing/analysis?agentRunId=run_1&nodeId=N1&projectId=8");
  });

  it("resolves labels across normal, dynamic, and Agent routes", () => {
    expect(resolveWorkspaceTabLabel("/ops/inventory")).toBe("库存预警");
    expect(resolveWorkspaceTabLabel("/dev/project/12/analysis")).toBe("市场分析工作台");
    expect(resolveWorkspaceTabLabel("/listing/generate?agentRunId=run_1&nodeId=G3")).toBe("G3 · 产品描述");
    expect(resolveWorkspaceTabLabel("/emperor/agents/listing.full.workflow/canvas"))
      .toBe("Agent画布 · listing.full.workflow");
  });

  it.each([
    ["/ops/product-board", "产品看板"],
    ["/ops/profit-board", "利润看板"],
    ["/ops/product-tasks", "产品任务"],
  ])("uses the exact operations title for %s including query and hash", (path, label) => {
    for (const suffix of ["", "?month=2026-10&operatorId=7", "#details", "?storeName=Store%20A&country=US#details"]) {
      const href = `${path}${suffix}`;
      expect(resolveWorkspaceTabLabel(href)).toBe(label);
      expect(readWorkspaceTabs(JSON.stringify([{ href, lastActiveAt: 1 }]))).toEqual([{ href, label, lastActiveAt: 1 }]);
      expect(upsertWorkspaceTab([], { href, label: "", lastActiveAt: 1 })).toEqual([{ href, label, lastActiveAt: 1 }]);
    }
    const href = normalizeWorkspaceHref(path, "month=2026-10", "details");
    expect(href).toBe(`${path}?month=2026-10#details`);
    expect(resolveWorkspaceTabLabel(href)).toBe(label);
  });

  it("keeps existing operations labels and preferred labels unchanged", () => {
    expect(resolveWorkspaceTabLabel("/ops/products?country=US#history")).toBe("产品总览");
    expect(resolveWorkspaceTabLabel("/ops/tasks?status=pending")).toBe("任务管理");
    expect(resolveWorkspaceTabLabel("/ops/product-board", " 自定义标签 ")).toBe("自定义标签");
    expect(resolveWorkspaceTabLabel("/ops/product-board-other")).toBe("product board other");
  });

  it("adds, revisits, and removes tabs without losing the other open pages", () => {
    const first = upsertWorkspaceTab([], {
      href: "/listing/canvas",
      label: "工作流画布",
      lastActiveAt: 1,
    });
    const second = upsertWorkspaceTab(first, {
      href: "/ops/ads",
      label: "广告优化",
      lastActiveAt: 2,
    });
    const revisited = upsertWorkspaceTab(second, {
      href: "/listing/canvas",
      label: "工作流画布",
      lastActiveAt: 3,
    });

    expect(revisited).toHaveLength(2);
    expect(revisited[0].lastActiveAt).toBe(3);
    expect(removeWorkspaceTab(revisited, "/ops/ads").map((tab) => tab.href))
      .toEqual(["/listing/canvas"]);
  });

  it("rejects malformed and public-page entries when restoring storage", () => {
    expect(readWorkspaceTabs("not-json")).toEqual([]);
    expect(readWorkspaceTabs(JSON.stringify([
      { href: "/login", label: "登录", lastActiveAt: 1 },
      { href: "https://example.com", label: "外部页面", lastActiveAt: 2 },
      { href: "/knowledge", label: "知识库", lastActiveAt: 3 },
    ]))).toEqual([
      { href: "/knowledge", label: "知识库", lastActiveAt: 3 },
    ]);
  });
});
