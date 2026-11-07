import {
  aggregationConceptKey,
  type ListingAggregation,
} from "./listingAggregation";
import type { ResearchPage } from "./researchCategories";
import { isNewQuestionMerge } from "./questionMerging";
const editable = [
  "text",
  "note",
  "group",
  "category",
  "badges",
  "comparisonScope",
  "position",
  "status",
  "answer",
  "differentiated",
  "availability",
];
/** Called only by an explicit human save/confirmation, never by generation. */
export function recordManualResearch(
  previous: ListingAggregation,
  incoming: ListingAggregation
): ListingAggregation {
  const next = structuredClone(incoming);
  for (const kind of ["features", "selling", "reviews", "questions"] as const) {
    const old = previous[kind] || [];
    for (const item of next[kind] || []) {
      const before = old.find(n => n.id === item.id);
      const fields = editable.filter(
        field =>
          !before ||
          JSON.stringify((before as any)[field]) !==
            JSON.stringify((item as any)[field])
      );
      if (fields.length)
        Object.assign(item, {
          manual: true,
          manualFields: [
            ...new Set([
              ...(before?.manualFields || []),
              ...(item.manualFields || []),
              ...fields,
            ]),
          ],
          manualChangedAt: new Date().toISOString(),
        });
      else if (before?.manual)
        Object.assign(item, {
          manual: true,
          manualFields: before.manualFields,
          manualChangedAt: before.manualChangedAt,
        });
    }
    for (const removed of old.filter(
      n => !(next[kind] || []).some(i => i.id === n.id)
    )) {
      next.excludedSourceKeys = [
        ...new Set([
          ...(next.excludedSourceKeys || []),
          removed.sourceKey ||
            aggregationConceptKey(
              kind,
              removed.text,
              "sentiment" in removed ? String(removed.sentiment) : ""
            ),
        ]),
      ];
      next.excludedConcepts = [
        ...(next.excludedConcepts || []).filter(n => n.id !== removed.id),
        {
          id: removed.id,
          kind,
          text: removed.text,
          sourceKey:
            removed.sourceKey || aggregationConceptKey(kind, removed.text),
        },
      ];
    }
  }
  return next;
}
export function researchPageChanged(
  previous: ListingAggregation,
  next: ListingAggregation,
  page: ResearchPage
) {
  const keys =
    page === "selling"
      ? ["features", "selling", "links", "productNotes", "excludedLinks"]
      : page === "reviews"
        ? ["reviews", "reviewSummary", "reviewHistory"]
        : page === "questions"
          ? ["questions"]
          : [];
  const kinds = page === "selling" ? ["features", "selling"] : [page];
  const excluded = (data: ListingAggregation) => [
    data.excludedConcepts?.filter(n => kinds.includes(n.kind)) || [],
    data.excludedSourceKeys?.filter(key =>
      kinds.some(kind => key.startsWith(kind + ":"))
    ) || [],
    data.organized?.[page as "selling" | "reviews" | "questions"],
  ];
  return (
    keys.some(
      k =>
        JSON.stringify((previous as any)[k]) !==
        JSON.stringify((next as any)[k])
    ) || JSON.stringify(excluded(previous)) !== JSON.stringify(excluded(next))
  );
}

/** Accept one research preview against the latest record. Other pages and
 * managed uploads/chat/locks keep their latest values, independent of timing. */
