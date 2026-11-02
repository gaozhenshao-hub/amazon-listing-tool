import { describeStep5SegmentFailure, type Step5SegmentFailure } from "./step5SegmentFailure";

export type Step5AplusOutlineModule = { moduleNumber?: number | null };

export function findIncompleteStep5Segment(input: {
  mainSegment: any;
  secondarySegment: any;
  aplusModules: any[];
  outlineAplusModules: Step5AplusOutlineModule[];
  requiresBrandStory: boolean;
  brandStory: any;
}): Step5SegmentFailure | null {
  const mainImage = input.mainSegment?.mainImage;
  const hasText = (value: unknown) => typeof value === "string" && value.trim().length > 0;
  if (!mainImage || ![mainImage.concept, mainImage.composition, mainImage.primary, mainImage.shooting].every(hasText)) {
    return describeStep5SegmentFailure({ id: "main", group: "main" });
  }
  const secondaryImages = input.secondarySegment?.secondaryImages;
  if (!Array.isArray(secondaryImages) || secondaryImages.length < 5) {
    return describeStep5SegmentFailure({ id: "secondary", group: "secondary" });
  }
  if (secondaryImages.some((image: any) => ![
    image?.focus,
    image?.expression,
    image?.composition,
    image?.textOverlay,
  ].every(hasText))) {
    return describeStep5SegmentFailure({ id: "secondary", group: "secondary" });
  }
  const returnedAplusNumbers = new Set(input.aplusModules.map((module) => Number(module?.moduleNumber)).filter(Boolean));
  const missingAplusIndex = input.outlineAplusModules.findIndex((module, index) => !returnedAplusNumbers.has(Number(module?.moduleNumber || index + 1)));
  if (missingAplusIndex >= 0) {
    const moduleNumber = Number(input.outlineAplusModules[missingAplusIndex]?.moduleNumber || missingAplusIndex + 1);
    return describeStep5SegmentFailure({ id: `aplus_${moduleNumber}`, group: "aplus" });
  }
  if (input.requiresBrandStory && !input.brandStory) return describeStep5SegmentFailure({ id: "brand_story", group: "brand_story" });
  return null;
}
