import { mkdir, writeFile, readFile } from "node:fs/promises";
import {
  IMAGE_DOCUMENT_SKILL,
  IMAGE_DOCUMENT_PROMPT,
} from "../server/domains/listing/imageDocumentPrompt";
import { assistantConfigurationService } from "../server/domains/ai_os/services/assistantConfigurations";
import { closeDbConnection } from "../server/repositories/dbClient";
export async function configureImageDocument(
  workspaceId: number,
  userId: number
) {
  const [current, options] = await Promise.all([
    assistantConfigurationService.get(workspaceId, "images"),
    assistantConfigurationService.options(workspaceId),
  ]);
  if (current.status !== "configured" || !current.record.config.enabled)
    throw new Error("图片策划助手尚未启用，保留现有配置");
  const descriptor = options.skills.find(s => s.slug === IMAGE_DOCUMENT_SKILL);
  if (!descriptor) throw new Error("套图文档策划技能尚未发布");
  const binding = {
    slug: IMAGE_DOCUMENT_SKILL,
    enabled: true,
    version: descriptor.version,
    manifestSha256: descriptor.manifestSha256,
    trigger: "运营点击制作套图文档、调整画面和生成分步提示词",
    instructions:
      "只扩展已确认大纲，使用卖点、评论、买家问题和运营指定参考；人工修改优先；四步提示词依次衔接，先预览再确认。",
  };
  const config = {
    ...current.record.config,
    skills: [
      ...current.record.config.skills.filter(
        s => s.slug !== IMAGE_DOCUMENT_SKILL
      ),
      binding,
    ],
  };
  if (JSON.stringify(config) === JSON.stringify(current.record.config))
    return { revision: current.record.revision, changed: false };
  const result = await assistantConfigurationService.save(workspaceId, userId, {
    agentKey: "images",
    expectedRevision: current.record.revision,
    config,
  });
  return { revision: result.revision, changed: true };
}
if (process.argv.includes("--upgrade")) {
  const quote = (value: string) =>
    "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
  const manifest = JSON.stringify({
    implementation: {
      systemPrompt: IMAGE_DOCUMENT_PROMPT,
      userPromptTemplate: "{{context}}",
      modelPolicy: "gem-3.8-flash",
      supportsJsonMode: true,
      maxTokens: 24576,
    },
  });
  const ddl = `-- DEDICATED RELEASE ONLY. Upgrade only the new document Skill, preserving project and library results.\nUPDATE emperor_skills SET version=2,manifest=${quote(manifest)} WHERE slug='${IMAGE_DOCUMENT_SKILL}' AND workspaceId IS NULL AND isSystem=1 AND version=1;\n`;
  let previous: string | null = null;
  try {
    previous = await readFile(
      "drizzle/0329_image_document_fact_priority.sql",
      "utf8"
    );
  } catch {}
  if (previous !== null && previous !== ddl)
    throw new Error("0329已存在，禁止改写历史迁移；请新增下一份迁移");
  await writeFile("drizzle/0329_image_document_fact_priority.sql", ddl);
  await mkdir("skills/套图文档策划", { recursive: true });
  await writeFile(
    "skills/套图文档策划/SKILL.md",
    `---\nname: 套图文档策划\ndescription: 根据已确认本品事实和大纲制作画面拆解及四步提示词。\n---\n\n${IMAGE_DOCUMENT_PROMPT}\n`
  );
  console.log("已生成套图文档事实优先级的独立升级迁移");
} else if (process.argv.includes("--migration")) {
  let exists = false;
  try {
    await readFile("drizzle/0328_image_document_and_settings.sql");
    exists = true;
  } catch {}
  if (exists)
    throw new Error("0328已存在，禁止改写历史迁移；请使用新的升级迁移");
  const quote = (value: string) =>
    "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
  const manifest = JSON.stringify({
    implementation: {
      systemPrompt: IMAGE_DOCUMENT_PROMPT,
      userPromptTemplate: "{{context}}",
      modelPolicy: "gem-3.8-flash",
      supportsJsonMode: true,
      maxTokens: 24576,
    },
  });
  const ddl = `-- DEDICATED RELEASE ONLY. Additive settings and image-document release; never rewrite project facts or library assets.
CREATE TABLE IF NOT EXISTS ops_saihu_api_configs (
 workspace_id INT NOT NULL PRIMARY KEY,app_id VARCHAR(200) NOT NULL,api_base_url VARCHAR(500) NOT NULL DEFAULT '',secret_cipher TEXT NOT NULL,updated_by INT NOT NULL,updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,connection_state JSON NULL,token_cipher TEXT NULL,token_expires_at BIGINT NULL
);
CREATE TABLE IF NOT EXISTS system_api_connection_checks (
 workspace_id INT NOT NULL,connection_code VARCHAR(64) NOT NULL,connection_version CHAR(64) NOT NULL,status VARCHAR(24) NOT NULL,checked_at BIGINT NOT NULL,shop_count INT NULL,message VARCHAR(500) NOT NULL,PRIMARY KEY(workspace_id,connection_code)
);
CREATE TABLE IF NOT EXISTS listing_image_documents (
 project_id INT NOT NULL PRIMARY KEY,workspace_id INT NOT NULL,data JSON NOT NULL,revision INT NOT NULL DEFAULT 1,locked BOOLEAN NOT NULL DEFAULT FALSE,job_run_id VARCHAR(128) NULL,updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,KEY idx_image_document_workspace(workspace_id,project_id)
);
CREATE TABLE IF NOT EXISTS listing_image_document_candidates (
 id CHAR(36) NOT NULL PRIMARY KEY,project_id INT NOT NULL,workspace_id INT NOT NULL,user_id INT NOT NULL,base_revision INT NOT NULL,source_hash CHAR(64) NOT NULL,configuration_revision INT NOT NULL,mode VARCHAR(20) NOT NULL,image_id CHAR(36) NULL,stage VARCHAR(24) NULL,job_run_id VARCHAR(128) NOT NULL,original_data JSON NOT NULL,input_data JSON NOT NULL,data JSON NOT NULL,history JSON NOT NULL,reply TEXT NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'open',improvement_id CHAR(36) NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,KEY idx_document_candidate(workspace_id,project_id,user_id,created_at)
);
INSERT INTO emperor_skills(slug,name,description,category,status,scope,version,isSystem,manifest,when_to_use)
SELECT '${IMAGE_DOCUMENT_SKILL}','套图文档策划','将图片大纲扩展成构图参考、画面拆解与分步提示词','运营','Released','global',1,1,${quote(manifest)},'用户主动制作或调整套图文档时使用'
WHERE NOT EXISTS(SELECT 1 FROM emperor_skills WHERE slug='${IMAGE_DOCUMENT_SKILL}' AND workspaceId IS NULL);
`;
  await writeFile("drizzle/0328_image_document_and_settings.sql", ddl);
  await mkdir("skills/套图文档策划", { recursive: true });
  await writeFile(
    "skills/套图文档策划/SKILL.md",
    `---\nname: 套图文档策划\ndescription: 根据已确认图片大纲和运营参考制作画面拆解及四步提示词。\n---\n\n${IMAGE_DOCUMENT_PROMPT}\n`
  );
  console.log("已生成套图文档策划技能与独立迁移");
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
  try {
    console.log(
      JSON.stringify(await configureImageDocument(workspaceId, userId))
    );
  } finally {
    await closeDbConnection();
  }
}
