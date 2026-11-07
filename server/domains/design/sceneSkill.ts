import { TRPCError } from "@trpc/server";
import { AssistantConfigurationSchema } from "../../../shared/assistantConfigurations";
import {
  configurationHash,
  skillManifestHash,
} from "../ai_os/services/assistantConversationSourcePrimitives";
import { execute, jsonValue, type Scope } from "./repository";

export const SCENE_SKILL = "design.scene.plan";
export async function snapshotSceneSkill(scope: Scope, tx: any) {
  const configs = await execute(
    "SELECT revision,config,configHash FROM emperor_assistant_configurations WHERE workspaceId=? AND agentKey='images' FOR SHARE",
    [scope.workspaceId],
    tx
  );
  const skills = await execute(
    "SELECT slug,version,manifest FROM emperor_skills WHERE slug=? AND status='Released' AND (workspaceId=? OR (workspaceId IS NULL AND scope='global')) FOR SHARE",
    [SCENE_SKILL, scope.workspaceId],
    tx
  );
  if (configs.length !== 1 || skills.length !== 1)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "场景图策划技能尚未配置，请联系管理员",
    });
  const config = AssistantConfigurationSchema.parse(
    jsonValue(configs[0].config, null)
  );
  const skill = skills[0];
  const binding = config.skills.find(
    item => item.slug === SCENE_SKILL && item.enabled
  );
  if (
    configs[0].configHash !== configurationHash(config) ||
    !config.enabled ||
    !binding ||
    binding.version !== Number(skill.version) ||
    binding.manifestSha256 !== skillManifestHash(skill.manifest)
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "场景图策划技能配置已变更，请联系管理员",
    });
  const manifest = jsonValue<any>(skill.manifest, {});
  const instruction = manifest?.implementation?.systemPrompt;
  if (
    typeof instruction !== "string" ||
    !instruction.trim() ||
    instruction.length > 12000
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "场景图策划技能不可用",
    });
  return {
    slug: SCENE_SKILL,
    version: binding.version,
    manifestSha256: binding.manifestSha256,
    revision: Number(configs[0].revision),
    instruction,
    bindingInstruction: binding.instructions,
  };
}
