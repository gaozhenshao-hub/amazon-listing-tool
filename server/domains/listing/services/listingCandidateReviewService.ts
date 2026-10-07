import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  listingBulletCandidates,
  listingCoreRevisions,
  listingFactRevisions,
  listingReviewRevisions,
} from "../../../../drizzle/schema/listingRevisions";
import { projectFiles, projects } from "../../../../drizzle/schema/project";
import { isTemplateOrEmptyFact } from "../../../../shared/listingFactSafety";
import { validateCrossBulletDistinctness, validateReviewedBulletClaims } from "./listingCandidateFactGate";
import { getDb } from "../repository";

type JsonObject = Record<string, unknown>;
type CandidateSource = "ai" | "human";
type CandidateStatus =
  | "generated"
  | "review_required"
  | "confirmed"
  | "rejected"
  | "stale"
  | "gate_failed"
  | "failed"
  | "draft";

type CandidateStructure = {
  subtitle?: string | null;
  fullText: string;
  evidenceFactIds: number[];
};

type ModelMetadata = {
  plannedModel?: string;
  fallbackReason?: string;
  schemaVersion?: string;
};

type CandidateServiceDependencies = {
  getDb: typeof getDb;
  now: () => Date;
  createId: () => string;
};

export type CreateListingCandidateInput = CandidateStructure & {
  workspaceId: number;
  projectId: number;
  actorId: number;
  actorRole: string;
  coreRevisionId: number;
  coreInputHash: string;
  source: CandidateSource;
  jobId?: number;
  skillRunId?: number;
  promptVersion?: string;
  actualModel?: string;
  modelMetadata?: ModelMetadata;
  gateResult: JsonObject;
};

export type EditListingCandidateInput = CandidateStructure & {
  workspaceId: number;
  projectId: number;
  actorId: number;
  actorRole: string;
  candidateId: number;
  expectedCandidateRevision: number;
  reason?: string;
};

export type CandidateDecisionInput = {
  workspaceId: number;
  projectId: number;
  actorId: number;
  actorRole: string;
  candidateId: number;
  expectedCandidateRevision: number;
  reason?: string;
};

const hash = (value: unknown) =>
  createHash("sha256").update(stableJson(value)).digest("hex");

