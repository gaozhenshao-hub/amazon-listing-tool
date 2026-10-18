// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createHash } from "node:crypto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AcquisitionReviewImageForm, { readReviewImageBytes, REVIEW_IMAGE_MAX_BYTES } from "./AcquisitionReviewImageForm";
afterEach(cleanup);
describe("original image byte selection", () => {
  it("retains all byte values and hashes raw bytes, never a data URL or transformed bitmap", async () => {
    const bytes = new Uint8Array(Array.from({ length: 9001 }, (_, index) => index % 256));
    const result = await readReviewImageBytes(new File([bytes], "original.avif", { type: "image/avif" }), new AbortController().signal);
    expect(Buffer.from(result.base64, "base64")).toEqual(Buffer.from(bytes));
    expect(result.contentHash).toBe(createHash("sha256").update(bytes).digest("hex")); expect(result.byteSize).toBe(bytes.length);
  });
  it.each([new File([], "empty.png"), new File(["x"], "script.svg"), new File([new Uint8Array(REVIEW_IMAGE_MAX_BYTES + 1)], "big.png")])("rejects invalid file before reading", async file => {
    await expect(readReviewImageBytes(file, new AbortController().signal)).rejects.toThrow("IMAGE_FILE_INVALID");
  });
  it("abort before reading does not produce bytes", async () => {
    const abort = new AbortController(); abort.abort();
    await expect(readReviewImageBytes(new File(["x"], "raw.png"), abort.signal)).rejects.toThrow("IMAGE_READ_ABORTED");
  });
  it("does not treat pasted HTML, multiple files, or selection as an upload", () => {
    const upload = vi.fn(); render(<AcquisitionReviewImageForm assets={[]} disabled={false} reason="" onSubmit={upload} onDraftChange={vi.fn()} />);
    const paste = screen.getByRole("textbox", { name: "粘贴原图区域" });
    fireEvent.paste(paste, { clipboardData: { files: [] } }); expect(screen.getByRole("alert")).toHaveTextContent("不把网页 HTML");
    fireEvent.paste(paste, { clipboardData: { files: [new File(["a"], "a.png"), new File(["b"], "b.png")] } }); expect(upload).not.toHaveBeenCalled();
    fireEvent.paste(paste, { clipboardData: { files: [new File(["a"], "a.png")] } }); expect(upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "明确上传原图" })); expect(upload).toHaveBeenCalledOnce();
  });
});
