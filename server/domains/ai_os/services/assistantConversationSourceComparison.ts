import { createHash } from "node:crypto";
import { z } from "zod";
import { AgentLibraryKeySchema } from "../../../../shared/agentLibraryContracts";
import { AssistantConfigurationSchema } from "../../../../shared/assistantConfigurations";
import { assistantConversationCanonical, configurationHash, skillManifestHash, AssistantConversationSkillPinSchema, AssistantConversationSourceApprovalSchema,
  assistantConversationSkillSnapshotFromRow, assistantConversationSkillSnapshotHash, assistantConversationSkillScopeMatches,
  type AssistantConversationSourceApproval } from "./assistantConversationSourcePrimitives";
import { StrictRegisteredModelSnapshotSchema, strictModelSnapshotFromRow, strictCostUpperBound } from "./strictSkillRuntime";

/** Server/offline tooling only. Never expose these helpers as RPC inputs.
 * A content hash detects changed evidence; it is NOT a signature proving that
 * someone actually queried a database or approved a budget. The collector and
 * release reviewer own that provenance. No helper here reads DB/env/network,
 * seeds Skills, changes a scope, or enables the runtime singleton. */
export const ASSISTANT_REVIEWED_SUPPLEMENT_REVISION = "383b69e6bc9d8b3d2f1d380422390ea200541628";
const sourceFiles = [
  { file: "scripts/configure-agent-library.ts", sha256: "b4bbb5cd165479bc2419223e9c34ab17d9432daf0a283ca982063ce5d0b64a7e" },
  { file: "server/domains/ai_os/services/agentLibrary.ts", sha256: "d3ffe1073adb2fcd7805eeeeff45b9ef985d19acdd544d0e63c25c63b6078e59" },
] as const;
const reviewed = [
  { slug: "agent.library.route", name: "Agent对话Skill选择", purpose: "route", inputContract: "friend_route_v1", outputContract: "route_slug_v1",
    manifestRawSha256: "b40d8c6b443cbaa90190616728b77bff8a4a929dd2ed11e3fbc9a04b2f262715", systemPromptSha256: "38f81ddd3b97b000a85ce15bae2c5ec72e64c6c8a2daa0adb230422ce2f4e82b" },
  { slug: "agent.library.coach", name: "Agent对话与规则教练", purpose: "reply", inputContract: "friend_reply_v1", outputContract: "reply_v1",
    manifestRawSha256: "de5c6e85adc043ab16a408b857bc689556b320a96537f8959703e9e31b294e71", systemPromptSha256: "efce62980e8e289e77cb311f98862bb5b374eaeb5e7c423ec7dfdcfad9e6cbd8" },
] as const;
const userPromptHash = "f7cbb53df68c8659c7f0291c9e4e472604913ace81031c340608c7e9472302ec";
const id = z.number().int().min(1).max(2147483647), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/u);
const timestamp = z.string().datetime({ offset: true });
const unavailable = z.object({ status: z.literal("unavailable"), reasonCode: code }).strict();
const rawSkillSchema = z.object({ id, workspaceId: id.nullable(), scope: text(32), slug: text(128), name: text(255), version: id, status: text(32),
  modelOverride: text(256).nullable(), timeout_seconds: z.number().int().min(0).max(600), owner: text(64).nullable(), isSystem: z.number().int().min(0).max(1), manifest: z.unknown() }).strict();
const rawModelSchema = z.object({ workspaceId: id.nullable(), slug: text(256), name: text(255), provider: text(64), modelId: text(256), baseUrl: z.string().max(2048), apiKeyRef: text(256).nullable(),
  isActive: z.union([z.boolean(), z.number().int().min(0).max(1)]), capabilityTags: z.unknown(), maxContextTokens: id,
  costPer1kInputTokens: z.union([z.string(), z.number()]).nullable(), costPer1kOutputTokens: z.union([z.string(), z.number()]).nullable() }).strict();
