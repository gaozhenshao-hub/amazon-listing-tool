import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { CompetitorAnalysis, InsertCompetitorAnalysis } from "../../../drizzle/schema/project";

const RECORD_FIELDS = [
  "id", "projectId", "asin", "title", "bulletPoints", "imageUrls", "price", "rating", "reviewCount",
  "reviewAnalysis", "keywords", "rawData", "aiSummary", "summary", "summaryStatus", "summaryVersion",
  "summaryConfirmedBy", "summaryConfirmedAt", "createdAt", "updatedAt",
] as const satisfies readonly (keyof CompetitorAnalysis)[];
const SOURCE_COLUMNS = ["title", "bulletPoints", "imageUrls", "price", "rating", "reviewCount"] as const;
// These are the source envelopes emitted by the current acquisition/manual/
// SellerSprite writers. Unknown raw keys are preserved, not claimed as original
// source evidence. In particular, reviewAnalysis is model output, not reviews.
const RAW_SOURCE_KEYS = [
  "source", "confirmedSnapshotId", "contentHash", "sellerSpriteSourceHash", "sellerSpriteData",
  "importSource", "manualInput", "scrapedData",
] as const;
const RESULT_COLUMNS = ["summary", "aiSummary", "keywords"] as const;
// Current competitor prompt fields plus the acquisition writer's nested result.
// This is not a new deep-analysis protocol or a completion marker allowlist.
const RAW_RESULT_KEYS = ["analysis", "titleAnalysis", "bulletPointsAnalysis", "keywords", "advantages", "weaknesses", "summary", "competitivePositioning"] as const;
type JsonObject = Record<string, unknown>;
type Update = Partial<InsertCompetitorAnalysis>;

function invalid(message: string, incoming = false): never {
  throw new TRPCError({ code: incoming ? "BAD_REQUEST" : "PRECONDITION_FAILED", message });
}

function dataObject(value: unknown, incoming = false): Record<string, PropertyDescriptor> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid("COMPETITOR_RECORD_INVALID", incoming);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== "string")
    || Object.values(descriptors).some(field => !("value" in field) || !field.enumerable)) return invalid("COMPETITOR_RECORD_INVALID", incoming);
  return descriptors;
}

