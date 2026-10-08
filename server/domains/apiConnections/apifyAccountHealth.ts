import { SafeHttpError, safeHttpRequest } from "../../infrastructure/http/safeHttpClient";

const APIFY_ACCOUNT_HOST = "api.apify.com";
const APIFY_ACCOUNT_PATH = "/v2/users/me";
const APIFY_ACCOUNT_TIMEOUT_MS = 10_000;

type ApifyJsonRequest = {
  path: string;
  token: string;
  method?: "GET" | "POST";
  body?: string;
  timeoutMs?: number;
};

export async function requestApifyJsonIPv4<T>({
  path,
  token,
  method = "GET",
  body,
  timeoutMs = APIFY_ACCOUNT_TIMEOUT_MS,
}: ApifyJsonRequest): Promise<T> {
  if (!path.startsWith("/")) throw new Error("apify_invalid_path");
  const apiPath = path.startsWith("/v2/") ? path : `/v2${path}`;
  try {
    const response = await safeHttpRequest(`https://${APIFY_ACCOUNT_HOST}${apiPath}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } : {}),
      },
      body,
      timeoutMs,
      allowedHosts: [APIFY_ACCOUNT_HOST],
      auditContext: { operation: "api_connections.apify_account_health" },
    });
    if (!response.ok) throw new Error(`apify_http_${response.status}`);
    try {
      return response.json<T>();
    } catch {
      throw new Error("apify_invalid_json");
    }
  } catch (error) {
    if (error instanceof SafeHttpError) {
      throw new Error(error.reason === "timeout" || error.reason === "aborted" ? "apify_timeout" : "apify_network");
    }
    throw error;
  }
}

/**
 * 轻量校验只验证账户端点可认证，不启动Actor、不读取数据集且不产生采集费用。
 * 请求由 Safe HTTP 统一解析、校验目标地址并执行，不启动Actor或读取数据集。
 */
export async function verifyApifyAccountToken(token: string): Promise<void> {
  await requestApifyJsonIPv4<unknown>({ path: APIFY_ACCOUNT_PATH, token });
}

export const APIFY_ACCOUNT_HEALTH_CONTRACT = {
  host: APIFY_ACCOUNT_HOST,
  path: APIFY_ACCOUNT_PATH,
  timeoutMs: APIFY_ACCOUNT_TIMEOUT_MS,
  allowedHosts: [APIFY_ACCOUNT_HOST],
} as const;