/** Stable JSON prevents key insertion order from changing an audit/content hash. */
export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function fail(
  code:
    | "BAD_REQUEST"
    | "CONFLICT"
    | "FORBIDDEN"
    | "PRECONDITION_FAILED"
    | "INTERNAL_SERVER_ERROR",
  message: string
): never {
  throw new TRPCError({ code, message });
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function normaliseStructure(input: CandidateStructure): Required<
  Pick<CandidateStructure, "fullText" | "evidenceFactIds">
> & {
  subtitle: string | null;
} {
  const fullText = input.fullText.trim();
  const subtitle = input.subtitle?.trim() || null;
  if (!fullText || fullText.length > 5_000)
    fail("BAD_REQUEST", "卖点正文不能为空且不得超过 5000 个字符");
  if (subtitle && subtitle.length > 500)
    fail("BAD_REQUEST", "卖点副标题不得超过 500 个字符");
  if (
    input.evidenceFactIds.length < 1 ||
    input.evidenceFactIds.length > 30 ||
    input.evidenceFactIds.some(id => !isPositiveInteger(id)) ||
    new Set(input.evidenceFactIds).size !== input.evidenceFactIds.length
  ) {
    fail("BAD_REQUEST", "候选必须引用至少一条不重复的已确认事实");
  }
  return {
    subtitle,
    fullText,
    evidenceFactIds: [...input.evidenceFactIds].sort((a, b) => a - b),
  };
}

function normaliseMetadata(input: CreateListingCandidateInput): JsonObject {
  if (
    input.source === "ai" &&
    (!isPositiveInteger(input.skillRunId) ||
      !input.promptVersion?.trim() ||
      !input.actualModel?.trim())
  ) {
    fail("BAD_REQUEST", "AI 候选必须保存来源 Skill Run、Prompt 版本和实际模型");
  }
  if (input.jobId !== undefined && !isPositiveInteger(input.jobId))
    fail("BAD_REQUEST", "Job ID 无效");
  if (input.skillRunId !== undefined && !isPositiveInteger(input.skillRunId))
    fail("BAD_REQUEST", "Skill Run ID 无效");
  const optionalText = [
    input.promptVersion,
    input.actualModel,
    input.modelMetadata?.plannedModel,
    input.modelMetadata?.fallbackReason,
    input.modelMetadata?.schemaVersion,
  ];
  if (
    optionalText.some(
      value => value !== undefined && (!value.trim() || value.length > 128)
    )
  ) {
    fail("BAD_REQUEST", "候选来源元数据格式无效");
  }
  return {
    source: input.source,
    jobId: input.jobId ?? null,
    skillRunId: input.skillRunId ?? null,
    promptVersion: input.promptVersion?.trim() || null,
    actualModel: input.actualModel?.trim() || null,
    plannedModel: input.modelMetadata?.plannedModel?.trim() || null,
    fallbackReason: input.modelMetadata?.fallbackReason?.trim() || null,
    schemaVersion: input.modelMetadata?.schemaVersion?.trim() || null,
  };
}

function normaliseGateResult(
  gateResult: JsonObject,
  provenance: JsonObject
): JsonObject {
  if (
    !gateResult ||
    Array.isArray(gateResult) ||
    typeof gateResult !== "object"
  ) {
    fail("BAD_REQUEST", "候选门禁结果必须是结构化对象");
  }
  let cloned: JsonObject;
  try {
    const serialized = JSON.stringify(gateResult);
    if (!serialized || serialized.length > 30_000)
      fail("BAD_REQUEST", "候选门禁结果为空或过大");
    cloned = JSON.parse(serialized) as JsonObject;
  } catch {
    fail("BAD_REQUEST", "候选门禁结果必须可序列化");
  }
  return { ...cloned, provenance };
}

function jsonIdArray(value: unknown, message: string): number[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.some(id => !isPositiveInteger(id)) ||
    new Set(value).size !== value.length
  ) {
    fail("PRECONDITION_FAILED", message);
  }
  return value as number[];
}

function asJsonObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as JsonObject;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed as JsonObject;
    } catch {
      return {};
    }
  }
  return {};
}

function candidateContentHash(input: {
  coreRevisionId: number;
  inputHash: string;
  structure: ReturnType<typeof normaliseStructure>;
  gateResult: JsonObject;
}): string {
  return hash({
    coreRevisionId: input.coreRevisionId,
    inputHash: input.inputHash,
    subtitle: input.structure.subtitle,
    fullText: input.structure.fullText,
    evidenceFactIds: input.structure.evidenceFactIds,
    gateResult: input.gateResult,
  });
}

function candidateCanBeConfirmed(candidate: {
  status: CandidateStatus;
  gateResultJson: unknown;
}) {
  if (!["generated", "review_required", "draft"].includes(candidate.status)) {
    fail("PRECONDITION_FAILED", "该候选不处于可人工确认状态");
  }
  const gate = asJsonObject(candidate.gateResultJson);
  const status =
    typeof gate.status === "string" ? gate.status.toLowerCase() : "";
  if (
    ["failed", "gate_failed", "blocked"].includes(status) ||
    gate.eligibleForConfirmation === false
  ) {
    fail("PRECONDITION_FAILED", "候选的服务端门禁尚未通过，不能人工确认");
  }
}

async function assertProjectWriteAccess(
  tx: any,
  input: {
    workspaceId: number;
    projectId: number;
    actorId: number;
    actorRole: string;
  }
) {
  const [project] = await tx
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1)
    .for("update");
  if (
    !project ||
    project.workspaceId !== input.workspaceId ||
    (project.userId !== input.actorId &&
      !["admin", "super_admin"].includes(input.actorRole))
  ) {
    fail("FORBIDDEN", "项目不属于当前已授权工作空间");
  }
}

