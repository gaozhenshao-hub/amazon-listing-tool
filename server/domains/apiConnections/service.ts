import { and, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { emperorToolSecrets } from "../../../drizzle/schema/ai_os";
import { requireDb } from "../../repositories/dbClient";
import {
  getSecretReferenceFallbackEnvironmentKey,
  rotateEmperorToolSecret,
  upsertEmperorToolSecret,
} from "../ai_os/services/toolGateway";
import {
  API_CONNECTION_DEFINITIONS,
  apiConnectionSecretSlug,
  assertKnownApiConnectionFields,
  getApiConnectionDefinition,
  type ApiConnectionCode,
} from "./contracts";

type ValidationStatus = "not_checked" | "verified" | "configuration_valid" | "pending_provider_contract" | "failed";
type StoredSecretRow = Pick<typeof emperorToolSecrets.$inferSelect, "slug" | "status" | "keyVersion" | "rotatedAt" | "updatedAt" | "metadata">;

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function validationFromMetadata(metadata: unknown) {
  const validation = toRecord(toRecord(metadata).validation);
  const status = typeof validation.status === "string" ? validation.status as ValidationStatus : "not_checked";
  return {
    status,
    checkedAt: typeof validation.checkedAt === "string" ? validation.checkedAt : null,
    errorCode: typeof validation.errorCode === "string" ? validation.errorCode : null,
  };
}

async function loadStoredRows(connection: ApiConnectionCode): Promise<Map<string, StoredSecretRow>> {
  const definition = getApiConnectionDefinition(connection);
  const slugs = definition.secretFields.map(field => apiConnectionSecretSlug(connection, field.key));
  const db = await requireDb("API connection secrets");
  const rows = await db.select({
    slug: emperorToolSecrets.slug,
    status: emperorToolSecrets.status,
    keyVersion: emperorToolSecrets.keyVersion,
    rotatedAt: emperorToolSecrets.rotatedAt,
    updatedAt: emperorToolSecrets.updatedAt,
    metadata: emperorToolSecrets.metadata,
  }).from(emperorToolSecrets).where(and(inArray(emperorToolSecrets.slug, slugs), isNull(emperorToolSecrets.workspaceId)));
  return new Map(rows.map((row: StoredSecretRow) => [row.slug, row]));
}

function fieldState(connection: ApiConnectionCode, field: { key: string; label: string; requiredForReady: boolean }, rows: Map<string, StoredSecretRow>) {
  const row = rows.get(apiConnectionSecretSlug(connection, field.key));
  const fallbackEnvironmentKey = getSecretReferenceFallbackEnvironmentKey(apiConnectionSecretSlug(connection, field.key));
  const useStoredSecret = row?.status === "active";
  const useEnvironmentFallback = !useStoredSecret && Boolean(fallbackEnvironmentKey && process.env[fallbackEnvironmentKey]);
  return {
    key: field.key,
    label: field.label,
    requiredForReady: field.requiredForReady,
    configured: useStoredSecret || useEnvironmentFallback,
    source: useStoredSecret ? "managed_secret" as const : useEnvironmentFallback ? "environment_compatibility" as const : "not_configured" as const,
    keyVersion: useStoredSecret ? row.keyVersion : null,
    updatedAt: useStoredSecret ? row.updatedAt : null,
  };
}

/** 为既有Provider状态页提供后台密钥优先且失败关闭的服务器端就绪检查。 */
export async function isApiConnectionSecretConfigured(connection: ApiConnectionCode, fieldKey: string): Promise<boolean> {
  const definition = getApiConnectionDefinition(connection);
  const field = definition.secretFields.find(item => item.key === fieldKey);
  if (!field) return false;
  try {
    const rows = await loadStoredRows(connection);
    return fieldState(connection, field, rows).configured;
  } catch {
    const fallbackEnvironmentKey = getSecretReferenceFallbackEnvironmentKey(apiConnectionSecretSlug(connection, fieldKey));
    return Boolean(fallbackEnvironmentKey && process.env[fallbackEnvironmentKey]);
  }
}

export async function listApiConnectionStates() {
  return Promise.all(Object.keys(API_CONNECTION_DEFINITIONS).map(async (connection) => {
    const code = connection as ApiConnectionCode;
    const definition = getApiConnectionDefinition(code);
    const rows = await loadStoredRows(code);
    const fields = definition.secretFields.map(field => fieldState(code, field, rows));
    const requiredConfigured = fields.filter(field => field.requiredForReady).every(field => field.configured);
    const validationRows = definition.secretFields
      .map(field => rows.get(apiConnectionSecretSlug(code, field.key)))
      .filter((row): row is StoredSecretRow => Boolean(row));
    const latest = validationRows
      .map(row => validationFromMetadata(row.metadata))
      .sort((a, b) => String(b.checkedAt || "").localeCompare(String(a.checkedAt || "")))[0]
      || { status: "not_checked" as ValidationStatus, checkedAt: null, errorCode: null };
    return {
      code,
      displayName: definition.displayName,
      purpose: definition.purpose,
      validationMode: definition.validationMode,
      integrationStatus: definition.integrationStatus,
      ready: requiredConfigured && definition.integrationStatus === "active",
      fields,
      validation: latest,
    };
  }));
}

export async function saveApiConnectionSecrets(input: {
  connection: ApiConnectionCode;
  values: Record<string, string>;
  userId: number;
}) {
  assertKnownApiConnectionFields(input.connection, input.values);
  const definition = getApiConnectionDefinition(input.connection);
  for (const [fieldKey, value] of Object.entries(input.values)) {
    const normalized = value.trim();
    if (!normalized) continue;
    const field = definition.secretFields.find(item => item.key === fieldKey);
    if (!field) throw new TRPCError({ code: "BAD_REQUEST", message: "不允许的连接密钥字段" });
    await upsertEmperorToolSecret({
      slug: apiConnectionSecretSlug(input.connection, fieldKey),
      value: normalized,
      description: `${definition.displayName} ${field.label}`,
      workspaceId: null,
      userId: input.userId,
      metadata: {
        connection: input.connection,
        field: fieldKey,
        validation: { status: "not_checked", checkedAt: null, errorCode: null },
      },
    });
  }
  return listApiConnectionStates();
}

async function persistValidation(input: {
  connection: ApiConnectionCode;
  status: ValidationStatus;
  errorCode?: string | null;
  userId: number;
}) {
  const definition = getApiConnectionDefinition(input.connection);
  const rows = await loadStoredRows(input.connection);
  const checkedAt = new Date().toISOString();
  const db = await requireDb("API connection validation");
  await Promise.all(definition.secretFields.map(async field => {
    const slug = apiConnectionSecretSlug(input.connection, field.key);
    const row = rows.get(slug);
    if (!row || row.status !== "active") return;
    await db.update(emperorToolSecrets).set({
      metadata: {
        ...toRecord(row.metadata),
        connection: input.connection,
        field: field.key,
        validation: { status: input.status, checkedAt, errorCode: input.errorCode || null },
      },
      updatedBy: input.userId,
    }).where(and(eq(emperorToolSecrets.slug, slug), isNull(emperorToolSecrets.workspaceId)));
  }));
  return { status: input.status, checkedAt, errorCode: input.errorCode || null };
}

export async function validateApiConnection(input: { connection: ApiConnectionCode; userId: number }) {
  const state = (await listApiConnectionStates()).find(item => item.code === input.connection);
  if (!state || !state.fields.filter(field => field.requiredForReady).every(field => field.configured)) {
    const validation = await persistValidation({ ...input, status: "failed", errorCode: "not_configured" });
    return { connection: input.connection, success: false, validation };
  }
  const validation = await persistValidation({ ...input, status: "pending_provider_contract", errorCode: "provider_contract_required" });
  return { connection: input.connection, success: false, validation };
}

export async function rewrapApiConnectionSecrets(input: { connection: ApiConnectionCode; userId: number }) {
  const definition = getApiConnectionDefinition(input.connection);
  const rows = await loadStoredRows(input.connection);
  const rotated = [] as string[];
  for (const field of definition.secretFields) {
    const slug = apiConnectionSecretSlug(input.connection, field.key);
    if (rows.get(slug)?.status !== "active") continue;
    await rotateEmperorToolSecret({ slug, workspaceId: null, userId: input.userId });
    rotated.push(field.key);
  }
  return { connection: input.connection, rotatedFields: rotated, states: await listApiConnectionStates() };
}
