import { z } from "zod";
const id = z.number().int().positive(), uuid = z.string().uuid().refine(value => value === value.toLowerCase()), hash = z.string().regex(/^[a-f0-9]{64}$/u);
export type DevelopmentMarketPendingContext = { userId: number; workspaceId: number; devProjectId: number };
const schema = z.object({ version: z.literal(1), userId: id, workspaceId: id, devProjectId: id,
  operationId: uuid, runOperationId: uuid.nullable(), action: z.enum(["start", "apply"]), requestHash: hash }).strict();
export type DevelopmentMarketPending = z.infer<typeof schema>;
export const developmentMarketPendingKey = (scope: DevelopmentMarketPendingContext) => `development-market-pending/v1/${scope.userId}/${scope.workspaceId}/${scope.devProjectId}`;
export function readDevelopmentMarketPending(scope: DevelopmentMarketPendingContext): DevelopmentMarketPending | null {
  const raw = localStorage.getItem(developmentMarketPendingKey(scope)); if (!raw) return null;
  const value = schema.parse(JSON.parse(raw));
  if (value.userId !== scope.userId || value.workspaceId !== scope.workspaceId || value.devProjectId !== scope.devProjectId || (value.action === "apply") !== (value.runOperationId !== null)) throw new Error("Pending scope invalid"); return value;
}
export function saveDevelopmentMarketPending(scope: DevelopmentMarketPendingContext, value: DevelopmentMarketPending, replaceOperationId?: string) {
  const old = readDevelopmentMarketPending(scope), checked = schema.parse(value);
  if (old && (old.operationId !== checked.operationId && old.operationId !== replaceOperationId || old.operationId === checked.operationId && JSON.stringify(old) !== JSON.stringify(checked))) throw new Error("Original request unresolved");
  if (checked.userId !== scope.userId || checked.workspaceId !== scope.workspaceId || checked.devProjectId !== scope.devProjectId || (checked.action === "apply") !== (checked.runOperationId !== null)) throw new Error("Pending scope invalid");
  const encoded = JSON.stringify(checked); localStorage.setItem(developmentMarketPendingKey(scope), encoded);
  if (localStorage.getItem(developmentMarketPendingKey(scope)) !== encoded) throw new Error("Pending ACK unavailable"); return checked;
}
export function releaseDevelopmentMarketPending(scope: DevelopmentMarketPendingContext, operationId: string) {
  const old = readDevelopmentMarketPending(scope); if (old?.operationId === operationId) localStorage.removeItem(developmentMarketPendingKey(scope));
  if (readDevelopmentMarketPending(scope)?.operationId === operationId) throw new Error("Pending release unavailable");
}
export async function withDevelopmentMarketLock<T>(scope: DevelopmentMarketPendingContext, body: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error("Browser lock unavailable");
  return navigator.locks.request(developmentMarketPendingKey(scope), { ifAvailable: true }, async lock => { if (!lock) throw new Error("Request busy in another tab"); return body(); });
}