/** Stable JSON with no silent omissions, property accessors, or local-time Date formatting. */
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (value instanceof Date) {
    try { return JSON.stringify(Date.prototype.toISOString.call(value)); }
    catch { return invalid("COMPETITOR_RECORD_INVALID"); }
  }
  if (Array.isArray(value)) {
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1
      || Array.from({ length: value.length }, (_, index) => String(index)).some(key => !fields[key]
        || !("value" in fields[key]) || !fields[key].enumerable)) return invalid("COMPETITOR_RAW_DATA_INVALID");
    return `[${Array.from({ length: value.length }, (_, index) => canonical(fields[String(index)].value)).join(",")}]`;
  }
  const fields = dataObject(value);
  return `{${Object.keys(fields).sort().map(key => `${JSON.stringify(key)}:${canonical(fields[key].value)}`).join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

/** Server-only exact persisted-value hash used by comparison CAS. */
export const competitorDataHash = digest;

function validateRecord(row: CompetitorAnalysis): void {
  const fields = dataObject(row);
  if (Object.keys(fields).length !== RECORD_FIELDS.length || RECORD_FIELDS.some(key => !fields[key])) return invalid("COMPETITOR_RECORD_INVALID");
  for (const key of RECORD_FIELDS) {
    const value: unknown = fields[key].value;
    if (["id", "projectId", "summaryVersion", "summaryConfirmedBy"].includes(key)) {
      if (!(key === "summaryConfirmedBy" && value === null) && (!Number.isSafeInteger(value) || (value as number) <= 0)) return invalid("COMPETITOR_RECORD_INVALID");
    } else if (["createdAt", "updatedAt", "summaryConfirmedAt"].includes(key)) {
      if (!(key === "summaryConfirmedAt" && value === null) && !(value instanceof Date)) return invalid("COMPETITOR_RECORD_INVALID");
    } else if (key === "summaryStatus") {
      if (value !== "draft" && value !== "confirmed") return invalid("COMPETITOR_RECORD_INVALID");
    } else if (key === "asin") {
      if (typeof value !== "string" || !value.trim()) return invalid("COMPETITOR_RECORD_INVALID");
    } else if (value !== null && typeof value !== "string") return invalid("COMPETITOR_RECORD_INVALID");
  }
  canonical(row);
}

/** Whole persisted-row CAS fingerprint. JSON text stays byte-exact; only actual Dates are normalized. */
export function competitorRevision(row: CompetitorAnalysis): string {
  validateRecord(row);
  return digest(row);
}

function rawObject(value: string | null | undefined, incoming = false): JsonObject {
  if (value === null || value === undefined) return {};
  if (typeof value !== "string") return invalid("COMPETITOR_RAW_DATA_INVALID", incoming);
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return invalid("COMPETITOR_RAW_DATA_INVALID", incoming); }
  try { dataObject(parsed); canonical(parsed); } catch { return invalid("COMPETITOR_RAW_DATA_INVALID", incoming); }
  return parsed as JsonObject;
}

/** Acquisition/import callers cannot mint a trusted human calibration, even on
 * the first insert. Existing calibrations are retained by the locked merger. */
export function stripIncomingManualSales(data: InsertCompetitorAnalysis): InsertCompetitorAnalysis {
  if (data.rawData === null || data.rawData === undefined) return data;
  const raw = rawObject(data.rawData, true);
  if (!Object.hasOwn(raw, "manualSales") && !Object.hasOwn(raw, "deepAdoptionRef")) return data;
  delete raw.manualSales;
  delete raw.deepAdoptionRef;
  return { ...data, rawData: canonical(raw) };
}

function sourceRevision(row: Pick<CompetitorAnalysis, "projectId" | "asin" | typeof SOURCE_COLUMNS[number]>, raw: JsonObject): string {
  const sources = Object.fromEntries(RAW_SOURCE_KEYS.filter(key => Object.hasOwn(raw, key)).map(key => [key, raw[key]]));
  // Human calibration is source evidence, but never an acquisition-writable key.
  if (Object.hasOwn(raw, "manualSales")) sources.manualSales = raw.manualSales;
  // The upload digest, not an AI summary or display filename, identifies the
  // original review file. This does not claim original review text is persisted.
  const reviewImport = raw.reviewImport;
  if (reviewImport !== undefined && reviewImport !== null) {
    const fields = dataObject(reviewImport);
    if (fields.sourceHash) sources.reviewSourceHash = fields.sourceHash.value;
  }
  return digest({ projectId: row.projectId, asin: row.asin, ...Object.fromEntries(SOURCE_COLUMNS.map(key => [key, row[key]])), sources });
}

/** Pure merge only. The repository must supply the current locked full row and
 * perform its own parent authorization, transaction and revision checks. This
 * does not authorize a new analysis or attest that any model run completed. */
export function mergeCompetitorUpdate(
  existing: CompetitorAnalysis,
  incoming: Partial<InsertCompetitorAnalysis>,
  options: { kind: "upsert" | "reviews" },
): Update {
  validateRecord(existing);
  const fields = dataObject(incoming, true);
  if (options.kind !== "upsert" && options.kind !== "reviews") return invalid("COMPETITOR_WRITE_KIND_INVALID", true);
  if (Object.keys(fields).some(key => !RECORD_FIELDS.includes(key as typeof RECORD_FIELDS[number]))) return invalid("COMPETITOR_RECORD_INVALID", true);
  for (const key of ["id", "projectId", "asin"] as const) {
    if (fields[key]?.value !== undefined && fields[key].value !== existing[key]) {
      throw new TRPCError({ code: "CONFLICT", message: "COMPETITOR_IDENTITY_CHANGED" });
    }
  }
  const oldRaw = rawObject(existing.rawData);
  const newRaw = rawObject(fields.rawData?.value, true);
  const beforeSourceRevision = sourceRevision(existing, oldRaw);
  const hasReviewPair = Boolean(existing.reviewAnalysis) || Object.hasOwn(oldRaw, "reviewImport");
  // Unknown/AI top-level fields already stored belong to the locked record.
  // A review writer carries an old whole-object spread, so only its explicit
  // review envelope is allowed to replace an existing key.
  const raw: JsonObject = options.kind === "reviews" ? { ...oldRaw } : { ...newRaw, ...oldRaw };
  if (Object.hasOwn(oldRaw, "manualSales")) raw.manualSales = oldRaw.manualSales;
  else delete raw.manualSales;
  // Only the dedicated, transactional human-adoption lane can mint/replace it.
  if (Object.hasOwn(oldRaw, "deepAdoptionRef")) raw.deepAdoptionRef = oldRaw.deepAdoptionRef;
  else delete raw.deepAdoptionRef;
  const update: Update = {};
  const confirmed = existing.summaryStatus === "confirmed";
  const humanEdited = Boolean(existing.summary?.trim()) && existing.summary !== existing.aiSummary;
  const columns = options.kind === "reviews" ? ["reviewCount"] as const : SOURCE_COLUMNS;
  for (const key of columns) {
    const value = fields[key]?.value;
    if (value !== undefined && value !== null) {
      if (typeof value !== "string") return invalid("COMPETITOR_RECORD_INVALID", true);
      update[key] = value;
    }
  }
  if (options.kind === "upsert") {
    for (const key of RAW_SOURCE_KEYS) {
      if (Object.hasOwn(newRaw, key) && newRaw[key] !== null) raw[key] = newRaw[key];
    }
    for (const key of RAW_RESULT_KEYS) {
      if (!confirmed && Object.hasOwn(newRaw, key) && newRaw[key] !== null) raw[key] = newRaw[key];
    }
    // The no-row review-import branch can race with a real insert. Do not pair
    // a new upload digest with an old analysis, or overwrite a newer digest with
    // the stale candidate. Only the explicit reviews lane may replace that pair.
    if (hasReviewPair) {
      if (newRaw.reviewImport !== undefined && newRaw.reviewImport !== null) {
        const newHash: unknown = dataObject(newRaw.reviewImport, true).sourceHash?.value;
        const oldHash: unknown = oldRaw.reviewImport === undefined || oldRaw.reviewImport === null
          ? undefined : dataObject(oldRaw.reviewImport).sourceHash?.value;
        if (typeof newHash !== "string" || !newHash.trim() || typeof oldHash !== "string" || newHash !== oldHash) {
          // A silent no-op would let the no-row importer report that a different
          // upload was saved. Reject the whole candidate; do not just keep raw.
          throw new TRPCError({ code: "CONFLICT", message: "COMPETITOR_REVIEW_SOURCE_CHANGED" });
        }
      }
      for (const key of ["reviewImport", "importedReviews"] as const) {
        if (Object.hasOwn(oldRaw, key)) raw[key] = oldRaw[key];
        else delete raw[key];
      }
    }
    // Preserve human edits without disabling the existing unedited-draft
    // reanalysis flow. This does not protect a late model result with a source
    // lease; a future durable reanalysis protocol must provide that separately.
    for (const key of RESULT_COLUMNS) {
      const value = fields[key]?.value;
      const protectedColumn = confirmed || (key === "summary" && humanEdited);
      if (!protectedColumn && value !== undefined && value !== null) {
        if (typeof value !== "string") return invalid("COMPETITOR_RECORD_INVALID", true);
        update[key] = value;
      }
    }
  } else {
    if (newRaw.reviewImport !== undefined && newRaw.reviewImport !== null) {
      const nextReview = dataObject(newRaw.reviewImport, true);
      const hash: unknown = nextReview.sourceHash?.value;
      if (typeof hash !== "string" || !hash.trim()) return invalid("COMPETITOR_REVIEW_SOURCE_INVALID", true);
      const oldHash = oldRaw.reviewImport === undefined || oldRaw.reviewImport === null
        ? undefined : dataObject(oldRaw.reviewImport).sourceHash?.value;
      const analysis: unknown = fields.reviewAnalysis?.value;
      if (hash !== oldHash && (typeof analysis !== "string" || !analysis.trim())) {
        throw new TRPCError({ code: "CONFLICT", message: "COMPETITOR_REVIEW_RESULT_REQUIRED" });
      }
    }
    for (const key of ["reviewImport", "importedReviews"] as const) {
      if (Object.hasOwn(newRaw, key) && newRaw[key] !== null) raw[key] = newRaw[key];
    }
  }
  const reviewAnalysis = fields.reviewAnalysis?.value;
  if (reviewAnalysis !== undefined && reviewAnalysis !== null && (options.kind === "reviews" || !hasReviewPair)) {
    if (typeof reviewAnalysis !== "string") return invalid("COMPETITOR_RECORD_INVALID", true);
    update.reviewAnalysis = reviewAnalysis;
  }
  // Never accept a caller's completion/staleness assertion as provenance.
  for (const key of ["analysisStale", "captureOnly"] as const) {
    if (Object.hasOwn(oldRaw, key)) raw[key] = oldRaw[key];
    else delete raw[key];
  }
  const retainedOldResult = confirmed || humanEdited
    || (options.kind === "reviews" && Boolean(existing.summary?.trim() || existing.aiSummary?.trim()))
    || (Object.hasOwn(oldRaw, "deepAnalysis") && oldRaw.deepAnalysis !== null);
  const afterSourceRevision = sourceRevision({ ...existing, ...update }, raw);
  if (retainedOldResult && beforeSourceRevision !== afterSourceRevision) raw.analysisStale = true;
  if (canonical(raw) !== canonical(oldRaw)) update.rawData = canonical(raw);
  // No identity, timestamps or summary-review state/version is returned.
  return update;
}
