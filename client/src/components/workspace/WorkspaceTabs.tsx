import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Ellipsis, ExternalLink, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  normalizeWorkspaceHref,
  readWorkspaceTabs,
  removeWorkspaceTab,
  resolveWorkspaceTabLabel,
  upsertWorkspaceTab,
  WORKSPACE_TABS_STORAGE_KEY,
  WORKSPACE_CLOSE_AND_NAVIGATE,
  isWorkspaceHref,
  type WorkspaceTab,
} from "./workspaceTabState";

export function WorkspaceTabs({
  currentLabel,
  variant = "default",
}: {
  currentLabel?: string;
  variant?: "default" | "dark";
}) {
  const [location, navigate] = useLocation();
  const currentHref = useMemo(
    () => normalizeWorkspaceHref(
      location,
      typeof window === "undefined" ? "" : window.location.search,
      typeof window === "undefined" ? "" : window.location.hash,
    ),
    [location],
  );
  const resolvedCurrentLabel = resolveWorkspaceTabLabel(currentHref, currentLabel);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => {
    const stored = typeof window === "undefined"
      ? []
      : readWorkspaceTabs(localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY));
    return upsertWorkspaceTab(stored, {
      href: currentHref,
      label: resolvedCurrentLabel,
      lastActiveAt: Date.now(),
    });
  });

  useEffect(() => {
    setTabs((current) => upsertWorkspaceTab(current, {
      href: currentHref,
      label: resolvedCurrentLabel,
      lastActiveAt: Date.now(),
    }));
  }, [currentHref, resolvedCurrentLabel]);

  useEffect(() => {
    localStorage.setItem(WORKSPACE_TABS_STORAGE_KEY, JSON.stringify(tabs));
  }, [tabs]);

  useEffect(() => {
    const activeTab = activeTabRef.current;
    if (typeof activeTab?.scrollIntoView === "function") {
      activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [currentHref, tabs.length]);

  const closeTab = (href: string) => {
    if (tabs.length <= 1) return;
    const closingIndex = tabs.findIndex((tab) => tab.href === href);
    const nextTabs = removeWorkspaceTab(tabs, href);
    setTabs(nextTabs);

    if (href === currentHref) {
      const nextIndex = Math.min(Math.max(closingIndex - 1, 0), nextTabs.length - 1);
      navigate(nextTabs[nextIndex]?.href || "/");
    }
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const destination = (event as CustomEvent<{destination:string}>).detail?.destination;
      if (!destination || !isWorkspaceHref(destination)) return;
      setTabs(current => upsertWorkspaceTab(removeWorkspaceTab(current, currentHref), {
        href: destination, label: resolveWorkspaceTabLabel(destination), lastActiveAt: Date.now(),
      }));
      navigate(destination);
    };
    window.addEventListener(WORKSPACE_CLOSE_AND_NAVIGATE, handler);
    return () => window.removeEventListener(WORKSPACE_CLOSE_AND_NAVIGATE, handler);
  }, [currentHref, navigate]);

  const closeOtherTabs = () => {
    const active = tabs.find((tab) => tab.href === currentHref) || {
      href: currentHref,
      label: resolvedCurrentLabel,
      lastActiveAt: Date.now(),
    };
    setTabs([active]);
  };

  const closeAllTabs = () => {
    const homeTab = { href: "/", label: "首页", lastActiveAt: Date.now() };
    setTabs([homeTab]);
    navigate("/");
  };

  const isDark = variant === "dark";

  return (
    <div
      className={cn(
        "flex h-16 shrink-0 items-stretch border-b",
        isDark ? "border-white/10 bg-[#0d1117] text-slate-300" : "border-border bg-muted/30",
      )}
      data-testid="workspace-tabs"
    >
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="flex h-12 min-w-max items-center gap-1 px-2">
          {tabs.map((tab) => {
            const active = tab.href === currentHref;
            return (
              <div
                key={tab.href}
                role="presentation"
                className={cn(
                  "group flex h-11 min-w-[170px] max-w-[280px] shrink-0 items-center rounded-lg border",
                  active
                    ? isDark
                      ? "border-white/15 bg-[#080b11] text-white"
                      : "border-border bg-background text-foreground"
                    : isDark
                      ? "border-transparent text-slate-500 hover:bg-white/5 hover:text-slate-200"
                      : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <button
                  ref={active ? activeTabRef : undefined}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={tab.label}
                  onClick={() => navigate(tab.href)}
                  className="h-full min-w-0 flex-1 truncate px-3 text-left text-sm font-medium leading-6"
                >
                  {tab.label}
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`关闭 ${tab.label}`}
                      disabled={tabs.length <= 1}
                      onClick={() => closeTab(tab.href)}
                      className={cn(
                        "mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:cursor-default disabled:opacity-20",
                        isDark ? "hover:bg-white/10" : "hover:bg-muted",
                      )}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>关闭页面</TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </div>

      <div className={cn("flex shrink-0 items-center border-l px-1", isDark ? "border-white/10" : "border-border")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="在浏览器新标签页打开"
              onClick={() => window.open(currentHref, "_blank", "noopener,noreferrer")}
              className={cn(
                "flex h-8 w-8 items-center justify-center",
                isDark ? "text-slate-500 hover:bg-white/5 hover:text-white" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>在浏览器新标签页打开</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="页面标签管理"
                  className={cn(
                    "flex h-8 w-8 items-center justify-center",
                    isDark ? "text-slate-500 hover:bg-white/5 hover:text-white" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Ellipsis className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>标签管理</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={tabs.length <= 1} onClick={() => closeTab(currentHref)}>
              关闭当前页面
            </DropdownMenuItem>
            <DropdownMenuItem disabled={tabs.length <= 1} onClick={closeOtherTabs}>
              关闭其他页面
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={closeAllTabs}>
              关闭全部并返回首页
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
