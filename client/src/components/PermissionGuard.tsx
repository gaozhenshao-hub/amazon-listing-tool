import { type ReactNode } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import { ShieldX, ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";

/**
 * Route-to-permission mapping table.
 * Maps URL path patterns to { moduleId, subModuleId } for permission checking.
 * Routes not listed here are considered public (no permission check).
 */
export const ROUTE_PERMISSION_MAP: Record<string, { moduleId: string; subModuleId?: string }> = {
  // === Module 1: 智能产品开发 (dev) ===
  "/dev": { moduleId: "dev", subModuleId: "dev_dashboard" },
  "/dev/new-project": { moduleId: "dev", subModuleId: "dev_new_project" },
  "/dev/projects": { moduleId: "dev", subModuleId: "dev_projects" },
  "/dev/project/:id": { moduleId: "dev", subModuleId: "dev_projects" },
  "/dev/project/:id/analysis": { moduleId: "dev", subModuleId: "dev_projects" },
  "/dev/project/:id/offsite": { moduleId: "dev", subModuleId: "dev_projects" },
  "/dev/compare": { moduleId: "dev", subModuleId: "dev_compare" },
  "/dev/supplier-library": { moduleId: "dev", subModuleId: "dev_supplier" },

  // === Module 2: 智能Listing生成 (listing) ===
  "/listing": { moduleId: "listing", subModuleId: "listing_projects" },
  "/listing/analysis": { moduleId: "listing", subModuleId: "listing_analysis" },
  "/listing/comparison": { moduleId: "listing", subModuleId: "listing_comparison" },
  "/listing/review-history": { moduleId: "listing", subModuleId: "listing_review_history" },
  "/listing/review-aggregation": { moduleId: "listing", subModuleId: "listing_review_aggregation" },
  "/listing/keywords": { moduleId: "listing", subModuleId: "listing_keywords" },
  "/listing/ad-structure": { moduleId: "listing", subModuleId: "listing_ad_structure" },
  "/listing/data-files": { moduleId: "listing", subModuleId: "listing_data_files" },
  "/listing/generate": { moduleId: "listing", subModuleId: "listing_generate" },
  "/listing/preview": { moduleId: "listing", subModuleId: "listing_preview" },
  "/listing/score": { moduleId: "listing", subModuleId: "listing_score" },
  "/listing/image-suggestions": { moduleId: "listing", subModuleId: "listing_image_workflow" },
  "/listing/image-workflow": { moduleId: "listing", subModuleId: "listing_image_workflow" },
  "/listing/project/:id": { moduleId: "listing", subModuleId: "listing_projects" },

  // === Module 3: 智能运营提效 (ops) ===
  "/ops": { moduleId: "ops", subModuleId: "ops_dashboard" },

  // === Module 4: 智能售后管理 (service) ===
  "/service": { moduleId: "service", subModuleId: "service_dashboard" },

  // === Module 5: 智能知识库 (knowledge) ===
  "/knowledge": { moduleId: "knowledge", subModuleId: "kb_overview" },
  "/knowledge/products": { moduleId: "knowledge", subModuleId: "kb_products" },
  "/knowledge/listings": { moduleId: "knowledge", subModuleId: "kb_listings" },
  "/knowledge/images": { moduleId: "knowledge", subModuleId: "kb_images" },
  "/knowledge/skills": { moduleId: "knowledge", subModuleId: "kb_skills" },
  "/knowledge/videos": { moduleId: "knowledge", subModuleId: "kb_videos" },

  // === Module 6: 系统管理 (admin) ===
  "/admin/users": { moduleId: "admin", subModuleId: "admin_users" },
  "/admin/review": { moduleId: "admin", subModuleId: "admin_review" },
  "/admin/assignments": { moduleId: "admin", subModuleId: "admin_projects" },
  "/admin/sop-access": { moduleId: "admin", subModuleId: "admin_sop_access" },
  "/admin/roles": { moduleId: "admin", subModuleId: "admin_roles" },
  "/admin/sync": { moduleId: "admin", subModuleId: "admin_sync" },
};

/**
 * Match a real path against the route permission map.
 * Handles dynamic segments like :id by converting patterns to regex.
 */
function matchRoute(pathname: string): { moduleId: string; subModuleId?: string } | null {
  // Try exact match first
  if (ROUTE_PERMISSION_MAP[pathname]) {
    return ROUTE_PERMISSION_MAP[pathname];
  }

  // Try pattern matching for dynamic routes
  for (const [pattern, perm] of Object.entries(ROUTE_PERMISSION_MAP)) {
    if (!pattern.includes(":")) continue;
    const regexStr = "^" + pattern.replace(/:[^/]+/g, "[^/]+") + "$";
    const regex = new RegExp(regexStr);
    if (regex.test(pathname)) {
      return perm;
    }
  }

  return null;
}

/**
 * Module display names for the 403 page
 */
const MODULE_NAMES: Record<string, string> = {
  dev: "智能产品开发",
  listing: "智能Listing生成",
  ops: "智能运营提效",
  service: "智能售后管理",
  knowledge: "智能知识库",
  admin: "系统管理",
};

/**
 * 403 Forbidden page component
 */
function ForbiddenPage({ moduleId, subModuleId }: { moduleId: string; subModuleId?: string }) {
  const [, setLocation] = useLocation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="h-20 w-20 rounded-full bg-red-50 flex items-center justify-center mb-6">
        <ShieldX className="h-10 w-10 text-red-400" />
      </div>
      <h1 className="text-2xl font-bold text-foreground mb-2">无访问权限</h1>
      <p className="text-muted-foreground mb-1 max-w-md">
        您没有访问<span className="font-medium text-foreground">「{MODULE_NAMES[moduleId] || moduleId}」</span>模块的权限
      </p>
      {subModuleId && (
        <p className="text-sm text-muted-foreground mb-6">
          子模块: {subModuleId}
        </p>
      )}
      <p className="text-sm text-muted-foreground mb-8 max-w-md">
        请联系管理员为您的角色分配相应的访问权限
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回上一页
        </Button>
        <Button onClick={() => setLocation("/")}>
          <Home className="h-4 w-4 mr-2" />
          返回首页
        </Button>
      </div>
    </div>
  );
}