const savedSchema = z.object({ workspaceId: id, agentKey: AgentLibraryKeySchema, revision: id, hash, config: AssistantConfigurationSchema }).strict();
const configurationProjectionSchema = z.union([
  z.object({ status: z.literal("configured"), workspaceId: id, agentKey: AgentLibraryKeySchema, revision: id, hash, enabled: z.boolean(), modelSlug: z.string().max(128),
    skills: z.array(z.object({ slug: text(128), enabled: z.boolean(), version: id, manifestSha256: hash }).strict()).max(80) }).strict(),
  z.object({ status: z.literal("not_configured") }).strict(), unavailable,
]);
const sourceRowSchema = z.object({ id, workspaceId: id.nullable(), scope: text(32), slug: text(128), name: text(255), version: id, status: text(32), owner: text(64).nullable(), isSystem: z.number().int().min(0).max(1),
  pin: AssistantConversationSkillPinSchema.nullable(), pinHash: hash.nullable(), issue: z.enum(["SKILL_SNAPSHOT_INVALID"]).nullable() }).strict().superRefine((value, context) => {
  if (value.pin === null ? value.pinHash !== null || value.issue === null : value.pinHash !== assistantConversationSkillSnapshotHash(value.pin) || value.issue !== null
    || (["id", "workspaceId", "scope", "slug", "name", "version", "status"] as const).some(key => value[key] !== value.pin![key])) context.addIssue({ code: "custom", message: "PIN_MISMATCH" });
});
const modelEvidenceSchema = z.object({ slug: text(256), workspaceId: id.nullable(), snapshot: StrictRegisteredModelSnapshotSchema.nullable(), issue: z.enum(["MODEL_SNAPSHOT_INVALID"]).nullable() }).strict()
  .refine(value => value.snapshot === null ? value.issue !== null : value.issue === null && value.snapshot.model.slug === value.slug && value.snapshot.model.workspaceId === value.workspaceId);
const evidenceBodySchema = z.object({ schema: z.literal("assistant-conversation-source-evidence/v1"), workspaceId: id, agentKey: AgentLibraryKeySchema, evidenceRef: text(512), capturedAt: timestamp,
  queryContract: z.literal("exact-slugs-workspace-and-all-null-rows/v1"), selectedSlugs: z.array(text(128)).max(82), configuration: configurationProjectionSchema,
  skills: z.union([z.object({ status: z.literal("available"), rows: z.array(sourceRowSchema).max(246) }).strict(), unavailable]),
  models: z.union([z.object({ status: z.literal("available"), rows: z.array(modelEvidenceSchema).max(3) }).strict(), unavailable]),
}).strict();
export const AssistantConversationSourceEvidenceSchema = evidenceBodySchema.extend({ evidenceHash: hash }).strict();
export type AssistantConversationSourceEvidence = z.infer<typeof AssistantConversationSourceEvidenceSchema>;
export type AssistantConversationSourceCaptureInput = {
  workspaceId: number; agentKey: z.infer<typeof AgentLibraryKeySchema>; evidenceRef: string; capturedAt: string;
  configuration: { status: "configured"; saved: z.infer<typeof savedSchema> } | { status: "not_configured" } | z.infer<typeof unavailable>;
  skillRegistry: { status: "available"; rows: z.input<typeof rawSkillSchema>[] } | z.infer<typeof unavailable>;
  modelRegistry: { status: "available"; rows: z.input<typeof rawModelSchema>[] } | z.infer<typeof unavailable>;
};
export class AssistantConversationSourceEvidenceError extends Error {
  constructor(readonly code: string) { super(`ASSISTANT_CONVERSATION_SOURCE_${code}`); this.name = "AssistantConversationSourceEvidenceError"; }
}
function fail(reason: string): never { throw new AssistantConversationSourceEvidenceError(reason); }
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown, max = 2 * 1024 * 1024): string { try { return assistantConversationCanonical(value, max); } catch { return fail("EVIDENCE_INVALID"); } }
const digest = (value: unknown) => sha(canonical(value));
function parse<T>(schema: z.ZodType<T>, raw: unknown): T { canonical(raw, 32 * 1024 * 1024); const value = schema.safeParse(raw); if (!value.success) fail("EVIDENCE_INVALID"); return structuredClone(value.data); }
function selected(configuration: z.infer<typeof configurationProjectionSchema>): string[] { return [...new Set([...reviewed.map(row => row.slug), ...(configuration.status === "configured" ? configuration.skills.filter(row => row.enabled).map(row => row.slug) : [])])].sort(); }
function projectionMissingColumns(rows: unknown, columns: string[], maximum: number): boolean {
  if (!Array.isArray(rows) || rows.length > maximum) fail("EVIDENCE_INVALID");
  return rows.some(row => row && typeof row === "object" && !Array.isArray(row) && columns.some(column => !Object.hasOwn(row, column)));
}

