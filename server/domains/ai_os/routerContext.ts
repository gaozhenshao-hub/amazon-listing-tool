import { TRPCError } from "@trpc/server";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../../repositories/dbClient";

export function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeSkillVersionForDb(value: unknown): number {
  const version = Number.parseInt(String(value ?? "1").trim().split(".")[0] || "1", 10);
  return Number.isFinite(version) && version > 0 ? version : 1;
}

export async function rawExecute(sqlStr: string, params: any[] = []): Promise<any[]> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  let result: any;
  if (params.length > 0) {
    const parts = sqlStr.split("?");
    const chunks: any[] = [];
    for (let i = 0; i < parts.length; i++) {
      chunks.push(drizzleSql.raw(parts[i]));
      if (i < params.length) {
        chunks.push(drizzleSql`${params[i]}`);
      }
    }
    const combined = drizzleSql.join(chunks, drizzleSql.raw(""));
    result = await db.execute(combined);
  } else {
    result = await db.execute(drizzleSql.raw(sqlStr));
  }
  const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
  return Array.isArray(rows) ? rows as any[] : [];
}

export async function getSkillBySlug(slug: string) {
  const rows = await rawExecute("SELECT * FROM emperor_skills WHERE slug = ? LIMIT 1", [slug]);
  return rows[0] || null;
}

export function parseManifest(skill: any) {
  if (!skill) return null;
  const manifest = typeof skill.manifest === "string" ? JSON.parse(skill.manifest) : skill.manifest;
  return { ...skill, manifest };
}

export interface ResolvedModel {
  modelId: string;
  provider: string;
  baseUrl?: string;
  apiKeyRef?: string;
  costPer1kInputTokens?: number;
  costPer1kOutputTokens?: number;
}

export async function resolveModel(skill: any, modelOverrideSlug?: string): Promise<ResolvedModel> {
  const fromRow = (row: any): ResolvedModel => ({
    modelId: row.modelId,
    provider: row.provider,
    baseUrl: row.baseUrl || undefined,
    apiKeyRef: row.apiKeyRef || undefined,
    costPer1kInputTokens: Number(row.costPer1kInputTokens || 0),
    costPer1kOutputTokens: Number(row.costPer1kOutputTokens || 0),
  });
  if (modelOverrideSlug) {
    const rows = await rawExecute("SELECT * FROM emperor_model_providers WHERE slug = ? AND isActive = 1 LIMIT 1", [modelOverrideSlug]);
    if (rows[0]) return fromRow(rows[0]);
  }
  if (skill.modelOverride) {
    const rows = await rawExecute("SELECT * FROM emperor_model_providers WHERE slug = ? AND isActive = 1 LIMIT 1", [skill.modelOverride]);
    if (rows[0]) return fromRow(rows[0]);
  }
  const manifest = typeof skill.manifest === "string" ? JSON.parse(skill.manifest) : skill.manifest;
  const modelPolicy = manifest?.implementation?.modelPolicy;
  if (modelPolicy) {
    const rows = await rawExecute("SELECT * FROM emperor_model_providers WHERE modelId = ? AND isActive = 1 LIMIT 1", [modelPolicy]);
    if (rows[0]) return fromRow(rows[0]);
  }
  const defaultRows = await rawExecute("SELECT * FROM emperor_model_providers WHERE isDefault = 1 AND isActive = 1 LIMIT 1");
  if (defaultRows[0]) return fromRow(defaultRows[0]);
  return { modelId: "manus-default", provider: "manus_builtin" };
}
