// Preconfigured storage helpers for Manus WebDev templates
// Uses the Biz-provided storage proxy (Authorization: Bearer <token>)

import { ENV } from './_core/env';
import { safeHttpRequest } from './infrastructure/http/safeHttpClient';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

type StorageConfig = { baseUrl: string; apiKey: string };
export type StorageProvider = "forge" | "s3" | "oss" | "local" | "external";
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

function createS3CompatibleClient(config: S3CompatibleStorageConfig, endpoint = config.endpoint): S3Client {
  return new S3Client({
    region: config.region,
    endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
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
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string; storageUri: string }> {
  const provider = getActiveStorageProvider();
  if (provider === "s3" || provider === "oss") {
    const config = getS3CompatibleStorageConfig();
    const key = normalizeKey(relKey);
    const serverClient = createS3CompatibleClient(config);
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

export async function storageGet(relKey: string): Promise<{ key: string; url: string; }> {
  const provider = getActiveStorageProvider();
  if (provider === "s3" || provider === "oss") {
    const config = getS3CompatibleStorageConfig();
    const key = normalizeKey(relKey);
    const url = await getSignedUrl(
      createS3CompatibleClient(config, config.publicEndpoint),
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { expiresIn: config.presignExpiresSeconds }
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
