/**
 * Lingxing API Adapter - DEPRECATED
 * All data is now imported via Excel uploads.
 * This minimal stub exists only for backward compatibility with test mocks.
 */

class LingxingAdapter {
  async request(_opts: any) { return { code: "200", data: {} }; }
  async requestWithMockFallback(_opts: any) { return { code: "200", data: {} }; }
  isMockMode() { return true; }
  isReady() { return false; }
}

const stub = new LingxingAdapter();
export function getLingxingAdapter() { return stub; }
export function initLingxingAdapterFromDb() {}
export { LingxingAdapter };
