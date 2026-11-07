import { mkdir, writeFile, readFile } from "node:fs/promises";
import {
  IMAGE_PLANNING_SKILL,
  IMAGE_PLANNING_PROMPT,
} from "../server/domains/listing/imagePlanningPrompt";
import {
  IMAGE_DOCUMENT_SKILL,
  IMAGE_DOCUMENT_PROMPT,
} from "../server/domains/listing/imageDocumentPrompt";
import { assistantConfigurationService } from "../server/domains/ai_os/services/assistantConfigurations";
import { closeDbConnection } from "../server/repositories/dbClient";
const skills = [
  {
    slug: IMAGE_PLANNING_SKILL,
    name: "图片大纲规划",
    version: 4,
    previous: 3,
    prompt: IMAGE_PLANNING_PROMPT,
    description: "规划模块目标、各图分工及具体卖点和用户关注，支持相邻A+合并。",
  },
  {
    slug: IMAGE_DOCUMENT_SKILL,
    name: "套图文档策划",
    version: 4,
    previous: 3,
    prompt: IMAGE_DOCUMENT_PROMPT,
    description:
      "整体细化图片布局、场景、产品交互、文字与构图参考，保留人工效果参考。",
  },
];
export async function configureModuleWorkflow(
  workspaceId: number,
  userId: number
) {
  const [current, options] = await Promise.all([
    assistantConfigurationService.get(workspaceId, "images"),
    assistantConfigurationService.options(workspaceId),
  ]);
  if (current.status !== "configured" || !current.record.config.enabled)
    throw new Error("图片策划助手未启用，保留原配置");
  const bindings = current.record.config.skills.map(binding => {
    const selected = skills.find(s => s.slug === binding.slug);
    if (!selected) return binding;
    const descriptor = options.skills.find(s => s.slug === binding.slug);
    if (!descriptor || Number(descriptor.version) !== selected.version)
      throw new Error("中文技能版本与本次发布不一致，保留原助手配置");
    return {
      ...binding,
      version: descriptor.version,
      manifestSha256: descriptor.manifestSha256,
    };
  });
  if (skills.some(s => !bindings.some(b => b.slug === s.slug && b.enabled)))
    throw new Error("请先启用图片大纲规划和套图文档策划，保留原助手配置");
  const instructions =
    "最新图片工作流：图片策划→人工找参考图→套图文档。大纲先写模块目标与各图分工，逐图关联具体功能、获益和用户关注；主图1模块含3方案，附图7模块，高级A+默认7模块位，品牌故事5模块。构图方式只用知识库整体布局标签，图片内容写清各区、背景、主体交互及短文案、主副标题位置及可视化图标，构图线框仅无合适参考时手动触发；效果图参考由人工选择。";
  const config = {
    ...current.record.config,
    skills: bindings,
    instructions: current.record.config.instructions.includes(instructions)
      ? current.record.config.instructions
      : [current.record.config.instructions, instructions]
          .filter(Boolean)
          .join("\n\n"),
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
async function writeMigration() {
  const literal = (s: string) =>
    "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
  const statements = skills
    .filter(s => s.slug === IMAGE_DOCUMENT_SKILL)
    .map(s => {
      const manifest = JSON.stringify({
        implementation: {
          systemPrompt: s.prompt,
          userPromptTemplate: "{{context}}",
          modelPolicy: "gem-3.8-flash",
          supportsJsonMode: true,
          maxTokens: 24576,
        },
      });
      return `UPDATE emperor_skills SET version=${s.version},manifest=${literal(manifest)} WHERE slug='${s.slug}' AND workspaceId IS NULL AND isSystem=1 AND status='Released' AND version=${s.previous};`;
    });
  const migration =
      "-- DEDICATED RELEASE ONLY. Upgrade existing Chinese-named document skill; preserve project results, unrelated skills and workspace overrides.\n" +
      statements.join("\n") +
      "\n",
    path = "drizzle/0332_image_plan_copy_wireframe.sql";
  let before: string | undefined;
  try {
    before = await readFile(path, "utf8");
  } catch {}
  if (
    before &&
    before !== migration &&
    !process.argv.includes("--replace-unreleased")
  )
    throw new Error(
      "新迁移已经生成。如尚未发布，请明确指定--replace-unreleased；已应用迁移不得改写"
    );
  await writeFile(path, migration);
  for (const skill of skills) {
    const directory = `skills/${skill.name}`;
    await mkdir(directory, { recursive: true });
    await writeFile(
      `${directory}/SKILL.md`,
      `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.prompt}\n`
    );
  }
  console.log("已生成模块大纲与图片内容的中文技能升级");
}
if (process.argv.includes("--migration")) await writeMigration();
else if (process.argv.includes("--run")) {
  const i = process.argv.indexOf("--run"),
    workspaceId = Number(process.argv[i + 1]),
    userId = Number(process.argv[i + 2]);
  if (
    !Number.isSafeInteger(workspaceId) ||
    workspaceId < 1 ||
    !Number.isSafeInteger(userId) ||
    userId < 1
  )
    throw new Error("请指定工作区和用户");
  try {
    console.log(
      JSON.stringify(await configureModuleWorkflow(workspaceId, userId))
    );
  } finally {
    await closeDbConnection();
  }
}
