import { isAmazonPageNavigation } from "./amazonContentText";
/** Stable field identities let human corrections remain separate from later AI output. */
import {
  moduleSellingPoints,
  richModuleTargets,
} from "./richModuleSellingPoints";
export function competitorStudyFields(
  study: any,
  layout?: unknown
): Record<string, string> {
  const fields: Record<string, string> = {};
  if (typeof study?.listing?.titleTranslation === "string")
    fields["title:translation"] = study.listing.titleTranslation;
  for (const bullet of study?.listing?.bullets || []) {
    if (Number.isSafeInteger(bullet.index)) {
      fields[`bullet:${bullet.index}:translation`] = String(
        bullet.translation || ""
      );
      fields[`bullet:${bullet.index}:sellingPoints`] = (
        bullet.sellingPoints || []
      ).join("、");
    }
  }
  for (const image of study?.images || []) {
    if (/^[a-f0-9]{64}$/.test(image.hash)) {
      fields[`image:${image.hash}:translation`] = String(
        image.translation || ""
      );
      fields[`image:${image.hash}:sellingPoints`] = (
        image.sellingPoints || []
      ).join("、");
    }
  }
  for (const v of study?.videoAnalyses || [])
    if (/^[a-f0-9]{64}$/.test(v.hash)) {
      fields["video:" + v.hash + ":sellingPoints"] = (v.sellingPoints || [])
        .map((p: any) => p.text)
        .join("、");
      for (const cue of v.cues || [])
        if (/^[A-Za-z0-9_-]{1,100}$/.test(cue.id))
          fields["subtitle:" + v.hash + ":" + cue.id + ":translation"] = String(
            cue.translation || ""
          );
    }
  for (const [index, review] of (study?.reviews || []).entries()) {
    fields[`review:${index}:name`] = String(review.name || "");
    fields[`review:${index}:reason`] = String(review.reason || "");
    fields[`review:${index}:percentage`] = String(review.percentage ?? "");
  }
  for (const text of study?.richContent?.texts || []) {
    if(typeof text.source=== "string" && isAmazonPageNavigation(text.source))continue;
    if (typeof text.id === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(text.id)) {
      fields[`text:${text.id}:translation`] = String(text.translation || "");
      fields[`text:${text.id}:sellingPoints`] = (text.sellingPoints || []).join(
        "、"
      );
    }
  }
  for (const image of study?.richContent?.images || [])
    if (/^[a-f0-9]{64}$/.test(image.sourceHash))
      for (const [index, region] of (image.regions || []).entries())
        fields[`region:${image.sourceHash}:${index}:translation`] = String(
          region.translation || ""
        );
  for (const target of richModuleTargets(layout, study?.richContent?.images))
    fields[`module:${target.id}:sellingPoints`] = moduleSellingPoints(
      target,
      study
    ).sellingPoints.join("、");
  return fields;
}

/** Includes older image/text corrections when they are shown as a unified module. */
export function competitorCurrentValues(
  study: any,
  layout: unknown,
  edits: Record<string, { original: string; value: string }> = {}
) {
  const fields = competitorStudyFields(study, layout);
  const current = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      edits[key]?.original === value ? edits[key].value : value,
    ])
  );
  for (const target of richModuleTargets(layout, study?.richContent?.images))
    current[`module:${target.id}:sellingPoints`] = moduleSellingPoints(
      target,
      study,
      edits
    ).sellingPoints.join("、");
  return current;
}
