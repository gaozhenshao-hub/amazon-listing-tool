export function clearStep4ReferenceLock(reference: unknown): Record<string, unknown> {
  const source = reference && typeof reference === "object" ? reference as Record<string, unknown> : {};
  const {
    isLocked: _isLocked,
    lockedSnapshot: _lockedSnapshot,
    lockedAt: _lockedAt,
    ...unlockedReference
  } = source;

  return { ...unlockedReference, isLocked: false };
}

export function clearStep4ReferenceLocks(references: unknown[]): Array<Record<string, unknown>> {
  return references.map(clearStep4ReferenceLock);
}
