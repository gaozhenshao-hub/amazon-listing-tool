// Preconfigured storage helpers for Manus WebDev templates
// Uses the Biz-provided storage proxy (Authorization: Bearer <token>)

import { ENV } from './_core/env';
import { safeHttpRequest } from './infrastructure/http/safeHttpClient';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

type StorageConfig = { baseUrl: string; apiKey: string };
export type StorageProvider = "forge" | "s3" | "oss" | "local" | "external";
export type StoragePutOptions = {
  /** Server-controlled durable upload protocols may forbid SDK-level retries.
   * Omission keeps every existing caller's configured/default retry behavior. */
  maxAttempts?: 1;
};
type StorageGetOptions = {
  /** Only server-controlled callers may select this shorter S3/OSS signature TTL. */
  expiresSeconds?: number;
  /** Persisted provider identity must not be silently rebound to the active provider. */
  expectedProvider?: string;
};
type S3CompatibleStorageConfig = {
  provider: "s3" | "oss";
  endpoint?: string;
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  presignExpiresSeconds: number;
};

export function buildStorageUri(key: string, provider: StorageProvider = "forge"): string {
  return `storage://${provider}/${normalizeKey(key)}`;
}

export function parseStorageUri(uri: string): { provider: StorageProvider | string; key: string } | null {
  const match = uri.match(/^storage:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { provider: match[1], key: normalizeKey(match[2]) };
}

function parseUnambiguousStorageHttpUrl(reference: string): { url: URL; segments: string[] } | null {
  // Inspect the original path before URL normalizes dot segments or backslashes.
  if (Array.from(reference).some(character => character.charCodeAt(0) <= 32 || character === "\\")) return null;
  const parts = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(reference);
  if (!parts || parts[1].includes("%")) return null;
  const url = new URL(reference);
  if (url.username || url.password || url.hash) return null;
  const path = parts[2];
  const segments = !path || path === "/" ? [] : path.slice(1).split("/").map(decodeURIComponent);
  if (segments.some(segment => !segment || segment === "." || segment === ".."
    || /[/\\]/u.test(segment)
    || Array.from(segment).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) return null;
  return { url, segments };
}

/**
 * Extract an object key only from a legacy S3-compatible pre-signed URL that
 * identifies the configured bucket at a configured endpoint. Regional endpoint
 * suffixes alone do not identify a bucket and must never authorize re-signing.
 */
export function parseLegacyPresignedObjectKey(reference: string): string | null {
  try {
    const provider = getActiveStorageProvider();
    if (provider !== "s3" && provider !== "oss") return null;
    const bucket = ENV.s3Bucket.trim();
    if (!bucket || !/^[a-z0-9][a-z0-9.-]*$/u.test(bucket) || bucket.endsWith(".") || bucket.includes("..")) return null;
    const parsed = parseUnambiguousStorageHttpUrl(reference);
    if (!parsed) return null;
    const { url, segments } = parsed;
    const queryKeys = Array.from(url.searchParams.keys()).map((key) => key.toLowerCase());
    const isPresigned = queryKeys.some((key) =>
      key.startsWith("x-amz-") || key === "signature" || key === "ossaccesskeyid" || key === "expires"
    );
    if (!isPresigned) return null;

    for (const endpoint of [ENV.s3Endpoint, ENV.s3PublicEndpoint].filter(Boolean)) {
      let configured: ReturnType<typeof parseUnambiguousStorageHttpUrl>;
      try { configured = parseUnambiguousStorageHttpUrl(endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint); } catch { continue; }
      if (!configured || configured.url.search || url.protocol !== configured.url.protocol || url.port !== configured.url.port) continue;
      // Only the endpoint root or an explicitly bucket-qualified path is known.
      // Custom path prefixes must not be guessed into the current private bucket.
      if (configured.segments.length > 1 || (configured.segments.length === 1 && configured.segments[0] !== bucket)) continue;
      const host = configured.url.hostname;
      const bucketInHost = host.startsWith(`${bucket}.`);
      let objectSegments: string[] | null = null;
      if (!configured.segments.length && (url.hostname === (bucketInHost ? host : `${bucket}.${host}`))) {
        objectSegments = segments;
      } else if (!bucketInHost && url.hostname === host && segments[0] === bucket) {
        objectSegments = segments.slice(1);
      }
      // Decode exactly once. Literal '%' (including text such as '%2f') is
      // part of the object key; GetObjectCommand receives it without re-decoding.
      if (objectSegments?.length) return objectSegments.join("/");
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a persisted file reference immediately before it is sent to a client
 * or an AI runtime. New files should store storage:// URIs; legacy pre-signed
 * URLs are refreshed only when their host and signature shape are verified.
 */
export async function resolveStoredObjectUrl(reference: string): Promise<string> {
  const parsed = parseStorageUri(reference);
  if (parsed) return (await storageGet(parsed.key, { expectedProvider: parsed.provider })).url;

  const legacyKey = parseLegacyPresignedObjectKey(reference);
  if (legacyKey) return (await storageGet(legacyKey, { expectedProvider: getActiveStorageProvider() })).url;

  return reference;
}

function getStorageConfig(): StorageConfig {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Storage proxy credentials missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

export function getActiveStorageProvider(): StorageProvider {
  const provider = ENV.storageProvider;
  if (provider === "forge" || provider === "s3" || provider === "oss" || provider === "local" || provider === "external") {
    return provider;
  }
  throw new Error(`Unsupported STORAGE_PROVIDER: ${provider}`);
}

export function resolveS3CompatibleEndpoints(serverEndpoint: string, publicEndpoint = "") {
  const normalizedServerEndpoint = serverEndpoint.trim();
  const normalizedPublicEndpoint = publicEndpoint.trim();
  return {
    serverEndpoint: normalizedServerEndpoint || undefined,
    presignEndpoint: normalizedPublicEndpoint || normalizedServerEndpoint || undefined,
  };
}

function getS3CompatibleStorageConfig(): S3CompatibleStorageConfig {
  const provider = getActiveStorageProvider();
  if (provider !== "s3" && provider !== "oss") {
    throw new Error(`S3-compatible storage is unavailable for provider: ${provider}`);
  }

  const required = {
    S3_REGION: ENV.s3Region,
    S3_BUCKET: ENV.s3Bucket,
    S3_ACCESS_KEY_ID: ENV.s3AccessKeyId,
    S3_SECRET_ACCESS_KEY: ENV.s3SecretAccessKey,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`S3-compatible storage credentials missing: ${missing.join(", ")}`);
  }

  const expires = Number.isFinite(ENV.storagePresignExpiresSeconds)
    ? Math.min(Math.max(Math.floor(ENV.storagePresignExpiresSeconds), 60), 7 * 24 * 60 * 60)
    : 3600;
  const endpoints = resolveS3CompatibleEndpoints(ENV.s3Endpoint, ENV.s3PublicEndpoint);
  return {
    provider,
    endpoint: endpoints.serverEndpoint,
    publicEndpoint: endpoints.presignEndpoint,
    region: ENV.s3Region,
    bucket: ENV.s3Bucket,
    accessKeyId: ENV.s3AccessKeyId,
    secretAccessKey: ENV.s3SecretAccessKey,
    forcePathStyle: ENV.s3ForcePathStyle,
    presignExpiresSeconds: expires,
  };
}

function createS3CompatibleClient(config: S3CompatibleStorageConfig, endpoint = config.endpoint, options: StoragePutOptions = {}): S3Client {
  return new S3Client({
    region: config.region,
    endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    ...(options.maxAttempts === 1 ? { maxAttempts: 1 } : {}),
  });
}

function buildUploadUrl(baseUrl: string, relKey: string): URL {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

async function buildDownloadUrl(
  baseUrl: string,
  relKey: string,
  apiKey: string
): Promise<string> {
  const downloadApiUrl = new URL(
    "v1/storage/downloadUrl",
    ensureTrailingSlash(baseUrl)
  );
  downloadApiUrl.searchParams.set("path", normalizeKey(relKey));
  const response = await safeHttpRequest(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(apiKey) as Record<string, string>,
    timeoutMs: 30_000,
    maxResponseBytes: 2 * 1024 * 1024,
    allowedHosts: [downloadApiUrl.hostname],
    auditContext: { operation: "storage.download_url" },
  });
  return response.json<{ url: string }>().url;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
  options: StoragePutOptions = {}
): Promise<{ key: string; url: string; storageUri: string }> {
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some(key => key !== "maxAttempts")
    || options.maxAttempts !== undefined && options.maxAttempts !== 1) {
    throw new Error("Storage PUT only supports the explicit maxAttempts: 1 override");
  }
  const provider = getActiveStorageProvider();
  if (options.maxAttempts === 1 && provider !== "s3" && provider !== "oss") {
    throw new Error("Single-attempt storage PUT requires S3/OSS");
  }
  if (provider === "s3" || provider === "oss") {
    const config = getS3CompatibleStorageConfig();
    const key = normalizeKey(relKey);
    const serverClient = createS3CompatibleClient(config, config.endpoint, options);
    await serverClient.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    }));
    const url = await getSignedUrl(
      createS3CompatibleClient(config, config.publicEndpoint),
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { expiresIn: config.presignExpiresSeconds }
    );
    return { key, url, storageUri: buildStorageUri(key, provider) };
  }

  if (provider !== "forge") {
    throw new Error(`storagePut is not configured for provider: ${provider}`);
  }
  const { baseUrl, apiKey } = getStorageConfig();
  const key = normalizeKey(relKey);
  const uploadUrl = buildUploadUrl(baseUrl, key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await safeHttpRequest(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(apiKey) as Record<string, string>,
    body: formData,
    timeoutMs: 120_000,
    maxResponseBytes: 2 * 1024 * 1024,
    allowedHosts: [uploadUrl.hostname],
    auditContext: { operation: "storage.upload" },
  });

  if (!response.ok) {
    const message = response.text() || response.statusText;
    throw new Error(
      `Storage upload failed (${response.status} ${response.statusText}): ${message}`
    );
  }
  const url = response.json<{ url: string }>().url;
  return { key, url, storageUri: buildStorageUri(key, "forge") };
}

export async function storageGet(
  relKey: string,
  options: StorageGetOptions = {}
): Promise<{ key: string; url: string; }> {
  const provider = getActiveStorageProvider();
  if (options.expectedProvider !== undefined && options.expectedProvider !== provider) {
    throw new Error("Stored object provider does not match the active storage provider");
  }
  if (provider === "s3" || provider === "oss") {
    const config = getS3CompatibleStorageConfig();
    const key = normalizeKey(relKey);
    const expiresIn = options.expiresSeconds ?? config.presignExpiresSeconds;
    if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 7 * 24 * 60 * 60) {
      throw new Error("Storage download signature TTL must be between 60 seconds and 7 days");
    }
    const url = await getSignedUrl(
      createS3CompatibleClient(config, config.publicEndpoint),
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { expiresIn }
    );
    return { key, url };
  }

  if (provider !== "forge") {
    throw new Error(`storageGet is not configured for provider: ${provider}`);
  }
  const { baseUrl, apiKey } = getStorageConfig();
  const key = normalizeKey(relKey);
  return {
    key,
    url: await buildDownloadUrl(baseUrl, key, apiKey),
  };
}

