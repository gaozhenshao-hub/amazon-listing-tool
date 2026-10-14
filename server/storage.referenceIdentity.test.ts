import { beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic configuration and SDK/HTTP boundaries only; no .env or real storage.
const fixture = vi.hoisted(() => ({
  env: {
    storageProvider: "oss", s3Endpoint: "https://oss.example.test", s3PublicEndpoint: "",
    s3Region: "synthetic", s3Bucket: "private-bucket", s3AccessKeyId: "fixture-key",
    s3SecretAccessKey: "fixture-secret", s3ForcePathStyle: false, storagePresignExpiresSeconds: 900,
    forgeApiUrl: "https://forge.example.test", forgeApiKey: "fixture-forge",
  },
  client: vi.fn(), get: vi.fn(), put: vi.fn(), sign: vi.fn(), http: vi.fn(),
}));
vi.mock("./_core/env", () => ({ ENV: fixture.env }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: fixture.client, GetObjectCommand: fixture.get, PutObjectCommand: fixture.put,
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: fixture.sign }));
vi.mock("./infrastructure/http/safeHttpClient", () => ({ safeHttpRequest: fixture.http }));

import { parseLegacyPresignedObjectKey, resolveStoredObjectUrl, storageGet } from "./storage";

const query = "?X-Amz-Signature=synthetic-expired";
const signed = "https://private-bucket.oss.example.test/new-signature";
function expectNoStorageEffects() {
  for (const spy of [fixture.client, fixture.get, fixture.put, fixture.sign, fixture.http]) expect(spy).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(fixture.env, { storageProvider: "oss", s3Endpoint: "https://oss.example.test",
    s3PublicEndpoint: "", s3Bucket: "private-bucket", s3ForcePathStyle: false });
  fixture.client.mockImplementation(() => ({}));
  fixture.get.mockImplementation(input => ({ input }));
  fixture.sign.mockResolvedValue(signed);
  fixture.http.mockResolvedValue({ json: () => ({ url: "https://forge.example.test/download" }) });
});

describe("T25 persisted provider identity", () => {
  it.each(["forge", "s3", "unknown", "OSS", ""])("rejects expected provider %j before SDK/HTTP while active provider is oss", async provider => {
    await expect(storageGet("same-key", { expectedProvider: provider })).rejects.toThrow(/provider does not match/);
    expectNoStorageEffects();
  });

  it.each(["forge", "s3", "unknown"])("generic URI resolver retains the %s identity", async provider => {
    await expect(resolveStoredObjectUrl(`storage://${provider}/same-key`)).rejects.toThrow(/provider does not match/);
    expectNoStorageEffects();
  });

  it("rejects an old OSS reference after switching only the synthetic active provider to S3", async () => {
    fixture.env.storageProvider = "s3";
    await expect(resolveStoredObjectUrl("storage://oss/same-key")).rejects.toThrow(/provider does not match/);
    expectNoStorageEffects();
  });

  it.each(["oss", "s3"])("signs a matching %s URI with the existing configured bucket and TTL", async provider => {
    fixture.env.storageProvider = provider;
    await expect(resolveStoredObjectUrl(`storage://${provider}/folder/image.png`)).resolves.toBe(signed);
    expect(fixture.get).toHaveBeenCalledWith({ Bucket: "private-bucket", Key: "folder/image.png" });
    expect(fixture.sign).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 900 });
    expect(fixture.http).not.toHaveBeenCalled();
  });

  it("retains the existing Forge download API and passes no provider override into configuration", async () => {
    fixture.env.storageProvider = "forge";
    await expect(resolveStoredObjectUrl("storage://forge/folder/item.txt")).resolves.toBe("https://forge.example.test/download");
    expect(fixture.http).toHaveBeenCalledOnce();
    const [url, options] = fixture.http.mock.calls[0];
    expect(String(url)).toBe("https://forge.example.test/v1/storage/downloadUrl?path=folder%2Fitem.txt");
    expect(options).toMatchObject({ method: "GET", headers: { Authorization: "Bearer fixture-forge" } });
    expect(fixture.client).not.toHaveBeenCalled();
    expect(fixture.env.storageProvider).toBe("forge");
  });

  it("keeps omitted expectedProvider backward compatible and preserves explicit server TTL", async () => {
    await storageGet("folder/item", { expiresSeconds: 300 });
    expect(fixture.sign).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 300 });
  });
});

