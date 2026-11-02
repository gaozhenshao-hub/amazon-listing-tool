import { count, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { emperorSkillRuns } from "../../../drizzle/schema/ai_os";
import {
  imageAssetLicenseEvidenceRevisions,
} from "../../../drizzle/schema/imageAssetTrustLedger";
import {
  imageAssetPolicyRevisions,
} from "../../../drizzle/schema/imageAssetPolicies";
import {
  listingBulletCandidates,
  listingCoreRevisions,
  listingFactRevisions,
  listingReviewRevisions,
} from "../../../drizzle/schema/listingRevisions";
import { getDb, type DbExecutor } from "../../repositories/dbClient";

/**
 * The available ledgers record workflow approvals and policy review, but do not
 * contain a human American-English language-assessment field. This message is
 * intentionally fixed rather than inferred from a gate or an AI evaluation.
 */
export const AMERICAN_ENGLISH_INSUFFICIENT_SAMPLE_MESSAGE = "样本不足，不能判断美语质量";

export type CoverageMetric = {
  denominatorCount: number;
  numeratorCount: number;
  ratio: number;
};

export type QualityDashboard = {
  listing: {
    factHumanConfirmation: CoverageMetric;
    coreHumanConfirmation: CoverageMetric;
    candidateHumanReview: CoverageMetric & {
      recordedDecisionCount: number;
    };
  };
  image: {
    policyHumanReview: CoverageMetric;
    licenseEvidenceHumanReview: CoverageMetric;
  };
  operations: {
    totalRunCount: number;
    succeededRunCount: number;
    failedRunCount: number;
    activeRunCount: number;
    canceledRunCount: number;
    completedRunSuccessRatio: number;
  };
  americanEnglishHumanReview: {
    sampleCount: number;
    message: typeof AMERICAN_ENGLISH_INSUFFICIENT_SAMPLE_MESSAGE;
  };
};

type AggregateRow = Record<string, number | string | null | undefined>;

function asCount(value: unknown): number {
  const countValue = Number(value);
  return Number.isFinite(countValue) && countValue >= 0 ? countValue : 0;
}

function rowCount(row: AggregateRow | undefined, key: string): number {
  return asCount(row?.[key]);
}

function coverage(numeratorCount: number, denominatorCount: number): CoverageMetric {
  return {
    denominatorCount,
    numeratorCount,
    ratio: denominatorCount === 0 ? 0 : numeratorCount / denominatorCount,
  };
}

function assertWorkspaceId(workspaceId: number): void {
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "请先选择项目所属的工作空间" });
  }
}

/**
 * Reads only workspace-scoped aggregate counts. No listing text, identifiers,
 * storage references, URLs, user identity, AI gate payload, or model output is
 * selected or returned from this service.
 */
