type JsonRecord = Record<string, any>;

function asText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

function findReference(references: JsonRecord[], moduleNumber: number, subModuleNumber: number) {
  const target = `A+模块 ${moduleNumber}.${subModuleNumber}`;
  return references.find((reference) =>
    String(reference?.imageType || "").trim() === target
    || String(reference?.imageNumber || "").trim() === `${moduleNumber}.${subModuleNumber}`,
  );
}

function findModuleReference(references: JsonRecord[], moduleNumber: number) {
  return references.find((reference) =>
    String(reference?.imageType || "").trim() === `A+模块 ${moduleNumber}`
    || String(reference?.imageNumber || "").trim() === String(moduleNumber),
  );
}

/**
 * Step5 模型有时会保留父级多图模块，却遗漏 subModules。
 * 此处将已确认的Step2子图和Step4逐图参考回填到最终结果，确保每张子图始终可编辑、可追溯。
 */
export function enrichStep5AplusSubmodules(input: {
  result: JsonRecord;
  outline: JsonRecord;
  step4Snapshot: JsonRecord | null;
}) {
  const sections = Array.isArray(input.result?.aPlusContent?.sections)
    ? input.result.aPlusContent.sections
    : [];
  const sourceModules = Array.isArray(input.outline?.aPlusModules) ? input.outline.aPlusModules : [];
  const references = Array.isArray(input.step4Snapshot?.imageReferences) ? input.step4Snapshot.imageReferences : [];

  const nextSections = sourceModules.map((sourceModule: JsonRecord, index: number) => {
    const moduleNumber = Number(sourceModule?.moduleNumber || index + 1);
    const section = sections.find((candidate: JsonRecord) => Number(candidate?.moduleNumber) === moduleNumber)
      || sections[index]
      || {};
    const sourceSubModules = Array.isArray(sourceModule?.subModules) ? sourceModule.subModules : [];
    if (!sourceSubModules.length) {
      const reference = findModuleReference(references, moduleNumber);
      return {
        ...section,
        moduleNumber,
        title: section.title || sourceModule.title || `A+模块 ${moduleNumber}`,
        purpose: section.purpose || sourceModule.purpose || sourceModule.contentBrief || "",
        referenceImageKey: section.referenceImageKey || reference?.imageType || `A+模块 ${moduleNumber}`,
      };
    }
    const modelSubModules = Array.isArray(section?.subModules) ? section.subModules : [];
    const subModules = sourceSubModules.map((source: JsonRecord, subIndex: number) => {
      const subModuleNumber = Number(source?.subModuleNumber || subIndex + 1);
      const model = modelSubModules.find((item: JsonRecord) => Number(item?.subModuleNumber) === subModuleNumber) || {};
      const reference = findReference(references, moduleNumber, subModuleNumber);
      const composition = asText(model.composition)
        || asText(reference?.compositionPlan?.layout)
        || asText(reference?.compositionScheme?.layout)
        || asText(reference?.composition)
        || asText(source.contentBrief);
      const imageDescription = asText(model.imageDescription)
        || asText(model.designAdvice)
        || asText(reference?.effectPlan?.description)
        || asText(reference?.effectScheme?.visualEffects)
        || asText(reference?.effect)
        || asText(source.contentBrief);

      return {
        ...model,
        subModuleNumber,
        title: model.title || source.title || `子图 ${subModuleNumber}`,
        purpose: model.purpose || source.purpose || source.contentBrief || "",
        composition,
        imageDescription,
        referenceImageKey: model.referenceImageKey || reference?.imageType || `A+模块 ${moduleNumber}.${subModuleNumber}`,
        isLocked: Boolean(source.isLocked),
      };
    });

    return {
      ...section,
      subModules,
      moduleSpecificContent: {
        ...(section.moduleSpecificContent || {}),
        subImages: subModules,
      },
    };
  });

  const sourceBrandStory = input.outline?.brandStory || input.outline?.brandStoryModule || input.outline?.aPlusBrandStory;
  const brandReference = references.find((reference) => String(reference?.imageType || "").trim() === "品牌故事");
  const brandStory = sourceBrandStory && typeof sourceBrandStory === "object" ? {
    ...(input.result.brandStory || input.result?.aPlusContent?.brandStory || {}),
    title: input.result?.brandStory?.title || sourceBrandStory.title || "品牌故事",
    purpose: input.result?.brandStory?.purpose || sourceBrandStory.purpose || sourceBrandStory.story || "品牌故事与品牌价值展示",
    composition: input.result?.brandStory?.composition || brandReference?.compositionPlan?.layout || sourceBrandStory.contentBrief || "",
    imageDescription: input.result?.brandStory?.imageDescription || brandReference?.effectPlan?.description || sourceBrandStory.contentBrief || "",
    referenceImageKey: input.result?.brandStory?.referenceImageKey || brandReference?.imageType || "品牌故事",
  } : input.result.brandStory;

  return {
    ...input.result,
    ...(brandStory ? { brandStory } : {}),
    aPlusContent: {
      ...(input.result.aPlusContent || {}),
      sections: nextSections,
    },
  };
}
