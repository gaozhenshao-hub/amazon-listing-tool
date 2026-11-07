import { sql } from "drizzle-orm";
import { requireDb, closeDbConnection } from "../server/repositories/dbClient";
import {
  planningRows,
  planningJson,
} from "../server/domains/listing/imagePlanningStore";
import {
  IMAGE_PLANNING_SKILL,
  IMAGE_PLANNING_PROMPT,
} from "../server/domains/listing/imagePlanningPrompt";
import {
  IMAGE_DOCUMENT_SKILL,
  IMAGE_DOCUMENT_PROMPT,
} from "../server/domains/listing/imageDocumentPrompt";
import { imageDocumentConfiguration } from "../server/domains/listing/imageDocumentContext";
import { assistantConfigurationService } from "../server/domains/ai_os/services/assistantConfigurations";
import { designModel } from "../server/domains/design/provider";
try {
  const db = await requireDb("verify module workflow release"),
    [project] = await planningRows(
      db,
      sql`SELECT userId,workspaceId FROM projects WHERE id=1`
    );
  if (!project) throw new Error("项目不可读取");
  const scope = {
    projectId: 1,
    userId: Number(project.userId),
    workspaceId: Number(project.workspaceId),
  };
  const expected = [
    {
      slug: IMAGE_PLANNING_SKILL,
      prompt: IMAGE_PLANNING_PROMPT,
      version: 4,
      name: "图片大纲规划",
    },
    {
      slug: IMAGE_DOCUMENT_SKILL,
      prompt: IMAGE_DOCUMENT_PROMPT,
      version: 4,
      name: "套图文档策划",
    },
  ];
  const config = await assistantConfigurationService.get(
    scope.workspaceId,
    "images"
  );
  if (config.status !== "configured") throw new Error("图片策划助手不可用");
  for (const item of expected) {
    const [skill] = await planningRows(
      db,
      sql`SELECT name,version,status,manifest FROM emperor_skills WHERE slug=${item.slug} AND workspaceId IS NULL`
    );
    if (
      !skill ||
      skill.name !== item.name ||
      Number(skill.version) !== item.version ||
      skill.status !== "Released" ||
      planningJson(skill.manifest)?.implementation?.systemPrompt !==
        item.prompt ||
      !config.record.config.skills.some(
        s =>
          s.slug === item.slug &&
          Number(s.version) === item.version &&
          s.enabled
      )
    )
      throw new Error("中文技能或绑定未完成升级");
  }
  await imageDocumentConfiguration(scope);
  const model = await designModel(scope);
  for (const table of [
    "research_bookmarks",
    "research_extension_sessions",
    "listing_image_composition_sketches",
  ])
    await planningRows(
      db,
      sql`SELECT COUNT(*) n FROM ${sql.identifier(table)}`
    );
  console.log(
    JSON.stringify({
      status: "MODULE_WORKFLOW_VERIFIED",
      skills: expected.map(s => ({ name: s.name, version: s.version })),
      configurationRevision: config.record.revision,
      sketchModel: model.modelId,
      collectionTablesReady: true,
      projectFactsUntouched: true,
    })
  );
} finally {
  await closeDbConnection();
}
