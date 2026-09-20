import {
  TEAMOROUTER_CREDENTIAL_REF,
  TEAMOROUTER_OPENAI_BASE_URL,
  TEAMOROUTER_TEXT_MODEL_CATALOG,
} from "./teamorouterCatalog";

export type TeamorouterCatalogExecutor = (sql: string, params: unknown[]) => Promise<unknown>;

/**
 * Registers only catalog-verified text models. Each row references the runtime
 * environment credential instead of persisting a key in the model registry.
 */
export async function syncGovernedTeamorouterCatalog(execute: TeamorouterCatalogExecutor) {
  await execute(
    "UPDATE emperor_model_providers SET baseUrl=?, apiKeyRef=? WHERE baseUrl LIKE ?",
    [TEAMOROUTER_OPENAI_BASE_URL, TEAMOROUTER_CREDENTIAL_REF, "%api.teamorouter.com%"],
  );

  for (const model of TEAMOROUTER_TEXT_MODEL_CATALOG) {
    await execute(
      `INSERT INTO emperor_model_providers (workspaceId,slug,name,provider,modelId,displayName,baseUrl,apiKeyRef,isDefault,isActive,capabilityTags,costPer1kInputTokens,costPer1kOutputTokens,maxContextTokens)
       VALUES (NULL,?,?,?,?,?,?,?,0,1,?,0,0,?)
       ON DUPLICATE KEY UPDATE
         name=VALUES(name), provider=VALUES(provider), modelId=VALUES(modelId), displayName=VALUES(displayName),
         baseUrl=VALUES(baseUrl), apiKeyRef=VALUES(apiKeyRef), isActive=1,
         capabilityTags=VALUES(capabilityTags), maxContextTokens=VALUES(maxContextTokens)`,
      [
        model.slug,
        model.name,
        "custom",
        model.modelId,
        model.name,
        TEAMOROUTER_OPENAI_BASE_URL,
        TEAMOROUTER_CREDENTIAL_REF,
        JSON.stringify(model.capabilityTags),
        model.maxContextTokens,
      ],
    );
  }

  return {
    migratedLegacyEndpoint: true,
    registeredModelSlugs: TEAMOROUTER_TEXT_MODEL_CATALOG.map((model) => model.slug),
    defaultChanged: false,
  };
}