function assertStoredCandidateIntegrity(candidate: any, core: any) {
  const structure = normaliseStructure({
    subtitle: candidate.subtitle,
    fullText: candidate.fullText ?? "",
    evidenceFactIds: jsonIdArray(
      candidate.evidenceFactIdsJson,
      "候选证据引用损坏"
    ),
  });
  const gateResult = asJsonObject(candidate.gateResultJson);
  const recomputed = candidateContentHash({
    coreRevisionId: candidate.coreRevisionId,
    inputHash: candidate.inputHash,
    structure,
    gateResult,
  });
  if (
    candidate.coreRevisionId !== core.id ||
    candidate.inputHash !== core.inputHash ||
    candidate.contentHash !== recomputed
  ) {
    fail(
      "PRECONDITION_FAILED",
      "候选内容或其受治理输入已发生变化，请重新生成或编辑"
    );
  }
  const coreFactIds = jsonIdArray(
    core.factRevisionIdsJson,
    "卖点核心缺少可追溯的确认事实"
  );
  if (structure.evidenceFactIds.some(id => !coreFactIds.includes(id))) {
    fail("PRECONDITION_FAILED", "候选引用了不属于当前卖点核心的事实");
  }
  return structure;
}

async function assertCurrentConfirmedCore(
  tx: any,
  input: {
    workspaceId: number;
    projectId: number;
    actorId: number;
    actorRole: string;
    coreRevisionId: number;
    coreInputHash?: string;
  }
) {
  await assertProjectWriteAccess(tx, input);

  const [core] = await tx
    .select()
    .from(listingCoreRevisions)
    .where(
      and(
        eq(listingCoreRevisions.id, input.coreRevisionId),
        eq(listingCoreRevisions.workspaceId, input.workspaceId),
        eq(listingCoreRevisions.projectId, input.projectId),
        eq(listingCoreRevisions.status, "confirmed")
      )
    )
    .limit(1)
    .for("update");
  if (
    !core ||
    !core.confirmedBy ||
    !core.confirmedAt ||
    (input.coreInputHash && core.inputHash !== input.coreInputHash)
  ) {
    fail("PRECONDITION_FAILED", "未找到当前已人工确认的卖点核心版本");
  }

  const [latestCore] = await tx
    .select({ id: listingCoreRevisions.id })
    .from(listingCoreRevisions)
    .where(
      and(
        eq(listingCoreRevisions.workspaceId, input.workspaceId),
        eq(listingCoreRevisions.projectId, input.projectId),
        eq(listingCoreRevisions.coreId, core.coreId)
      )
    )
    .orderBy(desc(listingCoreRevisions.revision))
    .limit(1)
    .for("update");
  if (latestCore?.id !== core.id)
    fail("CONFLICT", "卖点核心已有新修订，旧候选不得继续审阅或确认");

  const factIds = jsonIdArray(
    core.factRevisionIdsJson,
    "卖点核心缺少可追溯的确认事实"
  );
  const facts = await tx
    .select()
    .from(listingFactRevisions)
    .where(
      and(
        eq(listingFactRevisions.workspaceId, input.workspaceId),
        eq(listingFactRevisions.projectId, input.projectId),
        inArray(listingFactRevisions.id, factIds)
      )
    );
  const [latestFile] = await tx
    .select({ id: projectFiles.id, hash: projectFiles.rawContentHash })
    .from(projectFiles)
    .where(
      and(
        eq(projectFiles.projectId, input.projectId),
        eq(projectFiles.fileType, "product_attributes")
      )
    )
    .orderBy(desc(projectFiles.createdAt), desc(projectFiles.id))
    .limit(1)
    .for("update");
  if (
    !latestFile ||
    facts.length !== factIds.length ||
    facts.some(
      (fact: any) =>
        fact.status !== "confirmed" ||
        !fact.confirmedBy ||
        !fact.confirmedAt ||
        fact.sourceFileId !== latestFile.id ||
        fact.rawHash !== latestFile.hash ||
        isTemplateOrEmptyFact(fact.value)
    )
  ) {
    fail(
      "PRECONDITION_FAILED",
      "原始属性表或已确认事实发生变化，请重新核对卖点核心"
    );
  }
  return core;
}

async function getScopedCandidateForUpdate(
  tx: any,
  input: CandidateDecisionInput
) {
  const [candidate] = await tx
    .select()
    .from(listingBulletCandidates)
    .where(
      and(
        eq(listingBulletCandidates.id, input.candidateId),
        eq(listingBulletCandidates.workspaceId, input.workspaceId),
        eq(listingBulletCandidates.projectId, input.projectId)
      )
    )
    .limit(1)
    .for("update");
  if (!candidate) fail("FORBIDDEN", "候选不存在或不属于当前工作空间项目");
  if (candidate.candidateRevision !== input.expectedCandidateRevision) {
    fail("CONFLICT", "候选版本已变化，请刷新后再操作");
  }
  return candidate;
}