/** Invoke next to the actual bounded read-only query, before exporting evidence.
 * The complete manifest/config remains server-local; only exact projections and
 * fingerprints leave this helper. Missing tables are explicit unavailable. */
export function captureAssistantConversationSourceEvidence(input: AssistantConversationSourceCaptureInput): AssistantConversationSourceEvidence {
  canonical(input, 32 * 1024 * 1024);
  const identity = parse(z.object({ workspaceId: id, agentKey: AgentLibraryKeySchema }).strict(), { workspaceId: input.workspaceId, agentKey: input.agentKey });
  let configuration: z.infer<typeof configurationProjectionSchema>;
  if (input.configuration.status === "configured") {
    const saved = parse(savedSchema, input.configuration.saved);
    if (canonical(saved) !== canonical(input.configuration.saved) || saved.workspaceId !== identity.workspaceId || saved.agentKey !== identity.agentKey || saved.hash !== configurationHash(saved.config)) fail("CONFIGURATION_MISMATCH");
    configuration = { status: "configured", workspaceId: saved.workspaceId, agentKey: saved.agentKey, revision: saved.revision, hash: saved.hash, enabled: saved.config.enabled, modelSlug: saved.config.modelSlug,
      skills: saved.config.skills.map(({ slug, enabled, version, manifestSha256 }) => ({ slug, enabled, version, manifestSha256 })) };
  } else configuration = parse(configurationProjectionSchema, input.configuration);
  const selectedSlugs = selected(configuration);
  const skills: z.infer<typeof evidenceBodySchema>["skills"] = input.skillRegistry.status === "unavailable" ? parse(unavailable, input.skillRegistry)
    : projectionMissingColumns(input.skillRegistry.rows, Object.keys(rawSkillSchema.shape), 246) ? { status: "unavailable", reasonCode: "SKILL_REGISTRY_COLUMNS_MISSING" } : {
    status: "available", rows: parse(z.array(rawSkillSchema).max(246), input.skillRegistry.rows).map(row => {
      if (!selectedSlugs.includes(row.slug) || row.workspaceId !== null && row.workspaceId !== identity.workspaceId) fail("REGISTRY_SCOPE_MISMATCH");
      const { id: rowId, workspaceId, scope, slug, name, version, status, owner, isSystem } = row;
      const metadata = { id: rowId, workspaceId, scope, slug, name, version, status, owner, isSystem };
      try { const { pin } = assistantConversationSkillSnapshotFromRow(row); return { ...metadata, pin, pinHash: assistantConversationSkillSnapshotHash(pin), issue: null }; }
      catch { return { ...metadata, pin: null, pinHash: null, issue: "SKILL_SNAPSHOT_INVALID" as const }; }
    }).sort((a, b) => a.slug.localeCompare(b.slug, "en") || a.id - b.id),
  };
  const models: z.infer<typeof evidenceBodySchema>["models"] = input.modelRegistry.status === "unavailable" ? parse(unavailable, input.modelRegistry)
    : projectionMissingColumns(input.modelRegistry.rows, Object.keys(rawModelSchema.shape), 3) ? { status: "unavailable", reasonCode: "MODEL_REGISTRY_COLUMNS_MISSING" } : {
    status: "available", rows: parse(z.array(rawModelSchema).max(3), input.modelRegistry.rows).map(row => {
      if (configuration.status !== "configured" || !configuration.modelSlug || row.slug !== configuration.modelSlug || row.workspaceId !== null && row.workspaceId !== identity.workspaceId) fail("MODEL_SCOPE_MISMATCH");
      try { return { slug: row.slug, workspaceId: row.workspaceId, snapshot: strictModelSnapshotFromRow(identity.workspaceId, row.slug, row), issue: null }; }
      catch { return { slug: row.slug, workspaceId: row.workspaceId, snapshot: null, issue: "MODEL_SNAPSHOT_INVALID" as const }; }
    }).sort((a, b) => (a.workspaceId ?? 0) - (b.workspaceId ?? 0)),
  };
  const body = parse(evidenceBodySchema, { schema: "assistant-conversation-source-evidence/v1", ...identity, evidenceRef: input.evidenceRef, capturedAt: input.capturedAt,
    queryContract: "exact-slugs-workspace-and-all-null-rows/v1", selectedSlugs, configuration, skills, models });
  return { ...body, evidenceHash: digest(body) };
}

