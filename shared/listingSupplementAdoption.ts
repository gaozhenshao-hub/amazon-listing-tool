import { z } from "zod";
import {
  SupplementHashSchema, SupplementManifestSchema, SupplementRecordSchema,
  SupplementScopeSchema, SupplementKindSchema, SupplementUuidSchema,
  supplementCanonical, supplementHash,
} from "./listingSupplementSources";

/** Pure, complete-source merge. Authorization and transaction/CAS belong to the
 * server. An adopted attribute is a candidate, never a confirmed product fact. */
const targetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("competitor"), analysisId: z.number().int().positive(), asin: z.string().regex(/^[A-Z0-9]{10}$/u) }).strict(),
  z.object({ type: z.literal("product"), projectId: z.number().int().positive() }).strict(),
]);
const originSchema = z.object({
  sourceId: SupplementUuidSchema, manifestHash: SupplementHashSchema,
  recordId: SupplementHashSchema, fileName: z.string().min(1).max(255),
  contentHash: SupplementHashSchema,
  locator: z.object({ part: z.string().min(1).max(255), row: z.number().int().positive() }).strict(),
}).strict();
const entrySchema = z.object({
  key: SupplementHashSchema, valueHash: SupplementHashSchema,
  target: targetSchema, record: SupplementRecordSchema,
  origins: z.array(originSchema).min(1).max(20_000),
}).strict();
export const SupplementAdoptedSetSchema = z.object({
  version: z.literal(1), scope: SupplementScopeSchema, kind: SupplementKindSchema,
  entries: z.array(entrySchema).max(20_000),
  setHash: SupplementHashSchema,
}).strict().superRefine((set, ctx) => {
  const { setHash, ...body } = set;
  if (supplementHash(body) !== setHash || new Set(set.entries.map(entry => entry.key)).size !== set.entries.length
    || set.entries.some(entry => entry.record.kind !== set.kind || entry.valueHash !== supplementHash(entry.record.value)
      || entry.key !== recordKey(entry.target, entry.record)
      || !targetMatches(set.scope.projectId, entry.target, entry.record))) {
    ctx.addIssue({ code: "custom", message: "Invalid adopted source set" });
  }
});
export type SupplementAdoptedSet = z.infer<typeof SupplementAdoptedSetSchema>;
export type SupplementAdoptedEntry = z.infer<typeof entrySchema>;
type Target = z.infer<typeof targetSchema>;
type RecordValue = z.infer<typeof SupplementRecordSchema>;
const resolutionSchema = z.object({ key: SupplementHashSchema, valueHash: SupplementHashSchema }).strict();
export const SupplementAdoptionRequestSchema = SupplementScopeSchema.extend({
  kind: SupplementKindSchema, mode: z.enum(["append", "replace"]),
  sources: z.array(z.object({ sourceId: SupplementUuidSchema, manifestHash: SupplementHashSchema }).strict()).min(1).max(100),
  resolutions: z.array(resolutionSchema).max(20_000).default([]),
}).strict();
export const SupplementAdoptionCommitSchema = SupplementAdoptionRequestSchema.extend({
  operationId: SupplementUuidSchema, expectedPreviewHash: SupplementHashSchema,
}).strict();
export const SupplementAdoptionReceiptSchema = z.object({
  operationId: SupplementUuidSchema, version: z.number().int().positive(), setHash: SupplementHashSchema,
  kind: SupplementKindSchema, entryCount: z.number().int().nonnegative(),
  attributeFileId: z.number().int().positive().nullable(), factReviewRequired: z.boolean(),
}).strict();
const requestSchema = z.object({
  scope: SupplementScopeSchema, kind: SupplementKindSchema,
  mode: z.enum(["append", "replace"]),
  manifests: z.array(SupplementManifestSchema).min(1).max(100),
  current: SupplementAdoptedSetSchema.nullable(),
  resolutions: z.array(resolutionSchema).max(20_000).default([]),
}).strict();
export type SupplementAdoptionMergeInput = z.input<typeof requestSchema>;
export type SupplementAdoptionConflict = {
  key: string; target: Target; candidates: SupplementAdoptedEntry[];
};
const targetKey = (target: Target) => target.type === "product" ? `product:${target.projectId}` : `competitor:${target.analysisId}:${target.asin}`;
function targetMatches(projectId: number, target: Target, record: RecordValue) {
  return record.kind === "attributes" ? target.type === "product" && target.projectId === projectId
    : target.type === "competitor" && (record.declaredAsin === null || record.declaredAsin === target.asin);
}
function recordKey(target: Target, record: RecordValue): string {
  const identity = record.kind === "reviews"
    ? record.value.sourceReviewId ? { sourceReviewId: record.value.sourceReviewId } : record.value
    : record.kind === "questions"
      ? { question: record.value.question, type: record.value.type, parentQuestion: record.value.parentQuestion }
      : { name: record.value.name.trim().toLowerCase() };
  return supplementHash({ target, kind: record.kind, identity });
}
function fail(code: string): never { throw new Error(`SUPPLEMENT_ADOPTION_${code}`); }

