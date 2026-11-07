import { applyVideoEdits } from "../../../shared/competitorVideoAnalysis";
import { readJson } from "../../../shared/competitorPresentation";
import {
  richModuleTargets,
  moduleSellingPoints,
} from "../../../shared/richModuleSellingPoints";
import {
  brandBackgroundHashes,
  richTextSources,
} from "../../../shared/richContentPresentation";
import type {
  AggregationEvidence,
  ListingAggregation,
} from "../../../shared/listingAggregation";

export type AggregationSource = {
  id: string;
  text: string;
  evidence: AggregationEvidence[];
};
export type ReviewSource = {
  id: string;
  asin: string;
  text: string;
  reason: string;
  sentiment: "positive" | "negative";
  reviewIds: string[];
  evidence: { analysisId: number; groupIndex: number; generatedAt: string };
};

/** Reuse saved observations and original references. Never re-run image or review analysis while aggregating. */
export function collectAggregationSources(
  project: any,
  records: any[],
  current: ListingAggregation
) {
  const selling: AggregationSource[] = [],
    reviews: ReviewSource[] = [],
    questions: Array<{ id: string; asin: string; text: string }> = [];
  const summary = {
    sampleCount: 0,
    positive: 0,
    negative: 0,
    unrated: 0,
    asinCount: 0,
  };
  const studies = records
    .map(record => ({ record, raw: readJson(record.rawData) || {} }))
    .filter(
      ({ raw }) => raw.comparisonAnalysis?.version === 2 && !raw.analysisStale
    );
  const add = (id: string, text: unknown, evidence: AggregationEvidence[]) => {
    if (typeof text === "string" && text.trim())
      selling.push({ id, text: text.trim(), evidence });
  };
  for (const { record, raw } of studies) {
    const study = raw.comparisonAnalysis,
      edits = current.marks.find(m => m.analysisId === record.id)?.edits || {};
    const edited = (key: string, value: string) =>
      edits[key]?.original === value ? edits[key].value : value;
    const evidence = (
      kind: AggregationEvidence["kind"],
      sourceKey: string,
      quote: string,
      extra: Partial<AggregationEvidence> = {}
    ): AggregationEvidence => ({
      analysisId: record.id,
      asin: record.asin,
      kind,
      sourceKey,
      quote,
      basis: "direct",
      generatedAt: study.generatedAt,
      ...extra,
    });
    for (const b of study.listing?.bullets || []) {
      const index = Number(b.index) || 0,
        key = "bullet:" + index + ":sellingPoints",
        original = (b.sellingPoints || []).join("、");
      for (const [n, text] of edited(key, original).split("、").entries())
        add("B:" + record.id + ":" + index + ":" + n, text, [
          evidence("bullet", key, b.translation || text, {
            bulletIndex: index,
          }),
        ]);
    }
    const backgrounds = brandBackgroundHashes(raw.sourceLayout);
    for (const image of study.images || []) {
      if (backgrounds.has(image.hash)) continue;
      const key = "image:" + image.hash + ":sellingPoints";
      for (const [n, text] of edited(
        key,
        (image.sellingPoints || []).join("、")
      )
        .split("、")
        .entries())
        add("I:" + record.id + ":" + image.hash + ":" + n, text, [
          evidence("image", key, image.translation || text, {
            hash: image.hash,
          }),
        ]);
    }
    for (const target of richModuleTargets(
      raw.sourceLayout,
      raw.imageAssets || []
    )) {
      const points = moduleSellingPoints(target, study, edits).sellingPoints;
      const refs = target.imageHashes.map(hash =>
        evidence("image", target.id, points.join("、"), {
          hash,
          moduleId: target.moduleId,
        })
      );
      refs.push(
        ...target.blocks.map(block =>
          evidence(
            "module",
            block.id,
            study.richContent?.texts?.find((t: any) => t.id === block.id)
              ?.translation || block.text,
            { moduleId: target.moduleId, blockId: block.id }
          )
        )
      );
      if (!refs.length)
        refs.push(
          evidence("module", target.id, target.copy.join("\n"), {
            moduleId: target.moduleId,
          })
        );
      points.forEach((text, n) =>
        add("M:" + record.id + ":" + target.id + ":" + n, text, refs)
      );
    }
    for (const block of richTextSources(raw.sourceLayout)) {
      const translated = study.richContent?.texts?.find(
        (t: any) => t.id === block.id
      );
      const text = translated?.translation || block.text;
      add("T:" + record.id + ":" + block.id, text, [
        evidence("module", block.id, text, { blockId: block.id }),
      ]);
    }
    for (const original of study.videoAnalyses || raw.videoAnalyses || []) {
      const video = applyVideoEdits(original, edits)!;
      if (video.status !== "complete") continue;
      for (const [n, point] of (video.sellingPoints || []).entries()) {
        const text = typeof point === "string" ? point : point.text;
        const moments = typeof point === "string" ? [] : point.moments || [];
        add("V:" + record.id + ":" + video.hash + ":" + n, text, [
          evidence("video", "video:" + video.hash + ":" + n, text, {
            hash: video.hash,
            ...(moments[0]
              ? { start: moments[0].start, end: moments[0].end }
              : {}),
          }),
        ]);
      }
    }
    if (study.reviewVersion === 2) {
      summary.asinCount++;
      summary.sampleCount += Number(study.reviewSampleCount) || 0;
      summary.positive += Number(study.reviewSentimentCounts?.positive) || 0;
      summary.negative += Number(study.reviewSentimentCounts?.negative) || 0;
      summary.unrated += Number(study.reviewUnratedCount) || 0;
      for (const [index, group] of (study.reviews || []).entries())
        reviews.push({
          id: "R:" + record.id + ":" + index,
          asin: record.asin,
          text: edited("review:" + index + ":name", group.name),
          reason: edited("review:" + index + ":reason", group.reason || ""),
          sentiment: group.sentiment,
          reviewIds: [
            ...new Set<string>(
              (group.reviewIds || []).map((id: string) => record.id + ":" + id)
            ),
          ],
          evidence: {
            analysisId: record.id,
            groupIndex: index,
            generatedAt: study.generatedAt,
          },
        });
    }
    for (const [index, q] of (raw.productQuestions || []).entries())
      if (q.question)
        questions.push({
          id: "Q:" + record.id + ":" + index,
          asin: record.asin,
          text: q.questionCn || q.question,
        });
  }
  const product = {
    features: project.productFeatures || "",
    specs: project.productSpecs || "",
    productName: project.productName || "",
    notes: current.productNotes || "",
  };
  for (const [key, value] of Object.entries(product))
    if (key !== "productName" && value.trim())
      add("PRODUCT:" + key, value, [
        {
          kind: key === "notes" ? "user" : "product",
          sourceKey: "PRODUCT:" + key,
          quote: value.slice(0, 6000),
          basis: key === "notes" ? "user" : "direct",
        },
      ]);
  for (const node of [...(current.features || []), ...current.selling]) {
    const planned=node.availability === "planned" || node.group === "improve",key="PRODUCT:"+(planned?"PLANNED:":"CONFIRMED:")+node.id;
    const value=(planned?"本品尚未实现，属于待改进：":"")+node.text+"\n"+node.note;
    add(key,value,[{kind:"user",sourceKey:key,quote:value,basis:"user"}]);
  }
  return {
    selling,
    reviews,
    questions,
    summary,
    product,
    studyCount: studies.length,
  };
}
