import { describe, expect, it } from "vitest";
import { safeHttpRequest } from "../../../infrastructure/http/safeHttpClient";
import { createRestrictedTeamorouterSocksAgent } from "./skillRunner";

const shouldRun = process.env.RUN_TEAMOROUTER_SOCKS_PROXY_TEST === "1";

describe("Teamorouter SOCKS出口约束", () => {
  it("仅为Teamorouter主机创建代理，其他业务主机保持直连", () => {
    expect(createRestrictedTeamorouterSocksAgent("https://api.lingxing.com/v1/data", "socks5h://127.0.0.1:1088")).toBeUndefined();
  });

  it("拒绝非回环或非SOCKS代理配置", () => {
    expect(() => createRestrictedTeamorouterSocksAgent("https://api.teamorouter.com/v1/models", "https://proxy.example.com:443")).toThrow("local socks5 endpoint");
    expect(() => createRestrictedTeamorouterSocksAgent("https://api.teamorouter.com/v1/models", "socks5h://10.0.0.8:1088")).toThrow("local socks5 endpoint");
  });
});

(shouldRun ? describe : describe.skip)("Teamorouter本机SOCKS出口", () => {
  it("通过受限本机SOCKS出口读取轻量模型目录", async () => {
    const proxy = process.env.TEAMOROUTER_SOCKS_PROXY || "";
    const agent = createRestrictedTeamorouterSocksAgent("https://api.teamorouter.com/v1/models", proxy);
    expect(agent).toBeDefined();

    const response = await safeHttpRequest("https://api.teamorouter.com/v1/models", {
      agent,
      timeoutMs: 15_000,
      maxResponseBytes: 2 * 1024 * 1024,
      allowedHosts: ["api.teamorouter.com"],
      auditContext: { operation: "ai_os.teamorouter_socks_proxy_test" },
    });
    expect([200, 401]).toContain(response.status);
  }, 20_000);
});
