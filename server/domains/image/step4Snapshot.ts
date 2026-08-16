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
