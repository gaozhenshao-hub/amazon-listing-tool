/** Existing deployment configuration policy, shared by UI and server guards.
 * A page-level admin_sync read grant is not permission to operate peer sync.
 */
export function canManageDeploymentSync(role: string | null | undefined): boolean {
  return role === "admin" || role === "super_admin";
}
