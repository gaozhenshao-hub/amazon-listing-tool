import { createHash } from "node:crypto";
import type { TrpcContext } from "../../../_core/context";
import type { CompetitorAnalysis } from "../../../../drizzle/schema/project";
import { COMPETITOR_DEEP_EXECUTION_JOB_KIND } from "../../../../shared/competitorDeepExecutionJob";
import { buildCompetitorResearchEvidencePlan, canonicalCompetitorResearchEvidence as canonical } from "../../../../shared/competitorResearchEvidence";
import { buildCompetitorReviewCorpus } from "./competitorReviewCorpus";
import { createCompetitorDeepExecution, type DeepSkillPlan } from "./competitorDeepExecution";
import { buildCompetitorDeepResult } from "./competitorDeepResult";
import { competitorRevision } from "../../../repositories/project/competitorWritePolicy";

// Pure synthetic complete-kernel fixture. Never calls a provider or database.
const digest = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const originalBody = "Original unabridged 评论全文 with 100% punctuation & exact casing.";
function original(): CompetitorAnalysis {
  return { id: 21, projectId: 11, asin: "B000000001", title: "Lamp", bulletPoints: null, imageUrls: null, price: null, rating: null,
    reviewCount: null, reviewAnalysis: null, keywords: null, rawData: null, aiSummary: null, summary: null, summaryStatus: "draft", summaryVersion: 1,
    summaryConfirmedBy: null, summaryConfirmedAt: null, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") };
}
export async function createDeepAdoptionCandidateFixture(options: { workspaceId?: number | null; sourceWorkspaceId?: number | null; reviewBody?: string } = {}) {
  const body = options.reviewBody ?? originalBody;
  const workspaceId = options.workspaceId === undefined ? 7 : options.workspaceId;
  const sourceWorkspaceId = options.sourceWorkspaceId === undefined ? workspaceId : options.sourceWorkspaceId;
  const before = original(), bytes = Buffer.from(`ASIN,Review ID,Content,Rating\n${before.asin},platform-r1,${body},5`), fileName = `${before.asin}.csv`;
  const corpus = buildCompetitorReviewCorpus({ bytes, fileName, asin: before.asin, projectId: 11, analysisId: 21, sourceFileHash: digest(bytes) });
  const evidence = buildCompetitorResearchEvidencePlan({ identity: { userId: 3, workspaceId, sourceWorkspaceId, projectId: 11, analysisId: 21,
    asin: before.asin, revision: competitorRevision(before) }, title: before.title, bullets: [], reviews: { status: "available", corpus,
    source: { runId: "original-import", fileName, fileHash: digest(bytes) }, authorizedCorpusHash: "f".repeat(64) } }, digest);
  const binding = { skillSlug: "synthetic-historical", version: "1", status: "Released" as const, systemPromptHash: "a".repeat(16), userPromptHash: "b".repeat(16), manifestHash: "c".repeat(16) };
  const skills: DeepSkillPlan = { version: 1, authority: "user-primary", approvalRef: "historical-synthetic-plan", title: binding, selling: binding,
    buyers_batch: binding, buyers_synthesis: binding, summary: binding };
  const kernel = createCompetitorDeepExecution(evidence, skills); let journal = kernel.initial();
  const source = evidence.listingSources[0], citation = { sourceId: source.sourceId, start: 0, end: 4, quote: "Lamp" };
  const review = evidence.reviews.batches[0].items[0];
  for (let i = 0; i < journal.steps.length; i++) await kernel.runNext({ read: async () => journal,
    compareAndSwap: async (_old, next) => journal = next, assertCurrent: async () => undefined }, async request => {
    const raw = request.stage === "title" ? { keywords: [{ text: "Lamp", zh: "灯", citation }], modifiers: [], scenarios: [], titleZh: "灯" }
      : request.stage === "selling" ? { points: [{ name: "Lamp", description: "Seller claim", strength: "中", occurrences: [citation], goldenQuote: citation }], bulletTranslations: [] }
      : request.stage.startsWith("buyers:") ? { themes: [{ name: "User feedback", sentiment: "positive", reviewIds: [review.reviewId],
        citations: [{ sourceId: `${review.reviewId}:body`, start: 0, end: body.length, quote: body }] }], noThemeReviewIds: [] }
      : request.stage === "buyers_synthesis" ? { groups: [{ name: "Feedback", sentiment: "positive", themeIds: ["buyers:batch:0:theme:1"] }], concerns: [] }
      : { positioning: { text: "Supported lamp positioning", basis: "review_feedback", references: ["buyers:group:1"] }, advantages: [], weaknesses: [], learnings: [], opportunities: [] };
    return { raw, receipt: { runId: `historic-${request.stage}`, skillSlug: binding.skillSlug, skillVersion: "1", skillPromptHash: binding.systemPromptHash,
      skillManifestHash: binding.manifestHash, modelSlug: "synthetic-only" } };
  }, new AbortController().signal);
  const stored = { version: 1, evidence, skills, journal, agentRunId: "agent-historical", agentNodeId: "N1" };
  const runId = "deep-historical", artifactId = `deep_${digest(runId)}`, generatedAt = "2026-10-17T12:00:00.000Z";
  const result = buildCompetitorDeepResult({ evidence, skills, journal, jobRunId: runId, generatedAt }), artifactHash = digest(canonical(result));
  const base = { version: 1, kind: "competitor_deep_research", runId, analysisId: 21, artifactId, artifactHash, resultHash: result.resultHash,
    evidenceHash: evidence.evidenceHash, skillPlanHash: journal.skillPlanHash, journalHash: journal.journalHash, sourceRevision: evidence.identity.revision,
    summaryVersion: 2, generatedAt, reviewRequired: true, deepResearchComplete: false };
  const analysis = { ...before, aiSummary: result.summaryText, summary: result.summaryText, summaryVersion: 2,
    updatedAt: new Date(generatedAt), rawData: JSON.stringify({ research: { reviews: ["original capture"] }, deepResearchPublication: base,
      deepAnalysisRef: { artifactId, jobRunId: runId, resultHash: result.resultHash }, analysisStale: true, deepAnalysisStale: true }) };
  const receipt = { ...base, committedRevision: competitorRevision(analysis) }, metadata = { ...base, agentRunId: stored.agentRunId, agentNodeId: "N1" };
  const state = {
    user: { id: 3, status: "active", role: "admin", defaultWorkspaceId: workspaceId }, project: { id: 11, userId: 3, workspaceId: sourceWorkspaceId }, analysis,
    job: { runId, kind: COMPETITOR_DEEP_EXECUTION_JOB_KIND as string, module: "listing", userId: 3, workspaceId, projectId: 11, status: "succeeded",
      progress: 100, attempt: 1, maxAttempts: 1, lockedBy: null as string | null, leaseUntil: null as Date | null, errorMessage: null,
      completedAt: new Date(generatedAt), inputWire: JSON.stringify(stored, null, 2), outputWire: JSON.stringify(receipt, null, 2) },
    artifact: { workspaceId, artifactId, domain: "listing", artifactKey: `listing.competitor_deep.${before.asin}`, artifactType: "json", sourceType: "ai_output",
      sourceId: "21", sourceTable: "competitorAnalyses", sourceRowId: "21", runId: stored.agentRunId, agentSlug: "listing.full.workflow", nodeId: "N1", projectId: 11,
      userId: 3, status: "draft", version: 2, isCurrent: 0, contentHash: artifactHash, mimeType: "application/json", fileSizeBytes: Buffer.byteLength(canonical(result)),
      retentionClass: "hot", sourceSkillRunId: "historic-summary", sourceAiJobRunId: runId, contentWire: JSON.stringify(result, null, 2), metadataWire: JSON.stringify(metadata, null, 2) },
  };
  const ctx = { user: { id: 3, role: "admin", defaultWorkspaceId: workspaceId }, workspaceId, req: {}, res: {} } as TrpcContext;
  const request = () => ({ projectId: 11, analysisId: 21, expectedWorkspaceId: workspaceId, expectedRevision: competitorRevision(state.analysis) });
  return { state, result, stored, receipt, ctx, request };
}