export function mergeResearchProposal(
  current: ListingAggregation,
  proposal: ListingAggregation,
  section: "selling" | "reviews" | "questions"
): ListingAggregation {
  const next = structuredClone(current);
  const kinds =
    section === "selling"
      ? ["features", "selling", "links"]
      : section === "reviews"
        ? ["reviews", "reviewSummary", "reviewHistory"]
        : ["questions"];
  for (const key of kinds)
    (next as any)[key] = structuredClone((proposal as any)[key]);
  if(section==="questions")next.questionMergeBase=proposal.questionMergeBase;
  next.organized = { ...current.organized, [section]: true };
  if(section==="reviews")next.reviews=next.reviews.map(r=>r.status==="unset" && !current.reviews.find(old=>old.id===r.id)?.manual ? {...r,status:r.sentiment==="positive"?"covered":"solved"} : r);
  for (const kind of ["features", "selling", "reviews", "questions"] as const) {
    if (!next[kind]) continue;
    (next as any)[kind] = next[kind]!.filter(
      n =>
        !current.excludedConcepts?.some(e => e.id === n.id) &&
        !current.excludedSourceKeys?.includes(
          n.sourceKey ||
            aggregationConceptKey(
              kind,
              n.text,
              "sentiment" in n ? String(n.sentiment) : ""
            )
        )
    );
  }
  const features = new Set(next.features?.map(n => n.id)),
    benefits = new Set(next.selling.map(n => n.id));
  next.links = next.links?.filter(
    l =>
      features.has(l.featureId) &&
      benefits.has(l.benefitId) &&
      !current.excludedLinks?.includes(l.featureId + ":" + l.benefitId)
  );
  return next;
}

export function preserveManualResearch(
  current: ListingAggregation,
  proposal: ListingAggregation
): ListingAggregation {
  const next = structuredClone(proposal);
  for (const kind of ["features", "selling", "reviews", "questions"] as const) {
    const items = (next[kind] || []) as any[],
      before = current[kind] || [];
    for (const old of before)
      if (old.manual) {
        const at = items.findIndex(n => n.id === old.id);
        if (at < 0) {
          if(kind==="questions" && items.some(n=>isNewQuestionMerge(n) && n.mergedQuestionIds?.includes(old.id)))continue;
          items.push(structuredClone(old));
          continue;
        }
        for (const field of old.manualFields?.length
          ? old.manualFields
          : editable) {
          if(kind==="questions" && isNewQuestionMerge(items[at]) && ["text","note","answer"].includes(field))continue;
          if (field === "answer" && !(old as any).answer?.trim()) continue;
          if (field in old)
            items[at][field] = structuredClone((old as any)[field]);
        }
        Object.assign(items[at], {
          manual: true,
          manualFields: kind==="questions" && isNewQuestionMerge(items[at]) ? [...new Set([...(items[at].manualFields || []),...(old.manualFields || [])])] : old.manualFields,
          manualChangedAt: old.manualChangedAt,
        });
      }
    if (next[kind] || items.length) {
      const order = new Map(before.map((n, index) => [n.id, index]));
      items.sort(
        (a, b) =>
          (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      );
      (next as any)[kind] = items;
    }
  }
  for (const link of current.links || [])
    if (link.manual) {
      const index = next.links?.findIndex(n => n.id === link.id) ?? -1;
      if (index < 0)
        next.links = [...(next.links || []), structuredClone(link)];
      else next.links![index] = structuredClone(link);
    }
  next.excludedConcepts = current.excludedConcepts;
  next.excludedSourceKeys = current.excludedSourceKeys;
  next.excludedLinks = current.excludedLinks;
  return next;
}

export function sellingExclusions(data: ListingAggregation, preserve: boolean) {
  if (preserve) return data;
  return {
    ...data,
    excludedConcepts: data.excludedConcepts?.filter(
      item => item.kind !== "features" && item.kind !== "selling"
    ),
    excludedSourceKeys: data.excludedSourceKeys?.filter(
      key => !key.startsWith("features:") && !key.startsWith("selling:")
    ),
    excludedLinks: [],
  };
}

/** Replace the reviewed selling section without altering other sections. */
export function adoptSellingProposal(
  current: ListingAggregation,
  proposal: ListingAggregation,
  preserve: boolean
): ListingAggregation {
  return {
    ...sellingExclusions(current, preserve),
    features: proposal.features,
    selling: proposal.selling,
    links: proposal.links,
    organized: { ...current.organized, selling: true },
  };
}
