import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  HIGH_QUALITY_SKILL_SLUGS,
  buildGovernedHighQualityManifest,
  type GovernedSkillManifest,
} from "../server/domains/ai_os/services/highQualitySkillGovernance";

type SkillRow = {
  workspaceId: number | null;
  slug: string;
  version: number;
  status: string;
  manifest: unknown;
  modelOverride: string | null;
};

type MigrationSummary = {
  schema: "emperor.high_quality_skill_governance_migration/1.0";
  mode: "preview" | "apply";
  expectedSkills: number;
  foundSkills: number;
  changedSkills: number;
  unchangedSkills: number;
  canonicalRoutes: number;
  snapshotsCreated: number;
  versionRange: { min: number; max: number } | null;
};

function parseManifest(value: unknown): GovernedSkillManifest {
  if (!value) return {};
  if (typeof value === "string") return JSON.parse(value) as GovernedSkillManifest;
  return value as GovernedSkillManifest;
}

function snapshotHash(input: Pick<SkillRow, "manifest" | "modelOverride" | "status">) {
  return createHash("sha256")
    .update(JSON.stringify({ manifest: input.manifest, modelOverride: input.modelOverride ?? null, status: input.status }))
    .digest("hex");
}

function canonicalRoute(row: SkillRow, manifest: GovernedSkillManifest): string {
  const override = String(row.modelOverride || "").trim();
  if (override) return override;
  const legacy = manifest.implementation?.modelPolicy;
  if (typeof legacy === "string" && legacy.trim() && legacy !== "[object Object]") return legacy.trim();
  return "teamo-gpt-6-astra";
}

function ensureExpectedRows(rows: SkillRow[]) {
  const expected = [...HIGH_QUALITY_SKILL_SLUGS].sort();
  const found = rows.map((row) => row.slug).sort();
  const missing = expected.filter((slug) => !found.includes(slug));
  const unexpected = found.filter((slug) => !HIGH_QUALITY_SKILL_SLUGS.has(slug));
  if (missing.length || unexpected.length || found.length !== expected.length) {
    throw new Error(`High-quality Skill scope mismatch: missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}; found=${found.length}; expected=${expected.length}`);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is unavailable");

  const connection = await mysql.createConnection({ uri: databaseUrl, multipleStatements: false });
  try {
    const slugs = [...HIGH_QUALITY_SKILL_SLUGS];
    const placeholders = slugs.map(() => "?").join(",");
    const [rawRows] = await connection.execute(
      `SELECT workspaceId,slug,version,status,manifest,modelOverride FROM emperor_skills WHERE status='Released' AND slug IN (${placeholders}) ORDER BY slug`,
      slugs,
    );
    const rows = rawRows as SkillRow[];
    ensureExpectedRows(rows);

    const changes = rows.map((row) => {
      const currentManifest = parseManifest(row.manifest);
      const route = canonicalRoute(row, currentManifest);
      const repaired = buildGovernedHighQualityManifest({
        slug: row.slug,
        manifest: currentManifest,
        modelOverride: route,
      });
      return { row, route, repaired, currentManifest };
    });
    const changed = changes.filter((change) => change.repaired.changed || change.row.modelOverride !== change.route);

    const summary: MigrationSummary = {
      schema: "emperor.high_quality_skill_governance_migration/1.0",
      mode: apply ? "apply" : "preview",
      expectedSkills: HIGH_QUALITY_SKILL_SLUGS.size,
      foundSkills: rows.length,
      changedSkills: changed.length,
      unchangedSkills: changes.length - changed.length,
      canonicalRoutes: new Set(changes.map((change) => change.route)).size,
      snapshotsCreated: 0,
      versionRange: rows.length ? {
        min: Math.min(...rows.map((row) => Number(row.version || 1))),
        max: Math.max(...rows.map((row) => Number(row.version || 1))),
      } : null,
    };

    if (!apply) {
      console.log(JSON.stringify(summary));
      return;
    }

    await connection.beginTransaction();
    try {
      for (const change of changed) {
        const { row, route, repaired, currentManifest } = change;
        const hash = snapshotHash({ manifest: currentManifest, modelOverride: row.modelOverride, status: row.status });
        const snapshotId = `skill_snapshot_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
        const [snapshotResult] = await connection.execute(
          `INSERT IGNORE INTO emperor_skill_version_snapshots (snapshotId,workspaceId,skillSlug,skillVersion,snapshotHash,source,status,manifest,modelOverride,createdBy)
           VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
          [snapshotId, row.workspaceId, row.slug, String(row.version ?? 1), hash, "governance_migration", row.status, JSON.stringify(currentManifest), row.modelOverride ?? null],
        );
        if ((snapshotResult as { affectedRows?: number }).affectedRows === 1) summary.snapshotsCreated += 1;

        const nextVersion = Math.max(1, Number(row.version || 1)) + 1;
        const [updateResult] = await connection.execute(
          `UPDATE emperor_skills
           SET manifest=?, modelOverride=?, version=?, updatedAt=NOW()
           WHERE slug=? AND status='Released' AND version=?`,
          [JSON.stringify(repaired.manifest), route, nextVersion, row.slug, row.version],
        );
        if ((updateResult as { affectedRows?: number }).affectedRows !== 1) {
          throw new Error(`Concurrent or missing Skill update blocked for ${row.slug}`);
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
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ schema: "emperor.high_quality_skill_governance_migration/1.0", status: "failed", message }));
  process.exitCode = 1;
});
