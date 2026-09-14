import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("受控API连接安全契约", () => {
  it("密钥管理页只提供空白替换输入，不渲染掩码历史值或明文回填", () => {
    const source = read("client/src/pages/apiConnections/ApiConnectionManager.tsx");
    expect(source).toContain('type="password"');
    expect(source).toContain('placeholder={field.configured ? "留空则保留当前密钥；重新输入即可替换"');
    expect(source).not.toContain("••••••••");
    expect(source).not.toContain("secretValue");
  });

  it("连接状态合同仅公开配置与版本元数据，不包含密文或解密字段", () => {
    const source = read("server/domains/apiConnections/service.ts");
    expect(source).toContain("keyVersion: useStoredSecret ? row.keyVersion : null");
    expect(source).not.toContain("ciphertext:");
    expect(source).not.toContain("encryptedValue:");
    expect(source).not.toContain("decryptToolSecretValue");
  });

  it("赛狐在官方受限API合同登记前失败关闭，不构造或调用远程业务接口", () => {
    const source = read("server/domains/apiConnections/service.ts");
    const saihuStart = source.indexOf('if (input.connection === "saihu")');
    const tryStart = source.indexOf("try {", saihuStart);
    expect(saihuStart).toBeGreaterThan(-1);
    expect(tryStart).toBeGreaterThan(saihuStart);
    expect(source.slice(saihuStart, tryStart)).toContain('"provider_contract_required"');
  });

  it("业务Adapter优先解析受控Secret引用，旧环境变量只保留服务器端兼容回退", () => {
    const acquisitionAdapter = read("server/domains/acquisition/apifyProvider.ts");
    const monitorAdapter = read("server/domains/acquisition/apifyMonitorProvider.ts");
    const resolver = read("server/domains/ai_os/services/toolGateway/governanceCore.ts");
    expect(acquisitionAdapter).toContain('resolveToolSecretReference("secret://integration.apify.api_token", null)');
    expect(monitorAdapter).toContain('resolveToolSecretReference("secret://integration.apify.api_token", null)');
    expect(resolver).toContain('"integration.apify.api_token": "APIFY_API_TOKEN"');
  });
});
