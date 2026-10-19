import { LISTING_SUPPLEMENT_LIMITS, SupplementOriginalInputSchema, SupplementOriginalMetadataSchema, type SupplementOriginalInput, type SupplementOriginalMetadata } from "@shared/listingSupplementSources";
import { SupplementClientError } from "./supplementSourcesClientError";

function active(signal: AbortSignal) { if (signal.aborted) throw new SupplementClientError("SUPPLEMENT_ABORTED"); }
export async function supplementBytesHash(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, "0")).join("");
}
export function supplementBase64(bytes: Uint8Array) {
  let text = ""; for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(text);
}
export async function readSupplementFile(file: File, signal: AbortSignal): Promise<{ original: SupplementOriginalInput; metadata: SupplementOriginalMetadata }> {
  active(signal); if (!file.size || file.size > LISTING_SUPPLEMENT_LIMITS.fileBytes) throw new SupplementClientError("SUPPLEMENT_FILE_LIMIT");
  const mime = ({ csv: "text/csv", txt: "text/plain", json: "application/json", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel" } as Record<string, string>)[file.name.split(".").pop()?.toLowerCase() ?? ""];
  if (!mime) throw new SupplementClientError("SUPPLEMENT_FILE_TYPE");
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(), stop = () => { reader.abort(); reject(new SupplementClientError("SUPPLEMENT_ABORTED")); }, done = () => signal.removeEventListener("abort", stop);
    signal.addEventListener("abort", stop, { once: true }); reader.onload = () => { done(); if (reader.result instanceof ArrayBuffer) resolve(reader.result); else reject(new SupplementClientError("SUPPLEMENT_FILE_READ")); };
    reader.onerror = () => { done(); reject(new SupplementClientError("SUPPLEMENT_FILE_READ")); }; reader.onabort = () => { done(); reject(new SupplementClientError("SUPPLEMENT_ABORTED")); }; reader.readAsArrayBuffer(file);
  });
  active(signal); const bytes = new Uint8Array(buffer); if (bytes.length !== file.size) throw new SupplementClientError("SUPPLEMENT_FILE_READ");
  const metadata = SupplementOriginalMetadataSchema.parse({ originalType: "file", fileName: file.name, contentType: mime, byteSize: bytes.length, contentHash: await supplementBytesHash(bytes) }); active(signal);
  return { original: SupplementOriginalInputSchema.parse({ originalType: "file", fileName: file.name, contentType: mime, base64: supplementBase64(bytes) }), metadata };
}
export async function supplementClipboard(text: string, html: string, signal: AbortSignal): Promise<{ original: SupplementOriginalInput; metadata: SupplementOriginalMetadata }> {
  active(signal); const original = SupplementOriginalInputSchema.parse({ originalType: "clipboard", text, html }), bytes = new TextEncoder().encode(JSON.stringify({ version: 1, text, html }));
  const metadata = SupplementOriginalMetadataSchema.parse({ originalType: "clipboard", fileName: "clipboard.txt+html.json", contentType: "application/vnd.listing.clipboard+json", byteSize: bytes.length, contentHash: await supplementBytesHash(bytes) }); active(signal); return { original, metadata };
}
export async function verifySupplementDownload(data: { fileName: string; contentType: string; byteSize: number; contentHash: string; base64: string }, expected: Pick<SupplementOriginalMetadata, "fileName" | "contentType" | "byteSize" | "contentHash">, signal: AbortSignal) {
  active(signal);
  if (data.fileName !== expected.fileName || data.contentType !== expected.contentType || data.byteSize !== expected.byteSize || data.contentHash !== expected.contentHash || !Number.isSafeInteger(data.byteSize) || data.byteSize < 1 || data.byteSize > LISTING_SUPPLEMENT_LIMITS.fileBytes || data.base64.length !== Math.ceil(data.byteSize / 3) * 4) throw new SupplementClientError("SUPPLEMENT_DOWNLOAD_INVALID");
  let decoded: string; try { decoded = atob(data.base64); } catch { throw new SupplementClientError("SUPPLEMENT_DOWNLOAD_INVALID"); }
  if (decoded.length !== data.byteSize || btoa(decoded) !== data.base64) throw new SupplementClientError("SUPPLEMENT_DOWNLOAD_INVALID");
  const bytes = Uint8Array.from(decoded, value => value.charCodeAt(0)); if (await supplementBytesHash(bytes) !== expected.contentHash) throw new SupplementClientError("SUPPLEMENT_DOWNLOAD_INVALID"); active(signal); return bytes;
}
export function deliverSupplementDownload(bytes: Uint8Array, fileName: string) {
  // Always download as an attachment, never render original HTML/JSON as active content.
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: "application/octet-stream" }));
  try { const link = document.createElement("a"); link.href = url; link.download = fileName; link.rel = "noopener"; link.click(); } finally { URL.revokeObjectURL(url); }
}
