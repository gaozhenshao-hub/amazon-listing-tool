/**
 * Lingxing API Adapter - DEPRECATED
 * All data is now imported via Excel uploads.
 * This minimal stub exists only for backward compatibility with test mocks.
 */
import { failUnavailableDataSource } from "@shared/_core/errors";

class LingxingAdapter {
  async request(_opts: any): Promise<any> {
    return failUnavailableDataSource("Lingxing ERP", {
      replacementProcedure: "dataImport.uploadAndParse",
    });
  }

  async requestWithMockFallback(_opts: any): Promise<any> {
    return failUnavailableDataSource("Lingxing ERP", {
      replacementProcedure: "dataImport.uploadAndParse",
    });
  }

  isMockMode() { return false; }
  isReady() { return false; }
}

const stub = new LingxingAdapter();
export function getLingxingAdapter() { return stub; }
export function initLingxingAdapterFromDb() {}
export { LingxingAdapter };