const budgetSchema = z.object({ maxCostCents: z.number().int().min(0).max(1000000000), imageBudget: z.object({ policyId: text(256), maxInputTokensPerImage: z.number().int().min(1).max(10000000) }).strict().nullable() }).strict();
const policyBodySchema = z.object({ schema: z.literal("assistant-conversation-approved-execution-policy/v1"), workspaceId: id, agentKey: AgentLibraryKeySchema, evidenceRef: text(512),
  modelSlug: text(256), modelConfigurationHash: hash, credentialStatus: z.enum(["available", "unavailable", "unverified"]), route: budgetSchema, reply: budgetSchema }).strict();
export const AssistantConversationExecutionPolicyEvidenceSchema = policyBodySchema.extend({ evidenceHash: hash }).strict();
export type AssistantConversationExecutionPolicyEvidence = z.infer<typeof AssistantConversationExecutionPolicyEvidenceSchema>;
/** Capture only an already-approved actual policy. This does not infer a spend
 * authorization from price, choose a default fee, or read a credential value. */
export function captureAssistantConversationExecutionPolicy(input: { workspaceId: number; agentKey: z.infer<typeof AgentLibraryKeySchema>; evidenceRef: string;
  modelRow: z.input<typeof rawModelSchema>; credentialStatus: "available" | "unavailable" | "unverified"; route: z.infer<typeof budgetSchema>; reply: z.infer<typeof budgetSchema> }): AssistantConversationExecutionPolicyEvidence {
  canonical(input);
  const row = parse(rawModelSchema, input.modelRow);
  let model: z.infer<typeof StrictRegisteredModelSnapshotSchema>;
  try { model = strictModelSnapshotFromRow(input.workspaceId, row.slug, row); } catch { return fail("MODEL_POLICY_INVALID"); }
  const body = parse(policyBodySchema, { schema: "assistant-conversation-approved-execution-policy/v1", workspaceId: input.workspaceId, agentKey: input.agentKey, evidenceRef: input.evidenceRef,
    modelSlug: row.slug, modelConfigurationHash: model.configurationHash, credentialStatus: input.credentialStatus, route: input.route, reply: input.reply });
  return { ...body, evidenceHash: digest(body) };
}
const deploymentSchema = z.object({ evidenceRef: text(512), sourceRevision: z.literal(ASSISTANT_REVIEWED_SUPPLEMENT_REVISION), sourceSlug: z.enum(["agent.library.route", "agent.library.coach"]),
  registryId: id, workspaceId: id.nullable(), scope: text(32), skillSnapshotHash: hash }).strict();
