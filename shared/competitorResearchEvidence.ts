import { z } from "zod";
import { CompetitorSalesProjectionSchema } from "./competitorSales";
import {
  COMPETITOR_REVIEW_PARSER_VERSION,
  type CompetitorReviewCorpus,
  type CompetitorReviewItem,
} from "./competitorReviewCorpus";

/** Pure evidence preparation, NOT authorization, file provenance or model execution.
 * The caller must supply the complete authorized corpus and a trusted SHA-256.
 * No prompts, sentiment inference, OCR or market-wide denominator live here. */
export const COMPETITOR_RESEARCH_EVIDENCE_VERSION = 1 as const;
export const COMPETITOR_RESEARCH_BATCH_LIMITS = Object.freeze({ reviews: 60, utf8Bytes: 24 * 1024 });
export type CompetitorEvidenceSha256 = (canonicalUtf8Text: string) => string;
export class CompetitorResearchEvidenceError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "CompetitorResearchEvidenceError"; }
}
function fail(code: string): never { throw new CompetitorResearchEvidenceError(code); }
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.number().int().positive().safe();
const count = z.number().int().nonnegative().safe();
const asin = z.string().regex(/^[A-Z0-9]{10}$/u);
const text = z.string().refine(value => value.trim().length > 0);
const reviewId = z.string().regex(/^review_[a-f0-9]{64}$/u);
const fieldNames = ["asin", "sourceReviewId", "body", "title", "rating", "date", "author", "verifiedPurchase", "variant", "helpfulVotes"] as const;
const field = z.enum(fieldNames);
const location = z.object({ sheet: text, row: id.min(2) }).strict();
const occurrence = location.extend({
  assignment: z.enum(["row_asin", "filename_unique_asin"]),
  fields: z.array(z.object({ column: id.max(64), header: z.string(),
    value: z.union([z.string(), z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER), z.boolean(), z.null()]),
  }).strict()).min(1).max(64),
  mapping: z.partialRecord(field, id.max(64)), warnings: z.array(z.enum(fieldNames.map(name => `UNKNOWN_${name}`) as [string, ...string[]])),
}).strict();
const review = z.object({
  reviewId, asin, sourceReviewId: text.nullable(), title: text.nullable(), body: text.max(32000),
  rating: z.number().min(0).max(5).nullable(), date: text.nullable(), author: text.nullable(),
  verifiedPurchase: z.boolean().nullable(), variant: text.nullable(), helpfulVotes: count.nullable(),
  occurrences: z.array(occurrence).min(1).max(20000),
}).strict();
const coverage = z.object({
  scope: z.literal("complete_file_not_market_total"), format: z.enum(["csv", "xlsx"]), sourceFileHash: hash,
  sourceBytes: id.max(20 * 1024 * 1024), sourceFileName: text.max(500),
  sheets: z.array(z.object({ name: text, headerRow: z.literal(1), dataRows: count.max(20000) }).strict()).min(1).max(8),
  totalRows: count.max(20000), blankRows: count, emptyBodyRows: count, unassignedRows: count, otherAsinRows: count,
  matchedRows: count, duplicateRows: count, uniqueReviews: count, filenameFallbackRows: count,
  excluded: z.array(location.extend({ reason: z.enum(["blank_row", "empty_body", "unassigned_asin", "other_asin"]) }).strict()).max(20000),
  normalization: z.literal("LF_then_trim_no_internal_whitespace_collapse"),
}).strict();
const corpusSchema = z.object({ parserVersion: z.literal(COMPETITOR_REVIEW_PARSER_VERSION), corpusHash: hash,
  projectId: id, analysisId: id, asin, items: z.array(review).max(20000), coverage }).strict();
