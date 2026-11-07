import { readJson } from "../../../shared/competitorPresentation";
import { readListingAggregation } from "./aggregationStore";
import * as repository from "../../repositories";
import { resolveStoredObjectUrl } from "../../storage";
import type { PlanningScope } from "./imagePlanningStore";
export async function competitorReferenceImages(scope: PlanningScope) {
  const [records, aggregate] = await Promise.all([
    repository.getCompetitorAnalysesByProject(scope.projectId),
    readListingAggregation(scope),
  ]);
  const output = [];
  for (const record of records) {
    const raw = readJson(record.rawData) || {},
      liked = new Set(
        aggregate.data.marks.find(m => m.analysisId === record.id)
          ?.likedAssets || []
      ),
      seen = new Set<string>(),
      ordinals = new Map<string, number>();
    for (const asset of raw.imageAssets || []) {
      if (
        !/^[a-f0-9]{64}$/.test(asset.sourceUrlHash) ||
        seen.has(asset.sourceUrlHash) ||
        !asset.storageKey ||
        /video/.test(asset.role || "")
      )
        continue;
      seen.add(asset.sourceUrlHash);
      const url = await resolveStoredObjectUrl(asset.storageKey).catch(
        () => ""
      );
      if (!url) continue;
      const ordinal = (ordinals.get(asset.role) || 0) + 1;
      ordinals.set(asset.role, ordinal);
      output.push({
        source: "competitor" as const,
        analysisId: record.id,
        hash: String(asset.sourceUrlHash),
        imageUrl: url,
        asin: record.asin,
        title: record.title || record.asin,
        role: String(asset.role || "secondary"),
        ordinal,
        liked: liked.has(asset.sourceUrlHash),
      });
    }
  }
  return output.sort((a, b) => Number(b.liked) - Number(a.liked));
}
