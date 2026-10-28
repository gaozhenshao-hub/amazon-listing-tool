/** Administrator rollout of the three independent knowledge-tagging skills. */
import { and, eq, sql } from "drizzle-orm";
import { emperorSkills } from "../drizzle/schema";
import { requireDb, closeDbConnection } from "../server/repositories/dbClient";
import {
  assistantConfigurationService,
  skillManifestHash,
} from "../server/domains/ai_os/services/assistantConfigurations";
import { captureSkillVersionSnapshot } from "../server/domains/ai_os/services/skillQualityGates";
import { KNOWLEDGE_VIDEO_SKILL } from "../shared/videoLabels";
import { VIDEO_LABEL_PROMPT } from "../server/domains/knowledge/videoLabelPrompt";
import {
  KNOWLEDGE_SET_SKILL,
  SET_LABEL_PROMPT,
  IMAGE_LABEL_PROMPT,
} from "../server/domains/knowledge/taggingSkillPrompts";

const userId = Number(process.env.KNOWLEDGE_MAINTENANCE_ACTOR),
  workspaceId = Number(process.env.KNOWLEDGE_MAINTENANCE_WORKSPACE);
if (
  !Number.isSafeInteger(userId) ||
  userId < 1 ||
  !Number.isSafeInteger(workspaceId) ||
  workspaceId < 1
)
  throw Error("Explicit administrator scope required");
try {
  const db = await requireDb("configure three tagging skills");
  const [actors] = await db.execute(
    sql`SELECT role FROM users WHERE id=${userId} AND status='active'`
  );
  if (
    !(actors as unknown as Array<{ role: string }>).some(a =>
      ["admin", "super_admin"].includes(a.role)
    )
  )
    throw Error("Administrator required");
  const current = await assistantConfigurationService.get(
    workspaceId,
    "tagger"
  );
  if (current.status !== "configured" || !current.record.config.enabled)
    throw Error("Enabled tagger required");
  const model = current.record.config.modelSlug,
    options = await assistantConfigurationService.options(workspaceId);
  if (
    !options.models.some(
      m => m.slug === model && m.capabilityTags.includes("vision")
    )
  )
    throw Error("Vision model unavailable");
  const definitions = [
    {
      slug: KNOWLEDGE_SET_SKILL,
      name: "ASIN 集打标",
      prompt: SET_LABEL_PROMPT,
      trigger: "整套入库、总标签 AI 调整和整套重打",
      instructions:
        "综合全部图片，只判断类目、风格、主色、提亮色；排除白底主图偏差。",
    },
    {
      slug: "knowledge.images.tag",
      name: "图片打标",
      prompt: IMAGE_LABEL_PROMPT,
      trigger: "单图入库、图片重打和图片 AI 调整",
      instructions:
        "套图图片继承四项总标签；独立上传自行判断。三图文四图文对比共享，轮播逐张。",
    },
    {
      slug: KNOWLEDGE_VIDEO_SKILL,
      name: "视频打标与内容时间段",
      prompt: VIDEO_LABEL_PROMPT,
      trigger: "视频入库、视频重打和视频 AI 调整",
      instructions:
        "先判断故事叙事或讲解结构，再按五种类型和原有十个内容标签标出时间段。",
    },
  ];
  const bindings = [];
  for (const definition of definitions) {
    let [skill] = await db
      .select()
      .from(emperorSkills)
      .where(
        and(
          eq(emperorSkills.slug, definition.slug),
          eq(emperorSkills.workspaceId, workspaceId)
        )
      );
    const base = skill
      ? typeof skill.manifest === "string"
        ? JSON.parse(skill.manifest)
        : skill.manifest
      : {};
    const manifest = {
      ...base,
      contract: {
        ...base?.contract,
        outputMode: "json",
        humanReviewRequired: false,
      },
      implementation: {
        ...base?.implementation,
        systemPrompt: definition.prompt,
        userPromptTemplate: "{{context}}",
        modelPolicy: model,
        maxTokens: definition.slug === KNOWLEDGE_VIDEO_SKILL ? 12000 : 8000,
        temperature: 0.1,
        supportsJsonMode: true,
      },
    };
    if (!skill) {
      await db
        .insert(emperorSkills)
        .values({
          workspaceId,
          slug: definition.slug,
          name: definition.name,
          description: definition.instructions,
          category: "知识库",
          scope: "shared",
          status: "Released",
          version: 1,
          isSystem: 0,
          modelOverride: model,
          manifest,
        });
      [skill] = await db
        .select()
        .from(emperorSkills)
        .where(
          and(
            eq(emperorSkills.slug, definition.slug),
            eq(emperorSkills.workspaceId, workspaceId)
          )
        );
      await captureSkillVersionSnapshot({
        skill,
        workspaceId,
        userId,
        source: "update",
      });
    } else if (
      skillManifestHash(skill.manifest) !== skillManifestHash(manifest)
    ) {
      if (skill.status !== "Released")
        throw Error(`Skill is not released: ${definition.slug}`);
      const [updated] = await db
        .update(emperorSkills)
        .set({
          name: definition.name,
          description: definition.instructions,
          manifest,
          version: skill.version + 1,
        })
        .where(
          and(
            eq(emperorSkills.id, skill.id),
            eq(emperorSkills.version, skill.version)
          )
        );
      if (updated.affectedRows !== 1) throw Error("Skill changed concurrently");
      [skill] = await db
        .select()
        .from(emperorSkills)
        .where(eq(emperorSkills.id, skill.id));
      await captureSkillVersionSnapshot({
        skill,
        workspaceId,
        userId,
        source: "update",
      });
    }
    bindings.push({
      slug: definition.slug,
      enabled: true,
      trigger: definition.trigger,
      instructions: definition.instructions,
      version: skill.version,
      manifestSha256: skillManifestHash(skill.manifest),
    });
  }
  const config = {
    ...current.record.config,
    instructions:
      "按任务分别调用 ASIN 集、图片、视频打标技能。三个技能各司其职，不能用单张图片覆盖整套标签。用户确认本次结果前不修改共享规则。",
    rules: current.record.config.rules.filter(
      rule => !/(主色.*白色|白色.*主色|持续讲解.*口播)/.test(rule)
    ),
    skills: [
      ...current.record.config.skills.filter(
        s => !definitions.some(d => d.slug === s.slug)
      ),
      ...bindings,
    ],
  };
  const unchanged =
    JSON.stringify(config) === JSON.stringify(current.record.config);
  const saved = unchanged
    ? current.record
    : await assistantConfigurationService.save(workspaceId, userId, {
        agentKey: "tagger",
        expectedRevision: current.record.revision,
        config,
      });
  console.log(
    JSON.stringify({
      status: unchanged ? "already-configured" : "configured",
      model,
      revision: saved.revision,
      skills: bindings.map(b => ({ slug: b.slug, version: b.version })),
    })
  );
} finally {
  await closeDbConnection();
}
