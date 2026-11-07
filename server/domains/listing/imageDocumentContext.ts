import { inArray, sql } from "drizzle-orm";
import { kbTagDefinitions } from "../../../drizzle/schema";
import {
  CATEGORY_OPTIONS,
  STYLE_NAME_OPTIONS,
} from "../../../shared/imageTagConstants";
import { acquisitionReviewHash } from "../../../shared/acquisitionReview";
import type { ImageDocument } from "../../../shared/imageDocument";
import { requireDb } from "../../repositories/dbClient";
import {
  assistantConfigurationService,
  skillManifestHash,
} from "../ai_os/services/assistantConfigurations";
import { getEmperorSkillRuntimeSnapshot } from "../ai_os/services/skillRunner";
import { imagePlanningSources } from "./imagePlanningSources";
import {
  readImagePlan,
  planningRows,
  type PlanningScope,
} from "./imagePlanningStore";
import {
  documentActor,
  documentReferences,
  resolveDocumentMaterials,
} from "./imageDocumentMaterials";
import { outlineDocumentHash } from "./imageDocumentStore";
import { IMAGE_DOCUMENT_SKILL } from "./imageDocumentPrompt";
import { loadAsset } from "../knowledge/assetTargets";
import { assertResourceAction } from "../../services/securityGovernance";
export async function imageDocumentTags() {
  const rows = await (
    await requireDb("read document tags")
  )
    .select()
    .from(kbTagDefinitions)
    .where(inArray(kbTagDefinitions.dimension, ["category", "style"]));
  const active = rows.filter(row => {
      try {
        return JSON.parse(row.metadata || "{}").retiredFromChoices !== true;
      } catch {
        return true;
      }
    }),
    values = (dimension: string, fallback: readonly string[]) => {
      const found = active
        .filter(r => r.dimension === dimension)
        .map(r => r.value);
      return found.length ? found : [...fallback];
    };
  return {
    categories: values("category", CATEGORY_OPTIONS),
    styles: values("style", STYLE_NAME_OPTIONS),
  };
}
export async function imageDocumentConfiguration(
  scope: PlanningScope,
  required = true
) {
  const configured = await assistantConfigurationService.get(
    scope.workspaceId,
    "images"
  );
  if (configured.status !== "configured" || !configured.record.config.enabled) {
    if (required) throw new Error("请先启用图片策划助手");
    return null;
  }
  const binding = configured.record.config.skills.find(
    s => s.slug === IMAGE_DOCUMENT_SKILL && s.enabled
  );
  if (!binding) {
    if (required) throw new Error("请先在图片策划助手中启用套图文档策划");
    return null;
  }
  const snapshot = await getEmperorSkillRuntimeSnapshot(
    IMAGE_DOCUMENT_SKILL,
    scope.workspaceId
  );
  const [skill] = await planningRows(
    await requireDb("document skill"),
    sql`SELECT manifest FROM emperor_skills WHERE slug=${IMAGE_DOCUMENT_SKILL} AND status='Released' AND (workspaceId=${scope.workspaceId} OR (workspaceId IS NULL AND scope='global')) ORDER BY workspaceId DESC LIMIT 1`
  );
  if (
    !skill ||
    String(binding.version) !== String(snapshot.version) ||
    binding.manifestSha256 !== skillManifestHash(skill.manifest)
  ) {
    if (required) throw new Error("套图文档技能已更新，请更新助手绑定后重试");
    return null;
  }
  return {
    revision: configured.record.revision,
    config: configured.record.config,
    snapshot,
  };
}
export async function imageDocumentContext(
  scope: PlanningScope,
  data: ImageDocument
) {
  const [plan, sources, tags, configured] = await Promise.all([
    readImagePlan(scope),
    imagePlanningSources(scope),
    imageDocumentTags(),
    assistantConfigurationService.get(scope.workspaceId, "images"),
  ]);
  const materials = await resolveDocumentMaterials(
      scope,
      documentReferences(data)
    ),
    referenceSets = [];
  let knowledgeAllowed = true;
  try {
    await assertResourceAction({
      actor: await documentActor(scope),
      resource: "knowledge",
      action: "read",
      workspaceId: scope.workspaceId,
    });
  } catch {
    knowledgeAllowed = false;
  }
  for (const id of plan.data.referenceSets)
    try {
      if (!knowledgeAllowed) throw new Error("unavailable");
      const asset = await loadAsset(scope, "set", id),
        tags = Object.fromEntries(
          Object.entries(asset.result || {}).filter(([key]) =>
            [
              "setCategory",
              "setStyle",
              "setPrimaryColor",
              "setAccentColor",
            ].includes(key)
          )
        );
      referenceSets.push({
        id,
        title: asset.title,
        asin: asset.set?.asin,
        tags,
        version: acquisitionReviewHash(
          JSON.parse(JSON.stringify([asset.set?.id, tags]))
        ),
      });
    } catch {
      referenceSets.push({
        id,
        title: "参考套图暂时无法读取",
        asin: "",
        tags: {},
        version: "unavailable",
      });
    }
  const outlineHash = outlineDocumentHash(plan.data),
    sourceHash = acquisitionReviewHash(
      JSON.parse(
        JSON.stringify({
          outlineHash,
          facts: sources.sourceHash,
          materials: materials.map(m => [m.key, m.version]),
          referenceSets: referenceSets.map(s => [s.id, s.version]),
          tags,
        })
      )
    );
  return {
    plan,
    sources,
    tags,
    materials,
    referenceSets,
    outlineHash,
    sourceHash,
    configurationRevision:
      configured.status === "configured" ? configured.record.revision : 0,
  };
}
