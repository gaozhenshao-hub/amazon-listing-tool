import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useMemo } from "react";

export type PermissionOperation = 'read' | 'edit' | 'delete';

interface SubModulePermission {
  subModuleId: string;
  operations: PermissionOperation[];
}

interface ModulePermission {
  moduleId: string;
  operations: PermissionOperation[];
  subModules?: SubModulePermission[];
}

const FULL_ACCESS_ROLES = ['super_admin'];

export function usePermissions() {
  const { user } = useAuth();
  const { data: myPerms, isLoading } = trpc.roleManagement.myPermissions.useQuery(undefined, {
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const hasFullAccess = useMemo(() => {
    return !!user && FULL_ACCESS_ROLES.includes(user.role);
  }, [user]);

  const hasModuleAccess = (moduleId: string): boolean => {
    if (!user) return false;
    if (hasFullAccess) return true;
    if (!myPerms) return false;
    return myPerms.modules.includes(moduleId);
  };

  const hasModuleOperation = (moduleId: string, operation: PermissionOperation): boolean => {
    if (!user) return false;
    if (hasFullAccess) return true;
    if (!myPerms) return false;
    if (!myPerms.modules.includes(moduleId)) return false;
    if (!myPerms.detailedPermissions) return true;
    const modulePerm = myPerms.detailedPermissions.find((p: ModulePermission) => p.moduleId === moduleId);
    if (!modulePerm) return true;
    return modulePerm.operations.includes(operation);
  };

  const hasSubModuleOperation = (
    moduleId: string,
    subModuleId: string,
    operation: PermissionOperation
  ): boolean => {
    if (!user) return false;
    if (hasFullAccess) return true;
    if (!myPerms) return false;
    if (!myPerms.modules.includes(moduleId)) return false;
    if (!myPerms.detailedPermissions) return true;
    const modulePerm = myPerms.detailedPermissions.find((p: ModulePermission) => p.moduleId === moduleId);
    if (!modulePerm) return true;
    const subPerm = modulePerm.subModules?.find((s: SubModulePermission) => s.subModuleId === subModuleId);
    if (!subPerm) return modulePerm.operations.includes(operation);
    return subPerm.operations.includes(operation);
  };

  const canEdit = (moduleId: string, subModuleId?: string): boolean => {
    if (subModuleId) return hasSubModuleOperation(moduleId, subModuleId, 'edit');
    return hasModuleOperation(moduleId, 'edit');
  };

  const canDelete = (moduleId: string, subModuleId?: string): boolean => {
    if (subModuleId) return hasSubModuleOperation(moduleId, subModuleId, 'delete');
    return hasModuleOperation(moduleId, 'delete');
  };

  const canRead = (moduleId: string, subModuleId?: string): boolean => {
    if (subModuleId) return hasSubModuleOperation(moduleId, subModuleId, 'read');
    return hasModuleOperation(moduleId, 'read');
  };

  return {
    isLoading,
    permissions: myPerms ?? null,
    hasModuleAccess,
    hasModuleOperation,
    hasSubModuleOperation,
    canRead,
    canEdit,
    canDelete,
  };
}
