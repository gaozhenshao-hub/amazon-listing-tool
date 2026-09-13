import { describe, expect, it } from "vitest";
import { detectImageMeta } from "./assetIngestion";

describe("acquisition asset image metadata", () => {
  it("reads PNG dimensions from trusted magic bytes", () => {
    const bytes = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
    bytes.writeUInt32BE(1200, 16);
    bytes.writeUInt32BE(1500, 20);
    expect(detectImageMeta(bytes, "image/png")).toEqual({
      contentType: "image/png",
      extension: "png",
      width: 1200,
      height: 1500,
    });
  });

  it("rejects non-image bodies even when the response header claims image/jpeg", () => {
    expect(detectImageMeta(Buffer.from("<html>blocked</html>"), "image/jpeg")).toBeNull();
  });

  it("accepts AVIF only from an explicit image content type without inventing dimensions", () => {
    expect(detectImageMeta(Buffer.from("avif"), "image/avif; charset=binary")).toEqual({
      contentType: "image/avif",
      extension: "avif",
      width: null,
      height: null,
    });
  });
});