export async function readQualityDashboard(input: {
  workspaceId: number;
  database?: DbExecutor;
}): Promise<QualityDashboard> {
  const { workspaceId } = input;
  assertWorkspaceId(workspaceId);

  const database = input.database ?? await getDb();
  if (!database) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "质量仪表盘暂不可用" });
  }

  const [
    factRows,
    coreRows,
    candidateRows,
    candidateReviewRows,
    imagePolicyRows,
    imageEvidenceRows,
    emperorRunRows,
  ] = await Promise.all([
    database
      .select({
        totalCount: count(),
        humanConfirmedCount: sql<number>`coalesce(sum(case when ${listingFactRevisions.status} = 'confirmed' and ${listingFactRevisions.confirmedBy} is not null and ${listingFactRevisions.confirmedAt} is not null then 1 else 0 end), 0)`,
      })
      .from(listingFactRevisions)
      .where(eq(listingFactRevisions.workspaceId, workspaceId)),
    database
      .select({
        totalCount: count(),
        humanConfirmedCount: sql<number>`coalesce(sum(case when ${listingCoreRevisions.status} = 'confirmed' and ${listingCoreRevisions.confirmedBy} is not null and ${listingCoreRevisions.confirmedAt} is not null then 1 else 0 end), 0)`,
      })
      .from(listingCoreRevisions)
      .where(eq(listingCoreRevisions.workspaceId, workspaceId)),
    database
      .select({ totalCount: count() })
      .from(listingBulletCandidates)
      .where(eq(listingBulletCandidates.workspaceId, workspaceId)),
    database
      .select({
        humanReviewedCandidateCount: sql<number>`count(distinct case when ${listingReviewRevisions.status} = 'recorded' and ${listingReviewRevisions.decision} in ('accepted', 'edited', 'rejected') then ${listingReviewRevisions.candidateId} end)`,
        recordedDecisionCount: sql<number>`coalesce(sum(case when ${listingReviewRevisions.status} = 'recorded' and ${listingReviewRevisions.decision} in ('accepted', 'edited', 'rejected') then 1 else 0 end), 0)`,
      })
      .from(listingReviewRevisions)
      .where(eq(listingReviewRevisions.workspaceId, workspaceId)),
    database
      .select({
        totalCount: count(),
        humanReviewedCount: sql<number>`coalesce(sum(case when ${imageAssetPolicyRevisions.reviewedBy} is not null and ${imageAssetPolicyRevisions.reviewedAt} is not null and ${imageAssetPolicyRevisions.reviewState} in ('approved', 'rejected', 'revoked') then 1 else 0 end), 0)`,
      })
      .from(imageAssetPolicyRevisions)
      .where(eq(imageAssetPolicyRevisions.workspaceId, workspaceId)),
    database
      .select({
        totalCount: count(),
        humanReviewedCount: sql<number>`coalesce(sum(case when ${imageAssetLicenseEvidenceRevisions.reviewedBy} is not null and ${imageAssetLicenseEvidenceRevisions.reviewedAt} is not null and ${imageAssetLicenseEvidenceRevisions.status} in ('verified', 'rejected', 'revoked') then 1 else 0 end), 0)`,
      })
      .from(imageAssetLicenseEvidenceRevisions)
      .where(eq(imageAssetLicenseEvidenceRevisions.workspaceId, workspaceId)),
    database
      .select({
        totalRunCount: count(),
        succeededRunCount: sql<number>`coalesce(sum(case when ${emperorSkillRuns.status} = 'succeeded' then 1 else 0 end), 0)`,
        failedRunCount: sql<number>`coalesce(sum(case when ${emperorSkillRuns.status} = 'failed' then 1 else 0 end), 0)`,
        activeRunCount: sql<number>`coalesce(sum(case when ${emperorSkillRuns.status} in ('queued', 'running') then 1 else 0 end), 0)`,
        canceledRunCount: sql<number>`coalesce(sum(case when ${emperorSkillRuns.status} = 'canceled' then 1 else 0 end), 0)`,
        completedRunCount: sql<number>`coalesce(sum(case when ${emperorSkillRuns.status} in ('succeeded', 'failed', 'canceled') then 1 else 0 end), 0)`,
      })
      .from(emperorSkillRuns)
      .where(eq(emperorSkillRuns.workspaceId, workspaceId)),
  ]);

  const facts = factRows[0] as AggregateRow | undefined;
  const cores = coreRows[0] as AggregateRow | undefined;
  const candidates = candidateRows[0] as AggregateRow | undefined;
  const candidateReviews = candidateReviewRows[0] as AggregateRow | undefined;
  const imagePolicies = imagePolicyRows[0] as AggregateRow | undefined;
  const imageEvidence = imageEvidenceRows[0] as AggregateRow | undefined;
  const emperorRuns = emperorRunRows[0] as AggregateRow | undefined;

  const candidateTotalCount = rowCount(candidates, "totalCount");
  const completedRunCount = rowCount(emperorRuns, "completedRunCount");

  return {
    listing: {
      factHumanConfirmation: coverage(
        rowCount(facts, "humanConfirmedCount"),
        rowCount(facts, "totalCount"),
      ),
      coreHumanConfirmation: coverage(
        rowCount(cores, "humanConfirmedCount"),
        rowCount(cores, "totalCount"),
      ),
      candidateHumanReview: {
        ...coverage(
          rowCount(candidateReviews, "humanReviewedCandidateCount"),
          candidateTotalCount,
        ),
        recordedDecisionCount: rowCount(candidateReviews, "recordedDecisionCount"),
      },
    },
    image: {
      policyHumanReview: coverage(
        rowCount(imagePolicies, "humanReviewedCount"),
        rowCount(imagePolicies, "totalCount"),
      ),
      licenseEvidenceHumanReview: coverage(
        rowCount(imageEvidence, "humanReviewedCount"),
        rowCount(imageEvidence, "totalCount"),
      ),
    },
    operations: {
      totalRunCount: rowCount(emperorRuns, "totalRunCount"),
      succeededRunCount: rowCount(emperorRuns, "succeededRunCount"),
      failedRunCount: rowCount(emperorRuns, "failedRunCount"),
      activeRunCount: rowCount(emperorRuns, "activeRunCount"),
      canceledRunCount: rowCount(emperorRuns, "canceledRunCount"),
      completedRunSuccessRatio: completedRunCount === 0
        ? 0
        : rowCount(emperorRuns, "succeededRunCount") / completedRunCount,
    },
    // No available source ledger stores a human American-English assessment.
    // Candidate gates and AI output are intentionally excluded from this count.
    americanEnglishHumanReview: {
      sampleCount: 0,
      message: AMERICAN_ENGLISH_INSUFFICIENT_SAMPLE_MESSAGE,
    },
  };
}
