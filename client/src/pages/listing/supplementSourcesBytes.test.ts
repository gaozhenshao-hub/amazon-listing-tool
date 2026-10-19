// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSupplementFile, supplementClipboard, supplementBytesHash, verifySupplementDownload, deliverSupplementDownload, supplementBase64 } from "./supplementSourcesBytes";
beforeEach(() => { Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto }); });
describe("bounded original bytes without rewriting", () => {
  it("preserves exact file bytes", async () => { const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 13, 10, 65]), value = await readSupplementFile(new File([bytes], "source.csv"), new AbortController().signal); expect(value.original).toMatchObject({ base64: supplementBase64(bytes) }); expect(value.metadata.contentHash).toBe(await supplementBytesHash(bytes)); });
  it("retains exact clipboard plain text and HTML in the original envelope, not rendered HTML", async () => { const text = " \r\n评论 ", html = '<script>alert(1)</script>', value = await supplementClipboard(text, html, new AbortController().signal); expect(value.original).toEqual({ originalType: "clipboard", text, html }); expect(value.metadata.contentHash).toBe(await supplementBytesHash(new TextEncoder().encode(JSON.stringify({ version: 1, text, html })))); });
  it("rejects oversized file before read", async () => { const file = new File(["a"], "x.csv"); Object.defineProperty(file, "size", { value: 20 * 1024 * 1024 + 1 }); await expect(readSupplementFile(file, new AbortController().signal)).rejects.toThrow("LIMIT"); });
  it("aborts a file read and rejects unsupported formats", async () => { const controller = new AbortController(); controller.abort(); await expect(readSupplementFile(new File(["a"], "x.csv"), controller.signal)).rejects.toThrow("ABORTED"); await expect(readSupplementFile(new File(["a"], "x.html"), new AbortController().signal)).rejects.toThrow("TYPE"); });
  it("checks every download field, canonical base64 and original bytes hash", async () => { const bytes = new TextEncoder().encode("synthetic original"), expected = { fileName: "x.csv", contentType: "text/csv" as const, byteSize: bytes.length, contentHash: await supplementBytesHash(bytes) }, data = { ...expected, base64: supplementBase64(bytes) };
    expect(Array.from(await verifySupplementDownload(data, expected, new AbortController().signal))).toEqual(Array.from(bytes));
    for (const wrong of [{ ...data, fileName: "other.csv" }, { ...data, contentType: "text/html" }, { ...data, byteSize: 2 }, { ...data, contentHash: "a".repeat(64) }, { ...data, base64: "A".repeat(data.base64.length) }]) await expect(verifySupplementDownload(wrong, expected, new AbortController().signal)).rejects.toThrow();
  });
  it("releases object URLs after explicit attachment delivery", () => { const revoke = vi.fn(), click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {}); URL.createObjectURL = vi.fn(() => "blob:synthetic"); URL.revokeObjectURL = revoke; deliverSupplementDownload(new Uint8Array([65]), "original.csv"); expect(click).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith("blob:synthetic"); click.mockRestore(); });
});