describe("T25 legacy signed URL endpoint and bucket identity", () => {
  it.each([
    ["https://oss.example.test", "https://private-bucket.oss.example.test/folder/image.png", "folder/image.png"],
    ["https://oss.example.test", "https://oss.example.test/private-bucket/folder/image.png", "folder/image.png"],
    ["https://private-bucket.oss.example.test", "https://private-bucket.oss.example.test/folder/image.png", "folder/image.png"],
    ["https://oss.example.test/private-bucket", "https://oss.example.test/private-bucket/folder/image.png", "folder/image.png"],
    ["https://oss.example.test/private-bucket/", "https://oss.example.test/private-bucket/folder/image.png", "folder/image.png"],
    ["https://oss.example.test:9443", "https://private-bucket.oss.example.test:9443/folder/image.png", "folder/image.png"],
    ["https://oss.example.test", "https://private-bucket.oss.example.test/folder/%E5%9B%BE%20a.png", "folder/图 a.png"],
    ["https://oss.example.test", "https://private-bucket.oss.example.test/folder/100%25.png", "folder/100%.png"],
    ["https://oss.example.test", "https://private-bucket.oss.example.test/folder%252fimage.png", "folder%2fimage.png"],
    ["https://oss.example.test", "https://private-bucket.oss.example.test/folder/%252e%252e/image.png", "folder/%2e%2e/image.png"],
    // A virtual-host key beginning with the bucket name must not lose that prefix.
    ["https://oss.example.test", "https://private-bucket.oss.example.test/private-bucket/image.png", "private-bucket/image.png"],
  ])("maps an unambiguous same-bucket URL at %s", async (endpoint, reference, key) => {
    fixture.env.s3Endpoint = endpoint;
    expect(parseLegacyPresignedObjectKey(reference + query)).toBe(key);
    await expect(resolveStoredObjectUrl(reference + query)).resolves.toBe(signed);
    expect(fixture.get).toHaveBeenCalledWith({ Bucket: "private-bucket", Key: key });
  });

  it("recognizes an explicitly configured public endpoint without treating regional subdomains as buckets", async () => {
    fixture.env.s3Endpoint = "https://internal.example.test";
    fixture.env.s3PublicEndpoint = "https://public.example.test";
    await expect(resolveStoredObjectUrl("https://private-bucket.public.example.test/folder/image.png" + query)).resolves.toBe(signed);
    expect(fixture.get).toHaveBeenCalledWith({ Bucket: "private-bucket", Key: "folder/image.png" });
  });

  it.each([
    "https://other-bucket.oss.example.test/same-key",
    "https://arbitrary.oss.example.test/same-key",
    "https://nested.private-bucket.oss.example.test/same-key",
    "https://private-bucket.oss.example.test.attacker.test/same-key",
    "https://oss.example.test/other-bucket/same-key",
    "https://oss.example.test/same-key",
    "http://private-bucket.oss.example.test/same-key",
    "https://private-bucket.oss.example.test:9443/same-key",
    "https://private-bucket.oss.example.test/",
    "https://oss.example.test/private-bucket",
    "https://private-bucket.oss.example.test/folder//image.png",
    "https://private-bucket.oss.example.test/folder/../image.png",
    "https://private-bucket.oss.example.test/folder/%2e%2e/image.png",
    "https://private-bucket.oss.example.test/folder%2fimage.png",
    "https://private-bucket.oss.example.test/folder%5cimage.png",
    "https://private-bucket.oss.example.test/%zzimage.png",
    "https://private-bucket.oss.example.test/%00image.png",
    "https://private-bucket.oss.example.test/%E0%A4%A.png",
    "https://private-bucket.oss.example.test/folder\\image.png",
    "https://user:password@private-bucket.oss.example.test/image.png",
    "https://%70rivate-bucket.oss.example.test/image.png",
  ])("does not re-sign an unknown or ambiguous URL: %s", async reference => {
    expect(parseLegacyPresignedObjectKey(reference + query)).toBeNull();
    await expect(resolveStoredObjectUrl(reference + query)).resolves.toBe(reference + query);
    expectNoStorageEffects();
  });

  it.each(["", "other-bucket"])("refuses a missing or different configured bucket: %j", async bucket => {
    fixture.env.s3Bucket = bucket;
    const reference = "https://private-bucket.oss.example.test/image.png" + query;
    await expect(resolveStoredObjectUrl(reference)).resolves.toBe(reference);
    expectNoStorageEffects();
  });

  it.each(["https://oss.example.test/other-bucket", "https://oss.example.test/custom/prefix", "https://user:password@oss.example.test"])("does not infer bucket identity from ambiguous configured endpoint %s", async endpoint => {
    fixture.env.s3Endpoint = endpoint;
    const reference = "https://oss.example.test/private-bucket/image.png" + query;
    await expect(resolveStoredObjectUrl(reference)).resolves.toBe(reference);
    expectNoStorageEffects();
  });

  it("preserves unsigned external URLs and does not use leftover S3 configuration in Forge mode", async () => {
    const reference = "https://private-bucket.oss.example.test/image.png";
    await expect(resolveStoredObjectUrl(reference)).resolves.toBe(reference);
    fixture.env.storageProvider = "forge";
    await expect(resolveStoredObjectUrl(reference + query)).resolves.toBe(reference + query);
    expectNoStorageEffects();
  });
});
