import mysql from "mysql2/promise";
import { HIGH_QUALITY_SKILL_SLUGS, HIGH_QUALITY_QUALITY_MODEL } from "../server/domains/ai_os/services/highQualitySkillGovernance";

type SkillRow = { slug: string; name: string; category: string | null; manifest: unknown; modelOverride: string | null };
type ModelRow = { slug: string; isActive: number; maxContextTokens: number; capabilityTags: unknown; modelId: string };

function manifestOf(value: unknown): any {
  return typeof value === "string" ? JSON.parse(value) : value || {};
}
function promptLength(manifest: any): number {
  const implementation = manifest?.implementation || {};
  return String(implementation.systemPrompt || "").length + String(implementation.userPromptTemplate || "").length;
}
function tagList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try { return tagList(JSON.parse(value)); } catch { return []; }
  }
  return [];
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is unavailable");
  const connection = await mysql.createConnection({ uri: databaseUrl });
  try {
    const [skillsRaw] = await connection.execute(
      `SELECT slug,name,category,manifest,modelOverride FROM emperor_skills WHERE status='Released' ORDER BY slug`,
    );
    const [modelsRaw] = await connection.execute(
      `SELECT slug,isActive,maxContextTokens,capabilityTags,modelId FROM emperor_model_providers WHERE isActive=1 ORDER BY slug`,
    );
    const skills = skillsRaw as SkillRow[];
    const models = modelsRaw as ModelRow[];
    const registered = new Map(models.map((model) => [model.slug, model]));
    const gpt6 = registered.get(HIGH_QUALITY_QUALITY_MODEL);
    const highQuality = skills.filter((skill) => HIGH_QUALITY_SKILL_SLUGS.has(skill.slug));
    const qualityPolicyMissing = highQuality.filter((skill) => manifestOf(skill.manifest)?.implementation?.qualityModelPolicy !== HIGH_QUALITY_QUALITY_MODEL);
    const defaultGpt6 = highQuality.filter((skill) => skill.modelOverride === HIGH_QUALITY_QUALITY_MODEL);
    const contextRisk = skills.map((skill) => {
      const manifest = manifestOf(skill.manifest);
      const selected = String(skill.modelOverride || manifest?.implementation?.modelPolicy || "");
      const model = registered.get(selected);
      const requestedOutput = Number(manifest?.implementation?.maxTokens || 4096);
      const chars = promptLength(manifest);
      return {
        slug: skill.slug,
        model: selected || null,
        modelContext: model?.maxContextTokens || null,
        promptChars: chars,
        maxOutputTokens: requestedOutput,
        risk: !model ? "model_unregistered" : requestedOutput >= model.maxContextTokens * 0.6 ? "output_budget_pressure" : chars / 4 + requestedOutput >= model.maxContextTokens * 0.75 ? "input_context_pressure" : null,
      };
    }).filter((item) => item.risk);
    const qualityCandidates = highQuality.filter((skill) => {
      const manifest = manifestOf(skill.manifest);
      const category = String(skill.category || "");
      const length = promptLength(manifest);
      return skill.modelOverride !== HIGH_QUALITY_QUALITY_MODEL
        && (length > 12_000 || /analysis|diagnosis|decision|competitor|strategy|product|video/.test(`${skill.slug} ${category}`));
    }).map((skill) => ({
      slug: skill.slug,
      currentDefault: skill.modelOverride,
      promptChars: promptLength(manifestOf(skill.manifest)),
      reason: "complex_or_evidence_dense_task_quality_preset_already_uses_gpt6",
    }));
    console.log(JSON.stringify({
      schema: "emperor.gpt6_astra_route_audit/1.0",
      gpt6: gpt6 ? { active: gpt6.isActive === 1, modelId: gpt6.modelId, maxContextTokens: gpt6.maxContextTokens, capabilityTags: tagList(gpt6.capabilityTags) } : null,
      totalReleasedSkills: skills.length,
      highQualitySkills: highQuality.length,
      qualityPresetGpt6: highQuality.length - qualityPolicyMissing.length,
      qualityPolicyMissing: qualityPolicyMissing.map((skill) => skill.slug),
      defaultGpt6Count: defaultGpt6.length,
      defaultGpt6Slugs: defaultGpt6.map((skill) => skill.slug),
      contextRisk,
      defaultSwitchCandidates: qualityCandidates,
      recommendation: "Keep GPT-6 Astra for quality_first and selectively promote only evidence-dense, high-consequence analysis to default after quality/cost acceptance; no context-pressure promotion is justified while all registered Teamorouter text models expose 128000 tokens.",
      noModelCall: true,
    }));
  } finally {
    await connection.end();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ schema: "emperor.gpt6_astra_route_audit/1.0", status: "failed", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
