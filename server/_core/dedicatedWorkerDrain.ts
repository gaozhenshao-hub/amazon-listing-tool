/** Attach rejection observers before any unrelated shutdown/status await.
 * The returned original aggregate still rejects; the caller must await it and
 * mark shutdown unhealthy rather than report a timed-out cleanup as stopped. */
export function observeDedicatedWorkerDrains(drains: readonly (void | Promise<unknown>)[]) {
  const settled = Promise.all(drains);
  void settled.catch(() => undefined);
  return settled;
}
