import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type ImageAssetKind = "step4-ref" | "designer" | "expression-group";

type ImageAssetReceiptPayload = {
  v: 1;
  kind: ImageAssetKind;
  projectId: number;
  userId: number;
  key: string;
  urlHash: string;
};

type ImageAssetReceipt = {
  url: string;
  key: string;
  kind: ImageAssetKind;
};

const RECEIPT_PARAM = "imageAsset";

function receiptSecret() {
  const secret = process.env.JWT_SECRET || "";
  if (!secret) throw new Error("图片素材校验不可用，请联系管理员配置服务端密钥");
  return secret;
}

function encodePayload(payload: ImageAssetReceiptPayload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(encoded: string): ImageAssetReceiptPayload | null {
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (
      value?.v !== 1
      || !["step4-ref", "designer", "expression-group"].includes(value?.kind)
      || !Number.isInteger(value?.projectId)
      || !Number.isInteger(value?.userId)
      || typeof value?.key !== "string"
      || !value.key
      || typeof value?.urlHash !== "string"
    ) return null;
    return value as ImageAssetReceiptPayload;
  } catch {
    return null;
  }
}

function sign(encodedPayload: string) {
  return createHmac("sha256", receiptSecret()).update(encodedPayload).digest("base64url");
}

function sameSignature(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length
    && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function canonicalUrl(reference: string) {
  const url = new URL(reference);
  url.hash = "";
  return url.toString();
}

function hashUrl(url: string) {
  return createHash("sha256").update(url).digest("base64url");
}

/**
 * Adds a server-signed receipt in the URL fragment. Fragments are never sent to
 * object storage, so this preserves both S3 presigned URLs and browser previews.
 */
export function createImageAssetReceipt(input: {
  url: string;
  key: string;
  kind: ImageAssetKind;
  projectId: number;
  userId: number;
}): ImageAssetReceipt {
  const url = new URL(input.url);
  if (url.hash) throw new Error("上传素材 URL 不能包含片段");
  const bareUrl = canonicalUrl(input.url);
  const payload = encodePayload({
    v: 1,
    kind: input.kind,
    projectId: input.projectId,
    userId: input.userId,
    key: input.key,
    urlHash: hashUrl(bareUrl),
  });
  url.hash = new URLSearchParams({ [RECEIPT_PARAM]: `${payload}.${sign(payload)}` }).toString();
  return { url: url.toString(), key: input.key, kind: input.kind };
}

/**
 * Fail closed unless the URL is exactly the one signed by this server for the
 * authenticated user, project, and intended image workflow surface.
 */
export function requireImageAssetReceipt(input: {
  reference: string;
  kind: ImageAssetKind;
  projectId: number;
  userId: number;
}): ImageAssetReceipt {
  let url: URL;
  try {
    url = new URL(input.reference);
  } catch {
    throw new Error("图片素材必须使用受控上传生成的素材回执");
  }

  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const receipt = params.get(RECEIPT_PARAM);
  if (!receipt || params.get(RECEIPT_PARAM) !== receipt) {
    throw new Error("图片素材必须使用受控上传生成的素材回执");
  }
  const [encodedPayload, signature, ...extra] = receipt.split(".");
  if (!encodedPayload || !signature || extra.length > 0 || !sameSignature(sign(encodedPayload), signature)) {
    throw new Error("图片素材回执无效或已被篡改");
  }

  const payload = decodePayload(encodedPayload);
  if (!payload) throw new Error("图片素材回执无效或已被篡改");
  if (payload.kind !== input.kind) throw new Error("图片素材类型与当前操作不匹配");
  if (payload.projectId !== input.projectId) throw new Error("图片素材不属于当前项目");
  if (payload.userId !== input.userId) throw new Error("图片素材不属于当前用户");

  const bareUrl = canonicalUrl(input.reference);
  if (payload.urlHash !== hashUrl(bareUrl)) throw new Error("图片素材 URL 与服务端回执不匹配");
  return { url: bareUrl, key: payload.key, kind: payload.kind };
}
