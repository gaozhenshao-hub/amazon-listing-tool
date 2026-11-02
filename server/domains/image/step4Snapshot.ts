export function compactStep4ReferenceForStorage(reference: Record<string, any>, forceLocked = false) {
  const source = reference?.lockedSnapshot && typeof reference.lockedSnapshot === "object"
    ? reference.lockedSnapshot
    : reference || {};
  const { lockedSnapshot: _lockedSnapshot, isLocked: _isLocked, lockedAt: sourceLockedAt, ...content } = source;
  const lockedAt = reference?.lockedAt || sourceLockedAt;

  return forceLocked
    ? { ...content, isLocked: true, ...(lockedAt ? { lockedAt } : {}) }
    : { ...content, ...(reference?.isLocked ? { isLocked: true } : {}), ...(lockedAt ? { lockedAt } : {}) };
}

export function compactStep4SnapshotForStorage(snapshot: Record<string, any>, forceLocked = false) {
  return {
    ...snapshot,
    imageReferences: Array.isArray(snapshot?.imageReferences)
      ? snapshot.imageReferences.map((reference: Record<string, any>) => compactStep4ReferenceForStorage(reference, forceLocked))
      : [],
  };
}

function referenceIdentity(reference: Record<string, any>, index: number) {
  return String(
    reference?.imageKey
    || `${reference?.imageType || "image"}:${reference?.parentModuleNumber ?? ""}:${reference?.subModuleNumber ?? ""}:${reference?.imageNumber ?? index}`,
  );
}

/** 解锁时以最新AI方案为内容基准，仅保留用户上传的本地参考资产与备注。 */
export function mergeStep4LatestWithUserAssets(confirmedRaw: unknown, latestRaw: unknown) {
  const confirmed = confirmedRaw && typeof confirmedRaw === "object" ? confirmedRaw as Record<string, any> : null;
  const latest = latestRaw && typeof latestRaw === "object" ? latestRaw as Record<string, any> : null;
  if (!confirmed && !latest) return null;
  if (!confirmed) return latest;
  if (!latest) return confirmed;

  const confirmedRefs: any[] = Array.isArray(confirmed.imageReferences) ? confirmed.imageReferences : [];
  const latestRefs: any[] = Array.isArray(latest.imageReferences) ? latest.imageReferences : [];
  const confirmedByKey = new Map(confirmedRefs.map((reference, index) => [referenceIdentity(reference, index), reference]));
  return {
    ...confirmed,
    ...latest,
    imageReferences: latestRefs.map((latestReference, index) => {
      const confirmedReference = confirmedByKey.get(referenceIdentity(latestReference, index)) || confirmedRefs[index] || {};
      return {
        ...latestReference,
        compositionRefImageUrl: confirmedReference.compositionRefImageUrl || latestReference.compositionRefImageUrl,
        effectRefImageUrl: confirmedReference.effectRefImageUrl || latestReference.effectRefImageUrl,
        compositionRefNote: confirmedReference.compositionRefNote || latestReference.compositionRefNote,
        effectRefNote: confirmedReference.effectRefNote || latestReference.effectRefNote,
        kbReferenceImages: confirmedReference.kbReferenceImages || latestReference.kbReferenceImages,
      };
    }),
  };
}

/** 从AI Job的output或其result封装中取得可用于Step4解锁的完整参考方案。 */
export function extractLatestStep4JobResult(outputRaw: unknown) {
  let output = outputRaw;
  if (typeof output === "string") {
    try { output = JSON.parse(output); } catch { return null; }
  }
  if (!output || typeof output !== "object") return null;
  const result = (output as Record<string, any>).result && typeof (output as Record<string, any>).result === "object"
    ? (output as Record<string, any>).result
    : output as Record<string, any>;
  return Array.isArray((result as Record<string, any>).imageReferences) ? result : null;
}

/**
 * 单图重新生成只能替换目标索引；其余参考图和用户上传的参考资产必须原样保留。
 */
export function mergeSingleStep4Reference(snapshot: Record<string, any>, imageIndex: number, generated: Record<string, any>) {
  const imageReferences = Array.isArray(snapshot?.imageReferences) ? snapshot.imageReferences : [];
  const target = imageReferences[imageIndex];
  if (!target) throw new Error(`Image at index ${imageIndex} not found`);

  const merged = {
    ...generated,
    imageKey: target.imageKey || generated.imageKey,
    imageNumber: target.imageNumber ?? generated.imageNumber ?? imageIndex + 1,
    imageType: target.imageType ?? generated.imageType,
    purpose: target.purpose ?? generated.purpose,
    parentModuleNumber: target.parentModuleNumber ?? generated.parentModuleNumber ?? null,
    subModuleNumber: target.subModuleNumber ?? generated.subModuleNumber ?? null,
    compositionRefImageUrl: target.compositionRefImageUrl,
    effectRefImageUrl: target.effectRefImageUrl,
    compositionRefNote: target.compositionRefNote,
    effectRefNote: target.effectRefNote,
    kbReferenceImages: target.kbReferenceImages,
  };
  const nextReferences = [...imageReferences];
  nextReferences[imageIndex] = merged;
  return { ...snapshot, imageReferences: nextReferences };
}

/**
 * 整体确认只汇总每张图的当前确认版本，避免页面草稿或历史AI结果覆盖逐图锁定内容。
 */
export function buildStep4ConfirmedSnapshot(
  requestedSnapshot: Record<string, any> | null,
  confirmedByIndex: Map<number, Record<string, any> | null>,
) {
  const requestedRefs = requestedSnapshot?.imageReferences;
  if (!Array.isArray(requestedRefs) || requestedRefs.length === 0) {
    throw new Error("Step4 确认数据缺少图片参考方案");
  }
  if (requestedRefs.some((_: unknown, index: number) => !confirmedByIndex.get(index))) {
    throw new Error("请先逐图点击“确认此图”，整体确认只会发布独立确认版本");
  }
  return {
    ...requestedSnapshot,
    imageReferences: requestedRefs.map((_: unknown, index: number) =>
      compactStep4ReferenceForStorage(confirmedByIndex.get(index) as Record<string, any>, true),
    ),
  };
}
