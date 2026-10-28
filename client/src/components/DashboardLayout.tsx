import { usePermissions } from "@/hooks/usePermissions";
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
import { useMarketplace } from "@/contexts/MarketplaceContext";
import NotificationBell from "@/components/NotificationBell";
import { useIsMobile } from "@/hooks/useMobile";
import { MERGED_READONLY_FEATURES_ENABLED } from "@/lib/mergedReadOnlyFeatures";
import {
  LayoutDashboard,
  LogOut,
  PanelLeft,
  Search,
  FileText,
  FlaskConical,
  Image,
  Sparkles,
  GitCompareArrows,
  History,
  Database,
  DatabaseZap,
  Trash2,
  FileSpreadsheet,
  Gauge,
  Key,
  Target,
  MessageSquareText,
  Package,
  TrendingUp,
  Headphones,
  BookOpen,
  PlusCircle,
  FolderOpen,
  GitCompare,
  Building2,
  Lightbulb,
  Video,
  ChevronLeft,
  ChevronDown,
  Menu,
  Home,
  Settings,
  Globe,
  Users,
  User,
  ClipboardCheck,
  FolderKanban,
  Shield,
  RefreshCw,
  Bot,
  ShoppingBag,
  Rss,
  Truck,
  Clock,
  Star,
  Layers,
  Share2,
  UserCheck,
  CalendarDays,
  Link2,
  Activity,
  Stethoscope,
  Send,
  CheckCircle,
  ClipboardList,
  Upload,
  HelpCircle,
  LayoutGrid,
  Cpu,
  Zap,
  Timer,
  Wrench,
  BarChart3,
  Plug,
  Network,
  BrainCircuit,
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
import { WorkspaceTabs } from "@/components/workspace";
import MergedOperationsMenuEntry from "@/components/MergedOperationsMenuEntry";

// ─── Module definitions ────────────────────────────────────────
type ModuleId = "home" | "dev" | "procurement" | "ops" | "design" | "finance" | "knowledge" | "emperor" | "admin";

interface MenuItem {
  icon: LucideIcon;
  label: string;
  path: string;
  requiredOpsDirectory?: "ops_tasks" | "ops_data_import";
  adminOnly?: boolean;
}

interface MenuGroup {
  id: string;
  icon: LucideIcon;
  label: string;
  items: MenuItem[];
  adminOnly?: boolean;
}

type MenuEntry = MenuItem | MenuGroup;

interface ModuleDef {
  id: ModuleId;
  icon: LucideIcon;
  label: string;
  shortLabel: string;
  prefix: string;
  enabled: boolean;
  items: MenuEntry[];
}

function isMenuGroup(entry: MenuEntry): entry is MenuGroup {
  return "items" in entry;
}

const modules: ModuleDef[] = [
  { id: "dev", icon: Package, label: "产品开发", shortLabel: "产品开发", prefix: "/dev", enabled: true, items: [{ icon: Package, label: "产品开发", path: "/dev" }] },
  { id: "procurement", icon: Truck, label: "采购物流", shortLabel: "采购物流", prefix: "/procurement", enabled: true, items: [{ icon: Truck, label: "物流时效分析", path: "/procurement" }] },
  { id: "ops", icon: TrendingUp, label: "运营", shortLabel: "运营", prefix: "/ops", enabled: true, items: [
    { icon: ShoppingBag, label: "产品总览", path: "/ops/products" },
    { icon: Package, label: "库存情况", path: "/ops/inventory-details", requiredOpsDirectory: "ops_data_import" },
    { icon: ClipboardList, label: "任务看板", path: "/ops/product-tasks", requiredOpsDirectory: "ops_tasks" },
    { icon: TrendingUp, label: "利润看板", path: "/ops/profit-board", requiredOpsDirectory: "ops_data_import" },
    { icon: ShoppingBag, label: "产品看板", path: "/ops/product-board", requiredOpsDirectory: "ops_data_import" },
    { icon: Target, label: "广告看板", path: "/ops/ads" },
    { id: "listing-generation", icon: FileText, label: "智能 Listing 生成", items: [
      { icon: FolderKanban, label: "项目管理", path: "/listing" },
      { icon: Search, label: "Listing 抓取", path: "/listing/analysis" },
      { icon: GitCompareArrows, label: "竞品对比及分析", path: "/listing/comparison" },
      { icon: Sparkles, label: "Listing 生成", path: "/listing/generate" },
    ] },
    { id: "listing-advertising", icon: Target, label: "智能广告搭建", items: [
      { icon: Key, label: "关键词管理", path: "/listing/keywords" },
      { icon: Target, label: "广告架构", path: "/listing/ad-structure" },
    ] },
    { icon: Database, label: "赛狐数据同步", path: "/ops/saihu-sync", requiredOpsDirectory: "ops_data_import" },
  ] },
  { id: "design", icon: Image, label: "美工", shortLabel: "美工", prefix: "/design", enabled: true, items: [{ icon: Sparkles, label: "生图", path: "/design/images" }, { icon: BookOpen, label: "提示词库", path: "/design/prompts" }, { icon: FolderOpen, label: "素材库", path: "/design/materials" }] },
  { id: "finance", icon: BarChart3, label: "财务", shortLabel: "财务", prefix: "/finance", enabled: true, items: [{ icon: BarChart3, label: "财务", path: "/finance" }] },
  { id: "knowledge", icon: BookOpen, label: "知识库", shortLabel: "知识库", prefix: "/knowledge", enabled: true, items: [
    { icon: Image, label: "图片知识库", path: "/knowledge/images" },
    { icon: DatabaseZap, label: "受控采集与审核", path: "/knowledge/acquisition" },
    { icon: Trash2, label: "回收站", path: "/knowledge/recycle", adminOnly: true },
  ] },
  { id: "emperor", icon: BrainCircuit, label: "AI 管理", shortLabel: "AI 管理", prefix: "/emperor", enabled: true, items: [
    { icon: Layers, label: "Skill 库", path: "/emperor/skills" },
    { icon: Bot, label: "Agent 库", path: "/emperor/agent-library" },
    { icon: Cpu, label: "模型管理", path: "/emperor/models" },
    { icon: Settings, label: "通用设置", path: "/emperor/settings" },
  ] },
  { id: "admin", icon: Users, label: "系统管理", shortLabel: "系统管理", prefix: "/admin", enabled: true, items: [
    { icon: Shield, label: "角色管理", path: "/admin/roles" },
    { icon: Users, label: "用户管理", path: "/admin/users" },
  ] },
];

// ─── Helpers ───────────────────────────────────────────────────
function detectActiveModule(location: string): ModuleId {
  if (location.startsWith("/listing") || location.startsWith("/project/")) return "ops";
  return modules.find(module => location === module.prefix || location.startsWith(`${module.prefix}/`))?.id || "home";
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
              AMZ 全链路
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm leading-relaxed">
              产品运营、美工与图片资料协作平台。
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

  // 已登录但需要修改初始密码：重定向到登录页进行密码修改
  if ((user as any).mustChangePassword === 1 || (user as any).mustChangePassword === true) {
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login?must_change=1";
    }
    return null;
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
  const pageContent = children;

  // Filter modules based on user role
  const permissions = usePermissions();
  const accessibleModules = modules.filter(module => permissions.hasModuleAccess(module.id)
    || module.id === "ops" && permissions.hasModuleAccess("listing")
   );

  const isHomePage = activeModuleId === "home";
  const isAdmin = user?.role && (ADMIN_ROLES as readonly string[]).includes(user.role);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(sidebarExpanded));
  }, [sidebarExpanded]);

  // Mobile drawer state
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedMenuGroups, setExpandedMenuGroups] = useState<Record<string, boolean>>({});

  const handleModuleClick = (mod: ModuleDef) => {
    if (!mod.enabled) {
      toast.info(`${mod.label}模块即将推出，敬请期待`);
      return;
    }
    const firstEntry = mod.items[0];
    const target = firstEntry
      ? isMenuGroup(firstEntry)
        ? firstEntry.items[0]?.path || mod.prefix
        : firstEntry.path
      : mod.prefix;
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

  const renderMenuEntries = (mobile: boolean) => activeModule?.items.filter(entry => !entry.adminOnly || isAdmin).map((entry) => {
    if (!isMenuGroup(entry)) {
      const active = isMenuActive(entry);
      const button = (
        <button
          key={entry.path}
          type="button"
          aria-current={active ? "page" : undefined}
          onClick={() => handleMenuClick(entry.path)}
          className={cn(
            "w-full flex items-center gap-3 px-3 rounded-lg text-sm transition-all mb-0.5",
            mobile ? "py-2.5" : "py-2",
            active
              ? "bg-primary/10 text-primary font-medium"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <entry.icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
          <span className="truncate">{entry.label}</span>
        </button>
      );
      return entry.requiredOpsDirectory
        ? <MergedOperationsMenuEntry key={entry.path} directory={entry.requiredOpsDirectory}>{button}</MergedOperationsMenuEntry>
        : button;
    }

    const groupActive = entry.items.some(isMenuActive);
    const expanded = expandedMenuGroups[entry.id] ?? groupActive;
    const contentId = `${mobile ? "mobile" : "desktop"}-menu-group-${entry.id}`;

    return (
      <div key={entry.id} className="mb-0.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpandedMenuGroups((current) => ({
            ...current,
            [entry.id]: !expanded,
          }))}
          className={cn(
            "w-full flex items-center gap-3 px-3 rounded-lg text-sm transition-all",
            mobile ? "py-2.5" : "py-2",
            groupActive
              ? "bg-primary/5 text-primary font-medium"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <entry.icon className={cn("h-4 w-4 shrink-0", groupActive && "text-primary")} />
          <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
              expanded && "rotate-180"
            )}
          />
        </button>

        {expanded && (
          <div id={contentId} className="ml-3 mt-0.5 border-l border-border/70 pl-2">
            {entry.items.map((item) => {
              const active = isMenuActive(item);
              return (
                <button
                  key={item.path}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => handleMenuClick(item.path)}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-md px-2 text-sm transition-all mb-0.5",
                    mobile ? "py-2.5" : "py-2",
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <item.icon className={cn("h-3.5 w-3.5 shrink-0", active && "text-primary")} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  });

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
              {isHomePage ? "AMZ 全链路" : activeModule?.label || ""}
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
                    {isHomePage ? "AMZ 全链路" : activeModule?.label || ""}
                  </span>
                </div>
                <nav className="flex-1 overflow-y-auto py-2 px-2">
                  {isHomePage ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      请选择左侧工具模块
                    </div>
                  ) : (
                    renderMenuEntries(true)
                  )}
                </nav>
              </div>
            </div>
          </div>
        )}

        <WorkspaceTabs />
        <main className="flex-1 p-4">{pageContent}</main>
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
            {renderMenuEntries(false)}
          </nav>

          {/* Marketplace selector - only for ops module */}
          {activeModuleId === 'ops' && (
            <MarketplaceSelector />
          )}
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
        <WorkspaceTabs />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{pageContent}</main>
      </div>
    </div>
  );
}

// ─── Marketplace Selector (ops module only) ──────────────────
function MarketplaceSelector() {
  const { marketplace, setMarketplace, marketplaces, isLoading } = useMarketplace();

  if (isLoading) {
    return (
      <div className="px-3 py-3 border-t">
        <div className="h-8 bg-muted animate-pulse rounded-md" />
      </div>
    );
  }

  return (
    <div className="px-3 py-3 border-t shrink-0">
      <div className="flex items-center gap-2 mb-2">
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">站点筛选</span>
      </div>
      <select
        value={marketplace}
        onChange={(e) => setMarketplace(e.target.value)}
        className="w-full h-8 px-2 text-sm rounded-md border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        <option value="ALL">全部站点</option>
        {marketplaces.map((mp) => (
          <option key={mp.code} value={mp.code}>
            {mp.name} ({mp.storeNames.length}店)
          </option>
        ))}
      </select>
    </div>
  );
}
