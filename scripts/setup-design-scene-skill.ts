import { createAssistantConfigurationService } from "../server/domains/ai_os/services/assistantConfigurations";
import { createAssistantConfigurationRepository } from "../server/domains/ai_os/repositories/assistantConfigurations";
import { execute } from "../server/domains/design/repository";
import { skillManifestHash } from "../server/domains/ai_os/services/assistantConversationSourcePrimitives";

// Run only as part of the explicitly requested deployment, with the real actor
// and workspace. The normal configuration service preserves revision history.
const workspaceId = Number(process.argv[2]),
  userId = Number(process.argv[3]);
if (
  !Number.isSafeInteger(workspaceId) ||
  workspaceId < 1 ||
  !Number.isSafeInteger(userId) ||
  userId < 1
)
  throw new Error("A workspace and administrator are required");
const actor = await execute(
  "SELECT id FROM users WHERE id=? AND status='active' AND role IN ('admin','super_admin')",
  [userId]
);
const membership = await execute(
  "SELECT id FROM workspace_memberships WHERE workspaceId=? AND userId=? AND status='active'",
  [workspaceId, userId]
);
if (actor.length !== 1 || membership.length !== 1)
  throw new Error("Administrator or workspace unavailable");
const service = createAssistantConfigurationService(
  createAssistantConfigurationRepository(),
  () => true
);
const current = await service.get(workspaceId, "images");
const matches = await execute(
  "SELECT slug,version,manifest FROM emperor_skills WHERE slug=? AND status='Released' AND (workspaceId=? OR (workspaceId IS NULL AND scope='global'))",
  ["design.scene.plan", workspaceId]
);
if (matches.length !== 1) throw new Error("Scene skill unavailable");
const skill = {
  slug: String(matches[0].slug),
  version: Number(matches[0].version),
  manifestSha256: skillManifestHash(matches[0].manifest),
};
const previous =
  current.status === "configured"
    ? current.record.config
    : {
        name: "图片策划助手",
        description: "图片策划与场景图生成",
        enabled: false,
        modelSlug: "",
        instructions: "",
        rules: [],
        skills: [],
      };
const binding = {
  slug: skill.slug,
  enabled: true,
  trigger: "场景图生成",
  instructions: "按产品主体、构图参考、效果参考分别策划。",
  version: skill.version,
  manifestSha256: skill.manifestSha256,
};
const existing = previous.skills.find(item => item.slug === skill.slug);
if (
  previous.enabled &&
  existing?.enabled &&
  existing.version === skill.version &&
  existing.manifestSha256 === skill.manifestSha256
) {
  console.log("Scene skill is already configured");
} else {
  const updatedBinding = existing
    ? {
        ...existing,
        enabled: true,
        version: skill.version,
        manifestSha256: skill.manifestSha256,
      }
    : binding;
  const config = {
    ...previous,
    enabled: true,
    skills: [
      ...previous.skills.filter(item => item.slug !== skill.slug),
      updatedBinding,
    ],
  };
  const result = await service.save(workspaceId, userId, {
    agentKey: "images",
    expectedRevision:
      current.status === "configured" ? current.record.revision : 0,
    config,
  });
  console.log(`Scene skill configured at revision ${result.revision}`);
}
process.exit(0);
