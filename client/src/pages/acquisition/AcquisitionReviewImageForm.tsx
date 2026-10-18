import { useState } from "react";
import CryptoJS from "crypto-js";
import { Button } from "@/components/ui/button";
import type { ReviewAsset } from "./AssetReviewGrid";

export const REVIEW_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export type ReviewImageSelection = { file: File; role: "main" | "secondary" | "aplus" | "brand_story"; sourceAssetId: number | null };
/** Read exactly the supplied original bytes. No canvas, resize, compression or
 * re-encoding; server independently validates the real media type and pixels. */
export async function readReviewImageBytes(file: File, signal: AbortSignal) {
  if (!file.size || file.size > REVIEW_IMAGE_MAX_BYTES || !/\.(?:png|jpe?g|webp|gif|avif)$/iu.test(file.name)) throw new Error("IMAGE_FILE_INVALID");
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    const stop = () => { reader.abort(); reject(new Error("IMAGE_READ_ABORTED")); };
    const cleanup = () => signal.removeEventListener("abort", stop);
    reader.onload = () => { cleanup(); if (!signal.aborted && reader.result instanceof ArrayBuffer) resolve(reader.result); else reject(new Error("IMAGE_READ_INVALID")); };
    reader.onerror = () => { cleanup(); reject(new Error("IMAGE_READ_FAILED")); };
    reader.onabort = () => { cleanup(); reject(new Error("IMAGE_READ_ABORTED")); };
    if (signal.aborted) { reject(new Error("IMAGE_READ_ABORTED")); return; }
    signal.addEventListener("abort", stop, { once: true }); reader.readAsArrayBuffer(file);
  });
  if (signal.aborted || buffer.byteLength !== file.size || buffer.byteLength > REVIEW_IMAGE_MAX_BYTES) throw new Error("IMAGE_READ_INVALID");
  const bytes = new Uint8Array(buffer); let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) words[i >>> 2] = (words[i >>> 2] ?? 0) | bytes[i] << (24 - i % 4 * 8);
  const contentHash = CryptoJS.SHA256(CryptoJS.lib.WordArray.create(words, bytes.length)).toString();
  return { base64: btoa(binary), contentHash, byteSize: bytes.byteLength };
}

export default function AcquisitionReviewImageForm({ assets, disabled, reason, onSubmit, onDraftChange }: {
  assets: ReviewAsset[]; disabled: boolean; reason: string;
  onSubmit: (selection: ReviewImageSelection) => void; onDraftChange: (dirty: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null), [role, setRole] = useState<ReviewImageSelection["role"]>("secondary");
  const [sourceAssetId, setSourceAssetId] = useState<number | null>(null), [error, setError] = useState("");
  function select(next: File | null) {
    if (disabled) return;
    if (next && (!next.size || next.size > REVIEW_IMAGE_MAX_BYTES || !/\.(?:png|jpe?g|webp|gif|avif)$/iu.test(next.name))) {
      setError("请选择不超过 8 MiB 的 PNG、JPEG、WEBP、GIF 或 AVIF 原图；不会自动压缩或改写格式。"); return;
    }
    setFile(next); setError(""); onDraftChange(next !== null);
  }
  return <section aria-label="原字节补图" className="min-w-0 space-y-3 rounded border p-3">
    <h2 className="font-semibold">上传／粘贴原图补充本修订</h2>
    <p>只保存所选文件的原字节，不裁剪或重编码。先保存或明确放弃字段／图片选择草稿，再补图；一次一张，完成后重新读取修订。替换不会删除原件或已直接入库图片。</p>
    {reason && <p>{reason}</p>}{error && <p role="alert">{error}</p>}
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <label className="block">原图文件（最多 8 MiB）<input aria-label="原图文件（最多 8 MiB）" className="block max-w-full" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.avif" onChange={event => select(event.target.files?.[0] ?? null)} /></label>
      <div role="textbox" aria-label="粘贴原图区域" aria-readonly={disabled} tabIndex={disabled ? -1 : 0} className="rounded border p-3"
        onPaste={event => { if (disabled) return; const files = [...event.clipboardData.files];
          if (files.length !== 1) { setError("请一次粘贴一张原图；不把网页 HTML、链接或多图静默转换为图片。"); return; }
          event.preventDefault(); select(files[0]); }}>在此粘贴一张剪贴板原图；仅选择，不自动上传。</div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="min-w-0">图片归属<select aria-label="补图图片归属" className="block w-full min-w-0 rounded border p-2" value={role} onChange={event => setRole(event.target.value as ReviewImageSelection["role"])}>
        <option value="main">主图</option><option value="secondary">副图</option><option value="aplus">A+</option><option value="brand_story">品牌故事</option></select></label>
        <label className="min-w-0">对应原图（可选）<select aria-label="补图对应原图" className="block w-full min-w-0 rounded border p-2" value={sourceAssetId ?? ""} onChange={event => {
          const value = event.target.value ? Number(event.target.value) : null; setSourceAssetId(value);
          const asset = assets.find(item => item.id === value); if (asset && ["main", "secondary", "aplus", "brand_story"].includes(asset.role)) setRole(asset.role as ReviewImageSelection["role"]);
        }}><option value="">新增图片，不替换原图</option>{assets.filter(asset => ["main", "secondary", "aplus", "brand_story"].includes(asset.role)).map(asset => <option key={asset.id} value={asset.id}>#{asset.id} · {asset.role} · 图位 {asset.positionIndex + 1}</option>)}</select></label></div>
      {file && <p className="break-all">已选择：{file.name} · {file.size} bytes（仅浏览器内存，尚未上传）</p>}
      <div className="flex flex-wrap gap-2"><Button disabled={!file || disabled} onClick={() => { if (file) onSubmit({ file, role, sourceAssetId }); }}>明确上传原图</Button>
        <Button variant="outline" disabled={!file || disabled} onClick={() => select(null)}>放弃已选文件</Button></div>
    </fieldset>
  </section>;
}
