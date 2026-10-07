import sharp from "sharp";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 25_000_000;
const MAX_IMAGE_EDGE = 10_000;
const MAX_IMAGE_FRAMES = 30;

export class InvalidImageError extends Error {}

type ImageType = { extension: "png" | "jpg" | "webp" | "gif"; mimeType: string; format: "png" | "jpeg" | "webp" | "gif" };

function detectedType(buffer: Buffer): ImageType | null {
  if (buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return { extension: "png", mimeType: "image/png", format: "png" };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: "jpg", mimeType: "image/jpeg", format: "jpeg" };
  }
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { extension: "webp", mimeType: "image/webp", format: "webp" };
  }
  if (["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) {
    return { extension: "gif", mimeType: "image/gif", format: "gif" };
  }
  return null;
}

/** Check the file signature AND decode pixels; never trust extension or request MIME. */
export async function validateImageBytes(buffer: Buffer): Promise<{ extension: ImageType["extension"]; mimeType: string }> {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16 || buffer.length > MAX_IMAGE_BYTES) {
    throw new InvalidImageError("图片文件大小不合法（最大20MB）或内容为空");
  }
  const detected = detectedType(buffer);
  if (!detected) {
    throw new InvalidImageError("仅允许上传PNG、JPEG、WEBP或GIF图片，不能使用网页、SVG或伪造图片文件");
  }
  try {
    // metadata alone only reads headers; stats forces pixels to decode.
    // Bound both the source frame count and the actual pixels decoded.
    const options = { failOn: "warning" as const, limitInputPixels: MAX_IMAGE_PIXELS, pages: 1 };
    const metadata = await sharp(buffer, options).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (metadata.format !== detected.format || !width || !height || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE ||
      width * height > MAX_IMAGE_PIXELS || (metadata.pages ?? 1) > MAX_IMAGE_FRAMES) {
      throw new InvalidImageError("图片格式、宽高或动画帧数不符合上传限制");
    }
    await sharp(buffer, options).stats();
    return { extension: detected.extension, mimeType: detected.mimeType };
  } catch (error) {
    if (error instanceof InvalidImageError) throw error;
    throw new InvalidImageError("图片无法完整解码，请重新上传PNG、JPEG、WEBP或GIF原图");
  }
}
