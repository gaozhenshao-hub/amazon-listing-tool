import { AsyncLocalStorage } from "node:async_hooks";

const opsWorkspaceStorage = new AsyncLocalStorage<number>();

export function runWithOpsWorkspace<T>(workspaceId: number, callback: () => Promise<T>): Promise<T> {
  return opsWorkspaceStorage.run(workspaceId, callback);
}

export function currentOpsWorkspaceId(): number {
  const workspaceId = opsWorkspaceStorage.getStore();
  if (!workspaceId) {
    throw new Error("Operations write requires an explicit workspaceId or active workspace context");
  }
  return workspaceId;
}
