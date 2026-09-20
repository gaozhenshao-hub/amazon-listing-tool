import mysql from "mysql2/promise";
import { HIGH_QUALITY_SKILL_SLUGS } from "../server/domains/ai_os/services/highQualitySkillGovernance";

type SnapshotRow = {
  skillSlug: string;
  manifest: unknown;
  modelOverride: string | null;
  source: string;
  createdAt: string;
};

type Summary = {
  schema: "emperor.high_quality_skill_governance_rollback/1.0";
  mode: "preview" | "apply";
  expectedSkills: number;
  foundSnapshots: number;
  restoredSkills: number;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is unavailable");
  const connection = await mysql.createConnection({ uri: databaseUrl });
  try {
    const slugs = [...HIGH_QUALITY_SKILL_SLUGS];
    const placeholders = slugs.map(() => "?").join(",");
    const [raw] = await connection.execute(
      `SELECT s.skillSlug,s.manifest,s.modelOverride,s.source,s.createdAt
       FROM emperor_skill_version_snapshots s
       INNER JOIN (
         SELECT skillSlug,MAX(createdAt) AS latestCreatedAt
         FROM emperor_skill_version_snapshots
         WHERE source='governance_migration' AND skillSlug IN (${placeholders})
         GROUP BY skillSlug
       ) latest ON latest.skillSlug=s.skillSlug AND latest.latestCreatedAt=s.createdAt
       WHERE s.source='governance_migration'
       ORDER BY s.skillSlug`,
      slugs,
    );
    const snapshots = raw as SnapshotRow[];
    if (snapshots.length !== HIGH_QUALITY_SKILL_SLUGS.size) {
      throw new Error(`Rollback requires ${HIGH_QUALITY_SKILL_SLUGS.size} governance snapshots; found ${snapshots.length}`);
    }
    const summary: Summary = {
      schema: "emperor.high_quality_skill_governance_rollback/1.0",
      mode: apply ? "apply" : "preview",
      expectedSkills: HIGH_QUALITY_SKILL_SLUGS.size,
      foundSnapshots: snapshots.length,
      restoredSkills: 0,
    };
    if (!apply) {
      console.log(JSON.stringify(summary));
      return;
    }
    await connection.beginTransaction();
    try {
      for (const snapshot of snapshots) {
        const [result] = await connection.execute(
          `UPDATE emperor_skills
           SET manifest=?, modelOverride=?, version=version+1, updatedAt=NOW()
           WHERE slug=? AND status='Released'`,
          [JSON.stringify(snapshot.manifest), snapshot.modelOverride, snapshot.skillSlug],
        );
        if ((result as { affectedRows?: number }).affectedRows !== 1) {
          throw new Error(`Rollback blocked for ${snapshot.skillSlug}`);
        }
        summary.restoredSkills += 1;
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
  console.error(JSON.stringify({ schema: "emperor.high_quality_skill_governance_rollback/1.0", status: "failed", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
