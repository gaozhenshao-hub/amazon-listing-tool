import { createHash } from "node:crypto";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { vi } from "vitest";
import { buildCompetitorResearchEvidencePlan } from "../../../../shared/competitorResearchEvidence";
import { assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash } from "../../ai_os/services/assistantConversationSourcePrimitives";
import { strictModelSnapshotFromRow, strictRuntimeHash, strictSkillMessages } from "../../ai_os/services/strictSkillRuntime";
import { renderSkillTemplate, type RunSkillInput, type RunSkillResult } from "../../ai_os/services/skillRunner";
import { createCompetitorDeepRuntime } from "./competitorDeepRuntime";
import { DEEP_STAGES, deepRuntimeHash, type CompetitorDeepApproval } from "./competitorDeepRuntimeContract";
import { createCompetitorDeepExecution, type DeepExecutionRequest } from "./competitorDeepExecution";
import { deepRunId, type DeepJob } from "../../../repositories/listing/competitorDeepJobRepository";
import type { CompetitorDeepStoredInput } from "../../../repositories/listing/competitorDeepExecutionRepository";
import type { CompetitorDeepStartInput } from "../../../../shared/competitorDeepExecutionJob";
export const clone = <T>(value: T): T => structuredClone(value);
export const syntheticIdentity = { userId: 3, workspaceId: 7 };
export const syntheticOperationId = "12345678-1234-4234-8234-123456789abc";
const dialect = new MySqlDialect();
export async function deepFixture() {
  const model = { workspaceId: 7, slug: "synthetic-model", name: "Synthetic only", provider: "custom", modelId: "synthetic-id", baseUrl: "https://example.invalid/v1",
    apiKeyRef: "env:EXTERNAL_LLM_API_KEY", isActive: 1, capabilityTags: ["text"], maxContextTokens: 2_000_000, costPer1kInputTokens: "0.001", costPer1kOutputTokens: "0.002" };
  const rows = DEEP_STAGES.map((stage, index) => ({ id: index + 1, workspaceId: 7, scope: "workspace", slug: `synthetic.${stage}`, name: "Synthetic reviewed input", version: 1, status: "Released", modelOverride: null, timeout_seconds: 120,
    manifest: { implementation: { systemPrompt: "SYNTHETIC_NOT_APPROVAL", userPromptTemplate: "{{context}}", maxTokens: 4096, supportsJsonMode: true } } }));
  let approvals: CompetitorDeepApproval[] = rows.map((row, index) => { const skill = assistantConversationSkillSnapshotFromRow(row); return {
    version: 1, workspaceId: 7, stage: DEEP_STAGES[index], skillSlug: row.slug, skillSnapshotHash: assistantConversationSkillSnapshotHash(skill.pin), modelSlug: model.slug,
    modelConfigurationHash: strictModelSnapshotFromRow(7, model.slug, model).configurationHash,
    source: { origin: "user_listing", revision: "synthetic-revision", approvalRef: "synthetic-not-real-approval", evidenceId: "synthetic-source", evidenceHash: "e".repeat(64) },
    inputContract: "competitor_deep_evidence_v1", outputContract: "competitor_deep_claims_v1", maxCostCents: 10000 }; });
  const executor = { execute: vi.fn(async (statement: SQL) => {
    const query = dialect.sqlToQuery(statement);
    if (query.sql.includes("FROM emperor_skills")) return [clone(rows.filter(row => row.slug === query.params[0]))];
    if (query.sql.includes("FROM emperor_model_providers")) return [[clone(model)]];
    throw new Error("NO_REAL_DATABASE");
  }) };
  const calls: RunSkillInput<unknown>[] = [];
  let paid = 0, providerFailure = false, skipVerify = false;
  const runSkill = async <T>(input: RunSkillInput<T>): Promise<RunSkillResult<T>> => {
    calls.push(input as RunSkillInput<unknown>);
    const row = rows.find(value => value.slug === input.skillSlug)!, strict = input.strictExecution!;
    const user = renderSkillTemplate(row.manifest.implementation.userPromptTemplate, { context: input.context });
    const admission = strictSkillMessages(row.manifest.implementation.systemPrompt, user, [], strict.modelSnapshot, 4096);
    const requestHash = strictRuntimeHash({ model: model.modelId, messages: admission.messages, max_tokens: admission.budget.outputTokens, response_format: { type: "json_object" } });
    const runId = `synthetic-run-${calls.length}`;
    if (!skipVerify) await strict.beforeDispatch({ runId, stage: strict.stage, requestHash, modelConfigurationHash: strict.modelSnapshot.configurationHash, bindingHash: strict.bindingHash, budget: admission.budget });
    paid++; if (providerFailure) throw new Error("SYNTHETIC_PROVIDER_UNKNOWN");
    if (typeof input.context !== "string") throw new Error("SYNTHETIC_CONTEXT_REQUIRED");
    const parsedContext = JSON.parse(input.context) as { request: DeepExecutionRequest }, request = parsedContext.request;
    const original = evidence.listingSources[0], citation = { sourceId: original.sourceId, start: 0, end: original.text.length, quote: original.text };
    const raw = request.stage === "title" ? { keywords: [{ text: original.text, zh: "灯", citation }], modifiers: [], scenarios: [], titleZh: "灯" }
      : request.stage === "selling" ? { points: [{ name: "Lamp", description: "Synthetic seller claim", strength: "中", occurrences: [citation], goldenQuote: citation }], bulletTranslations: [] }
        : { positioning: { text: "A lamp", basis: "seller_claim", references: ["title:keyword:1"] }, advantages: [], weaknesses: [], learnings: [], opportunities: [] };
    const content = JSON.stringify(raw);
    return { runId, skillSlug: input.skillSlug, skillName: row.name, skillVersion: "1", skillPromptHash: input.expectedSkillPromptHash!, skillManifestHash: input.expectedSkillManifestHash!,
      content, parsed: input.validate!(content), modelSlug: model.slug, provider: "custom", durationMs: 1, costCents: 1, inputTokens: 10, outputTokens: 10, fallbackCount: 0, executionPreset: "standard", governance: null };
  };
  const runtime = createCompetitorDeepRuntime({ approvals: async () => clone(approvals), runSkill, credential: () => "SYNTHETIC_NEVER_REAL" });
  const { runtime: snapshot, skills } = await runtime.prepare(executor, 7);
  const evidence = buildCompetitorResearchEvidencePlan({ identity: { ...syntheticIdentity, sourceWorkspaceId: 7, projectId: 11, analysisId: 21, asin: "B000000001", revision: "a".repeat(64) },
    title: "Lamp", bullets: [], reviews: { status: "unavailable", reason: "synthetic_no_reviews" } }, text => createHash("sha256").update(text).digest("hex"));
  const input: CompetitorDeepStartInput = { expectedWorkspaceId: 7, projectId: 11, analysisId: 21, expectedRevision: evidence.identity.revision,
    expectedEvidenceHash: evidence.evidenceHash, operationId: syntheticOperationId };
  const stored: CompetitorDeepStoredInput = { version: 1, evidence, skills, journal: createCompetitorDeepExecution(evidence, skills).initial(), agentRunId: "synthetic-agent", agentNodeId: "N1",
    reservation: { request: input, requestHash: deepRuntimeHash({ identity: syntheticIdentity, request: input }), runtime: snapshot } };
  const job: DeepJob = { runId: deepRunId(syntheticIdentity, syntheticOperationId), ...syntheticIdentity, projectId: 11, status: "queued", progress: 0, attempt: 0,
    lockedBy: null, leaseUntil: null, input: stored, output: null, errorMessage: null };
  return { input, stored, job, evidence, runtime, snapshot, skills, executor, rows, model, calls, paid: () => paid,
    failProvider: () => { providerFailure = true; }, skipFence: () => { skipVerify = true; }, setApprovals: (value: CompetitorDeepApproval[]) => { approvals = value; }, getApprovals: () => clone(approvals) };
}
