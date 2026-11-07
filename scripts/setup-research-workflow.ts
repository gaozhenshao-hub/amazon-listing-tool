import { writeFile, mkdir } from "node:fs/promises";
import {
  RESEARCH_SKILLS,
  researchSkillPrompts,
  RESEARCH_ADJUST_SKILL,
  RESEARCH_ADJUST_PROMPT,
} from "../server/domains/listing/researchPrompts";
import {
  IMAGE_PLANNING_PROMPT,
  IMAGE_PLANNING_SKILL,
} from "../server/domains/listing/imagePlanningPrompt";
import { assistantConfigurationService } from "../server/domains/ai_os/services/assistantConfigurations";
import { closeDbConnection } from "../server/repositories/dbClient";
const names = {
  selling: "卖点梳理",
  reviews: "评论分析",
  questions: "买家问题整理",
  planning: "图片策划对话",
};
export async function configureResearchWorkflow(
  workspaceId: number,
  userId: number
) {
  const [current, options] = await Promise.all([
    assistantConfigurationService.get(workspaceId, "images"),
    assistantConfigurationService.options(workspaceId),
  ]);
  if (current.status !== "configured" || !current.record.config.enabled)
    throw new Error("图片策划助手未启用，保留原配置");
  const slugs = [IMAGE_PLANNING_SKILL, RESEARCH_SKILLS.planning],
    skills = slugs.map(slug => {
      const descriptor = options.skills.find(s => s.slug === slug);
      if (!descriptor) throw new Error("相关中文技能尚未发布");
      return {
        slug,
        enabled: true,
        version: descriptor.version,
        manifestSha256: descriptor.manifestSha256,
        trigger:
          slug === IMAGE_PLANNING_SKILL
            ? "图片大纲规划和逐图调整"
            : "图片策划对话",
        instructions:
          "以图片策划大师身份，使用卖点、好差评、买家问题及本品图片；尊重人工修改，按用户确认后的本品资料策划。",
      };
    });
  const instructions =
    "最新本品资料规则：已保存的卖点梳理就是完善的本品资料，人工修改优先，不再要求上传属性表；明确待改进/待实现除外。结合持续保存的图片策划对话确定画面方向。功能、获益、评论、买家问题统一四类，差异化独立黄标。";
  const config = {
    ...current.record.config,
    instructions: current.record.config.instructions.includes(instructions)
      ? current.record.config.instructions
      : [current.record.config.instructions, instructions]
          .filter(Boolean)
          .join("\n\n"),
    skills: [
      ...current.record.config.skills.filter(s => !slugs.includes(s.slug)),
      ...skills,
    ],
  };
  const saved = await assistantConfigurationService.save(workspaceId, userId, {
    agentKey: "images",
    expectedRevision: current.record.revision,
    config,
  });
  const listing = await assistantConfigurationService.get(
    workspaceId,
    "listing"
  );
  let listingSkillNames: string[] = [];
  if (listing.status === "configured") {
    const required = [
      RESEARCH_SKILLS.selling,
      RESEARCH_SKILLS.reviews,
      RESEARCH_SKILLS.questions,
      RESEARCH_ADJUST_SKILL,
    ];
    const bindings = required.map(slug => {
      const descriptor = options.skills.find(s => s.slug === slug);
      if (!descriptor) throw new Error("小L相关技能尚未发布");
      listingSkillNames.push(descriptor.name);
      return {
        slug,
        enabled: true,
        version: descriptor.version,
        manifestSha256: descriptor.manifestSha256,
        trigger: descriptor.name,
        instructions:
          "使用统一四类分类；保留人工修改和来源；问答以本品已确认资料为准，不移植竞品参数。",
      };
    });
    await assistantConfigurationService.save(workspaceId, userId, {
      agentKey: "listing",
      expectedRevision: listing.record.revision,
      config: {
        ...listing.record.config,
        skills: [
          ...listing.record.config.skills.filter(
            s => !required.includes(s.slug)
          ),
          ...bindings,
        ],
      },
    });
  }
  return {
    revision: saved.revision,
    listingSkillNames,
    skills: skills.map(s => s.slug),
    modelSlug: config.modelSlug,
  };
}
export async function restoreResearchConfiguration(
  workspaceId: number,
  userId: number,
  config: import("../shared/assistantConfigurations").AssistantConfiguration,
  agentKey: "images" | "listing" = "images"
) {
  const current = await assistantConfigurationService.get(
    workspaceId,
    agentKey
  );
  if (current.status !== "configured")
    throw new Error("Original assistant configuration unavailable");
  return assistantConfigurationService.save(workspaceId, userId, {
    agentKey,
    expectedRevision: current.record.revision,
    config,
  });
}
if(process.argv.includes("--write-preview-workflow")) {
  const literal=(s:string)=>"'"+s.replace(/\\/g,"\\\\").replace(/'/g,"''")+"'";
  const statements=["-- Explicit candidate workflow; upgrade only image planning Skills, never project contents."];
  for(const skill of [{slug:IMAGE_PLANNING_SKILL,name:"图片大纲规划",prompt:IMAGE_PLANNING_PROMPT,before:2,after:3,maxTokens:24576},{slug:RESEARCH_SKILLS.planning,name:"图片策划对话",prompt:researchSkillPrompts.planning,before:1,after:2,maxTokens:8000}]){
    const manifest=JSON.stringify({implementation:{systemPrompt:skill.prompt,userPromptTemplate:"{{context}}",modelPolicy:"gem-3.8-flash",supportsJsonMode:true,maxTokens:skill.maxTokens}});
    statements.push(`UPDATE emperor_skills SET version=${skill.after},manifest=${literal(manifest)} WHERE slug=${literal(skill.slug)} AND workspaceId IS NULL AND isSystem=1 AND version=${skill.before};`);
    await writeFile(`skills/${skill.name}/SKILL.md`,`---\nname: ${skill.name}\ndescription: ${skill.name}，主动触发、保留人工修改，先预览后确认。\n---\n\n${skill.prompt}\n`);
  }
  await writeFile("drizzle/0327_explicit_preview_workflow.sql",statements.join("\n")+"\n");
  console.log("已生成图片策划与大纲中文技能升级");
} else if(process.argv.includes("--write-question-consolidation")) {
  const manifest=JSON.stringify({implementation:{systemPrompt:researchSkillPrompts.questions,userPromptTemplate:"{{context}}",modelPolicy:"gem-3.8-flash",supportsJsonMode:true,maxTokens:24576}});
  const literal=(s:string)=>"'"+s.replace(/\\/g,"\\\\").replace(/'/g,"''")+"'";
  await writeFile("drizzle/0326_question_consolidation.sql","-- Upgrade only the buyer-question Skill; no project facts or assets are rewritten.\nUPDATE emperor_skills SET version=2,manifest="+literal(manifest)+" WHERE slug='listing.research.questions.v2' AND workspaceId IS NULL AND isSystem=1 AND version=1;\n");
  await writeFile("skills/买家问题整理/SKILL.md","---\nname: 买家问题整理\ndescription: 按购买顾虑合并同类问题与答案，保留来源和人工内容。\n---\n\n"+researchSkillPrompts.questions+"\n");
  console.log("已生成买家问题合并技能升级");
} else if (process.argv.includes("--write-migration")) {
  const literal = (s: string) =>
      "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'",
    statements = [
      "-- Dedicated research workflow release; no project content, evidence or assets are rewritten.",
    ];
  for (const section of Object.keys(names) as Array<keyof typeof names>) {
    const slug = RESEARCH_SKILLS[section],
      name = names[section],
      prompt = researchSkillPrompts[section];
    const manifest = JSON.stringify({
      implementation: {
        systemPrompt: prompt,
        userPromptTemplate: "{{context}}",
        modelPolicy: "gem-3.8-flash",
        supportsJsonMode: true,
        maxTokens: section === "planning" ? 8000 : 24576,
      },
    });
    statements.push(
      `INSERT INTO emperor_skills(slug,name,description,category,status,scope,version,isSystem,manifest,when_to_use) SELECT ${literal(slug)},${literal(name)},${literal("小L按统一分类与人工优先规则完成" + name)},'运营','Released','global',1,1,${literal(manifest)},${literal("运营主动点击" + name)} WHERE NOT EXISTS(SELECT 1 FROM emperor_skills WHERE slug=${literal(slug)});`
    );
    await mkdir(`skills/${name}`, { recursive: true });
    await writeFile(
      `skills/${name}/SKILL.md`,
      `---\nname: ${name}\ndescription: ${name}，统一分类、保留人工结论与真实依据。\n---\n\n${prompt}\n`
    );
  }
  const adjustManifest = JSON.stringify({
    implementation: {
      systemPrompt: RESEARCH_ADJUST_PROMPT,
      userPromptTemplate: "{{context}}",
      modelPolicy: "gem-3.8-flash",
      supportsJsonMode: true,
      maxTokens: 16000,
    },
  });
  statements.push(
    `INSERT INTO emperor_skills(slug,name,description,category,status,scope,version,isSystem,manifest,when_to_use) SELECT ${literal(RESEARCH_ADJUST_SKILL)},'聚合结果调整','在当前结果对话调整并建立独立改进草稿','运营','Released','global',1,1,${literal(adjustManifest)},'运营对话调整当前结果' WHERE NOT EXISTS(SELECT 1 FROM emperor_skills WHERE slug=${literal(RESEARCH_ADJUST_SKILL)});`
  );
  await mkdir("skills/聚合结果调整", { recursive: true });
  await writeFile(
    "skills/聚合结果调整/SKILL.md",
    `---\nname: 聚合结果调整\ndescription: 当前结果对话调整，未经确认不改写共享规则。\n---\n\n${RESEARCH_ADJUST_PROMPT}\n`
  );
  const manifest = JSON.stringify({
    implementation: {
      systemPrompt: IMAGE_PLANNING_PROMPT,
      userPromptTemplate: "{{context}}",
      modelPolicy: "gem-3.8-flash",
      supportsJsonMode: true,
      maxTokens: 24576,
    },
  });
  statements.push(
    `UPDATE emperor_skills SET manifest=${literal(manifest)},version=2 WHERE slug=${literal(IMAGE_PLANNING_SKILL)} AND workspaceId IS NULL AND isSystem=1 AND version=1;`
  );
  await writeFile(
    "drizzle/0325_research_workflow.sql",
    statements.join("\n") + "\n"
  );
  await writeFile(
    "skills/图片大纲规划/SKILL.md",
    `---\nname: 图片大纲规划\ndescription: 结合本品分析与策划对话规划画面大纲。\n---\n\n${IMAGE_PLANNING_PROMPT}\n`
  );
  console.log("已生成5个中文研究技能和图片大纲升级迁移");
} else if (process.argv.includes("--restore-config")) {
  const index = process.argv.indexOf("--restore-config"),
    workspaceId = Number(process.argv[index + 1]),
    userId = Number(process.argv[index + 2]);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  await restoreResearchConfiguration(
    workspaceId,
    userId,
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
    process.argv[index + 3] === "listing" ? "listing" : "images"
  );
  console.log("Original assistant configuration restored");
  await closeDbConnection();
} else if (process.argv.includes("--run")) {
  const index = process.argv.indexOf("--run"),
    workspace = Number(process.argv[index + 1]),
    user = Number(process.argv[index + 2]);
  if (
    !Number.isSafeInteger(workspace) ||
    workspace < 1 ||
    !Number.isSafeInteger(user) ||
    user < 1
  )
    throw new Error("请指定工作区和用户");
  console.log(JSON.stringify(await configureResearchWorkflow(workspace, user)));
  await closeDbConnection();
}
