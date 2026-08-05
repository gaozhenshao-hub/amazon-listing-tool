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
