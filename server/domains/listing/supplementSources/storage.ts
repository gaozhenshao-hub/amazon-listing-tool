import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ENV } from "../../../_core/env";
import {
  assertPrivateEvidenceStorageAvailable,
  getActiveStorageProvider,
  storagePut,
  storageGet,
} from "../../../storage";
import {
  safeHttpRequest,
  type SafeHttpRequestOptions,
  type SafeHttpResponse,
} from "../../../infrastructure/http/safeHttpClient";
import {
  supplementHash,
  type SupplementIdentity,
  type SupplementScope,
  type SupplementOriginalMetadata,
} from "../../../../shared/listingSupplementSources";
import {
  SupplementStoredOriginalSchema,
  supplementOperationKey,
  supplementBytesHash,
  supplementFail,
  type SupplementStoredOriginal,
} from "./protocol";
const defaults = {
  assertPrivate: assertPrivateEvidenceStorageAvailable,
  provider: getActiveStorageProvider,
  configuration: () => ({
    region: ENV.s3Region,
    bucket: ENV.s3Bucket,
    endpoint: ENV.s3Endpoint,
    forcePathStyle: ENV.s3ForcePathStyle,
    accessKeyId: ENV.s3AccessKeyId,
    secretAccessKey: ENV.s3SecretAccessKey,
  }),
  put: storagePut,
  get: storageGet,
  request: safeHttpRequest,
  remove: async (key: string) => {
    const client = new S3Client({
      region: ENV.s3Region,
      endpoint: ENV.s3Endpoint || undefined,
      forcePathStyle: ENV.s3ForcePathStyle,
      maxAttempts: 1,
      credentials: {
        accessKeyId: ENV.s3AccessKeyId,
        secretAccessKey: ENV.s3SecretAccessKey,
      },
    });
    try {
      const result = await client.send(
        new DeleteObjectCommand({ Bucket: ENV.s3Bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(30_000) }
      );
      if (![200, 204].includes(result.$metadata.httpStatusCode ?? 0))
        supplementFail("DELETE_OUTCOME_UNKNOWN");
    } finally {
      client.destroy();
    }
  },
};
function https(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return supplementFail("STORAGE_URL_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    /[\\\u0000-\u0020\u007f]/u.test(value)
  )
    supplementFail("STORAGE_URL_INVALID");
  return url;
}
/** All methods require a server-authored persisted descriptor. This adapter
 * never authorizes users, retries PUT/DELETE, executes SQL, or selects a URL
 * supplied by a browser. Deletion is explicit, not a retention sweep. */
export function createSupplementOriginalStorage(
  dependencies: Omit<Partial<typeof defaults>, "request"> & {
    request?: (
      url: URL,
      options: SafeHttpRequestOptions
    ) => Promise<Pick<SafeHttpResponse, "ok" | "status" | "body">>;
  } = {}
) {
  const deps = { ...defaults, ...dependencies };
  function configuration() {
    try {
      deps.assertPrivate();
      const provider = deps.provider(),
        config = deps.configuration();
      if (
        !["s3", "oss"].includes(provider) ||
        !config.region.trim() ||
        !config.bucket.trim() ||
        !config.accessKeyId.trim() ||
        !config.secretAccessKey.trim()
      )
        supplementFail("STORAGE_UNAVAILABLE");
      const domainHash = supplementHash({
        provider,
        region: config.region,
        bucket: config.bucket,
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
      });
      return { provider: provider as "s3" | "oss", domainHash };
    } catch {
      return supplementFail("STORAGE_UNAVAILABLE");
    }
  }
  function checked(raw: SupplementStoredOriginal) {
    const value = SupplementStoredOriginalSchema.parse(raw),
      current = configuration();
    if (
      value.provider !== current.provider ||
      value.domainHash !== current.domainHash
    )
      supplementFail("STORAGE_DOMAIN_CHANGED");
    return value;
  }
  function prepare(
    identity: SupplementIdentity,
    scope: SupplementScope,
    sourceId: string,
    metadata: SupplementOriginalMetadata
  ): SupplementStoredOriginal {
    const current = configuration(),
      objectKey = `listing-supplements/${identity.workspaceId}/${scope.projectId}/${supplementOperationKey(identity, sourceId)}.original`;
    return SupplementStoredOriginalSchema.parse({
      identity,
      scope,
      sourceId,
      metadata,
      ...current,
      storageUri: `storage://${current.provider}/${objectKey}`,
      objectKey,
    });
  }
  async function putOnce(raw: SupplementStoredOriginal, bytes: Uint8Array) {
    const value = checked(raw);
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.length !== value.metadata.byteSize ||
      supplementBytesHash(bytes) !== value.metadata.contentHash
    )
      supplementFail("CONTENT_MISMATCH");
    try {
      const stored = await deps.put(
        value.objectKey,
        Buffer.from(bytes),
        value.metadata.contentType,
        { maxAttempts: 1 }
      );
      if (
        stored.key !== value.objectKey ||
        stored.storageUri !== value.storageUri
      )
        supplementFail("PUT_OUTCOME_UNKNOWN");
      checked(value);
    } catch {
      supplementFail("PUT_OUTCOME_UNKNOWN");
    }
  }
  async function read(
    raw: SupplementStoredOriginal,
    absentOnly = false
  ): Promise<Buffer | null> {
    const value = checked(raw);
    try {
      const signed = await deps.get(value.objectKey, {
        expectedProvider: value.provider,
        expiresSeconds: 60,
      });
      if (signed.key !== value.objectKey) supplementFail("OBJECT_UNVERIFIED");
      const url = https(signed.url);
      const response = await deps.request(url, {
        method: "GET",
        allowedHosts: [url.hostname],
        maxRedirects: 0,
        timeoutMs: 30_000,
        maxResponseBytes: value.metadata.byteSize,
        auditContext: {
          workspaceId: value.identity.workspaceId,
          operation: "listing.supplement.original.verify",
        },
      });
      checked(value);
      if (absentOnly && response.status === 404) return null;
      if (
        response.status !== 200 ||
        !response.ok ||
        !Buffer.isBuffer(response.body) ||
        response.body.length !== value.metadata.byteSize ||
        supplementBytesHash(response.body) !== value.metadata.contentHash
      )
        supplementFail("OBJECT_UNVERIFIED");
      return Buffer.from(response.body);
    } catch {
      return supplementFail("OBJECT_UNVERIFIED");
    }
  }
  async function readVerified(raw: SupplementStoredOriginal): Promise<Buffer> {
    const bytes = await read(raw);
    if (!bytes) supplementFail("OBJECT_UNVERIFIED");
    return bytes;
  }
  async function deleteOnce(raw: SupplementStoredOriginal) {
    const value = checked(raw);
    try {
      await deps.remove(value.objectKey);
      checked(value);
    } catch {
      supplementFail("DELETE_OUTCOME_UNKNOWN");
    }
  }
  async function verifyAbsent(raw: SupplementStoredOriginal) {
    if ((await read(raw, true)) !== null)
      supplementFail("DELETE_OUTCOME_UNKNOWN");
  }
  return {
    prepare,
    putOnce,
    readVerified,
    deleteOnce,
    verifyAbsent,
    assertAvailable: configuration,
  };
}
export type SupplementOriginalStorage = ReturnType<
  typeof createSupplementOriginalStorage
>;
