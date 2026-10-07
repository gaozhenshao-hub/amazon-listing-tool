import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { applyListingOgilvyRole, LISTING_OGILVY_ROLE_MARKER } from "../server/domains/ai_os/services/highQualitySkillGovernance";
import {
  buildSingleBulletSkillManifest,
  SINGLE_BULLET_PROMPT_VERSION,
  SINGLE_BULLET_SKILL_SLUGS,
} from "../server/domains/listing/services/listingSingleBulletPromptPolicy";
import { buildListingChecklistSkillManifest, LISTING_CHECKLIST_SKILL_POLICIES } from "../server/domains/listing/services/listingChecklistSkillPolicy";

const slugs = [...SINGLE_BULLET_SKILL_SLUGS, "listing.checklist.bullets"] as const;
type Row = { slug: string; workspaceId: number | null; version: number; status: string; manifest: unknown; modelOverride: string | null; name: string; description: string | null };

export function parseManifest(value: unknown) {
  return typeof value === "string" ? JSON.parse(value) : (value ?? {});
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) =>
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)))
      : nested);
}

export function buildSingleBulletV6Change(row: Row) {
  if (row.status !== "Released") throw new Error(`Skill ${row.slug} 尚未发布，停止变更`);
  const current = parseManifest(row.manifest);
  const policy = LISTING_CHECKLIST_SKILL_POLICIES.find((item) => item.slug === "listing.checklist.bullets");
  const manifest = row.slug === "listing.checklist.bullets"
    ? buildListingChecklistSkillManifest(policy!, current)
    : buildSingleBulletSkillManifest(row.slug as (typeof SINGLE_BULLET_SKILL_SLUGS)[number], current);
  if (row.slug === "listing.checklist.bullets") {
    manifest.implementation = { ...manifest.implementation, promptVersion: SINGLE_BULLET_PROMPT_VERSION };
  }
  const prompt = String(manifest.implementation?.systemPrompt || "");
  if (prompt.split(LISTING_OGILVY_ROLE_MARKER).length !== 2
      || !prompt.includes(row.slug === "listing.checklist.bullets" ? "NATURAL_US_BULLET_CHECKLIST_V6" : `SINGLE_AMAZON_US_BULLET_V${SINGLE_BULLET_PROMPT_VERSION}`)) {
    throw new Error(`Skill ${row.slug} 奥美角色/任务层合同不匹配`);
  }
  // Both manual and workflow slugs share the exact same prompt; only the
  // consumer role, label and version differ. No automatic model change.
  const metadata = row.slug === "listing.bullet.single"
    ? { name: "手动单条卖点试写", description: "仅供皇帝Skill库手动试写；不驱动分步骤卖点精雕。奥美式自然美式英语v6，输出待人工确认。" }
    : row.slug === "listing.bullet.step.generate"
      ? { name: "分步骤卖点精雕", description: "分步骤Listing工作流单条卖点权威Skill v6；奥美式单一购买理由，事实可追溯、待人工确认。" }
      : { name: row.name, description: row.description };
  return { manifest, ...metadata, changed: canonicalJson(current) !== canonicalJson(manifest) || row.name !== metadata.name || row.description !== metadata.description };
}

async function main() {
  if (SINGLE_BULLET_PROMPT_VERSION !== 6) throw new Error("历史v6升级脚本已封存；请使用对应当前版本的专用升级脚本");
  const apply = process.argv.includes("--apply");
  if (!process.env.DATABASE_URL) throw new Error("数据库运行环境未配置");
  const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, multipleStatements: false });
  try {
    await connection.beginTransaction();
    try {
      const [raw] = await connection.execute(
        `SELECT slug,workspaceId,version,status,manifest,modelOverride,name,description FROM emperor_skills WHERE slug IN (?,?,?) ${apply ? "FOR UPDATE" : ""}`,
        slugs,
      );
      const rows = raw as Row[];
      if (rows.length !== slugs.length || slugs.some((slug) => !rows.some((row) => row.slug === slug))) {
        throw new Error("三项卖点Skill不完整，停止事务");
      }
      const changes = rows.map((row) => ({ row, next: buildSingleBulletV6Change(row) }));
      const prompts = changes.filter((item) => item.row.slug !== "listing.checklist.bullets")
        .map((item) => item.next.manifest.implementation?.systemPrompt);
      if (prompts[0] !== prompts[1]) throw new Error("两个单条卖点入口提示词不一致");
      const summary = { schema: "listing.single_bullet_v6/1", mode: apply ? "apply" : "preview",
        found: rows.length, changed: changes.filter(({ next }) => next.changed).map(({ row }) => row.slug), snapshotsCreated: 0 };
      if (apply) {
        for (const { row, next } of changes.filter(({ next }) => next.changed)) {
          const current = parseManifest(row.manifest);
          const snapshotHash = createHash("sha256").update(canonicalJson({ manifest: current, modelOverride: row.modelOverride, status: row.status })).digest("hex");
          const [snapshot] = await connection.execute(
            `INSERT IGNORE INTO emperor_skill_version_snapshots (snapshotId,workspaceId,skillSlug,skillVersion,snapshotHash,source,status,manifest,modelOverride,createdBy)
             VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
            [`skill_snapshot_${randomUUID().replace(/-/g, "").slice(0, 24)}`, row.workspaceId, row.slug, String(row.version), snapshotHash,
              "listing_bullet_v6", row.status, JSON.stringify(current), row.modelOverride],
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

if (process.argv[1]?.endsWith("upgradeListingSingleBulletSkillsV6.ts")) {
  void main().catch((error) => {
    console.error(JSON.stringify({ schema: "listing.single_bullet_v6/1", status: "failed", reason: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  });
}
