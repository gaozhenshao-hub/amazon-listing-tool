import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { usePermissions } from "@/hooks/usePermissions";
import { useProject } from "@/contexts/ProjectContext";
import { PERMISSION_ROUTE_REGISTRY } from "@shared/const";

export const LISTING_WORKSPACES = [
  { label: "生成结果", entries: [
    ["/listing/generate", "智能 Listing 生成"], ["/listing/preview", "生成结果与预览"], ["/listing/score", "结果评分"],
  ] },
] as const;

/** Contextual entries share the project's existing material stores and retain
 * route guards. Opening a tab never imports, adopts or generates anything. */
export default function ListingWorkspace({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { selectedProjectId } = useProject();
  const permissions = usePermissions();
  const path = location.split(/[?#]/, 1)[0];
  // Project, capture and comparison already have their own navigation. The
  // obsolete materials/research strip duplicated those controls.
  if (path === "/listing" || path.startsWith("/listing/project/") || path === "/listing/analysis" || path === "/listing/comparison") return <>{children}</>;
  const group = LISTING_WORKSPACES.find(item => item.entries.some(([href]) => href === path));
  const query = Number.isSafeInteger(selectedProjectId) && Number(selectedProjectId) > 0 ? `?projectId=${selectedProjectId}` : "";
  if (!group) return <>{children}</>;
  const entries = permissions.isLoading ? [] : group.entries.filter(([href]) => {
    const rule = PERMISSION_ROUTE_REGISTRY[href];
    return !!rule && permissions.canRead(rule.moduleId, rule.subModuleId);
  });
  return <div className="min-w-0 space-y-4">
    <nav aria-label={`${group.label}导航`} className="flex flex-wrap items-center gap-2 rounded-xl border p-2">
      <span className="px-2 text-sm text-muted-foreground">{group.label}</span>
      {entries.map(([href, label]) => <Link key={href} href={`${href}${query}`} aria-current={path === href ? "page" : undefined} className={`rounded-lg px-3 py-2 text-sm ${path === href ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"}`}>{label}</Link>)}
    </nav>
    {children}
  </div>;
}
