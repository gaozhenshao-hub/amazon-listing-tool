import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { LISTING_OGILVY_ROLE_MARKER } from "../server/domains/ai_os/services/highQualitySkillGovernance";
import { buildSingleBulletSkillManifest, SINGLE_BULLET_PROMPT_VERSION, SINGLE_BULLET_SKILL_SLUGS } from "../server/domains/listing/services/listingSingleBulletPromptPolicy";
import { canonicalJson, parseManifest } from "./upgradeListingSingleBulletSkillsV6";

type Row = { slug: string; workspaceId: number | null; version: number; status: string; manifest: unknown;
  modelOverride: string | null; name: string; description: string | null };

export function buildSingleBulletV7Change(row: Row) {
  if (row.status !== "Released") throw new Error(`Skill ${row.slug} 尚未发布，停止变更`);
  if (!SINGLE_BULLET_SKILL_SLUGS.some((slug) => slug === row.slug)) throw new Error("非本轮单条Skill，拒绝升级");
  if (SINGLE_BULLET_PROMPT_VERSION !== 7) throw new Error("v7升级脚本与当前提示词版本不匹配");
  const current = parseManifest(row.manifest);
  const manifest = buildSingleBulletSkillManifest(row.slug as (typeof SINGLE_BULLET_SKILL_SLUGS)[number], current);
  const prompt = String(manifest.implementation?.systemPrompt || "");
  if (prompt.split(LISTING_OGILVY_ROLE_MARKER).length !== 2 || !prompt.includes("SINGLE_AMAZON_US_BULLET_V7")
      || !prompt.includes("FACT_SOURCE_AND_TEMPLATE_GUARD_V1")) throw new Error("奥美角色或事实保护任务合同不匹配");
  const meta = row.slug === "listing.bullet.step.generate"
    ? { name: "分步骤卖点精雕", description: "分步骤Listing工作流单条卖点权威Skill v7；空白/示例事实过滤、证据可追溯、待人工确认。" }
    : { name: "手动单条卖点试写", description: "皇帝Skill库手动试写；不驱动分步骤工作流。事实与模板示例分离v7，输出待人工确认。" };
  return { ...meta, manifest, changed: canonicalJson(current) !== canonicalJson(manifest) || row.name !== meta.name || row.description !== meta.description };
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!process.env.DATABASE_URL) throw new Error("数据库运行环境未配置");
  const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, multipleStatements: false });
  try {
    await connection.beginTransaction();
    try {
      const slugs = [...SINGLE_BULLET_SKILL_SLUGS];
      const [raw] = await connection.execute(
        `SELECT slug,workspaceId,version,status,manifest,modelOverride,name,description FROM emperor_skills WHERE slug IN (?,?) ${apply ? "FOR UPDATE" : ""}`,
        slugs,
      );
      const rows = raw as Row[];
      if (rows.length !== slugs.length || slugs.some((slug) => !rows.some((row) => row.slug === slug))) {
        throw new Error("两项单条卖点Skill不完整，停止事务");
      }
      const changes = rows.map((row) => ({ row, next: buildSingleBulletV7Change(row) }));
      if (changes[0].next.manifest.implementation?.systemPrompt !== changes[1].next.manifest.implementation?.systemPrompt) {
        throw new Error("两个单条Skill提示词不一致");
      }
      const summary = { schema: "listing.single_bullet_v7/1", mode: apply ? "apply" : "preview",
        found: rows.length, changed: changes.filter(({ next }) => next.changed).map(({ row }) => row.slug), snapshotsCreated: 0 };
      if (apply) {
        for (const { row, next } of changes.filter(({ next }) => next.changed)) {
          const current = parseManifest(row.manifest);
          const snapshotHash = createHash("sha256").update(canonicalJson({ manifest: current, modelOverride: row.modelOverride, status: row.status })).digest("hex");
          const [snapshot] = await connection.execute(
            `INSERT IGNORE INTO emperor_skill_version_snapshots (snapshotId,workspaceId,skillSlug,skillVersion,snapshotHash,source,status,manifest,modelOverride,createdBy)
             VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
            [`skill_snapshot_${randomUUID().replace(/-/g, "").slice(0, 24)}`, row.workspaceId, row.slug, String(row.version), snapshotHash,
              "listing_bullet_v7", row.status, JSON.stringify(current), row.modelOverride],
          );
          if ((snapshot as { affectedRows: number }).affectedRows === 1) summary.snapshotsCreated++;
          else {
            const [existing] = await connection.execute(
              `SELECT snapshotId FROM emperor_skill_version_snapshots WHERE skillSlug=? AND skillVersion=? AND snapshotHash=? LIMIT 1`,
              [row.slug, String(row.version), snapshotHash],
            );
            if (!(existing as Array<{ snapshotId: string }>).length) throw new Error(`Skill ${row.slug} 未完成版本快照`);
          }
          const [result] = await connection.execute(
            `UPDATE emperor_skills SET name=?,description=?,manifest=?,version=version+1,updatedAt=NOW()
             WHERE slug=? AND version=? AND status='Released'`,
            [next.name, next.description, JSON.stringify(next.manifest), row.slug, row.version],
          );
          if ((result as { affectedRows: number }).affectedRows !== 1) throw new Error(`Skill ${row.slug} 版本竞争，停止发布`);
        }
      }
      if (apply) await connection.commit(); else await connection.rollback();
      console.log(JSON.stringify(summary));
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    await connection.end();
  }
}

if (process.argv[1]?.endsWith("upgradeListingSingleBulletSkillsV7.ts")) {
  void main().catch((error) => {
    console.error(JSON.stringify({ schema: "listing.single_bullet_v7/1", status: "failed", reason: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  });
}
