import { TRPCError } from "@trpc/server";

/** Readable KB image ≠ licensed owned-product creative material. Until the asset
 * ledger has origin/allowedUses/approval fields, no KB image can be promoted
 * into Step 4 manufacturing references or downstream deliverables. */
export function requireClassifiedStep4KbUses(step4: unknown): void {
  let snapshot: unknown = step4;
  if (typeof snapshot === "string") {
    try { snapshot = JSON.parse(snapshot); }
    catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "图片参考方案无效，请重新审阅" }); }
  }
  if (!snapshot || typeof snapshot !== "object") return;
  const references = (snapshot as Record<string, unknown>).imageReferences;
  if (!Array.isArray(references)) return;
  if (references.some((ref: unknown) => {
    if (!ref || typeof ref !== "object") return false;
    const images = (ref as Record<string, unknown>).kbReferenceImages;
    return Array.isArray(images) ? images.length > 0 : Boolean(images);
  })) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "知识库图片用途尚未审核，可能包含竞品图片；请移除图片引用，仅保留研究文字或等待资产用途审核" });
  }
}
