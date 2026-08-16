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

  const nextSections = sections.map((section: JsonRecord, index: number) => {
    const sourceModule = sourceModules[index];
    const sourceSubModules = Array.isArray(sourceModule?.subModules) ? sourceModule.subModules : [];
    if (!sourceSubModules.length) return section;

    const moduleNumber = Number(sourceModule?.moduleNumber || index + 1);
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

  return {
    ...input.result,
    aPlusContent: {
      ...(input.result.aPlusContent || {}),
      sections: nextSections,
    },
  };
}
