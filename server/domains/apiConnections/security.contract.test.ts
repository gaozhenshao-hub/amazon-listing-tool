import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("受控API连接安全契约", () => {

  it("连接状态合同仅公开配置与版本元数据，不包含密文或解密字段", () => {
    const source = read("server/domains/apiConnections/service.ts");
    expect(source).toContain("keyVersion: useStoredSecret ? row.keyVersion : null");
    expect(source).not.toContain("ciphertext:");
    expect(source).not.toContain("encryptedValue:");
    expect(source).not.toContain("decryptToolSecretValue");
  });

  it("赛狐在官方受限API合同登记前失败关闭，不构造或调用远程业务接口", () => {
    const source = read("server/domains/apiConnections/service.ts");
    const body = source.slice(source.indexOf("export async function validateApiConnection"),source.indexOf("export async function rewrapApiConnectionSecrets"));
    expect(body).toContain('"provider_contract_required"');
    expect(body).not.toContain('success: true');
    expect(source).not.toContain('safeHttpRequest');
  });
});
