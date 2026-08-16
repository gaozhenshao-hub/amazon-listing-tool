export type Step5SegmentFailureInput = {
  id: string;
  group: "main" | "secondary" | "aplus" | "brand_story" | "merge";
};

export type Step5SegmentFailure = {
  group: string;
  module: string | null;
};

export function describeStep5SegmentFailure(segment?: Step5SegmentFailureInput | null): Step5SegmentFailure {
  if (!segment) return { group: "unknown", module: null };
  if (segment.id.startsWith("aplus_")) {
    return { group: segment.group, module: segment.id.replace("aplus_", "A+ ") };
  }
  if (segment.id === "brand_story") return { group: segment.group, module: "品牌故事" };
  return { group: segment.group, module: null };
}
