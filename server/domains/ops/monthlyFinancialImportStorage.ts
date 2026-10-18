import { createHash } from "node:crypto";
import { ENV } from "../../_core/env";
import { assertPrivateEvidenceStorageAvailable, getActiveStorageProvider, storageGet, storagePut } from "../../storage";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";
import { MonthlyFinancialPreparedUploadSchema, monthlyFinancialOperationKey, type MonthlyFinancialPreparedUpload } from "./monthlyFinancialOperationJournal";

export class MonthlyFinancialImportStorageError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "MonthlyFinancialImportStorageError"; }
}
const fail = (code: string): never => { throw new MonthlyFinancialImportStorageError(code); };
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const MONTHLY_FINANCIAL_DOWNLOAD_TTL_SECONDS = 60;
const defaults = {
  assertPrivate: assertPrivateEvidenceStorageAvailable,
  provider: getActiveStorageProvider,
  configured: () => Boolean(ENV.s3Region.trim() && ENV.s3Bucket.trim() && ENV.s3AccessKeyId.trim() && ENV.s3SecretAccessKey.trim()),
  put: storagePut,
  get: storageGet,
  request: safeHttpRequest,
};
function safeDownloadUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { return fail("MONTHLY_STORAGE_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443") return fail("MONTHLY_STORAGE_URL_INVALID");
  return url;
}

/** This adapter does not authorize a user or commit a batch. The repository
 * must persist prepare before PUT, and commit the batch, artifact and receipt
 * under its cancellation fence. No retries, deletion or public URL fallback. */
export function createMonthlyFinancialImportStorage(dependencies: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...dependencies };
  function assertAvailable(): "s3" | "oss" {
    try {
      deps.assertPrivate();
      const provider = deps.provider();
      if ((provider !== "s3" && provider !== "oss") || !deps.configured()) return fail("MONTHLY_STORAGE_UNAVAILABLE");
      return provider;
    } catch { return fail("MONTHLY_STORAGE_UNAVAILABLE"); }
  }
  function capability(): { status: "available" | "unavailable"; reasonCode: string | null } {
    try { assertAvailable(); return { status: "available", reasonCode: null }; }
    catch { return { status: "unavailable", reasonCode: "private_monthly_storage_unavailable" }; }
  }
  function check(raw: MonthlyFinancialPreparedUpload): MonthlyFinancialPreparedUpload {
    const value = MonthlyFinancialPreparedUploadSchema.parse(raw);
    if (value.provider !== assertAvailable()) return fail("MONTHLY_STORAGE_PROVIDER_CHANGED");
    return value;
  }
  function prepare(identity: { userId: number; workspaceId: number }, operationId: string,
    metadata: { fileName: string; format: "xlsx" | "csv"; fileHash: string; byteSize: number; requestHash: string }): MonthlyFinancialPreparedUpload {
    const provider = assertAvailable();
    const objectKey = `monthly-financial/${identity.workspaceId}/${monthlyFinancialOperationKey(identity, operationId)}.${metadata.format}`;
    return MonthlyFinancialPreparedUploadSchema.parse({ ...metadata, identity, operationId, action: "upload", parserVersion: "monthly-financial-import-v1", provider, objectKey, storageUri: `storage://${provider}/${objectKey}` });
  }
  async function putOnce(raw: MonthlyFinancialPreparedUpload, bytes: Uint8Array): Promise<void> {
    const prepared = check(raw);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== prepared.byteSize || digest(bytes) !== prepared.fileHash) return fail("MONTHLY_STORAGE_CONTENT_MISMATCH");
    try {
      const contentType = prepared.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const stored = await deps.put(prepared.objectKey, Buffer.from(bytes), contentType, { maxAttempts: 1 });
      if (stored.key !== prepared.objectKey || stored.storageUri !== prepared.storageUri || deps.provider() !== prepared.provider) return fail("MONTHLY_STORAGE_PUT_UNCONFIRMED");
    } catch { return fail("MONTHLY_STORAGE_PUT_UNCONFIRMED"); }
  }
  /** Unknown uploads are resolved by this bounded GET, never another PUT.
   * A missing object is not proof that a concurrent request cannot finish. */
  async function readVerified(raw: MonthlyFinancialPreparedUpload): Promise<Uint8Array> {
    const prepared = check(raw);
    try {
      const signed = await deps.get(prepared.objectKey, { expectedProvider: prepared.provider, expiresSeconds: MONTHLY_FINANCIAL_DOWNLOAD_TTL_SECONDS });
      if (signed.key !== prepared.objectKey) return fail("MONTHLY_STORAGE_OBJECT_UNVERIFIED");
      const url = safeDownloadUrl(signed.url);
      const response = await deps.request(url, { method: "GET", allowedHosts: [url.hostname], maxRedirects: 0, maxResponseBytes: prepared.byteSize, timeoutMs: 30000,
        auditContext: { workspaceId: prepared.identity.workspaceId, operation: "monthly.import.verify" } });
      if (!response.ok || response.status !== 200 || !Buffer.isBuffer(response.body) || response.body.length !== prepared.byteSize || digest(response.body) !== prepared.fileHash || deps.provider() !== prepared.provider) return fail("MONTHLY_STORAGE_OBJECT_UNVERIFIED");
      return Uint8Array.from(response.body);
    } catch { return fail("MONTHLY_STORAGE_OBJECT_UNVERIFIED"); }
  }
  /** Only pass the persisted prepared record after current workspace, actor
   * and batch authorization. An arbitrary legacy fileUrl is never accepted. */
  async function download(raw: MonthlyFinancialPreparedUpload): Promise<{ url: string; expiresSeconds: number }> {
    const prepared = check(raw);
    try {
      const signed = await deps.get(prepared.objectKey, { expectedProvider: prepared.provider, expiresSeconds: MONTHLY_FINANCIAL_DOWNLOAD_TTL_SECONDS });
      if (signed.key !== prepared.objectKey || deps.provider() !== prepared.provider) return fail("MONTHLY_STORAGE_DOWNLOAD_UNAVAILABLE");
      safeDownloadUrl(signed.url);
      return { url: signed.url, expiresSeconds: MONTHLY_FINANCIAL_DOWNLOAD_TTL_SECONDS };
    } catch { return fail("MONTHLY_STORAGE_DOWNLOAD_UNAVAILABLE"); }
  }
  return { assertAvailable, capability, prepare, putOnce, readVerified, download };
}
export const monthlyFinancialImportStorage = createMonthlyFinancialImportStorage();
