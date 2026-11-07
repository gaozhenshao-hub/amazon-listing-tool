import { writeFile } from "node:fs/promises";
import {
  REVIEW_SKILL,
  VIDEO_SKILL,
  REVIEW_SKILL_PROMPT,
  VIDEO_SKILL_PROMPT,
  AGGREGATION_SKILL_PROMPT,
  AGGREGATION_SKILL_PROMPT_INITIAL,
  AGGREGATION_SKILL_PROMPT_SECOND,
} from "../server/domains/listing/listingSkillPrompts";
import { assistantConfigurationService } from "../server/domains/ai_os/services/assistantConfigurations";
export const researchSkillDefinitions = [
  {
    slug: REVIEW_SKILL,
    version: 1,
    maxTokens: undefined,
    initialPrompt: undefined,
    name: "竞品分析（评论与证据）",
    description: "具体表达好差评结论，保留已有评论证据和独立拉链问题",
    prompt: REVIEW_SKILL_PROMPT,
  },
  {
    slug: "listing.aggregation.graph.v1",
    version: 3,
    maxTokens: 16384,
    initialPrompt: AGGREGATION_SKILL_PROMPT_INITIAL,
    name: "聚合分析",
    description: "功能与用户获益归类连线、已有评论归并及来源反查",
    prompt: AGGREGATION_SKILL_PROMPT,
  },
  {
    slug: VIDEO_SKILL,
    version: 1,
    maxTokens: undefined,
    initialPrompt: undefined,
    name: "视频字幕与卖点分析",
    description: "提前准备中文字幕并提取带时间证据的视频卖点",
    prompt: VIDEO_SKILL_PROMPT,
  },
];
export async function bindResearchSkills(workspaceId: number, userId: number) {
  const options = await assistantConfigurationService.options(workspaceId),
    current = await assistantConfigurationService.get(workspaceId, "listing");
  if (!options.writeEnabled || current.status !== "configured")
    throw new Error("小L尚未配置，请先保留并核对现有助手配置");
  const skills = current.record.config.skills.filter(
    s => s.slug !== "listing.competitor.reviews.v1"
  );
  for (const item of researchSkillDefinitions) {
    const descriptor = options.skills.find(s => s.slug === item.slug);
    if (!descriptor) throw new Error("中文业务技能尚未发布：" + item.name);
    const binding = {
      slug: item.slug,
      enabled: true,
      version: descriptor.version,
      manifestSha256: descriptor.manifestSha256,
      trigger: item.description,
      instructions:
        "按" + item.name + "技能处理当前板块，保留来源证据和人工调整。",
    };
    const index = skills.findIndex(s => s.slug === item.slug);
    if (index < 0) skills.push(binding);
    else skills[index] = binding;
  }
  const saved = await assistantConfigurationService.save(workspaceId, userId, {
    agentKey: "listing",
    expectedRevision: current.record.revision,
    config: { ...current.record.config, skills },
  });
  return {
    revision: saved.revision,
    skills: researchSkillDefinitions.map(s => ({ slug: s.slug, name: s.name })),
  };
}
if (process.argv.includes("--write-migration")) {
  const literal = (s: string) =>
    "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
  const sql = researchSkillDefinitions
    .map(s =>
      [
        "INSERT INTO emperor_skills (slug,name,description,category,status,scope,version,isSystem,manifest,when_to_use)",
        "SELECT " +
          [s.slug, s.name, s.description, "运营", "Released", "global"]
            .map(literal)
            .join(",") +
          ",1,1,",
        "JSON_OBJECT('implementation',JSON_OBJECT('systemPrompt'," +
          literal(s.initialPrompt || s.prompt) +
          ",'userPromptTemplate','{{context}}','modelPolicy','gem-3.8-flash','supportsJsonMode',TRUE)),",
        literal(s.description) +
          " WHERE NOT EXISTS (SELECT 1 FROM emperor_skills WHERE slug=" +
          literal(s.slug) +
          ");",
      ].join("\n")
    )
    .join("\n\n");
  await writeFile(
    "drizzle/0319_listing_research_skills.sql",
    "-- DEDICATED RELEASE ONLY: Chinese listing research Skills.\n" + sql + "\n"
  );
  const aggregation=researchSkillDefinitions.find(s=>s.slug==="listing.aggregation.graph.v1")!;
  await writeFile("drizzle/0320_listing_aggregation_output_budget.sql",[
    "-- DEDICATED RELEASE ONLY: allow complete feature/benefit/review output for the new research Skill.",
    "-- Forward-only; preserve the prompt and all unrelated Skills, customizations and historical migrations.",
    "UPDATE emperor_skills SET manifest=JSON_SET(manifest,'$.implementation.maxTokens',16384,'$.implementation.systemPrompt',"+literal(AGGREGATION_SKILL_PROMPT_SECOND)+"),version=2",
    "WHERE slug='listing.aggregation.graph.v1' AND workspaceId IS NULL AND version=1 AND status='Released'",
    "AND JSON_UNQUOTE(JSON_EXTRACT(manifest,'$.implementation.systemPrompt'))="+literal(aggregation.initialPrompt!)+";",
  ].join("\n")+"\n");
  await writeFile("drizzle/0321_listing_aggregation_classification.sql",[
    "-- DEDICATED RELEASE ONLY: requested feature priorities and legacy review deduplication contract.",
    "UPDATE emperor_skills SET manifest=JSON_SET(manifest,'$.implementation.systemPrompt',"+literal(aggregation.prompt)+"),version=3",
    "WHERE slug='listing.aggregation.graph.v1' AND workspaceId IS NULL AND version=2 AND status='Released'",
    "AND JSON_UNQUOTE(JSON_EXTRACT(manifest,'$.implementation.systemPrompt'))="+literal(AGGREGATION_SKILL_PROMPT_SECOND)+";",
  ].join("\n")+"\n");
  console.log("已生成中文业务技能及完整聚合输出预算的迁移。");
} else if (process.argv.includes("--run")) {
  const index = process.argv.indexOf("--run"),
    workspaceId = Number(process.argv[index + 1]),
    userId = Number(process.argv[index + 2]);
  if (
    !Number.isSafeInteger(workspaceId) ||
    workspaceId < 1 ||
    !Number.isSafeInteger(userId) ||
    userId < 1
  )
    throw new Error("请指定工作区和用户");
  console.log(JSON.stringify(await bindResearchSkills(workspaceId, userId)));
}
