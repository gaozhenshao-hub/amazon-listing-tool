import { roleManagementRouter } from "../server/routers/roleManagement";
import { getAllRolePermissions, getAllUsers } from "../server/repositories/auth/authRepository";

async function main() {
  const [admin] = (await getAllUsers()).filter(user => user.status === "active" && (user.role === "super_admin" || user.role === "admin"));
  if (!admin) throw new Error("No active admin available for read-only permission governance verification");
  const caller = roleManagementRouter.createCaller({
    user: { ...admin, defaultWorkspaceId: (admin as any).defaultWorkspaceId ?? 1 },
    workspaceId: (admin as any).defaultWorkspaceId ?? 1,
    requestId: `permission-governance-read-only-${Date.now()}`,
    req: { headers: {}, header: () => undefined } as any,
    res: { locals: {} } as any,
  } as any);
  const before = await getAllRolePermissions();
  const snapshot = await caller.governanceSnapshot();
  const target = snapshot.roleMembers.find(item => item.role !== "super_admin")?.role;
  if (!target) throw new Error("No non-super-admin role available for preview verification");
  const role = before.find(item => item.role === target);
  const preview = await caller.previewUpdate({
    role: target,
    modules: role ? JSON.parse(role.modules) : [],
    description: role?.description || undefined,
    detailedPermissions: role?.detailedPermissions ? JSON.parse(role.detailedPermissions) : undefined,
  });
  const after = await getAllRolePermissions();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Read-only permission snapshot or preview unexpectedly changed role templates");
  if (!snapshot.singleCompanyMode || !snapshot.routes.length || !snapshot.resources.length || !preview.role || !preview.before || !preview.after) throw new Error("Permission governance read-only response is incomplete");
  console.log(JSON.stringify({
    roles: snapshot.roleMembers.length,
    routes: snapshot.routes.length,
    resources: snapshot.resources.length,
    previewRole: preview.role,
    verification: "permission-governance-snapshot-and-preview-read-only",
  }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "permission_governance_read_only_verification_failed"); process.exit(1); });