interface PermissionGuardProps {
  children: ReactNode;
  /** Override auto-detection: specify moduleId directly */
  moduleId?: string;
  /** Override auto-detection: specify subModuleId directly */
  subModuleId?: string;
  /** Minimum operation required (default: 'read') */
  requiredOperation?: "read" | "edit" | "delete";
}

/**
 * PermissionGuard wraps a route component and checks if the current user
 * has permission to access the corresponding module/sub-module.
 *
 * Usage:
 *   <PermissionGuard><MyPage /></PermissionGuard>
 *   <PermissionGuard moduleId="listing" subModuleId="listing_keywords"><KeywordPage /></PermissionGuard>
 */
export function PermissionGuard({
  children,
  moduleId: overrideModuleId,
  subModuleId: overrideSubModuleId,
  requiredOperation = "read",
}: PermissionGuardProps) {
  const { user } = useAuth();
  const { canRead, canEdit, canDelete, hasModuleAccess, isLoading: permLoading } = usePermissions();
  const [location] = useLocation();

  // Determine which module/submodule to check
  const routeMatch = matchRoute(location);
  const moduleId = overrideModuleId || routeMatch?.moduleId;
  const subModuleId = overrideSubModuleId || routeMatch?.subModuleId;

  // If no permission mapping found for this route, allow access (public route)
  if (!moduleId) {
    return <>{children}</>;
  }

  // Show loading state while permissions are loading
  if (permLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not logged in - let the auth system handle redirect
  if (!user) {
    return <>{children}</>;
  }

  // Check module-level access first
  if (!hasModuleAccess(moduleId)) {
    return <ForbiddenPage moduleId={moduleId} subModuleId={subModuleId} />;
  }

  // Check operation-level access
  let hasAccess = false;
  switch (requiredOperation) {
    case "read":
      hasAccess = canRead(moduleId, subModuleId);
      break;
    case "edit":
      hasAccess = canEdit(moduleId, subModuleId);
      break;
    case "delete":
      hasAccess = canDelete(moduleId, subModuleId);
      break;
  }

  if (!hasAccess) {
    return <ForbiddenPage moduleId={moduleId} subModuleId={subModuleId} />;
  }

  return <>{children}</>;
}