const authorizedSourceSchema = z.object({ runId: text.max(255), fileName: text.max(500), fileHash: hash }).strict();
export const competitorEvidenceIdentitySchema = z.object({
  userId: id, workspaceId: id.nullable(), sourceWorkspaceId: id.nullable(), projectId: id, analysisId: id, asin, revision: hash,
}).strict();
export type CompetitorEvidenceIdentity = z.infer<typeof competitorEvidenceIdentitySchema>;
// Independent external context, never a quote source or review denominator.
// Optional on stored v1 plans so historical hashes remain exactly verifiable.
export const competitorResearchSalesContextSchema = z.object({ version: z.literal(1), projection: CompetitorSalesProjectionSchema }).strict();
export type CompetitorResearchSalesContext = z.infer<typeof competitorResearchSalesContextSchema>;
export type CompetitorResearchEvidenceInput = {
  identity: CompetitorEvidenceIdentity; title: string | null; bullets: string[];
  salesContext?: CompetitorResearchSalesContext;
  reviews: { status: "available"; corpus: CompetitorReviewCorpus; source: z.infer<typeof authorizedSourceSchema>; authorizedCorpusHash: string }
    | { status: "unavailable"; reason: string };
};
const inputSchema = z.object({ identity: competitorEvidenceIdentitySchema, title: text.nullable(), bullets: z.array(text),
  salesContext: competitorResearchSalesContextSchema.optional(),
  reviews: z.discriminatedUnion("status", [z.object({ status: z.literal("available"), corpus: corpusSchema,
    source: authorizedSourceSchema, authorizedCorpusHash: hash }).strict(),
    z.object({ status: z.literal("unavailable"), reason: text.max(1000) }).strict()]),
}).strict();
const spanSchema = z.object({ start: z.literal(0), end: count, unit: z.literal("utf16_code_units") }).strict();
const listingSourceSchema = z.object({ sourceId: text, kind: z.enum(["title", "bullet"]), ordinal: count, text, span: spanSchema }).strict();
const batchSchema = z.object({ batchId: text, items: z.array(review).min(1).max(60), utf8Bytes: id.max(24 * 1024), sha256: hash }).strict();
const planSchema = z.object({
  version: z.literal(1), identity: competitorEvidenceIdentitySchema,
  listingSources: z.array(listingSourceSchema),
  salesContext: competitorResearchSalesContextSchema.optional(),
  reviews: z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), parserVersion: z.literal(COMPETITOR_REVIEW_PARSER_VERSION), parserCorpusHash: hash,
      authorizedCorpusHash: hash, source: authorizedSourceSchema,
      coverage, total: count.max(20000), batches: z.array(batchSchema).max(20000) }).strict(),
    z.object({ status: z.literal("unavailable"), reason: text.max(1000), total: z.null(), batches: z.tuple([]) }).strict(),
  ]),
  batchLimits: z.object({ reviews: z.literal(60), utf8Bytes: z.literal(24576) }).strict(),
  modelRead: z.literal(false), evidenceHash: hash,
}).strict();
export type CompetitorResearchEvidencePlan = z.infer<typeof planSchema>;
export type CompetitorResearchEvidenceSummary = {
  version: 1; identity: CompetitorEvidenceIdentity; evidenceHash: string; modelRead: false;
  listing: { titleAvailable: boolean; bulletCount: number; sourceCount: number };
  reviews: { status: "available" | "unavailable"; total: number | null; parserCorpusHash: string | null; authorizedCorpusHash: string | null;
    sourceFileHash: string | null; scope: "complete_file_not_market_total" | null;
    batchCount: number; totalBatchUtf8Bytes: number;
    batches: Array<{ batchId: string; count: number; utf8Bytes: number; sha256: string }> };
};

/** Descriptor-first JSON validation: no getters/toJSON, holes, custom array
 * methods, symbols or extra array properties participate in the hash. */
