export function claimLazyRecovery(storage: Storage, recoveryKey: string) {
  if (storage.getItem(recoveryKey)) {
    storage.removeItem(recoveryKey);
    return false;
  }
  storage.setItem(recoveryKey, "1");
  return true;
}
