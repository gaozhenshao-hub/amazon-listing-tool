import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { closeDbConnection, withDbTransaction } from "../server/repositories/dbClient";
import { configurationSession } from "../server/domains/ai_os/repositories/assistantConfigurations";
import {
  saveAssistantConfigurationInSession,
  skillManifestHash,
} from "../server/domains/ai_os/services/assistantConfigurations";
import { IMAGE_DOCUMENT_PROMPT, IMAGE_DOCUMENT_SKILL } from "../server/domains/listing/imageDocumentPrompt";
import { planningRows } from "../server/domains/listing/imagePlanningStore";
import { AssistantConfigurationSchema } from "../shared/assistantConfigurations";

const previousPromptHash = "029c1920b95133513894d4b00636b8790a02883d658120cb7fedc9f732511471";
const previousVersion = 6;
const version = 7;

async function release(workspaceId: number, userId: number) {
  return withDbTransaction("release image copy guidance and optional limits", async tx => {
    const session = configurationSession(tx, true);
    await session.assertSchema(workspaceId);
    const [head] = await session.current(workspaceId, "images");
    if (!head) throw new Error("图片策划助手未配置");
    const config = AssistantConfigurationSchema.parse(
      typeof head.config === "string" ? JSON.parse(head.config) : head.config
    );
    const binding = config.skills.find(item => item.slug === IMAGE_DOCUMENT_SKILL);
    const [skill] = await planningRows(tx, sql`
      SELECT version,manifest FROM emperor_skills
      WHERE slug=${IMAGE_DOCUMENT_SKILL} AND workspaceId IS NULL AND isSystem=1
        AND scope='global' AND status='Released'
      FOR UPDATE
    `);
    if (!skill || !binding?.enabled || !config.enabled ||
        binding.version !== Number(skill.version) ||
        binding.manifestSha256 !== skillManifestHash(skill.manifest))
      throw new Error("套图文档技能与当前助手绑定不一致");
    const manifest = typeof skill.manifest === "string" ? JSON.parse(skill.manifest) : skill.manifest;
    const prompt = manifest?.implementation?.systemPrompt;
    if (Number(skill.version) === version && prompt === IMAGE_DOCUMENT_PROMPT)
      return { version, revision: Number(head.revision), changed: false };
    if (Number(skill.version) !== previousVersion || typeof prompt !== "string" ||
        createHash("sha256").update(prompt.replace(/\r\n/g, "\n")).digest("hex") !== previousPromptHash)
      throw new Error("正式技能已修改，需核对差异后发布");
    const consumers = await planningRows(tx, sql`
      SELECT workspaceId,agentKey FROM emperor_assistant_configurations
      WHERE JSON_CONTAINS(config, JSON_OBJECT('slug', ${IMAGE_DOCUMENT_SKILL}), '$.skills')
      FOR UPDATE
    `);
    if (consumers.some(row => Number(row.workspaceId) !== workspaceId || row.agentKey !== "images"))
      throw new Error("其他助手也绑定此技能，需一起核对后发布");
    const active = await planningRows(tx, sql`
      SELECT id FROM ai_jobs
      WHERE kind='listing.images.document' AND status IN ('queued','running','submitting') LIMIT 1
    `);
    if (active.length) throw new Error("有套图文档任务正在执行，请完成后再发布");

    const updated = {
      ...manifest,
      implementation: { ...manifest.implementation, systemPrompt: IMAGE_DOCUMENT_PROMPT },
    };
    await tx.execute(sql`
      UPDATE emperor_skills SET version=${version},manifest=${JSON.stringify(updated)}
      WHERE slug=${IMAGE_DOCUMENT_SKILL} AND workspaceId IS NULL AND version=${previousVersion}
    `);
    const saved = await saveAssistantConfigurationInSession(session, workspaceId, userId, {
      agentKey: "images",
      mode: "configuration",
      expectedRevision: Number(head.revision),
      config: {
        ...config,
        skills: config.skills.map(item => item.slug === IMAGE_DOCUMENT_SKILL
          ? { ...item, version, manifestSha256: skillManifestHash(updated) }
          : item),
      },
    });
    return { version, revision: saved.revision, changed: true };
  }, { required: true });
}

const workspaceId = Number(process.env.IMAGE_PRODUCTION_WORKSPACE_ID);
const userId = Number(process.env.IMAGE_PRODUCTION_USER_ID);
if (!Number.isSafeInteger(workspaceId) || workspaceId < 1 ||
    !Number.isSafeInteger(userId) || userId < 1 ||
    process.env.ENABLE_ASSISTANT_CONFIGURATION_WRITES !== "true")
  throw new Error("请确认工作区、操作人和助手配置写入开关");
try {
  console.log("COPY_SKILL_RELEASED", JSON.stringify(await release(workspaceId, userId)));
} finally {
  await closeDbConnection();
}
