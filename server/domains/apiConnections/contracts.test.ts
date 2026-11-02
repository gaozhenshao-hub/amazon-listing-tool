import { describe, expect, it } from "vitest";
import {
  API_CONNECTION_DEFINITIONS,
  ApiConnectionSecretValuesSchema,
  apiConnectionSecretSlug,
  assertKnownApiConnectionFields,
} from "./contracts";

describe("受控API连接合同", () => {
  it("仅登记领星、Apify和赛狐，并固定系统级Secret引用命名", () => {
    expect(Object.keys(API_CONNECTION_DEFINITIONS)).toEqual(["apify", "lingxing", "saihu"]);
    expect(apiConnectionSecretSlug("apify", "api_token")).toBe("integration.apify.api_token");
    expect(apiConnectionSecretSlug("lingxing", "mcp_key")).toBe("integration.lingxing.mcp_key");
  });

  it("拒绝空值与未知密钥字段", () => {
    expect(() => ApiConnectionSecretValuesSchema.parse({})).toThrow();
    expect(() => assertKnownApiConnectionFields("apify", { unexpected: "value" })).toThrow("不允许");
  });

  it("将赛狐明确标为待受限官方API合同，禁止将其误报为已接入", () => {
    expect(API_CONNECTION_DEFINITIONS.saihu.integrationStatus).toBe("pending_provider_contract");
    expect(API_CONNECTION_DEFINITIONS.saihu.validationMode).toBe("configuration_only");
  });
});
