import { sql } from "drizzle-orm";
import { getDb } from "../server/repositories/dbClient";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [modelRows, skillRows, gptProviderRows, recentPlannerRuns] = await Promise.all([
    db.execute(sql.raw(`
      SELECT slug, provider, modelId, isDefault, isActive
      FROM emperor_model_providers
      ORDER BY isDefault DESC, slug ASC
    `)),
    db.execute(sql.raw(`
      SELECT slug,
             JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.implementation.modelPolicy')) AS modelPolicy,
             modelOverride,
             timeout_seconds
      FROM emperor_skills
      WHERE slug = 'emperor.conversation.plan'
      LIMIT 1
    `)),
    db.execute(sql.raw(`
      SELECT slug, provider, modelId, baseUrl, apiKeyRef, isActive
      FROM emperor_model_providers
      WHERE modelId = 'gpt-5.6-sol' AND isActive = 1
      LIMIT 1
    `)),
    db.execute(sql.raw(`
      SELECT id, runId, status, modelSlug, provider, durationMs, errorMessage, createdAt
      FROM emperor_skill_runs
      WHERE skillSlug = 'emperor.conversation.plan'
      ORDER BY id DESC
      LIMIT 5
    `)),
  ]);

  const normalizeRows = (result: unknown) => (
    Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result
  );

  const rawGptProvider = (normalizeRows(gptProviderRows) as Array<Record<string, unknown>>)[0];
  const gptBaseUrl = typeof rawGptProvider?.baseUrl === "string" ? rawGptProvider.baseUrl : "";
  const gptUrl = gptBaseUrl ? new URL(gptBaseUrl) : null;

  console.log(JSON.stringify({
    modelProviders: normalizeRows(modelRows),
    plannerSkill: normalizeRows(skillRows),
    gpt56Provider: rawGptProvider ? {
      slug: rawGptProvider.slug,
      provider: rawGptProvider.provider,
      modelId: rawGptProvider.modelId,
      isActive: rawGptProvider.isActive,
      apiKeyConfigured: Boolean(rawGptProvider.apiKeyRef),
      endpointPath: gptUrl?.pathname || null,
      endpointAlreadyIncludesChatCompletions: Boolean(gptUrl?.pathname.endsWith("/chat/completions")),
    } : null,
    recentPlannerRuns: (normalizeRows(recentPlannerRuns) as Array<Record<string, unknown>>).map((run) => ({
      id: run.id,
      runId: run.runId,
      status: run.status,
      modelSlug: run.modelSlug,
      provider: run.provider,
      durationMs: run.durationMs,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
    })),
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Model directory inspection failed");
  process.exitCode = 1;
});
