import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getLoginUrl } from "@/const";
import NotificationBell from "@/components/NotificationBell";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard,
  LogOut,
  PanelLeft,
  Search,
  FileText,
  Image,
  Sparkles,
  GitCompareArrows,
  History,
  Database,
  BarChart3,
  Gauge,
  Key,
  Target,
  MessageSquareText,
  Package,
  TrendingUp,
  Headphones,
  Eye,
  BookOpen,
  PlusCircle,
  FolderOpen,
  GitCompare,
  Building2,
  Lightbulb,
  Video,
  ChevronLeft,
  Menu,
  Home,
  Settings,
  Users,
  User,
  ClipboardCheck,
  FolderKanban,
  Shield,
  RefreshCw,
  Bot,
  ShoppingBag,
  Rss,
  type LucideIcon,
} from "lucide-react";
import { ROLE_LABELS, ROLE_MODULE_ACCESS, ADMIN_ROLES } from "@shared/const";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

// ─── Module definitions ────────────────────────────────────────
type ModuleId = "home" | "dev" | "listing" | "ops" | "service" | "knowledge" | "admin";

interface MenuItem {
  icon: LucideIcon;
  label: string;
  path: string;
}

interface ModuleDef {
  id: ModuleId;
  icon: LucideIcon;
  label: string;
  shortLabel: string;
  prefix: string;
  enabled: boolean;
  items: MenuItem[];
}

const modules: ModuleDef[] = [
  {
    id: "dev",
    icon: Package,
    label: "智能产品开发",
    shortLabel: "产品开发",
    prefix: "/dev",
    enabled: true,
    items: [
      { icon: LayoutDashboard, label: "仪表盘", path: "/dev" },
      { icon: PlusCircle, label: "新建项目", path: "/dev/new-project" },
      { icon: FolderOpen, label: "项目列表", path: "/dev/projects" },
      { icon: GitCompare, label: "产品对比", path: "/dev/compare" },
      { icon: Building2, label: "供应商库", path: "/dev/supplier-library" },
    ],
  },
  {
    id: "listing",
    icon: FileText,
    label: "智能Listing生成",
    shortLabel: "Listing",
    prefix: "/listing",
    enabled: true,
    items: [
      { icon: LayoutDashboard, label: "项目管理", path: "/listing" },
      { icon: Search, label: "竞品分析", path: "/listing/analysis" },
      { icon: GitCompareArrows, label: "竞品对比", path: "/listing/comparison" },
      { icon: History, label: "导入历史", path: "/listing/review-history" },
      { icon: MessageSquareText, label: "评论聚合分析", path: "/listing/review-aggregation" },
      { icon: Key, label: "关键词管理", path: "/listing/keywords" },
      { icon: Target, label: "广告架构", path: "/listing/ad-structure" },
      { icon: Database, label: "数据文件", path: "/listing/data-files" },
      { icon: Sparkles, label: "Listing生成", path: "/listing/generate" },
      { icon: FileText, label: "结果预览", path: "/listing/preview" },
      { icon: Gauge, label: "Listing评分", path: "/listing/score" },
      { icon: Image, label: "智能图片建议", path: "/listing/image-workflow" },
    ],
  },
  {
    id: "ops",
    icon: TrendingUp,
    label: "智能运营提效",
    shortLabel: "运营提效",
    prefix: "/ops",
    enabled: true,
    items: [
      { icon: LayoutDashboard, label: "运营仪表盘", path: "/ops" },
      { icon: ShoppingBag, label: "产品总览", path: "/ops/products" },
      { icon: BarChart3, label: "利润分析", path: "/ops/profit" },
      { icon: Package, label: "库存预警", path: "/ops/inventory" },
      { icon: Target, label: "广告优化", path: "/ops/ads" },
      { icon: Eye, label: "竞品监控", path: "/ops/competitor" },
      { icon: Bot, label: "爬虫引擎", path: "/ops/crawler" },
    ],
  },
  {
    id: "service",
    icon: Headphones,
    label: "智能售后管理",
    shortLabel: "售后管理",
    prefix: "/service",
    enabled: false,
    items: [
      { icon: LayoutDashboard, label: "售后仪表盘", path: "/service" },
      { icon: MessageSquareText, label: "AI客服回复", path: "/service/replies" },
      { icon: History, label: "退货分析", path: "/service/returns" },
      { icon: FileText, label: "邮件模板", path: "/service/templates" },
      { icon: Search, label: "客户画像", path: "/service/profiles" },
    ],
  },
  {
    id: "knowledge",
    icon: BookOpen,
    label: "智能知识库",
    shortLabel: "知识库",
    prefix: "/knowledge",
    enabled: true,
    items: [
      { icon: LayoutDashboard, label: "知识库总览", path: "/knowledge" },
      { icon: Bot, label: "AI知识助手", path: "/knowledge/bot" },
      { icon: Lightbulb, label: "智能产品创意库", path: "/knowledge/products" },
      { icon: FileText, label: "智能Listing文案库", path: "/knowledge/listings" },
      { icon: Image, label: "智能图片知识库", path: "/knowledge/images" },
      { icon: BookOpen, label: "智能运营SOP库", path: "/knowledge/skills" },
      { icon: Video, label: "智能视频知识库", path: "/knowledge/videos" },
      { icon: Rss, label: "情报推荐中心", path: "/knowledge/intel" },
    ],
  },
  {
    id: "admin",
    icon: Users,
    label: "系统管理",
    shortLabel: "管理",
    prefix: "/admin",
    enabled: true,
    items: [
      { icon: Users, label: "用户管理", path: "/admin/users" },
      { icon: ClipboardCheck, label: "审核中心", path: "/admin/review" },
      { icon: FolderKanban, label: "项目分配", path: "/admin/assignments" },
      { icon: Shield, label: "SOP权限", path: "/admin/sop-access" },
      { icon: Shield, label: "角色管理", path: "/admin/roles" },
      { icon: RefreshCw, label: "同步与监控", path: "/admin/sync" },
    ],
  },
];

