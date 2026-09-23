import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  LISTING_CHECKLIST_SKILL_POLICIES,
  buildListingChecklistSkillManifest,
} from "../server/domains/listing/services/listingChecklistSkillPolicy";
import { syncGovernedTeamorouterCatalog } from "../server/domains/ai_os/services/teamorouterCatalogRegistration";
import type { GovernedSkillManifest } from "../server/domains/ai_os/services/highQualitySkillGovernance";

type SkillRow = {
  workspaceId: number | null;
  slug: string;
  version: number;
  status: string;
  manifest: unknown;
  modelOverride: string | null;
};

type Summary = {
  schema: "listing.checklist_contract_repair/1.0";
  mode: "preview" | "apply";
  expectedChecklistSkills: number;
  foundChecklistSkills: number;
  checklistSkillsChanged: number;
  snapshotsCreated: number;
  catalogSync: { registeredModelCount: number; migratedLegacyEndpoint: boolean };
};

function parseManifest(value: unknown): GovernedSkillManifest {
  if (!value) return {};
  if (typeof value === "string") return JSON.parse(value) as GovernedSkillManifest;
  return value as GovernedSkillManifest;
}

function snapshotHash(row: SkillRow): string {
  return createHash("sha256")
    .update(JSON.stringify({ manifest: row.manifest, modelOverride: row.modelOverride ?? null, status: row.status }))
    .digest("hex");
}

function assertExpectedRows(rows: SkillRow[]) {
  const expected = LISTING_CHECKLIST_SKILL_POLICIES.map((policy) => policy.slug).sort();
  const found = rows.map((row) => row.slug).sort();
  const missing = expected.filter((slug) => !found.includes(slug));
  if (missing.length || found.length !== expected.length) {
    throw new Error(`Checklist Skill scope mismatch: missing=${missing.join(",") || "none"}; found=${found.length}; expected=${expected.length}`);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is unavailable");
  const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, multipleStatements: false });
  try {
    const slugs = LISTING_CHECKLIST_SKILL_POLICIES.map((policy) => policy.slug);
    const placeholders = slugs.map(() => "?").join(",");
    const [rawRows] = await connection.execute(
      `SELECT workspaceId,slug,version,status,manifest,modelOverride FROM emperor_skills WHERE status='Released' AND slug IN (${placeholders}) ORDER BY slug`,
      slugs,
    );
    const rows = rawRows as SkillRow[];
    assertExpectedRows(rows);
    const rowsBySlug = new Map(rows.map((row) => [row.slug, row]));
    const repairs = LISTING_CHECKLIST_SKILL_POLICIES.map((policy) => {
      const row = rowsBySlug.get(policy.slug)!;
      const manifest = parseManifest(row.manifest);
      const nextManifest = buildListingChecklistSkillManifest(policy, manifest);
      return { row, nextManifest, changed: JSON.stringify(nextManifest) !== JSON.stringify(manifest) };
    });
    const changed = repairs.filter((repair) => repair.changed);
    const summary: Summary = {
      schema: "listing.checklist_contract_repair/1.0",
      mode: apply ? "apply" : "preview",
      expectedChecklistSkills: LISTING_CHECKLIST_SKILL_POLICIES.length,
      foundChecklistSkills: rows.length,
      checklistSkillsChanged: changed.length,
      snapshotsCreated: 0,
      catalogSync: { registeredModelCount: 0, migratedLegacyEndpoint: false },
    };

    if (!apply) {
      console.log(JSON.stringify(summary));
      return;
    }

    await connection.beginTransaction();
    try {
      const catalog = await syncGovernedTeamorouterCatalog(async (statement, params) => {
        await connection.execute(statement, params);
      });
      summary.catalogSync = {
        registeredModelCount: catalog.registeredModelSlugs.length,
        migratedLegacyEndpoint: catalog.migratedLegacyEndpoint,
      };

      for (const repair of changed) {
        const { row, nextManifest } = repair;
        const [snapshotResult] = await connection.execute(
          `INSERT IGNORE INTO emperor_skill_version_snapshots
            (snapshotId,workspaceId,skillSlug,skillVersion,snapshotHash,source,status,manifest,modelOverride,createdBy)
           VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
          [
            `skill_snapshot_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
            row.workspaceId,
            row.slug,
            String(row.version || 1),
            snapshotHash(row),
            "listing_checklist_contract_repair",
            row.status,
            JSON.stringify(parseManifest(row.manifest)),
            row.modelOverride,
          ],
        );
        if ((snapshotResult as { affectedRows?: number }).affectedRows === 1) summary.snapshotsCreated += 1;

        const [updateResult] = await connection.execute(
          `UPDATE emperor_skills SET manifest=?, version=?, updatedAt=NOW()
           WHERE slug=? AND status='Released' AND version=?`,
          [JSON.stringify(nextManifest), Math.max(1, Number(row.version || 1)) + 1, row.slug, row.version],
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
  console.error(JSON.stringify({ schema: "listing.checklist_contract_repair/1.0", status: "failed", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
