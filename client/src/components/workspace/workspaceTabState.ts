const ACTIVE_PAGE_PATTERNS = ["^/knowledge/images/[0-9]+$", "^/listing/acquisition/review/[^/]+$", "^/knowledge/acquisition/job/[^/]+$", "^/ops/products/erp/[^/]+/[^/]+$", "^/ops/products/import/[^/]+/[^/]+$", "^/ops/products/[^/]+$", "^/procurement/shipping/[^/]+$", "^/listing/project/[^/]+$", "^/knowledge/acquisition/review/[^/]+$", "^/ops/products/view/[^/]+$", "^/project/[^/]+$"].map(pattern => new RegExp(pattern));
export interface WorkspaceTab {
  href: string;
  label: string;
  lastActiveAt: number;
}

export const WORKSPACE_TABS_STORAGE_KEY = "amz-workspace-tabs-v1";
export const WORKSPACE_CLOSE_AND_NAVIGATE = "workspace-close-and-navigate";
export function closeCurrentWorkspaceTabAndNavigate(destination: string) {
  window.dispatchEvent(new CustomEvent(WORKSPACE_CLOSE_AND_NAVIGATE, { detail: { destination } }));
}
export const MAX_WORKSPACE_TABS = 30;

const LISTING_NODE_LABELS: Record<string, string> = {
  N0: "项目管理",
  N1: "竞品分析",
  N2: "竞品对比",
  N3: "数据文件",
  N4: "关键词管理",
  N5: "评论聚合分析",
  G1: "卖点精雕",
  G2: "标题生成",
  G3: "产品描述",
  G4: "搜索词",
  G5: "QA问答",
  O1: "结果预览",
  O2: "Listing评分",
  O3: "广告架构",
  E1: "智能图片建议",
  E2: "视频脚本",
};

const EXACT_ROUTE_LABELS: Record<string, string> = {
  "/design/images": "美工 · 生图",
  "/design/prompts": "美工 · 提示词库",
  "/design/materials": "美工 · 素材库",
  "/": "首页",
  "/listing": "项目管理",
  "/listing/analysis": "竞品分析",
  "/listing/comparison": "竞品对比",
  "/listing/review-history": "导入历史",
  "/listing/keywords": "关键词管理",
  "/listing/data-files": "数据文件",
  "/listing/review-aggregation": "评论聚合分析",
  "/listing/buyer-questions": "买家问题库",
  "/listing/ad-structure": "广告架构",
  "/listing/generate": "Listing生成",
  "/listing/preview": "结果预览",
  "/listing/score": "Listing评分",
  "/dev": "产品开发",
  "/ops": "运营总览",
  "/ops/products": "产品总览",
  "/ops/product-board": "产品看板",
  "/ops/profit-board": "利润看板",
  "/ops/product-tasks": "任务看板",
  "/ops/inventory": "库存关注",
  "/ops/inventory-details": "库存情况",
  "/ops/ads": "广告看板",
  "/ops/logistics": "物流时效分析",
  "/ops/tasks": "任务看板",
  "/ops/task-tools": "会议与任务辅助",
  "/knowledge": "知识库总览",
  "/knowledge/images": "智能图片知识库",
  "/emperor": "Skill库",
  "/emperor/skills": "Skill库",
  "/emperor/models": "模型路由",
  "/emperor/settings": "皇帝通用设置",
  "/profile": "个人设置",
  "/admin/users": "用户管理",
  "/admin/roles": "角色管理",
  "/procurement": "采购物流",
  "/finance": "财务",
  "/emperor/agent-library": "Agent 库",
  "/knowledge/recycle": "回收站",
  "/knowledge/acquisition": "受控采集与审核",
  "/ops/saihu-sync": "赛狐数据同步",
};