// ─── Helpers ───────────────────────────────────────────────────
function detectActiveModule(location: string): ModuleId {
  if (location === "/") return "home";
  if (location.startsWith("/listing") || location.startsWith("/project/")) return "listing";
  if (location.startsWith("/dev")) return "dev";
  if (location.startsWith("/ops")) return "ops";
  if (location.startsWith("/service")) return "service";
  if (location.startsWith("/knowledge")) return "knowledge";
  if (location.startsWith("/admin")) return "admin";
  // Legacy routes (before migration) - map to listing
  const legacyPaths = ["/analysis", "/comparison", "/review-history", "/review-aggregation", "/keywords", "/ad-structure", "/data-files", "/generate", "/preview", "/score"];
  if (legacyPaths.some(p => location.startsWith(p))) return "listing";
  return "home"; // default
}

// Filter modules by user role
function getAccessibleModules(userRole: string | undefined): ModuleDef[] {
  if (!userRole) return [];
  const accessibleModuleIds = ROLE_MODULE_ACCESS[userRole] || [];
  return modules.filter(mod => accessibleModuleIds.includes(mod.id));
}

const SIDEBAR_EXPANDED_KEY = "platform-sidebar-expanded";

// ─── Main Component ────────────────────────────────────────────
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { loading, user } = useAuth();

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-accent/30 to-background">
        <div className="flex flex-col items-center gap-8 p-10 max-w-md w-full bg-card rounded-2xl shadow-lg border">
          <div className="flex flex-col items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-center text-card-foreground">
              亚马逊全链路智能工具
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm leading-relaxed">
              基于AI的亚马逊全链路运营工具，覆盖产品开发、Listing优化、运营提效、售后管理和知识库五大模块。
            </p>
          </div>
          <Button
            onClick={() => {
              window.location.href = "/login";
            }}
            size="lg"
            className="w-full shadow-md hover:shadow-lg transition-all"
          >
            登录使用
          </Button>
        </div>
      </div>
    );
  }

  return <DashboardLayoutContent>{children}</DashboardLayoutContent>;
}

