import {
  DESIGN_IMAGE_MODEL,
  DESIGN_BANANA_MODEL,
  type DesignParams,
} from "../../../shared/designStudio";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";
import { resolveGovernedModelApiKey } from "../ai_os/services/teamorouterCatalog";
import { execute, type Scope } from "./repository";

export const DESIGN_MODEL = DESIGN_IMAGE_MODEL;
export async function designModel(
  scope: Scope,
  providerId?: number,
  modelId: string = DESIGN_MODEL
) {
  if (![DESIGN_MODEL, DESIGN_BANANA_MODEL].some(id => id === modelId))
    throw new Error("不支持的生图模型");
  const rows = await execute(
    `SELECT id,baseUrl,modelId,apiKeyRef FROM emperor_model_providers
     WHERE TRIM(modelId)=? AND isActive=1 AND (workspaceId=? OR workspaceId IS NULL)
     ${providerId ? "AND id=?" : ""} ORDER BY workspaceId DESC,id ASC LIMIT 1`,
    [modelId, scope.workspaceId, ...(providerId ? [providerId] : [])]
  );
  const model = rows[0];
  if (
    !model ||
    String(model.baseUrl).replace(/\/+$/, "") !== "https://api.lk888.ai/v1"
  )
    throw new Error(
      `请在模型管理中配置并启用 ${modelId === DESIGN_BANANA_MODEL ? "大香蕉 2.1" : "Image 2.5"}`
    );
  const key = resolveGovernedModelApiKey(model.apiKeyRef);
  if (!key) throw new Error("生图模型尚未配置密钥");
  return { id: Number(model.id), key, modelId };
}
export class ProviderRejected extends Error {}
export async function providerRequest(
  model: { key: string },
  pathname: string,
  payload?: unknown
) {
  const response = await safeHttpRequest(
    `https://api.lk888.ai/v1/media/${pathname}`,
    {
      method: payload ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${model.key}`,
        "Content-Type": "application/json",
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      timeoutMs: payload ? 60_000 : 25_000,
      maxRedirects: 0,
      maxResponseBytes: 1024 * 1024,
      allowedHosts: ["api.lk888.ai"],
      auditContext: { operation: "design_image_generation" },
    }
  );
  if (!response.ok) {
    if ([400, 401, 403, 404, 422, 429].includes(response.status))
      throw new ProviderRejected(
        `生图服务拒绝请求（${response.status}），请检查模型权限、额度和参数`
      );
    throw new Error(`生图服务暂时未响应（${response.status}）`);
  }
  return unwrapProviderResponse(response.json<any>());
}
// Creation responses wrap task_id in data, while status responses are flat.
export function unwrapProviderResponse(body: any) {
  return body?.data &&
    typeof body.data === "object" &&
    ("task_id" in body.data || "is_final" in body.data)
    ? body.data
    : body;
}
export function parseProviderTaskId(body: any) {
  const id = String(unwrapProviderResponse(body)?.task_id ?? "");
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id))
    throw new Error("服务未返回有效任务编号，请核对服务端记录");
  return id;
}
export function resultUrls(body: any): string[] {
  const urls = Array.isArray(body?.result_urls)
    ? body.result_urls
    : body?.result_url
      ? [body.result_url]
      : [];
  if (!urls.length || urls.length > 4) throw new Error("服务未返回图片");
  return [...new Set<string>(urls)].map(value => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "tos.lingkeai.vip" ||
      url.port ||
      url.username ||
      url.password
    )
      throw new Error("生成图片地址不在受信任存储范围内");
    return url.toString();
  });
}
export async function downloadResult(url: string) {
  const response = await safeHttpRequest(url, {
    timeoutMs: 30_000,
    maxRedirects: 0,
    maxResponseBytes: 20 * 1024 * 1024,
    allowedHosts: ["tos.lingkeai.vip"],
  });
  if (!response.ok) throw new Error("生成成功，图片保存暂未完成");
  return response.body;
}

export function designGenerationPayload(
  prompt: string,
  params: DesignParams,
  images: string[]
) {
  return {
    model: params.model,
    prompt,
    params:
      params.model === DESIGN_BANANA_MODEL
        ? {
            aspectRatio: params.aspect_ratio,
            imageSize: params.resolution,
            thinkingLevel: params.thinking,
            n: 1,
            web_search: false,
            ...(images.length ? { images } : {}),
          }
        : {
            version: params.version,
            aspect_ratio: params.aspect_ratio,
            resolution: params.resolution,
            quality: params.quality,
            background: params.background,
            ...(images.length ? { images } : {}),
          },
  };
}
