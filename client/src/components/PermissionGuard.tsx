import { type ReactNode } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import { ShieldX, ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { PERMISSION_MODULE_LABELS, PERMISSION_ROUTE_REGISTRY, type PermissionRouteRule } from "@shared/const";

/**
 * Route-to-permission mapping table.
 * Maps URL path patterns to { moduleId, subModuleId } for permission checking.
 * Routes not listed here are considered public (no permission check).
 */
export const ROUTE_PERMISSION_MAP = PERMISSION_ROUTE_REGISTRY;

/**
 * Match a real path against the route permission map.
 * Handles dynamic segments like :id by converting patterns to regex.
 */
function matchRoute(pathname: string): PermissionRouteRule | null {
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
        您没有访问<span className="font-medium text-foreground">「{PERMISSION_MODULE_LABELS[moduleId] || moduleId}」</span>模块的权限
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
  if (!moduleId || routeMatch?.enforcement === "catalog_only") {
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
