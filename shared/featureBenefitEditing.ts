import { RESEARCH_CATEGORIES, type ResearchCategory } from "./researchCategories";
import type {
  ListingAggregation,
  AggregationFeature,
  AggregationBenefit,
} from "./listingAggregation";
import { aggregationConceptKey } from "./listingAggregation";
export type GraphSide = "feature" | "benefit";
export type GraphNode = AggregationFeature | AggregationBenefit;
export const graphPlanned=(node:GraphNode)=>node.availability==="planned" || node.group==="improve";
export function benefitPriority(node:GraphNode):"primary"|"secondary"|"necessary" {
  if(["primary","secondary","necessary"].includes(node.group))return node.group as "primary"|"secondary"|"necessary";
  if(node.group==="information" || node.category==="information")return "necessary";
  return "secondary";
}
export function editGraphNode(
  data: ListingAggregation,
  side: GraphSide,
  node: GraphNode
) {
  return side === "feature"
    ? {
        ...data,
        features: (data.features || []).map(n =>
          n.id === node.id
            ? ({ ...node, manual: true } as AggregationFeature)
            : n
        ),
      }
    : {
        ...data,
        selling: data.selling.map(n =>
          n.id === node.id
            ? ({ ...node, manual: true } as AggregationBenefit)
            : n
        ),
      };
}
export function removeGraphNode(
  data: ListingAggregation,
  side: GraphSide,
  id: string
): ListingAggregation {
  const node = (side === "feature" ? data.features || [] : data.selling).find(
    n => n.id === id
  );
  return {
    ...data,
    excludedConcepts: [...(data.excludedConcepts || []), ...(node?[{id:node.id,kind:side==="feature"?"features" as const:"selling" as const,text:node.text,sourceKey:node.sourceKey||aggregationConceptKey(side==="feature"?"features":"selling",node.text)}]:[])],
    excludedSourceKeys: [
      ...new Set([
        ...(data.excludedSourceKeys || []),
        ...(node
          ? [
              node.sourceKey ||
                aggregationConceptKey(
                  side === "feature" ? "features" : "selling",
                  node.text
                ),
            ]
          : []),
      ]),
    ],
    ...(side === "feature"
      ? { features: (data.features || []).filter(n => n.id !== id) }
      : { selling: data.selling.filter(n => n.id !== id) }),
    links: (data.links || []).filter(l =>
      side === "feature" ? l.featureId !== id : l.benefitId !== id
    ),
  };
}
export function moveGraphNode(
  data: ListingAggregation,
  side: GraphSide,
  id: string,
  group: string,
  before?: string
): ListingAggregation {
  const key = side === "feature" ? "features" : "selling",
    items = (data[key] || []) as GraphNode[],
    item = items.find(n => n.id === id);
  if (!item || id === before) return data;
  const next = items.filter(n => n.id !== id),
    index = before ? next.findIndex(n => n.id === before) : -1;
  next.splice(index < 0 ? next.length : index, 0, {
    ...item,
    differentiated:item.differentiated ?? item.group==="differentiated",
    ...(group==="improve"?{availability:"planned" as const}:RESEARCH_CATEGORIES.includes(group as ResearchCategory)?{category:group as ResearchCategory,availability:"current" as const,...(side==="feature"?{group:({core:"quality",design:"design",details:"detail",information:"information"} as const)[group as ResearchCategory]}:{})}:{group,availability:"current" as const}),
    manual: true,
  } as GraphNode);
  return { ...data, [key]: next };
}
