import { TRPCError } from "@trpc/server";
import * as repository from "../../repositories";
import { readJson } from "../../../shared/competitorPresentation";
import { richTextSources } from "../../../shared/richContentPresentation";
import type { AggregationEvidence } from "../../../shared/listingAggregation";
import { resolveStoredObjectUrl } from "../../storage";
import { readListingAggregation } from "./aggregationStore";
import { collectAggregationSources } from "./aggregationSources";
import { hydrateCompetitorEvidence } from "./competitorPresentation";
type Scope = { projectId: number; workspaceId: number; userId: number };
const identity = (r: AggregationEvidence) =>
  JSON.stringify([
    r.analysisId,
    r.kind,
    r.sourceKey,
    r.hash,
    r.moduleId,
    r.blockId,
    r.bulletIndex,
  ]);
export async function aggregationSourceEvidence(
  scope: Scope,
  requested: AggregationEvidence[] | string,
  page = 1
) {
  const project = await repository.getProjectById(
    scope.projectId,
    scope.userId,
    scope.workspaceId
  );
  if (!project || project.workspaceId !== scope.workspaceId)
    throw new TRPCError({ code: "NOT_FOUND", message: "项目不可访问" });
  const current=await readListingAggregation(scope);
  const node=typeof requested==="string"?[...(current.data.features||[]),...current.data.selling,...current.data.questions].find(n=>n.id===requested):undefined;
  if(typeof requested==="string"&&!node)throw new TRPCError({code:"NOT_FOUND",message:"当前功能或卖点已更新，请重新打开证据"});
  const refs=typeof requested==="string"?node?.evidence||[]:requested;
  const original = await repository.getCompetitorAnalysesByProject(
      scope.projectId
    ),
    records = await Promise.all(
      original.map(r => hydrateCompetitorEvidence(r, scope.workspaceId))
    );
  const sources = collectAggregationSources(project, records, current.data);
  const allowed = new Map<string, AggregationEvidence>(
    [...sources.selling.flatMap(s => s.evidence),...sources.reviews.map(r=>({kind:"review" as const,analysisId:r.evidence.analysisId,asin:r.asin,sourceKey:r.id,quote:r.text+"\n"+r.reason,basis:"direct" as const,generatedAt:r.evidence.generatedAt})),...sources.questions.map(q=>({kind:"listing" as const,analysisId:Number(q.id.split(":")[1]),asin:q.asin,sourceKey:q.id,quote:q.text,basis:"direct" as const}))].map(e => [identity(e), e])
  );
  const distinct = [
    ...new Map(
      refs.map(r => [
        JSON.stringify([r.analysisId, r.kind, r.hash || r.sourceKey]),
        r,
      ])
    ).values(),
  ];
  const pageSize = 10;
  const items = await Promise.all(
    distinct.slice((page - 1) * pageSize, page * pageSize).map(async ref => {
      const valid = allowed.get(identity(ref)) || (ref.kind==="video" && ref.sourceKey==="video:"+ref.hash ? [...allowed.values()].find(e=>e.kind==="video" && e.analysisId===ref.analysisId && e.hash===ref.hash && e.quote===ref.quote) : undefined),
        record = records.find(r => r.id === ref.analysisId),
        raw = record ? readJson(record.rawData) || {} : {};
      const asset = ref.hash
        ? (raw.imageAssets || []).find((a: any) => a.sourceUrlHash === ref.hash && (ref.kind === "video" ? a.role === "video" : a.role !== "video"))
        : null;
      const base = {
        kind: ref.kind,
        asin: record?.asin || null,
        title: record?.title || null,
        basis: ref.basis,
        quote: valid?.quote || "",
        stale: !valid || valid.quote !== ref.quote,
        originalText: "",
        imageUrl: null as string | null,
        video: null as any,
        start: valid?.start ?? null,
      };
      if (!valid)
        return {
          ...base,
          quote: "来源已更新或不属于当前项目，请重新汇总后核对。",
        };
      if (ref.kind === "image" && asset?.role !== "video" && asset?.storageKey)
        base.imageUrl = await resolveStoredObjectUrl(asset.storageKey).catch(
          () => null
        );
      if (ref.kind === "bullet") {
        const values = readJson(record?.bulletPoints) || [];
        base.originalText = values[ref.bulletIndex ?? -1] || "";
      }
      if (ref.kind === "module" && ref.blockId)
        base.originalText =
          richTextSources(raw.sourceLayout).find(b => b.id === ref.blockId)
            ?.text || "";
      if (ref.kind === "video" && asset?.role === "video") {
        const v = (raw.videos || []).find((v: any) => v.hash === ref.hash);
        if (v)
          base.video = {
            ...v,
            videoUrl: await resolveStoredObjectUrl(asset.storageKey).catch(
              () => null
            ),
            posterUrl: asset.thumbnailStorageKey
              ? await resolveStoredObjectUrl(asset.thumbnailStorageKey).catch(
                  () => null
                )
              : null,
            status: "ready",
            analysis: (raw.comparisonAnalysis?.videoAnalyses || []).find(
              (a: any) => a.hash === ref.hash
            ),
          };
      }
      return base;
    })
  );
  return { items, total: distinct.length, pageSize };
}
