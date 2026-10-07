import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createImageAssetReceipt, requireImageAssetReceipt } from "./domains/image/services/imageAssetReceipt";

const originalSecret = process.env.JWT_SECRET;
beforeEach(() => { process.env.JWT_SECRET = "local-only-synthetic-test-secret"; });
afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

const uploaded = {
  url: "https://assets.example.invalid/images/private-photo.jpg?sig=synthetic",
  key: "synthetic-test-object.jpg",
  kind: "designer" as const,
  projectId: 11,
  userId: 22,
};

describe("图片素材受控上传回执", () => {
  it("已上传素材可按原项目、本人、指定用途使用，访问对象时保留裸链接", () => {
    const receipt = createImageAssetReceipt(uploaded);
    expect(receipt.url).toContain("#imageAsset=");
    expect(requireImageAssetReceipt({ reference: receipt.url, kind: "designer", projectId: 11, userId: 22 }))
      .toMatchObject({ url: uploaded.url, kind: "designer" });
  });
  it("外部裸URL、伪造查询签名、替换主机或签名负载均拒绝", () => {
    const signed = createImageAssetReceipt(uploaded).url;
    const expected = { kind: "designer" as const, projectId: 11, userId: 22 };
    expect(() => requireImageAssetReceipt({ reference: uploaded.url, ...expected })).toThrow();
    expect(() => requireImageAssetReceipt({ reference: `${uploaded.url}&imageAsset=forged`, ...expected })).toThrow();
    expect(() => requireImageAssetReceipt({ reference: signed.replace("assets.example.invalid", "competitor.example.invalid"), ...expected })).toThrow();
    expect(() => requireImageAssetReceipt({ reference: `${signed}tampered`, ...expected })).toThrow();
  });
  it("不接受用途、项目或上传者不匹配的回执", () => {
    const signed = createImageAssetReceipt(uploaded).url;
    expect(() => requireImageAssetReceipt({ reference: signed, kind: "step4-ref", projectId: 11, userId: 22 })).toThrow();
    expect(() => requireImageAssetReceipt({ reference: signed, kind: "designer", projectId: 12, userId: 22 })).toThrow();
    expect(() => requireImageAssetReceipt({ reference: signed, kind: "designer", projectId: 11, userId: 23 })).toThrow();
  });
});
