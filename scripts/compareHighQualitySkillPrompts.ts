import mysql from "mysql2/promise";
import {
  HIGH_QUALITY_GOVERNANCE_MARKER,
  HIGH_QUALITY_SKILL_SLUGS,
} from "../server/domains/ai_os/services/highQualitySkillGovernance";

type SkillRow = { slug: string; manifest: unknown };
type SnapshotRow = { skillSlug: string; manifest: unknown; source: string; createdAt: string };

type Comparison = {
  slug: string;
  classification: "appended_governance_only" | "critical_prompt_replaced" | "policy_instruction_removed" | "other_change" | "baseline_unavailable";
  baselineSource: string | null;
  baselineLength: number | null;
  taskPromptLengthAfterRemovingGovernance: number;
  governanceLength: number;
};

function parseManifest(value: unknown): any {
  if (typeof value === "string") return JSON.parse(value);
  return value || {};
}

function promptFromManifest(value: unknown): string {
  return String(parseManifest(value)?.implementation?.systemPrompt || "").trim();
}

function removeGovernance(prompt: string): string {
  const marker = `\n\n## ${HIGH_QUALITY_GOVERNANCE_MARKER}`;
  const offset = prompt.indexOf(marker);
  return (offset >= 0 ? prompt.slice(0, offset) : prompt).trim();
}

function classifyChangedPrompt(slug: string): Comparison["classification"] {
  if (["listing.bullet.refine", "listing.checklist.bullets", "listing.translate.chinese", "ad.chatbot"].includes(slug)) {
    return "critical_prompt_replaced";
  }
  if (["listing.title.generate", "dev.analysis.product"].includes(slug)) {
    return "policy_instruction_removed";
  }
  return "other_change";
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is unavailable");
  const connection = await mysql.createConnection({ uri: databaseUrl });
  try {
    const slugs = [...HIGH_QUALITY_SKILL_SLUGS];
    const placeholders = slugs.map(() => "?").join(",");
    const [skillRaw] = await connection.execute(
      `SELECT slug,manifest FROM emperor_skills WHERE status='Released' AND slug IN (${placeholders}) ORDER BY slug`,
      slugs,
    );
    const [snapshotRaw] = await connection.execute(
      `SELECT skillSlug,manifest,source,createdAt FROM emperor_skill_version_snapshots WHERE skillSlug IN (${placeholders}) ORDER BY createdAt DESC`,
      slugs,
    );
    const snapshotsBySlug = new Map<string, SnapshotRow[]>();
    for (const snapshot of snapshotRaw as SnapshotRow[]) {
      const existing = snapshotsBySlug.get(snapshot.skillSlug) || [];
      existing.push(snapshot);
      snapshotsBySlug.set(snapshot.skillSlug, existing);
    }

    const comparisons: Comparison[] = (skillRaw as SkillRow[]).map((skill) => {
      const currentPrompt = promptFromManifest(skill.manifest);
      const originalPrompt = removeGovernance(currentPrompt);
      const governanceLength = Math.max(0, currentPrompt.length - originalPrompt.length);
      const baseline = (snapshotsBySlug.get(skill.slug) || []).find((snapshot) => !promptFromManifest(snapshot.manifest).includes(HIGH_QUALITY_GOVERNANCE_MARKER));
      const baselinePrompt = baseline ? promptFromManifest(baseline.manifest) : null;
      const classification = !baselinePrompt
        ? "baseline_unavailable"
        : baselinePrompt === originalPrompt
          ? "appended_governance_only"
          : classifyChangedPrompt(skill.slug);
      return {
        slug: skill.slug,
        classification,
        baselineSource: baseline?.source || null,
        baselineLength: baselinePrompt?.length ?? null,
        taskPromptLengthAfterRemovingGovernance: originalPrompt.length,
        governanceLength,
      };
    });

    const byClassification = Object.fromEntries(
      ["appended_governance_only", "critical_prompt_replaced", "policy_instruction_removed", "other_change", "baseline_unavailable"]
        .map((kind) => [kind, comparisons.filter((item) => item.classification === kind).length]),
    );
    console.log(JSON.stringify({
      schema: "emperor.high_quality_skill_prompt_variance/1.0",
      expectedSkills: HIGH_QUALITY_SKILL_SLUGS.size,
      comparedSkills: comparisons.length,
      byClassification,
      changedSlugs: comparisons.filter((item) => item.classification !== "appended_governance_only"),
      rawPromptContentExcluded: true,
      noModelCall: true,
    }));
  } finally {
    await connection.end();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ schema: "emperor.high_quality_skill_prompt_variance/1.0", status: "failed", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