export type AssistantConversationDeploymentEvidence = z.infer<typeof deploymentSchema>;
const sourceReviewSchema = z.object({ schema: z.literal("amazon-p5-reviewed-conversation-supplement/v1"), sourceRevision: z.literal(ASSISTANT_REVIEWED_SUPPLEMENT_REVISION),
  files: z.array(z.object({ file: text(512), sha256: hash }).strict()).length(2), runtimeApproval: z.literal(false),
  records: z.array(z.object({ slug: text(128), name: text(255), sourceOrigin: z.literal("reviewed_supplement"), purpose: z.enum(["route", "reply"]), sourceVersion: z.literal(1), sourceStatus: z.literal("Released"),
    sourceScope: z.literal("shared"), sourceOwner: z.literal("system"), sourceIsSystem: z.literal(1), sourceTimeoutSeconds: z.literal(90), manifest: z.unknown(), manifestRawSha256: hash,
    systemPromptSha256: hash, userPromptSha256: hash, inputContract: z.enum(["friend_route_v1", "friend_reply_v1"]), outputContract: z.enum(["route_slug_v1", "reply_v1"]) }).strict()).length(2),
}).passthrough();
function reviewedSources(raw: unknown) {
  const artifact = parse(sourceReviewSchema, raw);
  if (digest([...artifact.files].sort((a, b) => a.file.localeCompare(b.file, "en"))) !== digest([...sourceFiles].sort((a, b) => a.file.localeCompare(b.file, "en")))) fail("REVIEWED_SOURCE_CHANGED");
  return reviewed.map(expected => {
    const rows = artifact.records.filter(row => row.slug === expected.slug); if (rows.length !== 1) fail("REVIEWED_SOURCE_CHANGED");
    const row = rows[0];
    if (Object.entries(expected).some(([name, value]) => row[name as keyof typeof row] !== value) || row.userPromptSha256 !== userPromptHash || sha(JSON.stringify(row.manifest)) !== expected.manifestRawSha256) fail("REVIEWED_SOURCE_CHANGED");
    const source = assistantConversationSkillSnapshotFromRow({ id: 1, workspaceId: null, scope: row.sourceScope, slug: row.slug, name: row.name, version: row.sourceVersion, status: row.sourceStatus, modelOverride: null, timeout_seconds: row.sourceTimeoutSeconds, manifest: row.manifest });
    if (source.pin.systemPromptSha256 !== expected.systemPromptSha256 || source.pin.userPromptSha256 !== userPromptHash) fail("REVIEWED_SOURCE_CHANGED");
    return { ...row, manifestSha256: skillManifestHash(row.manifest) };
  });
}

export type AssistantConversationSourceComparison = {
  schema: "assistant-conversation-source-comparison/v1"; workspaceId: number; agentKey: z.infer<typeof AgentLibraryKeySchema>; evidenceHash: string;
  sourceReviewed: true; runtimeReady: boolean; blockers: Array<{ code: string; slug: string | null }>;
  hashSemantics: { sourceManifest: "canonical_semantic_manifest"; sourceRaw: "fixed_review_artifact_provenance_only"; registryRaw: "runtime_parsed_manifest_serialization" };
  sources: Array<{ slug: string; purpose: "route" | "reply"; sourceRevision: string; sourceScope: "shared"; registryId: number | null; registryScope: string | null; registryWorkspaceId: number | null;
    pin: z.infer<typeof AssistantConversationSkillPinSchema> | null; pinHash: string | null; differences: string[]; sourceMatches: boolean; runtimeScopeCompatible: boolean }>;
  contextualSkills: Array<{ slug: string; originRequired: "qingdao" | "user_listing"; status: "source_unreviewed"; registryMatchesBinding: boolean }>;
  runtimeApprovals: AssistantConversationSourceApproval[] | null;
};
/** The two fixed supplements are the ONLY source authority this slice grants.
 * Context/business Skills retain Qingdao or user_listing priority, and remain
 * explicit blockers until their separately reviewed evidence is implemented. */
