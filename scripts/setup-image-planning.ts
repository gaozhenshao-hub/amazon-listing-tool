import { writeFile } from "node:fs/promises";
import {
  IMAGE_PLANNING_PROMPT,
  IMAGE_PLANNING_SKILL,
} from "../server/domains/listing/imagePlanningPrompt";
import {
  AMAZON_MODULE_CATALOG,
  IMAGE_FAMILIES,
} from "../shared/imageModuleSpecs";
import { assistantConfigurationService } from "../server/domains/ai_os/services/assistantConfigurations";
import { closeDbConnection } from "../server/repositories/dbClient";

const role =
  "你是图片策划大师，以资深亚马逊视觉策划的判断，为当前产品组织清晰、有依据的图片大纲。结合已保存的卖点梳理、好差评、买家问题库。图片内容只描述画面；功能与用户获益在关联卖点中分别引用，不重复写一份分析。重要卖点可换角度重复表达，相关次要细节可合并。";
export async function configureImagePlanner(
  workspaceId: number,
  userId: number
) {
  const [current, tagger, options] = await Promise.all([
    assistantConfigurationService.get(workspaceId, "images"),
    assistantConfigurationService.get(workspaceId, "tagger"),
    assistantConfigurationService.options(workspaceId),
  ]);
  if (!options.writeEnabled) throw new Error("助手配置当前不可修改");
  const descriptor = options.skills.find(s => s.slug === IMAGE_PLANNING_SKILL);
  if (!descriptor) throw new Error("图片大纲规划技能尚未发布");
  const old = current.status === "configured" ? current.record.config : null;
  const modelSlug =
    old?.modelSlug ||
    (tagger.status === "configured" ? tagger.record.config.modelSlug : "");
  if (
    !modelSlug ||
    !options.models.some(
      m => m.slug === modelSlug && m.capabilityTags.includes("vision")
    )
  )
    throw new Error("没有可沿用的视觉模型，请配置图片策划助手");
  const binding = {
    slug: IMAGE_PLANNING_SKILL,
    enabled: true,
    version: descriptor.version,
    manifestSha256: descriptor.manifestSha256,
    trigger: "规划主图备选、附图、A+与品牌故事大纲；逐图对话调整",
    instructions:
      "按图片大纲规划技能工作，引用最新三类上游结论；参考图由用户人工选择。",
  };
  const config = {
    name: old?.name || "图片策划助手",
    description: old?.description || "图片策划大师：图片大纲与画面表达",
    enabled: true,
    modelSlug,
    instructions: old?.instructions?.includes(role)
      ? old.instructions
      : [old?.instructions, role].filter(Boolean).join("\n\n"),
    rules: old?.rules || [],
    skills: [
      ...(old?.skills || []).filter(s => s.slug !== IMAGE_PLANNING_SKILL),
      binding,
    ],
  };
  const saved = await assistantConfigurationService.save(workspaceId, userId, {
    agentKey: "images",
    expectedRevision:
      current.status === "configured" ? current.record.revision : 0,
    config,
  });
  return {
    revision: saved.revision,
    skill: IMAGE_PLANNING_SKILL,
    name: "图片大纲规划",
    modelSlug,
  };
}
if (process.argv.includes("--write-migration")) {
  const literal = (s: string) =>
    "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
  const skill = [
    "-- Dedicated release only. Preserve existing Skills, image tags and assets.",
    "INSERT INTO emperor_skills (slug,name,description,category,status,scope,version,isSystem,manifest,when_to_use)",
    "SELECT " +
      [
        IMAGE_PLANNING_SKILL,
        "图片大纲规划",
        "以图片策划大师身份结合卖点、好差评和买家问题规划画面",
        "运营",
        "Released",
        "global",
      ]
        .map(literal)
        .join(",") +
      ",1,1,",
    "JSON_OBJECT('implementation',JSON_OBJECT('systemPrompt'," +
      literal(IMAGE_PLANNING_PROMPT) +
      ",'userPromptTemplate','{{context}}','modelPolicy','gem-3.8-flash','supportsJsonMode',TRUE,'maxTokens',24576)),",
    literal("规划图片大纲或逐图调整画面") +
      " WHERE NOT EXISTS (SELECT 1 FROM emperor_skills WHERE slug=" +
      literal(IMAGE_PLANNING_SKILL) +
      ");",
  ];
  const tags = [
    ...IMAGE_FAMILIES.map(value => ({
      value,
      parent: null as string | null,
      metadata: JSON.stringify({ catalogVersion: 1 }),
    })),
    ...AMAZON_MODULE_CATALOG.map(spec => ({
      value: spec.name,
      parent: spec.family,
      metadata: JSON.stringify(spec),
    })),
  ];
  for (const [i, tag] of tags.entries())
    skill.push(
      "INSERT INTO kb_tag_definitions(userId,dimension,parentValue,value,sortOrder,isSystem,metadata) SELECT (SELECT MIN(id) FROM users WHERE role IN ('admin','super_admin')),'imageBelong'," +
        (tag.parent ? literal(tag.parent) : "NULL") +
        "," +
        literal(tag.value) +
        "," +
        i +
        ",1," +
        literal(tag.metadata) +
        " WHERE NOT EXISTS (SELECT 1 FROM kb_tag_definitions WHERE dimension='imageBelong' AND parentValue <=> " +
        (tag.parent ? literal(tag.parent) : "NULL") +
        " AND value=" +
        literal(tag.value) +
        ");"
    );
  await writeFile(
    "drizzle/0323_image_planning_skill_and_tags.sql",
    skill.join("\n") + "\n"
  );
  console.log("已生成中文图片大纲技能及两级官方模块规格迁移");
} else if (process.argv.includes("--run")) {
  const at = process.argv.indexOf("--run"),
    workspaceId = Number(process.argv[at + 1]),
    userId = Number(process.argv[at + 2]);
  if (
    !Number.isSafeInteger(workspaceId) ||
    workspaceId < 1 ||
    !Number.isSafeInteger(userId) ||
    userId < 1
  )
    throw new Error("请指定工作区和用户");
  console.log(JSON.stringify(await configureImagePlanner(workspaceId, userId)));
  await closeDbConnection();
}
