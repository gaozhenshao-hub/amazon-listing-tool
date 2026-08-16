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
    kbReferenceImages: target.kbReferenceImages,
  };
  const nextReferences = [...imageReferences];
  nextReferences[imageIndex] = merged;
  return { ...snapshot, imageReferences: nextReferences };
}
