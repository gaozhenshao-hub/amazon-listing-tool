import { z } from "zod";

export const ApiConnectionCodeSchema = z.enum(["saihu"]);
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