export function normalizeWorkspaceHref(
  location: string,
  browserSearch = "",
  browserHash = "",
): string {
  const parsed = new URL(location || "/", "http://workspace.local");
  if (!parsed.search && browserSearch) {
    parsed.search = browserSearch.startsWith("?") ? browserSearch : `?${browserSearch}`;
  }
  if (!parsed.hash && browserHash) {
    parsed.hash = browserHash.startsWith("#") ? browserHash : `#${browserHash}`;
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function isWorkspaceHref(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const pathname = new URL(href, "http://workspace.local").pathname;
  return Object.hasOwn(EXACT_ROUTE_LABELS, pathname) || ACTIVE_PAGE_PATTERNS.some(pattern => pattern.test(pathname));
}

export function resolveWorkspaceTabLabel(href: string, preferredLabel?: string): string {
  if (preferredLabel?.trim()) return preferredLabel.trim();

  const parsed = new URL(href, "http://workspace.local");
  const nodeId = parsed.searchParams.get("nodeId") || "";
  if (LISTING_NODE_LABELS[nodeId]) {
    return `${nodeId} · ${LISTING_NODE_LABELS[nodeId]}`;
  }

  if (/^\/knowledge\/images\/[0-9]+$/.test(parsed.pathname)) {
    const asin = parsed.searchParams.get("asin");
    return asin && /^(新)*[A-Z0-9]{10}$/.test(asin) ? `套图 · ${asin}` : "ASIN 套图详情";
  }
  if (/^\/knowledge\/acquisition\/job\/[0-9]+$/.test(parsed.pathname)) return "图片采集详情";
  const exact = EXACT_ROUTE_LABELS[parsed.pathname];
  if (exact) return exact;

  const agentCanvasMatch = parsed.pathname.match(/^\/emperor\/agents\/([^/]+)\/canvas$/);
  if (agentCanvasMatch) return `Agent画布 · ${decodeURIComponent(agentCanvasMatch[1])}`;
  if (/^\/dev\/project\/[^/]+\/analysis$/.test(parsed.pathname)) return "市场分析工作台";
  if (/^\/dev\/project\/[^/]+\/offsite$/.test(parsed.pathname)) return "站外分析";
  if (/^\/dev\/project\/[^/]+$/.test(parsed.pathname)) return "产品开发项目";
  if (/^\/listing\/project\/[^/]+$/.test(parsed.pathname)) return "Listing项目详情";
  if (/^\/listing\/video-script\/[^/]+$/.test(parsed.pathname)) return "视频脚本详情";
  if (/^\/ops\/products\/erp\/[^/]+\/[^/]+$/.test(parsed.pathname)) return "ERP 产品详情";
  if (/^\/ops\/products\/import\/[^/]+\/[^/]+$/.test(parsed.pathname)) return "导入产品详情";
  if (/^\/ops\/products\/[^/]+$/.test(parsed.pathname)) return "运营产品详情";
  if (/^\/ops\/shipping\/[^/]+$/.test(parsed.pathname)) return "物流批次详情";

  const segment = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "首页");
  return segment.replace(/[-_]+/g, " ");
}

export function readWorkspaceTabs(raw: string | null): WorkspaceTab[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const unique = new Map<string, WorkspaceTab>();
    for (const item of parsed) {
      if (!item || typeof item.href !== "string" || !isWorkspaceHref(item.href)) continue;
      const href = normalizeWorkspaceHref(item.href);
      unique.set(href, {
        href,
        label: typeof item.label === "string" && item.label.trim()
          ? item.label.trim()
          : resolveWorkspaceTabLabel(href),
        lastActiveAt: Number.isFinite(Number(item.lastActiveAt))
          ? Number(item.lastActiveAt)
          : 0,
      });
    }
    return Array.from(unique.values()).slice(-MAX_WORKSPACE_TABS);
  } catch {
    return [];
  }
}

export function upsertWorkspaceTab(
  tabs: WorkspaceTab[],
  nextTab: WorkspaceTab,
): WorkspaceTab[] {
  if (!isWorkspaceHref(nextTab.href)) return tabs;
  const normalized = {
    ...nextTab,
    href: normalizeWorkspaceHref(nextTab.href),
    label: resolveWorkspaceTabLabel(nextTab.href, nextTab.label),
  };
  const existingIndex = tabs.findIndex((tab) => tab.href === normalized.href);
  if (existingIndex >= 0) {
    return tabs.map((tab, index) => index === existingIndex ? normalized : tab);
  }

  const available = tabs.length >= MAX_WORKSPACE_TABS
    ? tabs.slice(1)
    : tabs;
  return [...available, normalized];
}

export function removeWorkspaceTab(tabs: WorkspaceTab[], href: string): WorkspaceTab[] {
  const normalizedHref = normalizeWorkspaceHref(href);
  return tabs.filter((tab) => tab.href !== normalizedHref);
}
