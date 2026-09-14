import { request as httpsRequest } from "node:https";

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
  return new Promise<T>((resolve, reject) => {
    const request = httpsRequest({
      hostname: APIFY_ACCOUNT_HOST,
      path: apiPath,
      method,
      family: 4,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
      },
      timeout: timeoutMs,
    }, response => {
      const statusCode = response.statusCode || 0;
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.once("error", () => reject(new Error("apify_network")));
      response.once("end", () => {
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`apify_http_${statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
        } catch {
          reject(new Error("apify_invalid_json"));
        }
      });
    });
    request.once("timeout", () => request.destroy(new Error("apify_timeout")));
    request.once("error", error => reject(new Error(error.message === "apify_timeout" ? "apify_timeout" : "apify_network")));
    request.end(body);
  });
}

/**
 * 轻量校验只验证账户端点可认证，不启动Actor、不读取数据集且不产生采集费用。
 * 强制IPv4避免部分生产网络的IPv6黑洞导致受控校验误报超时。
 */
export async function verifyApifyAccountToken(token: string): Promise<void> {
  await requestApifyJsonIPv4<unknown>({ path: APIFY_ACCOUNT_PATH, token });
}

export const APIFY_ACCOUNT_HEALTH_CONTRACT = {
  host: APIFY_ACCOUNT_HOST,
  path: APIFY_ACCOUNT_PATH,
  timeoutMs: APIFY_ACCOUNT_TIMEOUT_MS,
  family: 4,
} as const;
