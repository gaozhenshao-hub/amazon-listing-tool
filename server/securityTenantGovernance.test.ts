import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  SECURITY_ACTIONS,
  SECURITY_PERMISSION_MATRIX,
  SECURITY_RESOURCES,
} from "../shared/const";

const root = process.cwd();

function readRepoFile(repoPath: string) {
  return fs.readFileSync(path.join(root, repoPath), "utf8");
}

describe("security tenant governance v1", () => {
  it("defines resource-action permissions for tenant controlled surfaces", () => {
    expect(SECURITY_RESOURCES).toEqual([
      "project",
      "image_workflow",
      "product_development",
      "knowledge",
      "file",
      "tool",
      "agent",
      "ops_data",
    ]);
    expect(SECURITY_ACTIONS).toEqual(
      expect.arrayContaining([
        "read",
        "create",
        "update",
        "delete",
        "upload",
        "import",
        "export",
        "invoke",
        "run",
        "confirm",
        "cancel",
        "manage_secret",
        "rotate_secret",
        "sync",
      ]),
    );
    expect(SECURITY_PERMISSION_MATRIX.super_admin?.tool).toEqual(SECURITY_ACTIONS);
    expect(SECURITY_PERMISSION_MATRIX.admin?.tool).toEqual(expect.arrayContaining(["manage_secret", "rotate_secret"]));
    expect(SECURITY_PERMISSION_MATRIX.ops_specialist?.tool || []).not.toContain("rotate_secret");
  });

  it("ships a tenant migration with workspace scope, audit logs, and secret key versions", () => {
    const migration = readRepoFile("drizzle/0114_security_tenant_governance_v1.sql");

    for (const table of [
      "organizations",
      "workspaces",
      "workspace_memberships",
      "security_access_policies",
      "security_audit_logs",
      "emperor_secret_key_versions",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS \`${table}\``);
    }

    for (const table of [
      "projects",
      "projectFiles",
      "ai_jobs",
      "emperor_agent_runs",
      "emperor_agent_artifacts",
      "emperor_tool_runs",
      "emperor_tool_secrets",
    ]) {
      expect(migration).toContain(`ALTER TABLE \`${table}\``);
      expect(migration).toContain("ADD COLUMN `workspaceId` int");
    }

    expect(migration).toContain("idx_security_audit_workspace_created");
    expect(migration).toContain("idx_tool_runs_workspace_tool_created");
    expect(migration).toContain("INSERT INTO `emperor_secret_key_versions`");
    expect(migration).toContain("'tool', 'v1', 'active'");
  });

  it("keeps database governance aware of tenant security tables", () => {
    const governance = readRepoFile("server/repositories/dbGovernance.ts");

    expect(governance).toContain('"organizations"');
    expect(governance).toContain('"workspace_memberships"');
    expect(governance).toContain('"security_audit_logs"');
    expect(governance).toContain('"emperor_secret_key_versions"');
    expect(governance).toContain('indexName: "idx_security_audit_workspace_created"');
    expect(governance).toContain('indexName: "idx_tool_runs_workspace_tool_created"');
  });

  it("centralizes authorization, workspace scope, and security audit helpers", () => {
    const service = readRepoFile("server/services/securityGovernance.ts");

    expect(service).toContain("export async function hasResourceAction");
    expect(service).toContain("export async function assertResourceAction");
    expect(service).toContain("export async function recordSecurityAuditLog");
    expect(service).toContain("export function buildWorkspaceScopeFilter");
    expect(service).toContain("workspace_memberships");
    expect(service).toContain("security_access_policies");
    expect(service).toContain("security_audit_logs");

    const membershipCheck = service.indexOf("actorCanUseWorkspace(input.actor, workspaceId)");
    const ownerBypass = service.indexOf("input.ownerUserId && input.ownerUserId === input.actor.id");
    expect(membershipCheck).toBeGreaterThan(0);
    expect(ownerBypass).toBeGreaterThan(membershipCheck);
  });

  it("routes core surfaces through authorization and audit gates", () => {
    const authRepository = readRepoFile("server/repositories/auth/authRepository.ts");
    const projectRouter = readRepoFile("server/routers/project.ts");
    const projectFileRouter = readRepoFile("server/routers/projectFile.ts");
    const opsContext = [
      readRepoFile("server/domains/ops/routerContext.ts"),
      readRepoFile("server/domains/ops/workspaceProcedure.ts"),
    ].join("\n");
    const toolsRouter = readRepoFile("server/domains/ai_os/routers/tools.ts");
    const mcpRouter = readRepoFile("server/domains/ai_os/routers/mcp.ts");
    const agentsRouter = readRepoFile("server/domains/ai_os/routers/agents.ts");

    expect(authRepository).toContain("ensureDefaultWorkspaceForUser");
    expect(authRepository).toContain("workspaceMemberships");
    expect(projectRouter).toContain('resource: "project"');
    expect(projectRouter).toContain("recordSecurityAuditLog");
    expect(projectFileRouter).toContain('resource: "file"');
    expect(projectFileRouter).toContain("recordSecurityAuditLog");
    expect(opsContext).toContain('resource: "ops_data"');
    expect(opsContext).toContain("recordSecurityAuditLog");
    expect(toolsRouter).toContain('resource: "tool"');
    expect(toolsRouter).toContain("rotateSecret");
    expect(mcpRouter).toContain('resource: "tool"');
    expect(agentsRouter).toContain('resource: "agent"');
  });

  it("forces Tool secret references and supports key rotation", () => {
    const gateway = [
      readRepoFile("server/domains/ai_os/services/toolGateway.ts"),
      readRepoFile("server/domains/ai_os/services/toolGateway/governanceCore.ts"),
      readRepoFile("server/domains/ai_os/services/toolGateway/management.ts"),
    ].join("\n");

    expect(gateway).toContain("assertToolConfigUsesSecretRefs");
    expect(gateway).toContain("currentToolSecretKeyVersion");
    expect(gateway).toContain("rotateEmperorToolSecret");
    expect(gateway).toContain("secret://");
    expect(gateway).toContain("SECRET_TEMPLATE_PATTERN");
    expect(gateway).toContain("secret:");
    expect(gateway).toContain("previousKeyVersion");
  });
});
