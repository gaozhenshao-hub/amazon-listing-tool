import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalCompetitorResearchEvidence as canonical, verifyCompetitorResearchEvidencePlan,
  type CompetitorResearchEvidencePlan } from "../../../../shared/competitorResearchEvidence";
import { createCompetitorDeepResearchValidator, type CompetitorDeepStage,
  type CompetitorDeepTitleResult, type CompetitorDeepSellingResult, type CompetitorDeepBuyerBatchResult,
  type CompetitorDeepBuyersResult, type CompetitorDeepSummaryResult } from "../../../../shared/competitorDeepResearch";

/** Execution kernel for the pending-review compatibility contract. The store
 * MUST implement real transactional CAS plus current authorization/source/lease
 * checks. This module alone is not durable storage, a registered worker, approved
 * Skill configuration, or permission to call a model. No production wiring yet. */
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const shortHash = z.string().regex(/^[a-f0-9]{16}$/u);
const text = z.string().min(1).max(128);
export const deepSkillBindingSchema = z.object({
  skillSlug: text, version: text, status: z.literal("Released"),
  systemPromptHash: shortHash, userPromptHash: shortHash, manifestHash: shortHash,
}).strict();
export const deepSkillPlanSchema = z.object({
  version: z.literal(1), authority: z.literal("user-primary"),
  // Must come from a trusted approved resolver, never a request-body assertion.
  approvalRef: text,
  title: deepSkillBindingSchema, selling: deepSkillBindingSchema, buyers_batch: deepSkillBindingSchema,
  buyers_synthesis: deepSkillBindingSchema, summary: deepSkillBindingSchema,
}).strict();
export type DeepSkillBinding = z.infer<typeof deepSkillBindingSchema>;
export type DeepSkillPlan = z.infer<typeof deepSkillPlanSchema>;
const missingSchema = z.enum(["title_unavailable", "listing_unavailable", "reviews_unavailable", "no_matching_reviews", "no_supported_claims"]);
const stageSchema = z.string().regex(/^(?:title|selling|buyers:(?:0|[1-9]\d*)|buyers_synthesis|summary)$/u);
const modelReceiptSchema = z.object({ runId: z.string().min(1).max(80), skillSlug: text, skillVersion: text,
  skillPromptHash: shortHash, skillManifestHash: shortHash, modelSlug: text }).strict();
export type DeepModelReceipt = z.infer<typeof modelReceiptSchema>;
const stepSchema = z.object({
  stage: stageSchema, status: z.enum(["pending", "missing", "dispatched", "succeeded"]),
  missingReason: missingSchema.nullable(), requestHash: hash.nullable(), dispatchId: hash.nullable(),
  raw: z.unknown(), outputHash: hash.nullable(), modelReceipt: modelReceiptSchema.nullable(),
}).strict();
const journalSchema = z.object({ version: z.literal(1), evidenceHash: hash, skillPlanHash: hash,
  steps: z.array(stepSchema).min(4).max(20004), journalHash: hash }).strict();
export type DeepExecutionJournal = z.infer<typeof journalSchema>;
export type DeepExecutionRequest = {
  version: 1; stage: CompetitorDeepStage; evidenceHash: string; skillPlanHash: string;
  binding: DeepSkillBinding; input: unknown; requestHash: string; dispatchId: string;
};
export interface DeepExecutionStore {
  /** Return the authoritative journal, not a stale caller/cache copy. */
  read(): Promise<unknown>;
  /** Atomic expected-hash compare, commit and readback. Reject unknown ACKs.
   * Every write must reauthorize the actor, source revision and worker lease. */
  compareAndSwap(expectedJournalHash: string, next: DeepExecutionJournal): Promise<unknown>;
  /** Fresh authorization/source/lease/cancellation check immediately before dispatch. */
  assertCurrent(): Promise<void>;
}
export class DeepExecutionError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "DeepExecutionError"; }
}
function fail(code: string): never { throw new DeepExecutionError(code); }
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  try { return schema.parse(JSON.parse(canonical(value))); }
  catch { return fail("DEEP_EXECUTION_STATE_INVALID"); }
}
type Results = { title: CompetitorDeepTitleResult | null; selling: CompetitorDeepSellingResult | null;
  batches: CompetitorDeepBuyerBatchResult[]; buyers: CompetitorDeepBuyersResult | null; summary: CompetitorDeepSummaryResult | null };
type Step = DeepExecutionJournal["steps"][number];
const blank = (stage: CompetitorDeepStage): Step => ({ stage, status: "pending", missingReason: null,
  requestHash: null, dispatchId: null, raw: null, outputHash: null, modelReceipt: null });
const seal = (body: Omit<DeepExecutionJournal, "journalHash">): DeepExecutionJournal => ({ ...body, journalHash: sha256(canonical(body)) });