export function canonicalCompetitorResearchEvidence(value: unknown): string {
  const ancestors = new Set<object>(); let visited = 0;
  function encode(current: unknown, depth: number): string {
    if (++visited > 2_000_000 || depth > 32) fail("EVIDENCE_JSON_LIMIT");
    if (current === null || typeof current === "string" || typeof current === "boolean") return JSON.stringify(current);
    if (typeof current === "number" && Number.isFinite(current) && Math.abs(current) <= Number.MAX_SAFE_INTEGER && !Object.is(current, -0)) return JSON.stringify(current);
    if (!current || typeof current !== "object" || ancestors.has(current)) fail("EVIDENCE_JSON_INVALID");
    ancestors.add(current);
    const descriptors = Object.getOwnPropertyDescriptors(current);
    if (Reflect.ownKeys(current).some(key => typeof key === "symbol")) fail("EVIDENCE_JSON_INVALID");
    const read = (key: string) => {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) fail("EVIDENCE_JSON_INVALID");
      return encode(descriptor.value, depth + 1);
    };
    let result: string;
    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype || Object.keys(descriptors).length !== current.length + 1) fail("EVIDENCE_JSON_INVALID");
      const parts: string[] = [];
      for (let i = 0; i < current.length; i++) parts.push(read(String(i)));
      result = `[${parts.join(",")}]`;
    } else {
      if (Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) fail("EVIDENCE_JSON_INVALID");
      result = `{${Object.keys(descriptors).sort().map(key => `${JSON.stringify(key)}:${read(key)}`).join(",")}}`;
    }
    ancestors.delete(current); return result;
  }
  return encode(value, 0);
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(JSON.parse(canonicalCompetitorResearchEvidence(value)));
  if (!result.success) fail("EVIDENCE_INPUT_INVALID");
  return result.data;
}
function digest(value: unknown, sha256: CompetitorEvidenceSha256): string {
  if (typeof sha256 !== "function") fail("EVIDENCE_HASH_PROVIDER_INVALID");
  const result = sha256(canonicalCompetitorResearchEvidence(value));
  if (!hash.safeParse(result).success) fail("EVIDENCE_HASH_PROVIDER_INVALID");
  return result;
}
const utf8Bytes = (value: unknown) => new TextEncoder().encode(canonicalCompetitorResearchEvidence(value)).byteLength;

function validateCorpus(corpus: CompetitorReviewCorpus, identity: CompetitorEvidenceIdentity, sha256: CompetitorEvidenceSha256) {
  if (corpus.projectId !== identity.projectId || corpus.analysisId !== identity.analysisId || corpus.asin !== identity.asin) fail("EVIDENCE_CORPUS_SCOPE");
  const { corpusHash, ...original } = corpus;
  if (digest(original, sha256) !== corpusHash) fail("EVIDENCE_CORPUS_HASH");
  const c = corpus.coverage, sheets = new Map(c.sheets.map(sheet => [sheet.name, sheet.dataRows]));
  if (sheets.size !== c.sheets.length || c.totalRows !== c.sheets.reduce((sum, sheet) => sum + sheet.dataRows, 0)
    || c.uniqueReviews !== corpus.items.length || c.matchedRows !== c.uniqueReviews + c.duplicateRows
    || c.totalRows !== c.matchedRows + c.blankRows + c.emptyBodyRows + c.unassignedRows + c.otherAsinRows) fail("EVIDENCE_COVERAGE_INVALID");
  const rows = new Set<string>(), ids = new Set<string>(); let matched = 0, fallback = 0;
  const takeLocation = (value: { sheet: string; row: number }) => {
    const maximum = sheets.get(value.sheet), key = canonicalCompetitorResearchEvidence([value.sheet, value.row]);
    if (maximum === undefined || value.row > maximum + 1 || rows.has(key)) fail("EVIDENCE_COVERAGE_INVALID");
    rows.add(key);
  };
  for (const item of corpus.items) {
    if (ids.has(item.reviewId) || item.asin !== identity.asin) fail("EVIDENCE_REVIEW_ID_INVALID");
    ids.add(item.reviewId);
    for (const o of item.occurrences) {
      takeLocation(o); matched++; if (o.assignment === "filename_unique_asin") fallback++;
      if (o.fields.some((f, i) => f.column !== i + 1) || o.mapping.body === undefined
        || Object.values(o.mapping).some(column => column! > o.fields.length)
        || new Set(o.warnings).size !== o.warnings.length) fail("EVIDENCE_OCCURRENCE_INVALID");
    }
  }
  const excluded = { blank_row: 0, empty_body: 0, unassigned_asin: 0, other_asin: 0 };
  for (const row of c.excluded) { takeLocation(row); excluded[row.reason]++; }
  if (matched !== c.matchedRows || fallback !== c.filenameFallbackRows || rows.size !== c.totalRows
    || excluded.blank_row !== c.blankRows || excluded.empty_body !== c.emptyBodyRows
    || excluded.unassigned_asin !== c.unassignedRows || excluded.other_asin !== c.otherAsinRows) fail("EVIDENCE_COVERAGE_INVALID");
}

/** Exact batch wire payload for a future model adapter. The 24 KiB limit covers
 * this canonical JSON, including identity and all original occurrence fields.
 * A future adapter adding prompts/wrappers must budget that overhead separately. */