export function mergeSupplementAdoption(raw: SupplementAdoptionMergeInput) {
  const input = requestSchema.parse(raw), current = input.current;
  if (current && (supplementCanonical(current.scope) !== supplementCanonical(input.scope) || current.kind !== input.kind)) fail("CURRENT_SCOPE_MISMATCH");
  const seenSources = new Set<string>(), affected = new Set<string>();
  let incomingCount = 0;
  for (const manifest of input.manifests) {
    if (manifest.scope.projectId !== input.scope.projectId || manifest.identity.workspaceId !== input.scope.expectedWorkspaceId
      || manifest.kind !== input.kind || manifest.previewStatus !== "ready") fail("SOURCE_SCOPE_MISMATCH");
    if (seenSources.has(manifest.sourceId)) fail("DUPLICATE_SOURCE_SELECTION");
    seenSources.add(manifest.sourceId);
    for (const item of manifest.records) {
      const { revisionHash: _revision, ...target } = item.target;
      if (!targetMatches(input.scope.projectId, target, item.source)) fail("TARGET_MISMATCH");
      affected.add(targetKey(target));
      if (++incomingCount > 20_000) fail("RECORD_LIMIT");
    }
  }
  if (!incomingCount) fail("EMPTY_SOURCE");
  const variants = new Map<string, Map<string, SupplementAdoptedEntry>>();
  let duplicateCount = 0;
  function add(entry: SupplementAdoptedEntry) {
    let values = variants.get(entry.key);
    if (!values) { values = new Map(); variants.set(entry.key, values); }
    const existing = values.get(entry.valueHash);
    if (!existing) { values.set(entry.valueHash, structuredClone(entry)); return; }
    duplicateCount++;
    const refs = new Map(existing.origins.map(origin => [supplementCanonical(origin), origin]));
    for (const origin of entry.origins) refs.set(supplementCanonical(origin), origin);
    existing.origins = [...refs.values()].sort((a, b) => supplementCanonical(a).localeCompare(supplementCanonical(b)));
    if (existing.origins.length > 20_000) fail("ORIGIN_LIMIT");
  }
  for (const entry of current?.entries ?? []) {
    if (input.mode === "append" || !affected.has(targetKey(entry.target))) add(entry);
  }
  for (const manifest of [...input.manifests].sort((a, b) => a.sourceId.localeCompare(b.sourceId))) {
    for (const item of manifest.records) {
      const { revisionHash: _revision, ...target } = item.target;
      add({ key: recordKey(target, item.source), valueHash: supplementHash(item.source.value), target,
        record: item.source, origins: [{ sourceId: manifest.sourceId, manifestHash: manifest.manifestHash,
          contentHash: manifest.original.contentHash, fileName: manifest.original.fileName,
          recordId: item.source.recordId, locator: item.source.locator }] });
    }
  }
  const resolutions = new Map(input.resolutions.map(item => [item.key, item.valueHash]));
  if (resolutions.size !== input.resolutions.length) fail("DUPLICATE_RESOLUTION");
  const conflicts: SupplementAdoptionConflict[] = [], resolved: SupplementAdoptionConflict[] = [], entries: SupplementAdoptedEntry[] = [];
  for (const [key, values] of [...variants.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (values.size === 1) { if (resolutions.has(key)) fail("UNNEEDED_RESOLUTION"); entries.push([...values.values()][0]); continue; }
    const candidates = [...values.values()].sort((a, b) => a.valueHash.localeCompare(b.valueHash));
    const conflict = { key, target: candidates[0].target, candidates };
    const choice = resolutions.get(key);
    if (choice === undefined) { conflicts.push(conflict); continue; }
    const selected = values.get(choice);
    if (!selected) fail("UNKNOWN_RESOLUTION");
    entries.push(selected); resolved.push(conflict); resolutions.delete(key);
  }
  if (resolutions.size) fail("UNKNOWN_RESOLUTION");
  if (entries.length > 20_000) fail("RECORD_LIMIT");
  const body = { version: 1 as const, scope: input.scope, kind: input.kind, entries };
  const proposed = conflicts.length ? null : SupplementAdoptedSetSchema.parse({ ...body, setHash: supplementHash(body) });
  const result = { version: 1 as const, mode: input.mode, currentSetHash: current?.setHash ?? null,
    sources: input.manifests.map(item => ({ sourceId: item.sourceId, manifestHash: item.manifestHash })).sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    affectedTargets: [...affected].sort(), incomingCount, duplicateCount, conflicts, resolved,
    proposed, factReviewRequired: input.kind === "attributes", modelInvoked: false as const };
  return { ...result, previewHash: supplementHash(result) };
}