// ─── Layout Content ────────────────────────────────────────────
function DashboardLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();

  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem(SIDEBAR_EXPANDED_KEY);
    return saved !== null ? saved === "true" : true;
  });

  const activeModuleId = useMemo(() => detectActiveModule(location), [location]);
  const activeModule = useMemo(
    () => modules.find(m => m.id === activeModuleId) || null,
    [activeModuleId]
  );

  // Filter modules based on user role
  const accessibleModules = useMemo(
    () => getAccessibleModules(user?.role),
    [user?.role]
  );

  const isHomePage = activeModuleId === "home";
  const isAdmin = user?.role && (ADMIN_ROLES as readonly string[]).includes(user.role);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(sidebarExpanded));
  }, [sidebarExpanded]);

  // Mobile drawer state
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleModuleClick = (mod: ModuleDef) => {
    if (!mod.enabled) {
      toast.info(`${mod.label}模块即将推出，敬请期待`);
      return;
    }
    // Navigate to first item path if available, otherwise prefix
    const target = mod.items.length > 0 ? mod.items[0].path : mod.prefix;
    setLocation(target);
    if (isMobile) setMobileOpen(false);
  };

  const handleMenuClick = (path: string) => {
    setLocation(path);
    if (isMobile) setMobileOpen(false);
  };

  const handleHomeClick = () => {
    setLocation("/");
    if (isMobile) setMobileOpen(false);
  };

  const isMenuActive = (item: MenuItem) => {
    if (!activeModule) return false;
    if (item.path === activeModule.prefix) {
      return location === item.path;
    }
    return location.startsWith(item.path);
  };

  // ─── Mobile layout ───
  if (isMobile) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        {/* Mobile header */}
        <header className="flex items-center justify-between h-14 px-3 border-b bg-background/95 backdrop-blur sticky top-0 z-50">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent transition-colors"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="font-semibold text-sm truncate">
              {isHomePage ? "亚马逊全链路智能工具" : activeModule?.label || ""}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-xs font-medium text-primary">
                    {user?.name?.charAt(0).toUpperCase() || "U"}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5 text-sm">
                  <p className="font-medium">{user?.name || "-"}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_LABELS[user?.role || ""] || user?.role || "-"}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setLocation("/profile")} className="cursor-pointer">
                  <User className="mr-2 h-4 w-4" />
                  个人设置
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-destructive cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Mobile drawer overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 flex" onClick={() => setMobileOpen(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="relative flex w-72 bg-background shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Module rail */}
              <div className="w-16 bg-muted/50 border-r flex flex-col items-center py-3 gap-1">
                {/* Home button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleHomeClick}
                      className={cn(
                        "w-11 h-11 rounded-xl flex items-center justify-center transition-all mb-2",
                        isHomePage
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "hover:bg-accent text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Home className="h-5 w-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">首页</TooltipContent>
                </Tooltip>

                <div className="w-8 border-t border-border mb-1" />

                {accessibleModules.map((mod) => (
                  <Tooltip key={mod.id}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => handleModuleClick(mod)}
                        className={cn(
                          "w-11 h-11 rounded-xl flex items-center justify-center transition-all",
                          mod.id === activeModuleId
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : mod.enabled
                              ? "hover:bg-accent text-muted-foreground hover:text-foreground"
                              : "text-muted-foreground/40 cursor-not-allowed"
                        )}
                      >
                        <mod.icon className="h-5 w-5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {mod.label}{!mod.enabled && " (即将推出)"}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
              {/* Feature menu */}
              <div className="flex-1 flex flex-col">
                <div className="h-12 flex items-center px-4 border-b">
                  <span className="font-semibold text-sm">
                    {isHomePage ? "亚马逊全链路智能工具" : activeModule?.label || ""}
                  </span>
                </div>
                <nav className="flex-1 overflow-y-auto py-2 px-2">
                  {isHomePage ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      请选择左侧工具模块
                    </div>
                  ) : (
                    activeModule?.items.map((item) => {
                      const active = isMenuActive(item);
                      return (
                        <button
                          key={item.path}
                          onClick={() => handleMenuClick(item.path)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all mb-0.5",
                            active
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          )}
                        >
                          <item.icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })
                  )}
                </nav>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 p-4">{children}</main>
      </div>
    );
  }

  // ─── Desktop layout ───
  return (
    <div className="flex min-h-screen bg-background">
      {/* Module rail (always visible, 64px) */}
      <div className="w-16 bg-muted/30 border-r flex flex-col items-center py-3 shrink-0">
        <div className="flex flex-col items-center gap-1 flex-1">
          {/* Home button at top */}
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <button
                onClick={handleHomeClick}
                className={cn(
                  "w-11 h-11 rounded-xl flex flex-col items-center justify-center transition-all group relative",
                  isHomePage
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-accent text-muted-foreground hover:text-foreground"
                )}
              >
                <Home className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              <p>首页</p>
            </TooltipContent>
          </Tooltip>

          {/* Separator */}
          <div className="w-8 border-t border-border my-1" />

          {accessibleModules.map((mod) => (
            <Tooltip key={mod.id} delayDuration={200}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleModuleClick(mod)}
                  className={cn(
                    "w-11 h-11 rounded-xl flex flex-col items-center justify-center transition-all group relative",
                    mod.id === activeModuleId
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : mod.enabled
                        ? "hover:bg-accent text-muted-foreground hover:text-foreground"
                        : "text-muted-foreground/40 cursor-not-allowed"
                  )}
                >
                  <mod.icon className="h-5 w-5" />
                  {!mod.enabled && (
                    <div className="absolute -top-1 -right-1 w-2 h-2 bg-muted-foreground/30 rounded-full" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <p>{mod.label}</p>
                {!mod.enabled && <p className="text-xs text-muted-foreground">即将推出</p>}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Settings button */}
        <div className="mt-auto">
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <button
                onClick={() => { setLocation("/settings"); }}
                className={cn(
                  "w-11 h-11 rounded-xl flex items-center justify-center transition-all",
                  location.startsWith("/settings")
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-accent text-muted-foreground hover:text-foreground"
                )}
              >
                <Settings className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              <p>系统设置</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Notification bell */}
        <div className="flex justify-center">
          <NotificationBell />
        </div>
        {/* User avatar at bottom of rail */}
        <div className="pt-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-accent transition-colors">
                <Avatar className="h-8 w-8 border">
                  <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">
                    {user?.name?.charAt(0).toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-52">
              <div className="px-2 py-1.5 text-sm">
                <p className="font-medium">{user?.name || "-"}</p>
                <p className="text-xs text-muted-foreground">{user?.email || "-"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {ROLE_LABELS[user?.role || ""] || user?.role || "-"}
                </p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setLocation("/profile")}
                className="cursor-pointer"
              >
                <User className="mr-2 h-4 w-4" />
                个人设置
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={logout}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Feature sidebar (collapsible, 220px) — hidden on home page */}
      {!isHomePage && activeModule && (
        <div
          className={cn(
            "border-r bg-background flex flex-col shrink-0 transition-all duration-200 overflow-hidden",
            sidebarExpanded ? "w-[220px]" : "w-0"
          )}
        >
          {/* Sidebar header */}
          <div className="h-14 flex items-center justify-between px-4 border-b shrink-0">
            <span className="font-semibold text-sm truncate">{activeModule.label}</span>
            <button
              onClick={() => setSidebarExpanded(false)}
              className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-accent transition-colors"
            >
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          {/* Menu items */}
          <nav className="flex-1 overflow-y-auto py-2 px-2">
            {activeModule.items.map((item) => {
              const active = isMenuActive(item);
              return (
                <button
                  key={item.path}
                  onClick={() => handleMenuClick(item.path)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all mb-0.5",
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <item.icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar (only when sidebar collapsed and not home page) */}
        {!isHomePage && !sidebarExpanded && activeModule && (
          <div className="h-12 flex items-center px-4 border-b shrink-0">
            <button
              onClick={() => setSidebarExpanded(true)}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-accent transition-colors mr-3"
            >
              <PanelLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <span className="text-sm font-medium text-muted-foreground">{activeModule.label}</span>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