export function createCompetitorDeepExecution(evidenceInput: unknown, skillPlanInput: unknown) {
  const evidence: CompetitorResearchEvidencePlan = verifyCompetitorResearchEvidencePlan(evidenceInput, sha256);
  const skills = parse(deepSkillPlanSchema, skillPlanInput), skillPlanHash = sha256(canonical(skills));
  const stages: CompetitorDeepStage[] = ["title", "selling", ...evidence.reviews.batches.map((_, i) => `buyers:${i}` as const), "buyers_synthesis", "summary"];
  const sourceMissing = (stage: string): Step["missingReason"] => stage === "title" && !evidence.listingSources.some(s => s.kind === "title") ? "title_unavailable"
    : stage === "selling" && !evidence.listingSources.length ? "listing_unavailable"
      : stage === "buyers_synthesis" && evidence.reviews.status === "unavailable" ? "reviews_unavailable"
        : stage === "buyers_synthesis" && evidence.reviews.total === 0 ? "no_matching_reviews" : null;
  function binding(stage: string): DeepSkillBinding { return skills[stage.startsWith("buyers:") ? "buyers_batch" : stage as "title" | "selling" | "buyers_synthesis" | "summary"]; }
  function supported(results: Results) { return !!results.title || !!results.selling || !!results.buyers?.data.groups.length || !!results.buyers?.data.concerns.length; }
  function missing(stage: string, results: Results) { return sourceMissing(stage) ?? (stage === "summary" && !supported(results) ? "no_supported_claims" : null); }
  function request(stage: CompetitorDeepStage, results: Results): DeepExecutionRequest {
    let input: unknown;
    if (stage === "title") input = { title: evidence.listingSources.filter(source => source.kind === "title") };
    else if (stage === "selling") input = { listing: evidence.listingSources, images: "not_included_no_ocr" };
    else if (stage.startsWith("buyers:")) {
      const index = Number(stage.slice(7)), batch = evidence.reviews.batches[index];
      if (!batch) return fail("DEEP_EXECUTION_BATCH_UNKNOWN");
      input = { batchIndex: index, batchId: batch.batchId, batchHash: batch.sha256, items: batch.items, scope: "complete_file_not_market_total" };
    } else if (stage === "buyers_synthesis") {
      // Retain every validated theme/ID; no first-N sampling or frequency-label conversion.
      input = { batches: results.batches.map(result => ({ outputHash: result.outputHash, data: result.data })), questions: "unavailable_no_question_evidence" };
    } else input = { title: results.title, selling: results.selling, buyers: results.buyers,
      reviewEvidence: { status: evidence.reviews.status, total: evidence.reviews.total,
        missingReason: sourceMissing("buyers_synthesis"), scope: "complete_file_not_market_total" },
      missingListing: { title: sourceMissing("title"), selling: sourceMissing("selling") },
      images: "not_included_no_ocr", questions: "unavailable_no_question_evidence" };
    const body = { version: 1 as const, stage, evidenceHash: evidence.evidenceHash, skillPlanHash, binding: binding(stage), input };
    // A future model adapter must also account for prompt/token overhead. Refuse
    // oversized synthesis; do not turn an incomplete prefix into complete research.
    const wire = canonical(body);
    if (Buffer.byteLength(wire, "utf8") > 256 * 1024) fail("DEEP_EXECUTION_CONTEXT_TOO_LARGE");
    const requestHash = sha256(wire), dispatchId = sha256(canonical({ evidenceHash: evidence.evidenceHash, skillPlanHash, stage, requestHash }));
    return { ...body, requestHash, dispatchId };
  }
  function initial(): DeepExecutionJournal {
    return seal({ version: 1, evidenceHash: evidence.evidenceHash, skillPlanHash, steps: stages.map(blank) });
  }
  function inspect(raw: unknown) {
    const journal = parse(journalSchema, raw), { journalHash, ...body } = journal;
    if (journalHash !== sha256(canonical(body)) || journal.evidenceHash !== evidence.evidenceHash || journal.skillPlanHash !== skillPlanHash
      || journal.steps.length !== stages.length || journal.steps.some((step, i) => step.stage !== stages[i])) fail("DEEP_EXECUTION_BINDING_CHANGED");
    const validator = createCompetitorDeepResearchValidator(evidence, sha256);
    const results: Results = { title: null, selling: null, batches: [], buyers: null, summary: null };
    const modelRunIds = new Set<string>();
    let boundary = false;
    for (const [index, step] of journal.steps.entries()) {
      if (boundary && canonical(step) !== canonical(blank(stages[index]))) fail("DEEP_EXECUTION_STAGE_ORDER");
      if (step.status === "pending") {
        if (canonical(step) !== canonical(blank(stages[index]))) fail("DEEP_EXECUTION_STATE_INVALID");
        boundary = true; continue;
      }
      const reason = missing(step.stage, results);
      if (step.status === "missing") {
        if (!reason || canonical(step) !== canonical({ ...blank(stages[index]), status: "missing", missingReason: reason })) fail("DEEP_EXECUTION_MISSING_INVALID");
        continue;
      }
      if (reason) fail("DEEP_EXECUTION_MISSING_INVALID");
      const call = request(stages[index], results);
      if (step.requestHash !== call.requestHash || step.dispatchId !== call.dispatchId || step.missingReason !== null) fail("DEEP_EXECUTION_REQUEST_CHANGED");
      if (step.status === "dispatched") {
        if (step.raw !== null || step.outputHash !== null || step.modelReceipt !== null) fail("DEEP_EXECUTION_STATE_INVALID");
        boundary = true; continue;
      }
      const model = step.modelReceipt, expected = binding(step.stage);
      if (!model || model.skillSlug !== expected.skillSlug || model.skillVersion !== expected.version || model.skillPromptHash !== expected.systemPromptHash
        || model.skillManifestHash !== expected.manifestHash) fail("DEEP_EXECUTION_SKILL_CHANGED");
      if (modelRunIds.has(model.runId)) fail("DEEP_EXECUTION_MODEL_RECEIPT_REUSED");
      modelRunIds.add(model.runId);
      let result;
      if (step.stage === "title") result = results.title = validator.validateTitle(step.raw);
      else if (step.stage === "selling") result = results.selling = validator.validateSelling(step.raw);
      else if (step.stage.startsWith("buyers:")) { result = validator.validateBuyerBatch(Number(step.stage.slice(7)), step.raw); results.batches.push(result); }
      else if (step.stage === "buyers_synthesis") result = results.buyers = validator.validateBuyers(step.raw, results.batches);
      else result = results.summary = validator.validateSummary(step.raw, results);
      if (step.outputHash !== result.outputHash) fail("DEEP_EXECUTION_RESULT_CHANGED");
    }
    return { journal, results, validator };
  }
  async function runNext(store: DeepExecutionStore, invoke: (request: DeepExecutionRequest, signal: AbortSignal) => Promise<{ raw: unknown; receipt: DeepModelReceipt }>, signal: AbortSignal) {
    const current = inspect(await store.read()), index = current.journal.steps.findIndex(s => s.status === "pending" || s.status === "dispatched");
    if (index < 0) {
      // A completed journal is not an authorization receipt. Recheck before
      // exposing results after a restart, revocation or source/lease change.
      await store.assertCurrent();
      if (signal.aborted) fail("DEEP_EXECUTION_CANCELED");
      return { state: current.results.summary ? "ready_for_review" as const : "incomplete_sources" as const, ...current };
    }
    const stage = stages[index], step = current.journal.steps[index];
    if (step.status === "dispatched") fail("DEEP_EXECUTION_MODEL_RESULT_UNKNOWN");
    if (signal.aborted) fail("DEEP_EXECUTION_CANCELED");
    const reason = missing(stage, current.results);
    const save = async (old: DeepExecutionJournal, replacement: Step) => {
      const next = seal({ version: 1, evidenceHash: old.evidenceHash, skillPlanHash: old.skillPlanHash,
        steps: old.steps.map((value, i) => i === index ? replacement : value) });
      // Validate semantic transition before attempting any write.
      inspect(next);
      const acknowledged = inspect(await store.compareAndSwap(old.journalHash, next));
      if (canonical(acknowledged.journal) !== canonical(next)) fail("DEEP_EXECUTION_WRITE_UNCONFIRMED");
      return acknowledged;
    };
    if (reason) return { state: "checkpointed" as const, ...await save(current.journal, { ...step, status: "missing", missingReason: reason }) };
    const call = request(stage, current.results);
    const dispatched = await save(current.journal, { ...step, status: "dispatched", requestHash: call.requestHash, dispatchId: call.dispatchId });
    await store.assertCurrent();
    if (signal.aborted) fail("DEEP_EXECUTION_CANCELED");
    // Exactly one call per durable dispatch. Any throw/timeout, invalid result,
    // lost acknowledgement or restart leaves dispatched; never auto-retry it.
    const outcome = await invoke(JSON.parse(canonical(call)), signal);
    if (signal.aborted) fail("DEEP_EXECUTION_CANCELED");
    const receipt = parse(modelReceiptSchema, outcome.receipt);
    let result;
    if (stage === "title") result = current.validator.validateTitle(outcome.raw);
    else if (stage === "selling") result = current.validator.validateSelling(outcome.raw);
    else if (stage.startsWith("buyers:")) result = current.validator.validateBuyerBatch(Number(stage.slice(7)), outcome.raw);
    else if (stage === "buyers_synthesis") result = current.validator.validateBuyers(outcome.raw, current.results.batches);
    else result = current.validator.validateSummary(outcome.raw, current.results);
    return { state: "checkpointed" as const, ...await save(dispatched.journal, { ...dispatched.journal.steps[index],
      status: "succeeded", raw: outcome.raw, outputHash: result.outputHash, modelReceipt: receipt }) };
  }
  return { initial, inspect, runNext };
}
