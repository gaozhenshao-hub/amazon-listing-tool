import mysql from "mysql2/promise";
import {
  HIGH_QUALITY_GOVERNANCE_MARKER,
  HIGH_QUALITY_SKILL_SLUGS,
} from "../server/domains/ai_os/services/highQualitySkillGovernance";

type SkillRow = {
  slug: string;
  manifest: unknown;
  modelOverride: string | null;
};

function parseManifest(value: unknown): any {
  if (typeof value === "string") return JSON.parse(value);
  return value || {};
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is unavailable");
  const connection = await mysql.createConnection({ uri: databaseUrl });
  try {
    const slugs = [...HIGH_QUALITY_SKILL_SLUGS];
    const [raw] = await connection.execute(
      `SELECT slug,manifest,modelOverride FROM emperor_skills WHERE status='Released' AND slug IN (${slugs.map(() => "?").join(",")}) ORDER BY slug`,
      slugs,
    );
    const rows = raw as SkillRow[];
    const invalid = rows.filter((row) => {
      const manifest = parseManifest(row.manifest);
      const implementation = manifest.implementation || {};
      const contract = manifest.contract || {};
      const governance = manifest.governance || {};
      return !String(implementation.systemPrompt || "").includes(HIGH_QUALITY_GOVERNANCE_MARKER)
        || implementation.supportsJsonMode !== true
        || implementation.qualityModelPolicy !== "teamo-gpt-6-astra"
        || contract.humanReviewRequired !== true
        || contract.automaticExecution !== "prohibited"
        || governance.humanReviewRequired !== true
        || governance.automaticExecution !== "prohibited";
    });
    const bullet = rows.find((row) => row.slug === "listing.bullets.generate");
    const [governanceSnapshotRows] = await connection.execute(
      `SELECT COUNT(*) AS count FROM emperor_skill_version_snapshots WHERE source='governance_migration' AND skillSlug IN (${slugs.map(() => "?").join(",")})`,
      slugs,
    );
    const governanceSnapshotCount = Number((governanceSnapshotRows as Array<{ count: number }>)[0]?.count || 0);
    const [coverageRows] = await connection.execute(
      `SELECT COUNT(DISTINCT skillSlug) AS count FROM emperor_skill_version_snapshots WHERE skillSlug IN (${slugs.map(() => "?").join(",")})`,
      slugs,
    );
    const snapshotCoverageCount = Number((coverageRows as Array<{ count: number }>)[0]?.count || 0);
    const result = {
      schema: "emperor.high_quality_skill_governance_verification/1.0",
      expectedSkills: HIGH_QUALITY_SKILL_SLUGS.size,
      foundSkills: rows.length,
      invalidGovernanceSkills: invalid.length,
      governanceSnapshotCount,
      snapshotCoverageCount,
      bulletSkillRoute: bullet?.modelOverride || null,
      noModelCall: true,
    };
    if (rows.length !== HIGH_QUALITY_SKILL_SLUGS.size || invalid.length || governanceSnapshotCount < HIGH_QUALITY_SKILL_SLUGS.size - 1 || snapshotCoverageCount !== HIGH_QUALITY_SKILL_SLUGS.size || result.bulletSkillRoute !== "teamo-gpt-6-astra") {
      throw new Error(JSON.stringify(result));
    }
    console.log(JSON.stringify(result));
  } finally {
    await connection.end();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ schema: "emperor.high_quality_skill_governance_verification/1.0", status: "failed", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