export function encodeCompetitorResearchBatch(value: unknown, batchIndex: number, sha256: CompetitorEvidenceSha256): string {
  const plan = verifyCompetitorResearchEvidencePlan(value, sha256);
  if (!Number.isSafeInteger(batchIndex) || batchIndex < 0 || plan.reviews.status !== "available" || !plan.reviews.batches[batchIndex]) fail("EVIDENCE_BATCH_UNKNOWN");
  const batch = plan.reviews.batches[batchIndex];
  return canonicalCompetitorResearchEvidence({ version: 1, identity: plan.identity, parserCorpusHash: plan.reviews.parserCorpusHash,
    authorizedCorpusHash: plan.reviews.authorizedCorpusHash, source: plan.reviews.source, batchId: batch.batchId, items: batch.items });
}

export function buildCompetitorResearchEvidencePlan(raw: CompetitorResearchEvidenceInput, sha256: CompetitorEvidenceSha256): CompetitorResearchEvidencePlan {
  const input = parse(inputSchema, raw), identity = input.identity;
  const listingSources: CompetitorResearchEvidencePlan["listingSources"] = [];
  if (input.title !== null) listingSources.push({ sourceId: `analysis:${identity.analysisId}:title`, kind: "title", ordinal: 0, text: input.title,
    span: { start: 0, end: input.title.length, unit: "utf16_code_units" } });
  input.bullets.forEach((bullet, i) => listingSources.push({ sourceId: `analysis:${identity.analysisId}:bullet:${i + 1}`, kind: "bullet", ordinal: i + 1, text: bullet,
    span: { start: 0, end: bullet.length, unit: "utf16_code_units" } }));
  let reviews: CompetitorResearchEvidencePlan["reviews"];
  if (input.reviews.status === "unavailable") reviews = { status: "unavailable", reason: input.reviews.reason, total: null, batches: [] };
  else {
    const corpus = input.reviews.corpus;
    validateCorpus(corpus, identity, sha256);
    if (input.reviews.source.fileHash !== corpus.coverage.sourceFileHash || input.reviews.source.fileName !== corpus.coverage.sourceFileName) fail("EVIDENCE_SOURCE_CHANGED");
    const { source, authorizedCorpusHash } = input.reviews;
    const batches: z.infer<typeof batchSchema>[] = [];
    let pending: CompetitorReviewItem[] = [];
    const payload = (items: CompetitorReviewItem[]) => ({ version: 1, identity, parserCorpusHash: corpus.corpusHash, authorizedCorpusHash, source,
      batchId: `analysis:${identity.analysisId}:reviews:${batches.length + 1}`, items });
    const flush = () => {
      const body = payload(pending);
      batches.push({ batchId: body.batchId, items: pending, utf8Bytes: utf8Bytes(body), sha256: digest(body, sha256) }); pending = [];
    };
    for (const item of corpus.items) {
      if (pending.length && (pending.length === COMPETITOR_RESEARCH_BATCH_LIMITS.reviews || utf8Bytes(payload([...pending, item])) > COMPETITOR_RESEARCH_BATCH_LIMITS.utf8Bytes)) flush();
      if (utf8Bytes(payload([item])) > COMPETITOR_RESEARCH_BATCH_LIMITS.utf8Bytes) fail("EVIDENCE_REVIEW_TOO_LARGE");
      pending.push(item);
    }
    if (pending.length) flush();
    reviews = { status: "available", parserVersion: corpus.parserVersion, parserCorpusHash: corpus.corpusHash, authorizedCorpusHash, source,
      coverage: corpus.coverage, total: corpus.items.length, batches };
  }
  const body = { version: 1 as const, identity, listingSources, reviews,
    ...(input.salesContext === undefined ? {} : { salesContext: input.salesContext }),
    batchLimits: { reviews: 60 as const, utf8Bytes: 24576 as const }, modelRead: false as const };
  return { ...body, evidenceHash: digest(body, sha256) };
}

/** Rebuilds rather than trusting self-reported counts, sizes, hashes or batches.
 * A caller-supplied digest is not an authenticated source or execution receipt. */