async function nextReviewRevision(tx: any, candidateId: number) {
  const [latest] = await tx
    .select({ reviewRevision: listingReviewRevisions.reviewRevision })
    .from(listingReviewRevisions)
    .where(eq(listingReviewRevisions.candidateId, candidateId))
    .orderBy(desc(listingReviewRevisions.reviewRevision))
    .limit(1)
    .for("update");
  return (latest?.reviewRevision ?? 0) + 1;
}

async function writeReviewAudit(
  tx: any,
  input: {
    workspaceId: number;
    projectId: number;
    candidateId: number;
    expectedRevision: number;
    actorId: number;
    decision: "accepted" | "edited" | "rejected";
    beforeHash: string | null;
    afterHash: string | null;
    resultingCandidateId?: number;
    reason?: string;
  }
) {
  const reviewRevision = await nextReviewRevision(tx, input.candidateId);
  await tx.insert(listingReviewRevisions).values({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    candidateId: input.candidateId,
    reviewRevision,
    decision: input.decision,
    beforeHash: input.beforeHash,
    afterHash: input.afterHash,
    expectedRevision: input.expectedRevision,
    resultingCandidateId: input.resultingCandidateId ?? null,
    reason: input.reason?.trim() || null,
    actorId: input.actorId,
  });
  return reviewRevision;
}

/**
 * Candidate review service. It deliberately does not write `listings`: legacy
 * Listing persistence has no governed atomic apply path wired here yet.
 */
