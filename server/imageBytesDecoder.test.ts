import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { InvalidImageError, validateImageBytes } from "./domains/image/services/validateImageBytes";

const synthetic = () => sharp({ create: { width: 3, height: 3, channels: 4, background: "#ffffff" } });

describe("上传图片的完整解码和格式门禁", () => {
  it.each([
    ["png", "png", "image/png"],
    ["jpeg", "jpg", "image/jpeg"],
    ["webp", "webp", "image/webp"],
    ["gif", "gif", "image/gif"],
  ] as const)("能解码的%s图片允许签发对应内容类型", async (format, extension, mimeType) => {
    const image = await synthetic().toFormat(format).toBuffer();
    expect(await validateImageBytes(image)).toEqual({ extension, mimeType });
  });
  it("仅有PNG头部、无有效像素时拒绝", async () => {
    const truncated = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    await expect(validateImageBytes(truncated)).rejects.toBeInstanceOf(InvalidImageError);
  });
  it("不依赖传入MIME判定HTML、SVG或未知格式，超过大小限制失败关闭", async () => {
    await expect(validateImageBytes(Buffer.from("<html><img src=x></html>"))).rejects.toBeInstanceOf(InvalidImageError);
    await expect(validateImageBytes(Buffer.alloc(20 * 1024 * 1024 + 1))).rejects.toBeInstanceOf(InvalidImageError);
  });
});
