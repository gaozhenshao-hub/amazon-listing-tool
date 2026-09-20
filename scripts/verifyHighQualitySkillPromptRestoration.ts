import mysql from "mysql2/promise";
import {
  HIGH_QUALITY_GOVERNANCE_MARKER,
  HIGH_QUALITY_SKILL_SLUGS,
  LISTING_OGILVY_ROLE_MARKER,
  applyListingOgilvyRole,
} from "../server/domains/ai_os/services/highQualitySkillGovernance";
import { getListingBulletSkillRepairV3 } from "../server/domains/listing/services/listingBulletSkillPolicy";

type SkillRow = { slug: string; manifest: unknown };
type SnapshotRow = { skillSlug: string; manifest: unknown; createdAt: string };

function parseManifest(value: unknown): any {
  if (typeof value === "string") return JSON.parse(value);
  return value || {};
}
function prompt(value: unknown): string {
  return String(parseManifest(value)?.implementation?.systemPrompt || "").trim();
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is unavailable");
  const connection = await mysql.createConnection({ uri: databaseUrl });
  try {
    const slugs = [...HIGH_QUALITY_SKILL_SLUGS];
    const expectedListingSkills = slugs.filter((slug) => slug.startsWith("listing.")).length;
    const placeholders = slugs.map(() => "?").join(",");
    const [skillsRaw] = await connection.execute(`SELECT slug,manifest FROM emperor_skills WHERE status='Released' AND slug IN (${placeholders}) ORDER BY slug`, slugs);
    const [snapshotsRaw] = await connection.execute(`SELECT skillSlug,manifest,createdAt FROM emperor_skill_version_snapshots WHERE skillSlug IN (${placeholders}) ORDER BY createdAt DESC`, slugs);
    const bySlug = new Map<string, SnapshotRow[]>();
    for (const snapshot of snapshotsRaw as SnapshotRow[]) {
      const list = bySlug.get(snapshot.skillSlug) || [];
      list.push(snapshot);
      bySlug.set(snapshot.skillSlug, list);
    }

    const invalid: string[] = [];
    let listingsWithOgilvyRole = 0;
    let historicalPromptMatches = 0;
    for (const skill of skillsRaw as SkillRow[]) {
      const manifest = parseManifest(skill.manifest);
      const currentPrompt = prompt(skill.manifest);
      const governanceOk = manifest?.contract?.humanReviewRequired === true
        && manifest?.contract?.automaticExecution === "prohibited"
        && manifest?.governance?.humanReviewRequired === true
        && manifest?.governance?.automaticExecution === "prohibited";
      if (currentPrompt.includes(HIGH_QUALITY_GOVERNANCE_MARKER) || !governanceOk) invalid.push(skill.slug);
      if (skill.slug.startsWith("listing.")) {
        if (!currentPrompt.includes(LISTING_OGILVY_ROLE_MARKER)) invalid.push(skill.slug);
        else listingsWithOgilvyRole += 1;
      }
      if (skill.slug === "listing.bullets.generate") {
        const expected = applyListingOgilvyRole(skill.slug, getListingBulletSkillRepairV3().systemPrompt);
        if (currentPrompt !== expected) invalid.push(skill.slug);
      } else {
        const baseline = (bySlug.get(skill.slug) || []).find((snapshot) => !prompt(snapshot.manifest).includes(HIGH_QUALITY_GOVERNANCE_MARKER));
        if (!baseline || currentPrompt !== applyListingOgilvyRole(skill.slug, prompt(baseline.manifest))) invalid.push(skill.slug);
        else historicalPromptMatches += 1;
      }
    }
    const result = {
      schema: "emperor.high_quality_skill_prompt_restoration_verification/1.0",
      expectedSkills: HIGH_QUALITY_SKILL_SLUGS.size,
      foundSkills: (skillsRaw as SkillRow[]).length,
      historicalPromptMatches,
      preservedBulletV3: 1,
      listingOgilvyRoleApplied: listingsWithOgilvyRole,
      invalidSkills: [...new Set(invalid)].length,
      noModelCall: true,
    };
    if (result.foundSkills !== HIGH_QUALITY_SKILL_SLUGS.size || result.historicalPromptMatches !== HIGH_QUALITY_SKILL_SLUGS.size - 1 || result.listingOgilvyRoleApplied !== expectedListingSkills || result.invalidSkills) {
      throw new Error(JSON.stringify(result));
    }
    console.log(JSON.stringify(result));
  } finally {
    await connection.end();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ schema: "emperor.high_quality_skill_prompt_restoration_verification/1.0", status: "failed", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