export function createListingCandidateReviewService(
  dependencies: Partial<CandidateServiceDependencies> = {}
) {
  const deps: CandidateServiceDependencies = {
    getDb,
    now: () => new Date(),
    createId: randomUUID,
    ...dependencies,
  };

  async function requireTransaction() {
    const db = await deps.getDb();
    if (!db || typeof (db as any).transaction !== "function") {
      fail("INTERNAL_SERVER_ERROR", "候选审阅事务暂不可用");
    }
    return db as any;
  }

  async function createCandidate(input: CreateListingCandidateInput) {
    const structure = normaliseStructure(input);
    const provenance = normaliseMetadata(input);
    const gateResult = normaliseGateResult(input.gateResult, provenance);
    const db = await requireTransaction();
    return db.transaction(async (tx: any) => {
      const core = await assertCurrentConfirmedCore(tx, input);
      const contentHash = candidateContentHash({
        coreRevisionId: core.id,
        inputHash: core.inputHash,
        structure,
        gateResult,
      });
      const candidateKey = deps.createId();
      const [written] = await tx.insert(listingBulletCandidates).values({
        candidateKey,
        candidateRevision: 1,
        parentCandidateId: null,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        coreRevisionId: core.id,
        jobId: input.jobId ?? null,
        skillRunId: input.skillRunId ?? null,
        promptVersion: input.promptVersion?.trim() || null,
        actualModel: input.actualModel?.trim() || null,
        inputHash: core.inputHash,
        subtitle: structure.subtitle,
        fullText: structure.fullText,
        evidenceFactIdsJson: structure.evidenceFactIds,
        gateResultJson: gateResult,
        status: "review_required",
        contentHash,
        createdBy: input.actorId,
      });
      return {
        id: written.insertId,
        candidateKey,
        candidateRevision: 1,
        contentHash,
        status: "review_required" as const,
      };
    });
  }

  async function editCandidate(input: EditListingCandidateInput) {
    const structure = normaliseStructure(input);
    const db = await requireTransaction();
    return db.transaction(async (tx: any) => {
      const current = await getScopedCandidateForUpdate(tx, input);
      if (
        ["rejected", "stale", "failed", "gate_failed"].includes(current.status)
      ) {
        fail(
          "PRECONDITION_FAILED",
          "该候选已拒绝、失效或门禁失败，不能在原版本上编辑"
        );
      }
      const core = await assertCurrentConfirmedCore(tx, {
        ...input,
        coreRevisionId: current.coreRevisionId,
        coreInputHash: current.inputHash,
      });
      assertStoredCandidateIntegrity(current, core);
      const priorGate = asJsonObject(current.gateResultJson);
      const gateResult = {
        ...priorGate,
        status: "needs_review",
        invalidatedReason: "human_content_edit",
        invalidatedAt: deps.now().toISOString(),
        provenance: {
          source: "human",
          parentCandidateId: current.id,
          originSkillRunId: current.skillRunId ?? null,
          originActualModel: current.actualModel ?? null,
          originPromptVersion: current.promptVersion ?? null,
        },
      };
      const candidateRevision = current.candidateRevision + 1;
      const contentHash = candidateContentHash({
        coreRevisionId: core.id,
        inputHash: core.inputHash,
        structure,
        gateResult,
      });
      const [written] = await tx.insert(listingBulletCandidates).values({
        candidateKey: current.candidateKey,
        candidateRevision,
        parentCandidateId: current.id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        coreRevisionId: core.id,
        jobId: current.jobId,
        skillRunId: current.skillRunId,
        promptVersion: current.promptVersion,
        actualModel: current.actualModel,
        inputHash: core.inputHash,
        subtitle: structure.subtitle,
        fullText: structure.fullText,
        evidenceFactIdsJson: structure.evidenceFactIds,
        gateResultJson: gateResult,
        status: "review_required",
        contentHash,
        createdBy: input.actorId,
      });
      // The source content remains immutable and reviewable, but it can no
      // longer be accepted once a human created its successor revision.
      await tx
        .update(listingBulletCandidates)
        .set({ status: "stale", staleAt: deps.now() })
        .where(
          and(
            eq(listingBulletCandidates.id, current.id),
            eq(listingBulletCandidates.workspaceId, input.workspaceId),
            eq(listingBulletCandidates.projectId, input.projectId),
            eq(
              listingBulletCandidates.candidateRevision,
              input.expectedCandidateRevision
            ),
            inArray(listingBulletCandidates.status, [
              "draft",
              "generated",
              "review_required",
            ])
          )
        );
      const reviewRevision = await writeReviewAudit(tx, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        candidateId: current.id,
        expectedRevision: input.expectedCandidateRevision,
        actorId: input.actorId,
        decision: "edited",
        beforeHash: current.contentHash,
        afterHash: contentHash,
        resultingCandidateId: written.insertId,
        reason: input.reason,
      });
      return {
        id: written.insertId,
        candidateKey: current.candidateKey,
        candidateRevision,
        contentHash,
        reviewRevision,
        status: "review_required" as const,
      };
    });
  }

  async function rejectCandidate(input: CandidateDecisionInput) {
    const db = await requireTransaction();
    return db.transaction(async (tx: any) => {
      await assertProjectWriteAccess(tx, input);
      const current = await getScopedCandidateForUpdate(tx, input);
      if (["confirmed", "rejected", "stale"].includes(current.status)) {
        fail("PRECONDITION_FAILED", "该候选已经确认、拒绝或失效，不能再次拒绝");
      }
      await tx
        .update(listingBulletCandidates)
        .set({ status: "rejected" })
        .where(
          and(
            eq(listingBulletCandidates.id, current.id),
            eq(listingBulletCandidates.workspaceId, input.workspaceId),
            eq(listingBulletCandidates.projectId, input.projectId),
            eq(
              listingBulletCandidates.candidateRevision,
              input.expectedCandidateRevision
            ),
            inArray(listingBulletCandidates.status, [
              "draft",
              "generated",
              "review_required",
              "gate_failed",
              "failed",
            ])
          )
        );
      const reviewRevision = await writeReviewAudit(tx, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        candidateId: current.id,
        expectedRevision: input.expectedCandidateRevision,
        actorId: input.actorId,
        decision: "rejected",
        beforeHash: current.contentHash,
        afterHash: null,
        reason: input.reason,
      });
      return { id: current.id, status: "rejected" as const, reviewRevision };
    });
  }

  async function confirmCandidate(input: CandidateDecisionInput) {
    const db = await requireTransaction();
    return db.transaction(async (tx: any) => {
      const current = await getScopedCandidateForUpdate(tx, input);
      const core = await assertCurrentConfirmedCore(tx, {
        ...input,
        coreRevisionId: current.coreRevisionId,
        coreInputHash: current.inputHash,
      });
      assertStoredCandidateIntegrity(current, core);
      candidateCanBeConfirmed(current);
      const evidenceFactIds = jsonIdArray(current.evidenceFactIdsJson, "候选证据引用损坏");
      const citedFacts = await tx.select({ id: listingFactRevisions.id,
        attributeKey: listingFactRevisions.attributeKey, value: listingFactRevisions.value })
        .from(listingFactRevisions).where(and(
          eq(listingFactRevisions.workspaceId, input.workspaceId),
          eq(listingFactRevisions.projectId, input.projectId),
          inArray(listingFactRevisions.id, evidenceFactIds),
          eq(listingFactRevisions.status, "confirmed"),
        )).for("update");
      const claimIssues = validateReviewedBulletClaims({ subtitle: current.subtitle,
        fullText: current.fullText, evidenceFactIds, approvedFacts: citedFacts });
      if (claimIssues.length) fail("PRECONDITION_FAILED", `卖点事实或格式需修正：${claimIssues.join("；")}`);
      const projectConfirmedBullets = await tx.select({ subtitle: listingBulletCandidates.subtitle,
        fullText: listingBulletCandidates.fullText, coreRevisionId: listingBulletCandidates.coreRevisionId })
        .from(listingBulletCandidates).where(and(
          eq(listingBulletCandidates.workspaceId, input.workspaceId),
          eq(listingBulletCandidates.projectId, input.projectId),
          eq(listingBulletCandidates.status, "confirmed"),
        )).for("update");
      const duplicateIssues = validateCrossBulletDistinctness({ subtitle: current.subtitle,
        fullText: current.fullText, previous: projectConfirmedBullets
          .filter((item: { coreRevisionId: number }) => item.coreRevisionId !== core.id) });
      if (duplicateIssues.length) fail("PRECONDITION_FAILED", duplicateIssues.join("；"));
      await tx
        .update(listingBulletCandidates)
        .set({ status: "confirmed" })
        .where(
          and(
            eq(listingBulletCandidates.id, current.id),
            eq(listingBulletCandidates.workspaceId, input.workspaceId),
            eq(listingBulletCandidates.projectId, input.projectId),
            eq(
              listingBulletCandidates.candidateRevision,
              input.expectedCandidateRevision
            ),
            inArray(listingBulletCandidates.status, [
              "draft",
              "generated",
              "review_required",
            ])
          )
        );
      const reviewRevision = await writeReviewAudit(tx, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        candidateId: current.id,
        expectedRevision: input.expectedCandidateRevision,
        actorId: input.actorId,
        decision: "accepted",
        beforeHash: current.contentHash,
        afterHash: current.contentHash,
        reason: input.reason,
      });
      return {
        id: current.id,
        candidateKey: current.candidateKey,
        candidateRevision: current.candidateRevision,
        contentHash: current.contentHash,
        reviewRevision,
        status: "confirmed" as const,
        listingSync: "not_started" as const,
      };
    });
  }

  /** Fail closed until the parent integration can atomically CAS listings + snapshots + audit. */
  async function syncConfirmedCandidateToListing(
    _input: CandidateDecisionInput & {
      listingId: number;
      expectedListingVersion: number;
    }
  ) {
    fail(
      "PRECONDITION_FAILED",
      "正式 Listing 同步接口已关闭：尚未接入旧 Listing 的版本 CAS、完整快照和同事务人审审计，未写入任何 Listing"
    );
  }

  return {
    createCandidate,
    editCandidate,
    rejectCandidate,
    confirmCandidate,
    syncConfirmedCandidateToListing,
  };
}

const candidateReviewService = createListingCandidateReviewService();

export const createListingCandidate = candidateReviewService.createCandidate;
export const editListingCandidate = candidateReviewService.editCandidate;
export const rejectListingCandidate = candidateReviewService.rejectCandidate;
export const confirmListingCandidate = candidateReviewService.confirmCandidate;
export const syncConfirmedCandidateToListing =
  candidateReviewService.syncConfirmedCandidateToListing;
