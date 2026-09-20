import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  HIGH_QUALITY_GOVERNANCE_MARKER,
  HIGH_QUALITY_SKILL_SLUGS,
  applyListingOgilvyRole,
} from "../server/domains/ai_os/services/highQualitySkillGovernance";
import { getListingBulletSkillRepairV3 } from "../server/domains/listing/services/listingBulletSkillPolicy";

type SkillRow = {
  workspaceId: number | null;
  slug: string;
  version: number;
  status: string;
  manifest: unknown;
  modelOverride: string | null;
};

type SnapshotRow = {
  skillSlug: string;
  manifest: unknown;
  source: string;
  createdAt: string;
};

type Summary = {
  schema: "emperor.high_quality_skill_prompt_restoration/1.0";
  mode: "preview" | "apply";
  expectedSkills: number;
  foundSkills: number;
  restoredHistoricalPrompts: number;
  preservedBulletV3: number;
  listingOgilvyRoleApplied: number;
  snapshotsCreated: number;
};

function parseManifest(value: unknown): any {
  if (typeof value === "string") return JSON.parse(value);
  return value || {};
}

function prompt(manifest: unknown): string {
  return String(parseManifest(manifest)?.implementation?.systemPrompt || "").trim();
}

function hashCurrent(row: SkillRow): string {
  return createHash("sha256")
    .update(JSON.stringify({ manifest: row.manifest, modelOverride: row.modelOverride ?? null, status: row.status }))
    .digest("hex");
}

function ensureExpectedRows(rows: SkillRow[]) {
  const expected = [...HIGH_QUALITY_SKILL_SLUGS].sort();
  const found = rows.map((row) => row.slug).sort();
  const missing = expected.filter((slug) => !found.includes(slug));
  if (missing.length || found.length !== expected.length) {
    throw new Error(`High-quality Skill scope mismatch: missing=${missing.join(",") || "none"}; found=${found.length}; expected=${expected.length}`);
  }
}

function isPreGovernancePrompt(value: unknown): boolean {
  return !prompt(value).includes(HIGH_QUALITY_GOVERNANCE_MARKER);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is unavailable");
  const connection = await mysql.createConnection({ uri: databaseUrl, multipleStatements: false });
  try {
    const slugs = [...HIGH_QUALITY_SKILL_SLUGS];
    const placeholders = slugs.map(() => "?").join(",");
    const [skillsRaw] = await connection.execute(
      `SELECT workspaceId,slug,version,status,manifest,modelOverride FROM emperor_skills WHERE status='Released' AND slug IN (${placeholders}) ORDER BY slug`,
      slugs,
    );
    const skills = skillsRaw as SkillRow[];
    ensureExpectedRows(skills);
    const [snapshotsRaw] = await connection.execute(
      `SELECT skillSlug,manifest,source,createdAt FROM emperor_skill_version_snapshots WHERE skillSlug IN (${placeholders}) ORDER BY createdAt DESC`,
      slugs,
    );
    const snapshotsBySlug = new Map<string, SnapshotRow[]>();
    for (const snapshot of snapshotsRaw as SnapshotRow[]) {
      const list = snapshotsBySlug.get(snapshot.skillSlug) || [];
      list.push(snapshot);
      snapshotsBySlug.set(snapshot.skillSlug, list);
    }

    const changes = skills.map((row) => {
      const currentManifest = parseManifest(row.manifest);
      const baseline = (snapshotsBySlug.get(row.slug) || []).find((snapshot) => isPreGovernancePrompt(snapshot.manifest));
      let restoredPrompt: string;
      let kind: "historical" | "listing_bullet_v3";
      if (row.slug === "listing.bullets.generate") {
        restoredPrompt = getListingBulletSkillRepairV3().systemPrompt;
        kind = "listing_bullet_v3";
      } else {
        if (!baseline) throw new Error(`Missing pre-governance prompt snapshot for ${row.slug}`);
        restoredPrompt = prompt(baseline.manifest);
        kind = "historical";
      }
      const finalPrompt = applyListingOgilvyRole(row.slug, restoredPrompt);
      const restoredManifest = {
        ...currentManifest,
        implementation: {
          ...(currentManifest.implementation || {}),
          systemPrompt: finalPrompt,
        },
      };
      return { row, kind, finalPrompt, restoredManifest };
    });

    const summary: Summary = {
      schema: "emperor.high_quality_skill_prompt_restoration/1.0",
      mode: apply ? "apply" : "preview",
      expectedSkills: HIGH_QUALITY_SKILL_SLUGS.size,
      foundSkills: skills.length,
      restoredHistoricalPrompts: changes.filter((change) => change.kind === "historical").length,
      preservedBulletV3: changes.filter((change) => change.kind === "listing_bullet_v3").length,
      listingOgilvyRoleApplied: changes.filter((change) => change.row.slug.startsWith("listing.")).length,
      snapshotsCreated: 0,
    };
    if (!apply) {
      console.log(JSON.stringify(summary));
      return;
    }

    await connection.beginTransaction();
    try {
      for (const change of changes) {
        const snapshotId = `skill_snapshot_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
        const [snapshotResult] = await connection.execute(
          `INSERT IGNORE INTO emperor_skill_version_snapshots (snapshotId,workspaceId,skillSlug,skillVersion,snapshotHash,source,status,manifest,modelOverride,createdBy)
           VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
          [snapshotId, change.row.workspaceId, change.row.slug, String(change.row.version ?? 1), hashCurrent(change.row), "prompt_restoration", change.row.status, JSON.stringify(parseManifest(change.row.manifest)), change.row.modelOverride ?? null],
        );
        if ((snapshotResult as { affectedRows?: number }).affectedRows === 1) summary.snapshotsCreated += 1;
        const [updateResult] = await connection.execute(
          `UPDATE emperor_skills SET manifest=?, version=?, updatedAt=NOW() WHERE slug=? AND status='Released' AND version=?`,
          [JSON.stringify(change.restoredManifest), Math.max(1, Number(change.row.version || 1)) + 1, change.row.slug, change.row.version],
        );
        if ((updateResult as { affectedRows?: number }).affectedRows !== 1) {
          throw new Error(`Concurrent or missing Skill update blocked for ${change.row.slug}`);
        }
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    console.log(JSON.stringify(summary));
  } finally {
    await connection.end();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ schema: "emperor.high_quality_skill_prompt_restoration/1.0", status: "failed", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
