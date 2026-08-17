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
