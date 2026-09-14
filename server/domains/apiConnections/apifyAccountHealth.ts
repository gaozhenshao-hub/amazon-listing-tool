import { request as httpsRequest } from "node:https";

const APIFY_ACCOUNT_HOST = "api.apify.com";
const APIFY_ACCOUNT_PATH = "/v2/users/me";
const APIFY_ACCOUNT_TIMEOUT_MS = 10_000;

/**
 * 轻量校验只验证账户端点可认证，不启动Actor、不读取数据集且不产生采集费用。
 * 强制IPv4避免部分生产网络的IPv6黑洞导致受控校验误报超时。
 */
export async function verifyApifyAccountToken(token: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = httpsRequest({
      hostname: APIFY_ACCOUNT_HOST,
      path: APIFY_ACCOUNT_PATH,
      method: "GET",
      family: 4,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      timeout: APIFY_ACCOUNT_TIMEOUT_MS,
    }, response => {
      response.resume();
      const statusCode = response.statusCode || 0;
      if (statusCode >= 200 && statusCode < 300) {
        resolve();
        return;
      }
      reject(new Error(`apify_http_${statusCode}`));
    });

    request.once("timeout", () => request.destroy(new Error("apify_timeout")));
    request.once("error", reject);
    request.end();
  });
}

export const APIFY_ACCOUNT_HEALTH_CONTRACT = {
  host: APIFY_ACCOUNT_HOST,
  path: APIFY_ACCOUNT_PATH,
  timeoutMs: APIFY_ACCOUNT_TIMEOUT_MS,
  family: 4,
} as const;
