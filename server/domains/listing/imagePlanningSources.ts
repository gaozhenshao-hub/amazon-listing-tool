import { TRPCError } from "@trpc/server";
import * as repository from "../../repositories";
import { readJson } from "../../../shared/competitorPresentation";
import { acquisitionReviewHash } from "../../../shared/acquisitionReview";
import { readListingAggregation } from "./aggregationStore";
import { collectAggregationSources } from "./aggregationSources";
import type { PlanningScope } from "./imagePlanningStore";
import type { ImageOutline } from "../../../shared/imagePlanning";
import type { ListingAggregation } from "../../../shared/listingAggregation";
import { resolveQuestionIds } from "../../../shared/questionMerging";
import { applyRichContentEdits } from "../../../shared/richContentPresentation";
import { taggingUnitPreview } from "../knowledge/taggingUnitPreview";
import type { MessageContent } from "../../_core/llm";

export async function imagePlanningSources(scope: PlanningScope) {
  const project = await repository.getProjectById(
    scope.projectId,
    scope.userId,
    scope.workspaceId
  );
  if (!project || project.workspaceId !== scope.workspaceId)
    throw new TRPCError({ code: "NOT_FOUND", message: "项目不可访问" });
  const upstream = await readListingAggregation(scope),
    records = await repository.getCompetitorAnalysesByProject(scope.projectId);
  const observations = collectAggregationSources(
    project,
    records,
    upstream.data
  );
  const competitors = records.map(record => {
    const raw = readJson(record.rawData) || {};
    return {
      analysisId: record.id,
      snapshotId: raw.confirmedSnapshotId,
      asin: record.asin,
      title: record.title,
      bullets: record.bulletPoints,
      stale: !!raw.analysisStale,
      imageFindings: raw.analysisStale
        ? undefined
        : raw.comparisonAnalysis?.images,
      modules: raw.analysisStale
        ? undefined
        : applyRichContentEdits(
            raw.comparisonAnalysis?.richContent,
            upstream.data.marks.find(m => m.analysisId === record.id)?.edits
          ),
      layout: raw.sourceLayout,
    };
  });
  const compactNode = (node: any) => ({
    ...node,
    evidence: node.evidence?.map((e: any) => ({
      ...e,
      quote: typeof e.quote === "string" ? e.quote.slice(0, 1000) : e.quote,
      quoteTruncated: typeof e.quote === "string" && e.quote.length > 1000,
    })),
  });
  const input = {
    product: observations.product,
    productNotes: upstream.data.productNotes || "",
    ownProductPhotos:upstream.data.productPhotos || [],
    planningDialogue:upstream.data.planningConversation?.messages || [],
    selling: upstream.data.selling.map(compactNode),
    features: (upstream.data.features || []).map(compactNode),
    links: upstream.data.links || [],
    reviews: upstream.data.reviews,
    reviewSummary: upstream.data.reviewSummary,
    questions: upstream.data.questions,
    competitors,
  };
  // Optional fields are absent on a new project; hash the persisted JSON shape.
  const sourceHash = acquisitionReviewHash(JSON.parse(JSON.stringify({
    input,
  })));
  return {
    input,
    sourceHash,
    upstream: upstream.data,
    revision: upstream.revision,
  };
}
export async function planningVisuals(scope: PlanningScope) {
  const records = await repository.getCompetitorAnalysesByProject(
      scope.projectId
    ),
    attachments: MessageContent[] = [],
    images: Array<{ asin: string; role: string; hash: string }> = [];
  let unavailable = 0;
  const own=(await readListingAggregation(scope)).data.productPhotos || [];
  for(const photo of own.slice(0,8))try{
    const buffer=await taggingUnitPreview({primary:{id:0,imageUrl:photo.storageKey,imagePosition:"main"},images:[{id:0,imageUrl:photo.storageKey,imagePosition:"main"}],complete:true});
    attachments.push({type:"image_url",image_url:{url:"data:image/jpeg;base64,"+buffer.toString("base64")}});
    images.push({asin:"本品",role:photo.kind==="product"?"产品实拍图":"配件实拍图",hash:photo.id});
  }catch{unavailable++;}
  for (const record of records.slice(0, 2)) {
    const raw = readJson(record.rawData) || {},
      all = (raw.imageAssets || []).filter((a: any) => a.storageKey),
      assets = [
        ...all.filter((a: any) => a.role === "main").slice(0, 1),
        ...all.filter((a: any) => a.role === "secondary").slice(0, 1),
        ...all.filter((a: any) => a.role === "aplus").slice(0, 1),
      ];
    for (const [index, asset] of assets.entries())
      try {
        const image = await taggingUnitPreview({
          primary: {
            id: index,
            imageUrl: asset.storageKey,
            imagePosition: asset.role,
          },
          images: [
            {
              id: index,
              imageUrl: asset.storageKey,
              imagePosition: asset.role,
            },
          ],
          complete: true,
        });
        attachments.push({
          type: "image_url",
          image_url: {
            url: "data:image/jpeg;base64," + image.toString("base64"),
          },
        });
        images.push({
          asin: record.asin,
          role: asset.role,
          hash: asset.sourceUrlHash,
        });
      } catch {
        unavailable++;
      }
  }
  return { attachments, images, unavailable };
}
export function validateOutlineLinks(
  data: ImageOutline,
  upstream: ListingAggregation,
  baseline?: ImageOutline
) {
  const fields = {
    benefitIds: upstream.selling,
    featureIds: upstream.features || [],
    reviewIds: upstream.reviews,
    questionIds: upstream.questions,
  } as const;
  const original = new Map(baseline?.groups.flatMap(group => group.items).map(item => [item.id, item]));
  for (const item of data.groups.flatMap(g => g.items)) {
    item.questionIds=resolveQuestionIds(item.questionIds,upstream.questions);
    for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
      const ids = new Set(fields[key].map(n => n.id));
      if (
        new Set(item[key]).size !== item[key].length ||
        item[key].some(id => !ids.has(id) && !original.get(item.id)?.[key].includes(id))
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "关联的上一级结论已变化，请重新选择",
        });
    }
  }
}
