export function canRepairFailedMigrationChecksum(
  existing,
  nextChecksum,
  retryFailed,
) {
  if (!existing || existing.checksum === nextChecksum) return false;
  return existing.status === "failed" && retryFailed === true;
}
