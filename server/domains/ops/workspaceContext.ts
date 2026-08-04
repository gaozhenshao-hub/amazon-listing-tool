import { AsyncLocalStorage } from "node:async_hooks";
import type { CacheScope, CacheVisibility } from "../../infrastructure/cache/scopedCache";

export type OpsRequestScope = {
  workspaceId: number;
  tenantId: string | number;
  userId?: number | null;
};

const opsWorkspaceStorage = new AsyncLocalStorage<OpsRequestScope>();

export function runWithOpsWorkspace<T>(scope: number | OpsRequestScope, callback: () => Promise<T>): Promise<T> {
  const normalized = typeof scope === "number"
    ? { workspaceId: scope, tenantId: `workspace-${scope}`, userId: null }
    : scope;
  if (!normalized.workspaceId) throw new Error("Operations context requires workspaceId");
  return opsWorkspaceStorage.run(normalized, callback);
}

export function currentOpsWorkspaceId(): number {
  const scope = opsWorkspaceStorage.getStore();
  if (!scope?.workspaceId) {
    throw new Error("Operations write requires an explicit workspaceId or active workspace context");
  }
  return scope.workspaceId;
}

export function currentOpsRequestScope(): OpsRequestScope {
  const scope = opsWorkspaceStorage.getStore();
  if (!scope?.workspaceId) throw new Error("Operations request requires an active workspace context");
  return scope;
}

export function currentOpsCacheScope(visibility: CacheVisibility = "workspace"): CacheScope {
  const scope = currentOpsRequestScope();
  if (visibility === "user" && !scope.userId) {
    throw new Error("User-private operations cache requires an active userId");
  }
  return {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    userId: scope.userId,
  };
}
