import mysql from "mysql2/promise";
import {
  LISTING_CHECKLIST_SKILL_POLICIES,
} from "../server/domains/listing/services/listingChecklistSkillPolicy";
import { HIGH_QUALITY_QUALITY_MODEL } from "../server/domains/ai_os/services/highQualitySkillGovernance";
import { LISTING_CHECKLIST_DIMENSIONS } from "../server/domains/listing/services/checklistContracts";

function parse(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return JSON.parse(String(value)) as Record<string, unknown>;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is unavailable");
  const db = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const slugs = LISTING_CHECKLIST_SKILL_POLICIES.map((policy) => policy.slug);
    const placeholders = slugs.map(() => "?").join(",");
    const [rows] = await db.query(
      `SELECT slug,status,version,modelOverride,manifest FROM emperor_skills WHERE slug IN (${placeholders}) ORDER BY slug`,
      slugs,
    );
    if (rows.length !== LISTING_CHECKLIST_SKILL_POLICIES.length) throw new Error("Checklist Skill inventory is incomplete");

    const skills = rows.map((row) => {
      const manifest = parse(row.manifest);
      const implementation = (manifest.implementation || {}) as Record<string, unknown>;
      const contract = (manifest.contract || {}) as Record<string, unknown>;
      const policy = LISTING_CHECKLIST_SKILL_POLICIES.find((candidate) => candidate.slug === row.slug)!;
      const required = LISTING_CHECKLIST_DIMENSIONS[policy.kind];
      const outputSchema = (contract.outputSchema || {}) as Record<string, unknown>;
      const scoresSchema = ((outputSchema.properties || {}) as Record<string, unknown>).checkListScores as Record<string, unknown> | undefined;
      const actualRequired = Array.isArray(scoresSchema?.required) ? scoresSchema.required : [];
      const scoreProperties = (scoresSchema?.properties || {}) as Record<string, { required?: unknown }>;
      const feedbackContractComplete = required.every((key) => {
        const scoreRequired = scoreProperties[key]?.required;
        return Array.isArray(scoreRequired)
          && ["pass", "notes", "reason", "suggestion", "evidenceQuote"].every((field) => scoreRequired.includes(field));
      });
      return {
        slug: row.slug,
        status: row.status,
        version: Number(row.version),
        promptChars: String(implementation.systemPrompt || "").length,
        supportsJsonMode: implementation.supportsJsonMode === true,
        qualityModelPolicy: implementation.qualityModelPolicy || null,
        evaluationModelPolicy: implementation.evaluationModelPolicy || null,
        requiredDimensionCount: actualRequired.length,
        completeContract: required.every((key) => actualRequired.includes(key)),
        feedbackContractComplete,
        promptRequiresActionableFeedback: String(implementation.systemPrompt || "").includes("Every dimension object MUST include all five keys"),
        gpt6QualityRoute: implementation.qualityModelPolicy === HIGH_QUALITY_QUALITY_MODEL
          && implementation.evaluationModelPolicy === HIGH_QUALITY_QUALITY_MODEL,
      };
    });
    if (!skills.every((skill) => skill.status === "Released" && skill.promptChars > 500 && skill.supportsJsonMode && skill.completeContract && skill.feedbackContractComplete && skill.promptRequiresActionableFeedback && skill.gpt6QualityRoute)) {
      throw new Error("Checklist remediation verification failed");
    }
    const [models] = await db.query(
      "SELECT slug,isActive,provider,baseUrl IS NOT NULL AS hasBaseUrl,apiKeyRef IS NOT NULL AS hasApiKeyRef FROM emperor_model_providers WHERE slug=? LIMIT 1",
      [HIGH_QUALITY_QUALITY_MODEL],
    );
    const model = models[0];
    if (!model || !model.isActive || !model.hasBaseUrl || !model.hasApiKeyRef) throw new Error("GPT-6 Astra model route is unavailable");
    console.log(JSON.stringify({
      verificationMode: "static_only",
      skills,
      gpt6Astra: { active: Boolean(model.isActive), provider: model.provider, hasBaseUrl: Boolean(model.hasBaseUrl), hasApiKeyRef: Boolean(model.hasApiKeyRef) },
      actionsPerformed: { databaseWrites: false, llmCalls: false, fileRetries: false, providerCalls: false },
    }));
  } finally {
    await db.end();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ schema: "listing.checklist_feedback_verification/1.0", status: "failed", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
