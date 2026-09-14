import { z } from "zod";

export const ApiConnectionCodeSchema = z.enum(["apify", "lingxing", "saihu"]);
export type ApiConnectionCode = z.infer<typeof ApiConnectionCodeSchema>;

export type ApiConnectionSecretField = {
  key: string;
  label: string;
  requiredForReady: boolean;
  fallbackEnvironmentKey: string | null;
};

export type ApiConnectionDefinition = {
  code: ApiConnectionCode;
  displayName: string;
  purpose: string;
  validationMode: "remote_read_only" | "configuration_only";
  integrationStatus: "active" | "pending_provider_contract";
  secretFields: readonly ApiConnectionSecretField[];
};

export const API_CONNECTION_DEFINITIONS: Record<ApiConnectionCode, ApiConnectionDefinition> = {
  apify: {
    code: "apify",
    displayName: "Apify",
    purpose: "Amazon受控采集与价格、Offer、BSR、关键词排名监控",
    validationMode: "remote_read_only",
    integrationStatus: "active",
    secretFields: [
      { key: "api_token", label: "API Token", requiredForReady: true, fallbackEnvironmentKey: "APIFY_API_TOKEN" },
    ],
  },
  lingxing: {
    code: "lingxing",
    displayName: "领星",
    purpose: "官方MCP只读产品、库存、广告与财务数据读取",
    validationMode: "remote_read_only",
    integrationStatus: "active",
    secretFields: [
      { key: "mcp_key", label: "MCP访问密钥", requiredForReady: true, fallbackEnvironmentKey: "LINGXING_MCP_KEY" },
      { key: "app_id", label: "应用ID（可选）", requiredForReady: false, fallbackEnvironmentKey: "LINGXING_APP_ID" },
      { key: "app_secret", label: "应用密钥（可选）", requiredForReady: false, fallbackEnvironmentKey: "LINGXING_APP_SECRET" },
    ],
  },
  saihu: {
    code: "saihu",
    displayName: "赛狐ERP",
    purpose: "当前用于人工上传与人员映射；实时API需在登记官方受限合同后单独启用",
    validationMode: "configuration_only",
    integrationStatus: "pending_provider_contract",
    secretFields: [
      { key: "api_token", label: "API Token（可选）", requiredForReady: false, fallbackEnvironmentKey: "SAIHU_API_TOKEN" },
      { key: "app_id", label: "应用ID（可选）", requiredForReady: false, fallbackEnvironmentKey: "SAIHU_APP_ID" },
      { key: "app_secret", label: "应用密钥（可选）", requiredForReady: false, fallbackEnvironmentKey: "SAIHU_APP_SECRET" },
    ],
  },
};

export const ApiConnectionSecretValuesSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/),
  z.string().trim().min(1).max(8_192),
).refine(values => Object.keys(values).length > 0, "请至少填写一个待保存的密钥字段");

export const SaveApiConnectionInputSchema = z.object({
  connection: ApiConnectionCodeSchema,
  values: ApiConnectionSecretValuesSchema,
});

export const ValidateApiConnectionInputSchema = z.object({
  connection: ApiConnectionCodeSchema,
});

export const RewrapApiConnectionInputSchema = z.object({
  connection: ApiConnectionCodeSchema,
});

export function apiConnectionSecretSlug(connection: ApiConnectionCode, fieldKey: string): string {
  return `integration.${connection}.${fieldKey}`;
}

export function getApiConnectionDefinition(connection: ApiConnectionCode): ApiConnectionDefinition {
  return API_CONNECTION_DEFINITIONS[connection];
}

export function assertKnownApiConnectionFields(connection: ApiConnectionCode, values: Record<string, string>) {
  const known = new Set(getApiConnectionDefinition(connection).secretFields.map(field => field.key));
  for (const key of Object.keys(values)) {
    if (!known.has(key)) throw new Error("存在不允许的连接密钥字段");
  }
}
