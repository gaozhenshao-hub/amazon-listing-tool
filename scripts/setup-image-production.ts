import { mkdir, writeFile, readFile } from "node:fs/promises";
import { productionSkillDefinitions } from "../server/domains/listing/imageProductionSkills";
import {
  IMAGE_DOCUMENT_PROMPT,
  IMAGE_DOCUMENT_SKILL,
} from "../server/domains/listing/imageDocumentPrompt";
import { assistantConfigurationService } from "../server/domains/ai_os/services/assistantConfigurations";
import { closeDbConnection } from "../server/repositories/dbClient";

export async function configureImageProduction(
  workspaceId: number,
  userId: number
) {
  const current = await assistantConfigurationService.get(
    workspaceId,
    "images"
  );
  if (current.status !== "configured" || !current.record.config.enabled)
    throw new Error("请先启用图片策划助手");
  const options = await assistantConfigurationService.options(workspaceId);
  const bindings = [
    {
      skill: IMAGE_DOCUMENT_SKILL,
      name: "套图文档策划",
      label: "生成图片内容和五段提示词",
    },
    ...productionSkillDefinitions,
  ].map(def => {
    const skill = options.skills.find(s => s.slug === def.skill);
    if (!skill) throw new Error(`尚未发布${def.name}，停止修改配置`);
    const previous = current.record.config.skills.find(
      s => s.slug === def.skill
    );
    return {
      slug: def.skill,
      enabled: previous?.enabled ?? true,
      version: skill.version,
      manifestSha256: skill.manifestSha256,
      trigger: `运营手动执行${def.label}`,
      instructions: (
        previous?.instructions ||
        "只处理当前步骤，使用已确认上一步结果和指定参考；运营确认后才能进入下一步。"
      ).replace(
        /四步提示词依次衔接/g,
        "五段提示词按整体构图、背景场景、产品嵌入、交互融合、文字图标衔接"
      ),
    };
  });
  const config = {
    ...current.record.config,
    skills: [
      ...current.record.config.skills.filter(
        s => !bindings.some(b => b.slug === s.slug)
      ),
      ...bindings,
    ],
  };
  if (JSON.stringify(config) === JSON.stringify(current.record.config))
    return { changed: false, revision: current.record.revision };
  const saved = await assistantConfigurationService.save(workspaceId, userId, {
    agentKey: "images",
    expectedRevision: current.record.revision,
    config,
  });
  return { changed: true, revision: saved.revision };
}
const quote = (s: string) =>
  "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
const manifest = (instruction: string, maxTokens = 8192) =>
  JSON.stringify({
    implementation: {
      systemPrompt: instruction,
      userPromptTemplate: "{{context}}",
      modelPolicy: "gem-3.8-flash",
      supportsJsonMode: true,
      maxTokens,
    },
  });
if (process.argv.includes("--migration")) {
  const ddl = `-- DEDICATED RELEASE ONLY. Add image-production state and isolated per-step skills; preserve all existing business results and custom skill overrides.
CREATE TABLE IF NOT EXISTS listing_image_productions (
 project_id INT NOT NULL,workspace_id INT NOT NULL,user_id INT NOT NULL,image_id CHAR(36) NOT NULL,data JSON NOT NULL,revision INT NOT NULL DEFAULT 1,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY(project_id,workspace_id,user_id,image_id),KEY idx_production_owner(workspace_id,user_id)
);
${productionSkillDefinitions
  .map(
    def => `INSERT INTO emperor_skills(slug,name,description,category,status,scope,version,isSystem,manifest,when_to_use)
SELECT ${quote(def.skill)},${quote(def.name)},${quote(def.name + "：按当前图位已确认提示词和参考制作并多轮调整")},'运营','Released','global',1,1,${quote(manifest(def.instruction))},${quote("运营点击" + def.label + "时使用")}
WHERE NOT EXISTS(SELECT 1 FROM emperor_skills WHERE slug=${quote(def.skill)} AND workspaceId IS NULL);`
  )
  .join("\n")}
UPDATE emperor_skills SET version=5,manifest=${quote(manifest(IMAGE_DOCUMENT_PROMPT, 24576))} WHERE slug=${quote(IMAGE_DOCUMENT_SKILL)} AND workspaceId IS NULL AND isSystem=1 AND status='Released' AND version=4;
`;
  const file = "drizzle/0333_listing_image_production.sql";
  const previous = await readFile(file, "utf8").catch(() => null);
  if (previous !== null && previous !== ddl)
    throw new Error("0333已存在且内容不同，禁止重写历史迁移");
  await writeFile(file, ddl);
  for (const def of [
    ...productionSkillDefinitions.map(d => ({
      name: d.name,
      instruction: d.instruction,
    })),
    { name: "套图文档策划", instruction: IMAGE_DOCUMENT_PROMPT },
  ]) {
    await mkdir(`skills/${def.name}`, { recursive: true });
    await writeFile(
      `skills/${def.name}/SKILL.md`,
      `---\nname: ${def.name}\ndescription: ${def.name}，运营手动触发，依据已确认资料制作并调整当前结果。\n---\n\n${def.instruction}\n`
    );
  }
  console.log("已生成0333迁移和中文业务Skills，未连接生产库或执行迁移");
} else if (process.argv.includes("--run")) {
  const workspaceId = Number(process.env.IMAGE_PRODUCTION_WORKSPACE_ID),
    userId = Number(process.env.IMAGE_PRODUCTION_USER_ID);
  if (!workspaceId || !userId) throw new Error("必须明确指定工作空间和操作人");
  try {
    console.log(await configureImageProduction(workspaceId, userId));
  } finally {
    await closeDbConnection();
  }
}
