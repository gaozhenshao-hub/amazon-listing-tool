import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { LISTING_OGILVY_ROLE_MARKER } from "../server/domains/ai_os/services/highQualitySkillGovernance";
import {
  buildSingleBulletV8SkillManifest,
  SINGLE_BULLET_SKILL_SLUGS,
  SINGLE_BULLET_V8_PROMPT_VERSION,
} from "../server/domains/listing/services/listingSingleBulletPromptPolicy";

const slugs = [...SINGLE_BULLET_SKILL_SLUGS] as const;

type Row = {
  slug: string;
  workspaceId: number | null;
  version: number;
  status: string;
  manifest: unknown;
  modelOverride: string | null;
  name: string;
  description: string | null;
};

/** Kept local so this v8 migration has no behavioral dependency on v6/v7 scripts. */
export function parseV8Manifest(value: unknown) {
  return typeof value === "string" ? JSON.parse(value) : (value ?? {});
}

/** Kept local so MySQL's JSON object-key ordering cannot create false updates. */
export function canonicalV8Json(value: unknown): string {
  return JSON.stringify(value, (_key, nested) =>
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)))
      : nested);
}

/**
 * v8 currently has a different candidate/needs_facts envelope from the live
 * v7 parser. No environment may publish it until runner, manual trial,
 * candidate persistence and review are upgraded and regression-tested.
 */
export function assertV8ProductionApplyAuthorized(input: {
  apply: boolean;
  runtimeEnvironment?: string;
  productionApproval?: string;
}) {
  if (!input.apply) return;
  throw new Error("v8 Skill 的运行时解析/候选账本尚未适配新信封；所有环境暂禁止 --apply，只可离线预览");
}

export function buildSingleBulletV8Change(row: Row) {
  if (row.status !== "Released") throw new Error(`Skill ${row.slug} 尚未发布，停止变更`);
  if (!SINGLE_BULLET_SKILL_SLUGS.some((slug) => slug === row.slug)) throw new Error("非本轮单条Skill，拒绝升级");
  const current = parseV8Manifest(row.manifest);
  const manifest = buildSingleBulletV8SkillManifest(row.slug as (typeof SINGLE_BULLET_SKILL_SLUGS)[number], current);
  const prompt = String(manifest.implementation?.systemPrompt || "");
  const outputSchema = manifest.contract?.outputSchema as Record<string, unknown> | undefined;
  const schemaProperties = outputSchema?.properties as Record<string, unknown> | undefined;
  const candidate = schemaProperties?.candidate as Record<string, unknown> | undefined;
  if (prompt.split(LISTING_OGILVY_ROLE_MARKER).length !== 2
      || !prompt.includes("SINGLE_AMAZON_US_BULLET_V8")
      || !prompt.includes("selectedCore {id,revision,singleBuyerReason,confirmedFactRefs[]}")
      || !prompt.includes("confirmedFacts [{id,claim,sourceRef,verificationRevision}]")
      || !prompt.includes("previousConfirmedBullets")
      || !prompt.includes("evidenceFactIds")) {
    throw new Error("v8奥美角色、确认事实或事实ID任务合同不匹配");
  }
  if (outputSchema?.type !== "object" || !Array.isArray(outputSchema.required)
      || !outputSchema.required.includes("status") || !outputSchema.required.includes("candidate")
      || !outputSchema.required.includes("missingEvidence")
      || !Array.isArray(candidate?.type) || !candidate.type.includes("object") || !candidate.type.includes("null")) {
    throw new Error("v8固定候选JSON信封合同不匹配");
  }
  const meta = row.slug === "listing.bullet.step.generate"
    ? { name: "分步骤卖点精雕", description: "分步骤Listing工作流单条卖点权威Skill v8候选准备；确认事实ID可追溯、缺证据显式返回、待人工确认。" }
    : { name: "手动单条卖点试写", description: "皇帝Skill库手动试写v8候选准备；不驱动分步骤工作流，确认事实ID可追溯、待人工确认。" };
  return {
    ...meta,
    manifest,
    changed: canonicalV8Json(current) !== canonicalV8Json(manifest)
      || row.name !== meta.name || row.description !== meta.description,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  assertV8ProductionApplyAuthorized({
    apply,
    runtimeEnvironment: process.env.NODE_ENV || process.env.APP_ENV,
    productionApproval: process.env.LISTING_SINGLE_BULLET_V8_PRODUCTION_APPLY_APPROVED,
  });
  if (!process.env.DATABASE_URL) throw new Error("数据库运行环境未配置");

  const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, multipleStatements: false });
  try {
    await connection.beginTransaction();
    try {
      const [raw] = await connection.execute(
        `SELECT slug,workspaceId,version,status,manifest,modelOverride,name,description
         FROM emperor_skills WHERE slug IN (?,?) ${apply ? "FOR UPDATE" : ""}`,
        slugs,
      );
      const rows = raw as Row[];
      if (rows.length !== slugs.length || slugs.some((slug) => !rows.some((row) => row.slug === slug))) {
        throw new Error("两项单条卖点Skill不完整，停止事务");
      }
      const changes = rows.map((row) => ({ row, next: buildSingleBulletV8Change(row) }));
      if (changes[0].next.manifest.implementation?.systemPrompt !== changes[1].next.manifest.implementation?.systemPrompt) {
        throw new Error("两个单条Skill提示词不一致");
      }
      const summary = {
        schema: "listing.single_bullet_v8/1",
        mode: apply ? "apply" : "preview",
        found: rows.length,
        changed: changes.filter(({ next }) => next.changed).map(({ row }) => row.slug),
        snapshotsCreated: 0,
      };

      if (apply) {
        for (const { row, next } of changes.filter(({ next }) => next.changed)) {
          const current = parseV8Manifest(row.manifest);
          const snapshotHash = createHash("sha256")
            .update(canonicalV8Json({ manifest: current, modelOverride: row.modelOverride, status: row.status }))
            .digest("hex");
          const [snapshot] = await connection.execute(
            `INSERT IGNORE INTO emperor_skill_version_snapshots
             (snapshotId,workspaceId,skillSlug,skillVersion,snapshotHash,source,status,manifest,modelOverride,createdBy)
             VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
            [
              `skill_snapshot_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
              row.workspaceId,
              row.slug,
              String(row.version),
              snapshotHash,
              "listing_bullet_v8",
              row.status,
              JSON.stringify(current),
              row.modelOverride,
            ],
          );
          if ((snapshot as { affectedRows: number }).affectedRows === 1) summary.snapshotsCreated++;
          else {
            const [existing] = await connection.execute(
              `SELECT snapshotId FROM emperor_skill_version_snapshots
               WHERE skillSlug=? AND skillVersion=? AND snapshotHash=? LIMIT 1`,
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

if (process.argv[1]?.endsWith("upgradeListingSingleBulletSkillsV8.ts")) {
  void main().catch((error) => {
    console.error(JSON.stringify({
      schema: "listing.single_bullet_v8/1",
      status: "failed",
      reason: error instanceof Error ? error.message : "unknown",
    }));
    process.exitCode = 1;
  });
}
