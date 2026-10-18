import type { ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";

export type MergedOperationsMenuEntryProps = {
  directory: "ops_tasks" | "ops_data_import";
  children: ReactNode;
};
const validId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;

/** Only the three opt-in merged menu entries use this gate. Visibility is not
 * authorization: each route, page and server read still checks its own scope. */
export default function MergedOperationsMenuEntry({ directory, children }: MergedOperationsMenuEntryProps) {
  const auth = useAuth(), permissions = usePermissions(), user = auth.user;
  if (auth.loading || auth.error || !user || !validId(user.id) || !validId(user.defaultWorkspaceId) || typeof user.role !== "string" || !user.role.trim() || permissions.isLoading) return null;
  if (!permissions.canRead("ops", "ops_dashboard") || !permissions.canRead("ops", directory)) return null;
  return <>{children}</>;
}