/** Upload and preview share this fail-closed private-bucket precondition. */
export function assertPrivateEvidenceStorageAvailable(): void {
  const provider = getActiveStorageProvider();
  if ((provider !== "s3" && provider !== "oss") || !ENV.storagePrivateObjects) {
    throw new Error("Private evidence preview requires a private S3/OSS bucket and STORAGE_PRIVATE_OBJECTS=true");
  }
  const expiresIn = ENV.privateEvidencePreviewPresignExpiresSeconds;
  if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 300) {
    throw new Error("Private evidence preview TTL must be configured from 60 to 300 seconds");
  }
}

/**
 * Obtain a private evidence-document URL only when deployment explicitly
 * attests its S3/OSS bucket is not anonymously readable. Forge has no short
 * caller-selected expiry and must never store these PDFs in this flow.
 */
export async function createPrivateEvidencePreviewUrl(storageUri: string): Promise<string> {
  assertPrivateEvidenceStorageAvailable();
  const parsed = parseStorageUri(storageUri);
  const provider = getActiveStorageProvider();
  if (!parsed || parsed.provider !== provider) {
    throw new Error("Private evidence storage reference is not controlled by the active provider");
  }
  const expiresIn = ENV.privateEvidencePreviewPresignExpiresSeconds;
  return (await storageGet(parsed.key, { expiresSeconds: expiresIn })).url;
}
