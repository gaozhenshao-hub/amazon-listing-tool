import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ provider: "forge", privateObjects: false, previewTtl: 300 }));
vi.mock("./_core/env", () => ({ ENV: {
  get storageProvider() { return settings.provider; },
  get storagePrivateObjects() { return settings.privateObjects; },
  get privateEvidencePreviewPresignExpiresSeconds() { return settings.previewTtl; },
} }));

import { assertPrivateEvidenceStorageAvailable } from "./storage";

beforeEach(() => {
  settings.provider = "forge";
  settings.privateObjects = false;
  settings.previewTtl = 300;
});

describe("许可证明私有存储前置条件", () => {
  it("Forge与未声明私有的S3/OSS都拒绝上传", () => {
    expect(() => assertPrivateEvidenceStorageAvailable()).toThrow("private S3/OSS bucket");
    for (const provider of ["s3", "oss"]) {
      settings.provider = provider;
      expect(() => assertPrivateEvidenceStorageAvailable()).toThrow("private S3/OSS bucket");
    }
  });

  it("预览有效期非法时拒绝，只有显式声明的私有桶与短期签名才可使用", () => {
    settings.provider = "s3";
    settings.privateObjects = true;
    settings.previewTtl = 301;
    expect(() => assertPrivateEvidenceStorageAvailable()).toThrow("TTL");
    settings.previewTtl = 300;
    expect(() => assertPrivateEvidenceStorageAvailable()).not.toThrow();
  });
});
