import { createHash } from "node:crypto";
import { createProductTaskLocalStorage } from "./productTaskLocalStorage";
import { z } from "zod";
import { ENV } from "../../_core/env";
import { assertPrivateEvidenceStorageAvailable, getActiveStorageProvider, storageGet, storagePut } from "../../storage";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";
import { ProductTaskWriteExecuteInputSchema, ProductTaskWriteIdentitySchema, PRODUCT_TASK_ATTACHMENT_EXTENSIONS, type ProductTaskWriteExecuteInput, type ProductTaskWriteIdentity } from "../../../shared/productTaskWrite";
import { decodeProductTaskAttachment, productTaskOperationKey, productTaskOperationRequestHash, ProductTaskPreparedUploadSchema, type ProductTaskPreparedUpload } from "./productTaskOperationJournal";

export class ProductTaskAttachmentStorageError extends Error { constructor(public readonly code: string) { super(code); this.name = "ProductTaskAttachmentStorageError"; } }
const fail = (code: string): never => { throw new ProductTaskAttachmentStorageError(code); };
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const PRODUCT_TASK_DOWNLOAD_TTL_SECONDS = 60;
const defaults = {
  local: createProductTaskLocalStorage(),
  assertPrivate: assertPrivateEvidenceStorageAvailable,
  provider: getActiveStorageProvider,
  configured: () => Boolean(ENV.s3Region.trim() && ENV.s3Bucket.trim() && ENV.s3AccessKeyId.trim() && ENV.s3SecretAccessKey.trim()),
  put: storagePut,
  get: storageGet,
  request: safeHttpRequest,
};
function safeDownloadUrl(value: string) {
  let url: URL; try { url = new URL(value); } catch { return fail("TASK_ATTACHMENT_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443") return fail("TASK_ATTACHMENT_URL_INVALID");
  return url;
}

/** No object deletion, public URL fallback, automatic PUT retry or provider
 * migration. Callers own task authorization and the durable prepare/final fence. */
export function createProductTaskAttachmentStorage(dependencies: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...dependencies };
  function assertAvailable(): "s3" | "oss" | "local" {
    if (deps.provider() === "local") {
      try { deps.local.configuration(); return "local"; } catch { return fail("TASK_ATTACHMENT_STORAGE_UNAVAILABLE"); }
    }
    try { deps.assertPrivate(); const provider = deps.provider(); if ((provider !== "s3" && provider !== "oss") || !deps.configured()) return fail("TASK_ATTACHMENT_STORAGE_UNAVAILABLE"); return provider; }
    catch { return fail("TASK_ATTACHMENT_STORAGE_UNAVAILABLE"); }
  }
  function capability(): { status: "available" | "unavailable"; reasonCode: string | null } {
    try { assertAvailable(); return { status: "available", reasonCode: null }; } catch { return { status: "unavailable", reasonCode: "private_attachment_storage_unavailable" }; }
  }
  function check(prepared: ProductTaskPreparedUpload) {
    const value = ProductTaskPreparedUploadSchema.parse(prepared);
    if (value.provider !== assertAvailable()) return fail("TASK_ATTACHMENT_PROVIDER_CHANGED");
    if (value.provider === "local" && value.domainHash !== deps.local.configuration().domainHash) return fail("TASK_ATTACHMENT_PROVIDER_CHANGED");
    return value;
  }
  function plan(rawIdentity: ProductTaskWriteIdentity, rawCommand: Extract<ProductTaskWriteExecuteInput, { action: "upload" }>) {
    const identity = ProductTaskWriteIdentitySchema.parse(rawIdentity), command = ProductTaskWriteExecuteInputSchema.parse(rawCommand);
    if (command.action !== "upload" || command.expectedWorkspaceId !== identity.workspaceId) return fail("TASK_ATTACHMENT_SCOPE_INVALID");
    const bytes = decodeProductTaskAttachment(command.base64), provider = assertAvailable();
    const domainHash = provider === "local" ? deps.local.configuration().domainHash : undefined;
    const localPrefix = domainHash ? `${domainHash}-${digest(bytes)}-${bytes.length}-` : "";
    const objectKey = `ops-tasks/${identity.workspaceId}/${command.taskId}/${localPrefix}${productTaskOperationKey(identity, command.operationId)}.${command.name.split(".").at(-1)!.toLowerCase()}`;
    const prepared = ProductTaskPreparedUploadSchema.parse({ identity, operationId: command.operationId, action: "upload", requestHash: productTaskOperationRequestHash(command), taskId: command.taskId, expectedVersion: command.expectedVersion, name: command.name, byteSize: bytes.length, contentHash: digest(bytes), provider, ...(domainHash ? { domainHash } : {}), objectKey, storageUri: `storage://${provider}/${objectKey}` });
    return { prepared, bytes };
  }
  async function putOnce(raw: ProductTaskPreparedUpload, bytes: Buffer): Promise<void> {
    const prepared = check(raw);
    if (!Buffer.isBuffer(bytes) || bytes.length !== prepared.byteSize || digest(bytes) !== prepared.contentHash) return fail("TASK_ATTACHMENT_CONTENT_MISMATCH");
    try {
      if (prepared.provider === "local") { await deps.local.put(prepared.objectKey, bytes); check(prepared); return; }
      const stored = await deps.put(prepared.objectKey, bytes, "application/octet-stream");
      if (stored.key !== prepared.objectKey || stored.storageUri !== prepared.storageUri || deps.provider() !== prepared.provider) return fail("TASK_ATTACHMENT_PUT_UNCONFIRMED");
    } catch { return fail("TASK_ATTACHMENT_PUT_UNCONFIRMED"); }
  }
  async function verify(raw: ProductTaskPreparedUpload): Promise<void> {
    const prepared = check(raw);
    try {
      if (prepared.provider === "local") { await deps.local.read(prepared.objectKey); check(prepared); return; }
      const signed = await deps.get(prepared.objectKey, { expectedProvider: prepared.provider, expiresSeconds: PRODUCT_TASK_DOWNLOAD_TTL_SECONDS });
      if (signed.key !== prepared.objectKey) return fail("TASK_ATTACHMENT_OBJECT_UNVERIFIED");
      const url = safeDownloadUrl(signed.url);
      const response = await deps.request(url, { method: "GET", allowedHosts: [url.hostname], maxRedirects: 0, maxResponseBytes: prepared.byteSize, timeoutMs: 30000, auditContext: { workspaceId: prepared.identity.workspaceId, operation: "task.attachment.verify" } });
      if (!response.ok || response.status !== 200 || !Buffer.isBuffer(response.body) || response.body.length !== prepared.byteSize || digest(response.body) !== prepared.contentHash || deps.provider() !== prepared.provider) return fail("TASK_ATTACHMENT_OBJECT_UNVERIFIED");
    } catch { return fail("TASK_ATTACHMENT_OBJECT_UNVERIFIED"); }
  }
  async function download(input: { workspaceId: number; taskId: number; storageUri: string }): Promise<{ url: string; expiresSeconds: number } | { base64: string; byteSize: number; contentHash: string }> {
    const scope = z.object({ workspaceId: z.number().int().positive().max(2147483647), taskId: z.number().int().positive().max(2147483647), storageUri: z.string().min(1).max(400) }).strict().parse(input), provider = assertAvailable();
    const prefix = `storage://${provider}/ops-tasks/${scope.workspaceId}/${scope.taskId}/`;
    if (!scope.storageUri.startsWith(prefix)) return fail("TASK_ATTACHMENT_REFERENCE_INVALID");
    const basename = scope.storageUri.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/u.test(basename) || !PRODUCT_TASK_ATTACHMENT_EXTENSIONS.test(basename)) return fail("TASK_ATTACHMENT_REFERENCE_INVALID");
    const key = scope.storageUri.slice(`storage://${provider}/`.length);
    try {
      if (provider === "local") {
        const bytes = await deps.local.read(key);
        if (deps.provider() !== provider) return fail("TASK_ATTACHMENT_PROVIDER_CHANGED");
        return { base64: bytes.toString("base64"), byteSize: bytes.length, contentHash: digest(bytes) };
      }
      const signed = await deps.get(key, { expectedProvider: provider, expiresSeconds: PRODUCT_TASK_DOWNLOAD_TTL_SECONDS });
      if (signed.key !== key || deps.provider() !== provider) return fail("TASK_ATTACHMENT_DOWNLOAD_UNAVAILABLE");
      safeDownloadUrl(signed.url); return { url: signed.url, expiresSeconds: PRODUCT_TASK_DOWNLOAD_TTL_SECONDS };
    } catch { return fail("TASK_ATTACHMENT_DOWNLOAD_UNAVAILABLE"); }
  }
  return { capability, assertAvailable, plan, putOnce, verify, download };
}
export const productTaskAttachmentStorage = createProductTaskAttachmentStorage();
