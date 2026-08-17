export interface WorkspaceTab {
  href: string;
  label: string;
  lastActiveAt: number;
}

export const WORKSPACE_TABS_STORAGE_KEY = "amz-workspace-tabs-v1";
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
  "/": "首页",
  "/listing": "项目管理",
  "/listing/canvas": "工作流画布",
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
  "/listing/image-suggestions": "智能图片建议",
  "/listing/image-workflow": "智能图片建议",
  "/listing/video-script": "视频脚本生成",
  "/dev": "产品开发仪表盘",
  "/dev/new-project": "新建产品项目",
  "/dev/projects": "产品项目列表",
  "/dev/compare": "产品对比",
  "/dev/supplier-library": "供应商库",
  "/ops": "运营仪表盘",
  "/ops/dashboard-upgrade": "智能运营中心",
  "/ops/products": "产品总览",
  "/ops/inventory": "库存预警",
  "/ops/ads": "广告优化",
  "/ops/ad-deep": "广告深度优化",
  "/ops/custom-dashboard": "自定义看板",
  "/ops/crawler": "爬虫引擎",
  "/ops/logistics": "物流时效分析",
  "/ops/data-import": "ERP 数据导入中心",
  "/ops/ad-mapping": "广告组合映射",
  "/ops/tasks": "任务管理",
  "/service": "售后仪表盘",
  "/service/reviews": "Review智能管理",
  "/service/returns": "退货分析",
  "/service/emails": "邮件管理与AI客服",
  "/service/profiles": "客户画像",
  "/knowledge": "知识库总览",
  "/knowledge/bot": "AI知识助手",
  "/knowledge/products": "智能产品创意库",
  "/knowledge/listings": "智能Listing文案库",
  "/knowledge/images": "智能图片知识库",
  "/knowledge/skills": "智能运营SOP库",
  "/knowledge/videos": "智能视频知识库",
  "/knowledge/intel": "情报推荐中心",
  "/offsite": "站外总览",
  "/offsite/influencers": "达人管理",
  "/offsite/campaigns": "活动管理",
  "/offsite/outreach": "外联管理",
  "/offsite/content-review": "内容审核",
  "/offsite/social-accounts": "社媒账号",
  "/offsite/content-calendar": "内容日历",
  "/offsite/tiktok-matrix": "TikTok矩阵",
  "/offsite/attribution": "归因追踪",
  "/offsite/analytics": "全渠道分析",
  "/emperor": "Skill库",
  "/emperor/skills": "Skill库",
  "/emperor/trace": "运行历史",
  "/emperor/agents": "Agent编排",
  "/emperor/models": "模型路由",
  "/emperor/mcp": "MCP连接器",
  "/emperor/scheduled": "定时任务",
  "/emperor/usage": "Token用量",
  "/emperor/observability": "可观测看板",
  "/emperor/diagnostics": "诊断中心",
  "/emperor/settings": "皇帝通用设置",
  "/emperor/knowledge": "皇帝知识库",
  "/settings": "系统设置",
  "/profile": "个人设置",
  "/admin/users": "用户管理",
  "/admin/review": "审核中心",
  "/admin/assignments": "项目分配",
  "/admin/sop-access": "SOP权限",
  "/admin/roles": "角色管理",
  "/admin/sync": "同步与监控",
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
  return !["/login", "/404"].includes(pathname) && !pathname.startsWith("/__qa__/");
}

export function resolveWorkspaceTabLabel(href: string, preferredLabel?: string): string {
  if (preferredLabel?.trim()) return preferredLabel.trim();

  const parsed = new URL(href, "http://workspace.local");
  const nodeId = parsed.searchParams.get("nodeId") || "";
  if (LISTING_NODE_LABELS[nodeId]) {
    return `${nodeId} · ${LISTING_NODE_LABELS[nodeId]}`;
  }

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
