import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock, putObjectCommandMock, getObjectCommandMock, s3ClientMock, getSignedUrlMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  putObjectCommandMock: vi.fn((input: unknown) => ({ kind: "put", input })),
  getObjectCommandMock: vi.fn((input: unknown) => ({ kind: "get", input })),
  s3ClientMock: vi.fn(),
  getSignedUrlMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: s3ClientMock,
  PutObjectCommand: putObjectCommandMock,
  GetObjectCommand: getObjectCommandMock,
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

beforeEach(() => {
  vi.clearAllMocks();
  s3ClientMock.mockImplementation(() => ({ send: sendMock }));
  getSignedUrlMock.mockResolvedValue("https://oss.example.test/signed-download");
});

describe("独立对象存储提供商选择", () => {
  it("默认继续使用Forge，避免影响当前Manus部署", async () => {
    vi.stubEnv("STORAGE_PROVIDER", "forge");
    vi.resetModules();
    const { getActiveStorageProvider } = await import("./storage");
    expect(getActiveStorageProvider()).toBe("forge");
  });

  it("识别阿里云OSS的S3兼容提供商", async () => {
    vi.stubEnv("STORAGE_PROVIDER", "oss");
    vi.resetModules();
    const { buildStorageUri, getActiveStorageProvider, parseStorageUri } = await import("./storage");
    expect(getActiveStorageProvider()).toBe("oss");
    expect(buildStorageUri("/images/demo.png", "oss")).toBe("storage://oss/images/demo.png");
    expect(parseStorageUri("storage://oss/images/demo.png")).toEqual({ provider: "oss", key: "images/demo.png" });
  });

  it("OSS模式上传对象并返回短期签名下载URL", async () => {
    vi.stubEnv("STORAGE_PROVIDER", "oss");
    vi.stubEnv("S3_ENDPOINT", "https://oss-cn-hangzhou.aliyuncs.com");
    vi.stubEnv("S3_REGION", "cn-hangzhou");
    vi.stubEnv("S3_BUCKET", "amz-private");
    vi.stubEnv("S3_ACCESS_KEY_ID", "test-key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("STORAGE_PRESIGN_EXPIRES_SECONDS", "900");
    vi.resetModules();
    const { storageGet, storagePut } = await import("./storage");

    const uploaded = await storagePut("/uploads/demo.txt", "demo", "text/plain");
    const downloaded = await storageGet("uploads/demo.txt");

    expect(putObjectCommandMock).toHaveBeenCalledWith({
      Bucket: "amz-private",
      Key: "uploads/demo.txt",
      Body: "demo",
      ContentType: "text/plain",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(getSignedUrlMock).toHaveBeenCalledTimes(2);
    expect(getSignedUrlMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "get" }),
      { expiresIn: 900 }
    );
    expect(uploaded).toEqual({
      key: "uploads/demo.txt",
      url: "https://oss.example.test/signed-download",
      storageUri: "storage://oss/uploads/demo.txt",
    });
    expect(downloaded).toEqual({ key: "uploads/demo.txt", url: "https://oss.example.test/signed-download" });
  });

  it("OSS配置缺失时拒绝执行上传或下载", async () => {
    vi.stubEnv("STORAGE_PROVIDER", "oss");
    vi.stubEnv("S3_REGION", "");
    vi.stubEnv("S3_BUCKET", "");
    vi.stubEnv("S3_ACCESS_KEY_ID", "");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "");
    vi.resetModules();
    const { storageGet } = await import("./storage");

    await expect(storageGet("uploads/demo.txt")).rejects.toThrow(
      "S3-compatible storage credentials missing: S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY"
    );
  });
});