export function verifyCompetitorResearchEvidencePlan(value: unknown, sha256: CompetitorEvidenceSha256): CompetitorResearchEvidencePlan {
  const plan = parse(planSchema, value);
  const titles = plan.listingSources.filter(source => source.kind === "title");
  if (titles.length > 1) fail("EVIDENCE_PLAN_CHANGED");
  const rebuilt = buildCompetitorResearchEvidencePlan({ identity: plan.identity, title: titles[0]?.text ?? null,
    bullets: plan.listingSources.filter(source => source.kind === "bullet").map(source => source.text),
    ...(plan.salesContext === undefined ? {} : { salesContext: plan.salesContext }),
    reviews: plan.reviews.status === "unavailable" ? { status: "unavailable", reason: plan.reviews.reason } : { status: "available",
      source: plan.reviews.source, authorizedCorpusHash: plan.reviews.authorizedCorpusHash, corpus: {
      parserVersion: plan.reviews.parserVersion, corpusHash: plan.reviews.parserCorpusHash, projectId: plan.identity.projectId,
      analysisId: plan.identity.analysisId, asin: plan.identity.asin, items: plan.reviews.batches.flatMap(batch => batch.items), coverage: plan.reviews.coverage,
    } },
  }, sha256);
  if (canonicalCompetitorResearchEvidence(rebuilt) !== canonicalCompetitorResearchEvidence(plan)) fail("EVIDENCE_PLAN_CHANGED");
  return rebuilt;
}

/** Safe for a UI response: no text, quotes, authors, raw cells or filenames. */
export function summarizeCompetitorResearchEvidencePlan(value: unknown, sha256: CompetitorEvidenceSha256): CompetitorResearchEvidenceSummary {
  const plan = verifyCompetitorResearchEvidencePlan(value, sha256), r = plan.reviews;
  return { version: 1, identity: plan.identity, evidenceHash: plan.evidenceHash, modelRead: false,
    listing: { titleAvailable: plan.listingSources.some(source => source.kind === "title"), bulletCount: plan.listingSources.filter(source => source.kind === "bullet").length, sourceCount: plan.listingSources.length },
    reviews: { status: r.status, total: r.total, parserCorpusHash: r.status === "available" ? r.parserCorpusHash : null,
      authorizedCorpusHash: r.status === "available" ? r.authorizedCorpusHash : null,
      sourceFileHash: r.status === "available" ? r.coverage.sourceFileHash : null, scope: r.status === "available" ? r.coverage.scope : null,
      batchCount: r.batches.length, totalBatchUtf8Bytes: r.batches.reduce((sum, batch) => sum + batch.utf8Bytes, 0),
      batches: r.batches.map(batch => ({ batchId: batch.batchId, count: batch.items.length, utf8Bytes: batch.utf8Bytes, sha256: batch.sha256 })) } };
}

export function competitorReviewEvidenceSourceId(id: string, part: "body" | "title"): string {
  if (!reviewId.safeParse(id).success || !["body", "title"].includes(part)) fail("EVIDENCE_SOURCE_UNKNOWN");
  return `${id}:${part}`;
}
/** Citation offsets use JS UTF-16 [start,end), not bytes/code points. Exact case,
 * whitespace and punctuation are required; no cross-source or surrogate split. */
export function assertCompetitorResearchEvidenceQuote(value: unknown, citation: { sourceId: string; start: number; end: number; quote: string }, sha256: CompetitorEvidenceSha256): void {
  const plan = verifyCompetitorResearchEvidencePlan(value, sha256);
  const c = parse(z.object({ sourceId: text, start: count, end: id, quote: text }).strict(), citation);
  let source = plan.listingSources.find(item => item.sourceId === c.sourceId)?.text;
  if (source === undefined && plan.reviews.status === "available") {
    for (const batch of plan.reviews.batches) for (const item of batch.items) {
      if (c.sourceId === competitorReviewEvidenceSourceId(item.reviewId, "body")) source = item.body;
      if (c.sourceId === competitorReviewEvidenceSourceId(item.reviewId, "title") && item.title !== null) source = item.title;
    }
  }
  const splitPair = (at: number) => source !== undefined && /[\uD800-\uDBFF]/u.test(source.charAt(at - 1)) && /[\uDC00-\uDFFF]/u.test(source.charAt(at));
  if (source === undefined || c.end <= c.start || c.end > source.length || splitPair(c.start) || splitPair(c.end) || source.slice(c.start, c.end) !== c.quote) fail("EVIDENCE_QUOTE_MISMATCH");
}