export function compareAssistantConversationSources(input: { evidence: unknown; sourceReview: unknown; deployments?: AssistantConversationDeploymentEvidence[]; approvedExecutionPolicy?: AssistantConversationExecutionPolicyEvidence | null }): AssistantConversationSourceComparison {
  const evidence = parse(AssistantConversationSourceEvidenceSchema, input.evidence), { evidenceHash, ...body } = evidence;
  if (digest(body) !== evidenceHash || canonical(evidence.selectedSlugs) !== canonical(selected(evidence.configuration))
    || evidence.configuration.status === "configured" && (evidence.configuration.workspaceId !== evidence.workspaceId || evidence.configuration.agentKey !== evidence.agentKey)) fail("EVIDENCE_MISMATCH");
  if (evidence.skills.status === "available" && (new Set(evidence.skills.rows.map(row => row.id)).size !== evidence.skills.rows.length || evidence.skills.rows.some(row => !evidence.selectedSlugs.includes(row.slug) || row.workspaceId !== null && row.workspaceId !== evidence.workspaceId))) fail("REGISTRY_SCOPE_MISMATCH");
  const review = reviewedSources(input.sourceReview), deployments = parse(z.array(deploymentSchema).max(2), input.deployments ?? []);
  if (new Set(deployments.map(row => row.sourceSlug)).size !== deployments.length) fail("DEPLOYMENT_EVIDENCE_INVALID");
  const blockers: AssistantConversationSourceComparison["blockers"] = [], add = (reason: string, slug: string | null = null) => { blockers.push({ code: reason, slug }); };
  const approvals: AssistantConversationSourceApproval[] = [];
  const config = evidence.configuration;
  if (config.status !== "configured") add(config.status === "unavailable" ? config.reasonCode : "CONFIGURATION_NOT_CONFIGURED");
  else if (!config.enabled || !config.modelSlug) add("CONFIGURATION_NOT_EXECUTABLE");
  if (evidence.skills.status !== "available") add(evidence.skills.reasonCode);
  let model: z.infer<typeof StrictRegisteredModelSnapshotSchema> | null = null;
  if (evidence.models.status !== "available") add(evidence.models.reasonCode);
  else if (evidence.models.rows.length !== 1 || !evidence.models.rows[0].snapshot) add("MODEL_UNAVAILABLE_OR_AMBIGUOUS");
  else { model = evidence.models.rows[0].snapshot; if (model.workspaceId !== evidence.workspaceId || config.status !== "configured" || model.model.slug !== config.modelSlug) fail("MODEL_SCOPE_MISMATCH"); }
  let policy: AssistantConversationExecutionPolicyEvidence | null = null;
  if (input.approvedExecutionPolicy) {
    policy = parse(AssistantConversationExecutionPolicyEvidenceSchema, input.approvedExecutionPolicy); const { evidenceHash: policyHash, ...policyBody } = policy;
    if (digest(policyBody) !== policyHash) fail("MODEL_POLICY_INVALID");
    if (!model || policy.workspaceId !== evidence.workspaceId || policy.agentKey !== evidence.agentKey || policy.modelSlug !== model.model.slug || policy.modelConfigurationHash !== model.configurationHash) add("APPROVED_MODEL_CHANGED");
    if (policy.credentialStatus !== "available") add("MODEL_CREDENTIAL_UNVERIFIED");
  } else add("EXECUTION_POLICY_UNAVAILABLE");
  const sources = review.map(source => {
    const rows = evidence.skills.status === "available" ? evidence.skills.rows.filter(row => row.slug === source.slug) : [];
    const row = rows.length === 1 ? rows[0] : null, pin = row?.pin ?? null, differences: string[] = [];
    if (!row) add(rows.length ? "SOURCE_REGISTRY_AMBIGUOUS" : "SOURCE_REGISTRY_MISSING", source.slug);
    if (row && !pin) add("SOURCE_REGISTRY_INVALID", source.slug);
    if (pin && row) {
      for (const [field, actual, expected] of [["name", pin.name, source.name], ["version", pin.version, source.sourceVersion], ["status", pin.status, source.sourceStatus], ["owner", row.owner, source.sourceOwner], ["isSystem", row.isSystem, source.sourceIsSystem], ["timeoutSeconds", pin.timeoutSeconds, source.sourceTimeoutSeconds], ["modelOverride", pin.modelOverride, null], ["manifestSha256", pin.manifestSha256, source.manifestSha256], ["systemPromptSha256", pin.systemPromptSha256, source.systemPromptSha256], ["userPromptSha256", pin.userPromptSha256, source.userPromptSha256]] as const) if (actual !== expected) differences.push(field);
      if (differences.length) add("REVIEWED_SOURCE_REGISTRY_DIFFERS", source.slug);
      const deployment = deployments.find(item => item.sourceSlug === source.slug);
      if (pin.workspaceId !== null || pin.scope !== source.sourceScope) {
        if (!deployment || deployment.registryId !== pin.id || deployment.workspaceId !== pin.workspaceId || deployment.scope !== pin.scope || deployment.skillSnapshotHash !== row.pinHash) add("DEPLOYMENT_PROVENANCE_REQUIRED", source.slug);
      } else if (deployment && (deployment.registryId !== pin.id || deployment.workspaceId !== pin.workspaceId || deployment.scope !== pin.scope || deployment.skillSnapshotHash !== row.pinHash)) add("DEPLOYMENT_PROVENANCE_MISMATCH", source.slug);
      if (!assistantConversationSkillScopeMatches(pin, evidence.workspaceId, source.slug)) add("REGISTRY_SCOPE_UNSUPPORTED", source.slug);
      if (policy && model) {
        const budget = policy[source.purpose];
        try { if (strictCostUpperBound(model, 1, pin.maxTokens) > budget.maxCostCents) add("EXECUTION_BUDGET_INSUFFICIENT", source.slug); } catch { add("MODEL_PRICING_UNAVAILABLE", source.slug); }
        if (budget.imageBudget && (!model.model.capabilityTags.includes("vision") || budget.imageBudget.maxInputTokensPerImage > model.model.maxContextTokens)) add("IMAGE_BUDGET_INVALID", source.slug);
        approvals.push(AssistantConversationSourceApprovalSchema.parse({ workspaceId: evidence.workspaceId, agentKey: evidence.agentKey, purpose: source.purpose, skillSlug: source.slug, skillSnapshotHash: row.pinHash,
          source: { origin: "reviewed_supplement", revision: ASSISTANT_REVIEWED_SUPPLEMENT_REVISION, approvalRef: `reviewed-supplement:${ASSISTANT_REVIEWED_SUPPLEMENT_REVISION}:${source.manifestRawSha256}` },
          inputContract: source.inputContract, outputContract: source.outputContract, modelConfigurationHash: model.configurationHash, maxCostCents: budget.maxCostCents, imageBudget: budget.imageBudget }));
      }
    }
    return { slug: source.slug, purpose: source.purpose, sourceRevision: ASSISTANT_REVIEWED_SUPPLEMENT_REVISION, sourceScope: source.sourceScope, registryId: row?.id ?? null, registryScope: row?.scope ?? null, registryWorkspaceId: row?.workspaceId ?? null,
      pin, pinHash: row?.pinHash ?? null, differences, sourceMatches: !!pin && differences.length === 0, runtimeScopeCompatible: !!pin && assistantConversationSkillScopeMatches(pin, evidence.workspaceId, source.slug) };
  });
  const contextualSkills: AssistantConversationSourceComparison["contextualSkills"] = config.status === "configured" ? config.skills.filter(row => row.enabled).map(binding => {
    const matching = evidence.skills.status === "available" ? evidence.skills.rows.filter(row => row.slug === binding.slug) : [];
    const pin = matching.length === 1 ? matching[0].pin : null;
    const registryMatchesBinding = !!pin && assistantConversationSkillScopeMatches(pin, evidence.workspaceId, binding.slug) && pin.version === binding.version && pin.manifestSha256 === binding.manifestSha256;
    add("CONTEXT_SOURCE_UNREVIEWED", binding.slug); if (!registryMatchesBinding) add("CONTEXT_BINDING_UNVERIFIABLE", binding.slug);
    return { slug: binding.slug, originRequired: binding.slug.startsWith("listing.") ? "user_listing" : "qingdao", status: "source_unreviewed", registryMatchesBinding };
  }) : [];
  const runtimeReady = blockers.length === 0 && approvals.length === 2;
  return { schema: "assistant-conversation-source-comparison/v1", workspaceId: evidence.workspaceId, agentKey: evidence.agentKey, evidenceHash, sourceReviewed: true, runtimeReady, blockers, hashSemantics: { sourceManifest: "canonical_semantic_manifest", sourceRaw: "fixed_review_artifact_provenance_only", registryRaw: "runtime_parsed_manifest_serialization" }, sources, contextualSkills, runtimeApprovals: runtimeReady ? approvals : null };
}
