import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../repositories/dbClient";
import { aiArtifacts } from "../../../../drizzle/schema/ai_os";
import {
  competitorAnalyses,
  competitorComparisonReports,
  devAnalysisStages,
  devProjects,
  projects,
} from "../../../../drizzle/schema/project";
import {
  adStructures,
  keywords,
  listingVersions,
  listings,
  negativeKeywords,
  reviewAggregations,
} from "../../../../drizzle/schema/listing";
import {
  competitorImageAnalyses,
  expressionGroupImages,
  expressionGroups,
  imageWorkflowSessions,
} from "../../../../drizzle/schema/image";
import {
  videoEditScripts,
  videoScriptSections,
  videoScriptShots,
  videoScriptSubtopics,
  videoScripts,
  videoSpvSegments,
} from "../../../../drizzle/schema/video";
import { registerUnifiedArtifact, type ArtifactSourceType, type RegisteredArtifact } from "./artifactLifecycle";

async function projectScope(projectId: number, domain: "listing" | "image" | "ads" | "video" | "project") {
  const db = await getDb();
  if (!db) return null;
  if (domain === "project") {
    const [project] = await db.select({ userId: devProjects.userId })
      .from(devProjects)
      .where(eq(devProjects.id, projectId))
      .limit(1);
    return project ? { workspaceId: null, userId: project.userId } : null;
  }
  const [project] = await db.select({
    workspaceId: projects.workspaceId,
    userId: projects.userId,
  }).from(projects).where(eq(projects.id, projectId)).limit(1);
  return project || null;
}

async function registerBusinessArtifact(input: {
  domain: "listing" | "image" | "ads" | "video" | "project";
  artifactKey: string;
  sourceTable: string;
  sourceRowId: number | string;
  projectId?: number | null;
  workspaceId?: number | null;
  userId?: number | null;
  content: unknown;
  sourceType: ArtifactSourceType;
  status?: "draft" | "final";
  metadata?: Record<string, unknown>;
}): Promise<RegisteredArtifact | null> {
  const scope = input.projectId ? await projectScope(input.projectId, input.domain) : null;
  return registerUnifiedArtifact({
    workspaceId: input.workspaceId ?? scope?.workspaceId ?? null,
    domain: input.domain,
    artifactKey: input.artifactKey,
    artifactType: "json",
    sourceType: input.sourceType,
    sourceTable: input.sourceTable,
    sourceRowId: input.sourceRowId,
    projectId: input.projectId ?? null,
    userId: input.userId ?? scope?.userId ?? null,
    status: input.status || "final",
    isCurrent: true,
    content: input.content,
    metadata: { businessArtifact: true, projectId: input.projectId ?? null, ...input.metadata },
  });
}

function parseArtifactContent(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function compactDevAnalysisContent(stageType: string, content: unknown): unknown {
  if (stageType !== "information_summary" || !content || typeof content !== "object" || Array.isArray(content)) return content;
  const summary = content as Record<string, any>;
  const competitors = Array.isArray(summary.competitors) ? summary.competitors : [];
  const compactText = (value: unknown, maxLength = 600) => String(value || "").slice(0, maxLength);
  const compactStrings = (value: unknown, maxItems = 8) => Array.isArray(value)
    ? value.slice(0, maxItems).map((item) => compactText(item, 300))
    : [];
  const orderedCompetitors = [...competitors].sort((left: any, right: any) => {
    const rank = (item: any) => item?.isBenchmark ? 2 : item?.aiRecommendedBenchmark ? 1 : 0;
    return rank(right) - rank(left);
  });
  const selectedCompetitors = orderedCompetitors.slice(0, Math.min(8, Math.max(3, orderedCompetitors.length))).map((item: any) => ({
    productId: item.productId,
    asin: compactText(item.asin, 32),
    title: compactText(item.title, 300),
    variantSpec: compactText(item.variantSpec, 300),
    competitorStatus: compactText(item.competitorStatus, 40),
    primaryTags: compactStrings(item.primaryTags, 6),
    priceTier: compactText(item.priceTier, 20),
    monthlySales: item.monthlySales ?? null,
    price: item.price ?? null,
    rating: item.rating ?? null,
    reviewNotes: compactText(item.reviewNotes, 400),
    reviewCount: item.reviewCount ?? null,
    listingDate: compactText(item.listingDate, 40),
    fulfillment: compactText(item.fulfillment, 40),
    aiRecommendedBenchmark: Boolean(item.aiRecommendedBenchmark),
    isBenchmark: Boolean(item.isBenchmark),
    benchmarkReason: compactText(item.benchmarkReason, 500),
    manualNote: compactText(item.manualNote, 500),
  }));
  const opportunity = summary.productOpportunity || {};
  return {
    schemaVersion: summary.schemaVersion,
    generatedAt: summary.generatedAt,
    executiveSummary: compactText(summary.executiveSummary, 1_200),
    project: {
      ...summary.project,
      keywords: compactStrings(summary.project?.keywords, 20),
    },
    competitors: selectedCompetitors,
    marketEvidence: {
      salesTrend: compactText(summary.marketEvidence?.salesTrend, 800),
      seasonality: compactText(summary.marketEvidence?.seasonality, 500),
      benchmarkAdvantages: compactStrings(summary.marketEvidence?.benchmarkAdvantages, 8),
      benchmarkDisadvantages: compactStrings(summary.marketEvidence?.benchmarkDisadvantages, 8),
      brandAnalysis: compactText(summary.marketEvidence?.brandAnalysis, 800),
    },
    productOpportunity: {
      mainFunctions: compactStrings(opportunity.mainFunctions, 10),
      usageScenarios: compactStrings(opportunity.usageScenarios, 8),
      targetAudience: compactStrings(opportunity.targetAudience, 8),
      positiveSignals: compactStrings(opportunity.positiveSignals, 8),
      negativeSignals: compactStrings(opportunity.negativeSignals, 8),
      sellingPoints: (opportunity.sellingPoints || []).slice(0, 8).map((item: any) => ({
        point: compactText(item?.point, 300),
        evidence: compactText(item?.evidence, 300),
        implementation: compactText(item?.implementation, 300),
      })),
      painPoints: (opportunity.painPoints || []).slice(0, 8).map((item: any) => ({
        point: compactText(item?.point, 300),
        evidence: compactText(item?.evidence, 300),
        resolved: Boolean(item?.resolved),
        resolution: compactText(item?.resolution, 300),
      })),
    },
    patentRisk: {
      ...summary.patentRisk,
      reportRefs: compactStrings(summary.patentRisk?.reportRefs, 6),
      relatedPatents: compactStrings(summary.patentRisk?.relatedPatents, 8),
      summary: compactText(summary.patentRisk?.summary, 600),
      conclusion: compactText(summary.patentRisk?.conclusion, 600),
      avoidancePlan: compactText(summary.patentRisk?.avoidancePlan, 600),
    },
    landingPlan: {
      developmentSuggestions: compactStrings(summary.landingPlan?.developmentSuggestions, 8),
      operationsSuggestions: compactStrings(summary.landingPlan?.operationsSuggestions, 8),
      appearanceConcepts: compactStrings(summary.landingPlan?.appearanceConcepts, 6),
      designConcept: compactText(summary.landingPlan?.designConcept, 600),
      timeline: (summary.landingPlan?.timeline || []).slice(0, 8),
    },
    economics: {
      ...summary.economics,
      suppliers: (summary.economics?.suppliers || []).slice(0, 5),
      assumptions: compactStrings(summary.economics?.assumptions, 8),
    },
    provenance: summary.provenance,
    completeness: summary.completeness,
    artifactProjection: {
      fullSourceTable: "dev_analysis_stages",
      purpose: "confirmed_decision_context",
      omittedCompetitorCount: Math.max(0, competitors.length - selectedCompetitors.length),
    },
  };
}

export async function registerDevAnalysisArtifact(
  stageId: number,
  sourceType: ArtifactSourceType = "ai_output",
) {
  const db = await getDb();
  if (!db) return null;
  const [stage] = await db.select().from(devAnalysisStages)
    .where(eq(devAnalysisStages.id, stageId))
    .limit(1);
  if (!stage) return null;
  const content = compactDevAnalysisContent(
    String(stage.stageType),
    parseArtifactContent(stage.editedResult || stage.rawResult || null),
  );
  return registerBusinessArtifact({
    domain: "project",
    artifactKey: `dev.analysis.${stage.stageType}`,
    sourceTable: "dev_analysis_stages",
    sourceRowId: stage.id,
    projectId: stage.projectId,
    userId: stage.userId,
    content,
    sourceType,
    status: stage.status === "confirmed" ? "final" : "draft",
    metadata: {
      stageType: stage.stageType,
      stageStatus: stage.status,
      confirmedAt: stage.confirmedAt,
      schemaVersion: stage.stageType === "information_summary" ? "1.0" : null,
    },
  });
}

export async function resolveCurrentDevAnalysisArtifact(stageId: number) {
  const db = await getDb();
  if (!db) return null;
  const [artifact] = await db.select().from(aiArtifacts).where(and(
    eq(aiArtifacts.sourceTable, "dev_analysis_stages"),
    eq(aiArtifacts.sourceRowId, String(stageId)),
    eq(aiArtifacts.status, "final"),
    eq(aiArtifacts.isCurrent, 1),
  )).orderBy(desc(aiArtifacts.version)).limit(1);
  if (!artifact) return null;
  return {
    ...artifact,
    content: parseArtifactContent(artifact.contentJson),
    ref: `ai-artifact://${artifact.artifactId}@${artifact.version}`,
  };
}

export async function registerAdArtifact(input: {
  artifactKey: string;
  sourceTable: string;
  sourceRowId: number | string;
  workspaceId?: number | null;
  projectId?: number | null;
  userId?: number | null;
  content: unknown;
  sourceType?: ArtifactSourceType;
  status?: "draft" | "final";
  metadata?: Record<string, unknown>;
}) {
  return registerBusinessArtifact({
    domain: "ads",
    artifactKey: input.artifactKey,
    sourceTable: input.sourceTable,
    sourceRowId: input.sourceRowId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    userId: input.userId,
    content: input.content,
    sourceType: input.sourceType || "ai_output",
    status: input.status,
    metadata: input.metadata,
  });
}

export async function registerListingArtifact(listingId: number, sourceType: ArtifactSourceType = "ai_output") {
  const db = await getDb();
  if (!db) return null;
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  if (!listing) return null;
  const [keywordRows, negativeKeywordRows, versionRows, reviewRows] = await Promise.all([
    db.select().from(keywords).where(eq(keywords.projectId, listing.projectId)),
    db.select().from(negativeKeywords).where(eq(negativeKeywords.projectId, listing.projectId)),
    db.select().from(listingVersions).where(eq(listingVersions.projectId, listing.projectId)),
    db.select().from(reviewAggregations).where(eq(reviewAggregations.projectId, listing.projectId)),
  ]);
  return registerBusinessArtifact({
    domain: "listing",
    artifactKey: "listing.content",
    sourceTable: "listings",
    sourceRowId: listing.id,
    projectId: listing.projectId,
    content: {
      listing,
      keywords: keywordRows,
      negativeKeywords: negativeKeywordRows,
      versions: versionRows,
      reviewAggregations: reviewRows,
    },
    sourceType,
    status: listing.isActive ? "final" : "draft",
    metadata: { listingVersion: listing.version, isActive: Boolean(listing.isActive) },
  });
}

export async function registerCompetitorAnalysisArtifact(
  analysisId: number,
  sourceType: ArtifactSourceType = "ai_output",
) {
  const db = await getDb();
  if (!db) return null;
  const [analysis] = await db.select().from(competitorAnalyses)
    .where(eq(competitorAnalyses.id, analysisId))
    .limit(1);
  if (!analysis) return null;
  return registerBusinessArtifact({
    domain: "listing",
    artifactKey: `listing.competitor_analysis.${analysis.asin}`,
    sourceTable: "competitorAnalyses",
    sourceRowId: analysis.id,
    projectId: analysis.projectId,
    userId: analysis.summaryConfirmedBy,
    content: analysis,
    sourceType,
    status: analysis.summaryStatus === "confirmed" ? "final" : "draft",
    metadata: {
      asin: analysis.asin,
      summaryStatus: analysis.summaryStatus,
      summaryVersion: analysis.summaryVersion,
    },
  });
}

export async function registerCompetitorComparisonArtifact(
  reportId: number,
  sourceType: ArtifactSourceType = "ai_output",
) {
  const db = await getDb();
  if (!db) return null;
  const [report] = await db.select().from(competitorComparisonReports)
    .where(eq(competitorComparisonReports.id, reportId))
    .limit(1);
  if (!report) return null;
  return registerBusinessArtifact({
    domain: "listing",
    artifactKey: `listing.competitor_comparison.${report.selectionKey}`,
    sourceTable: "competitorComparisonReports",
    sourceRowId: report.id,
    workspaceId: report.workspaceId,
    projectId: report.projectId,
    userId: report.userId,
    content: report,
    sourceType,
    status: report.status === "confirmed" ? "final" : "draft",
    metadata: {
      selectionKey: report.selectionKey,
      reportStatus: report.status,
      reportVersion: report.version,
    },
  });
}

export async function registerImageWorkflowArtifact(sessionId: number, sourceType: ArtifactSourceType = "ai_output") {
  const db = await getDb();
  if (!db) return null;
  const [session] = await db.select().from(imageWorkflowSessions).where(eq(imageWorkflowSessions.id, sessionId)).limit(1);
  if (!session) return null;
  const [competitors, groups, groupImages] = await Promise.all([
    db.select().from(competitorImageAnalyses).where(eq(competitorImageAnalyses.projectId, session.projectId)),
    db.select().from(expressionGroups).where(eq(expressionGroups.projectId, session.projectId)),
    db.select().from(expressionGroupImages).where(eq(expressionGroupImages.projectId, session.projectId)),
  ]);
  return registerBusinessArtifact({
    domain: "image",
    artifactKey: "image.workflow",
    sourceTable: "image_workflow_sessions",
    sourceRowId: session.id,
    projectId: session.projectId,
    userId: session.userId,
    content: { session, competitors, expressionGroups: groups, expressionGroupImages: groupImages },
    sourceType,
    status: session.status === "completed" ? "final" : "draft",
    metadata: { currentStep: session.currentStep, workflowStatus: session.status },
  });
}

export async function registerAdStructureArtifact(structureId: number, sourceType: ArtifactSourceType = "ai_output") {
  const db = await getDb();
  if (!db) return null;
  const [structure] = await db.select().from(adStructures).where(eq(adStructures.id, structureId)).limit(1);
  if (!structure) return null;
  return registerBusinessArtifact({
    domain: "ads",
    artifactKey: "ads.structure",
    sourceTable: "adStructures",
    sourceRowId: structure.id,
    projectId: structure.projectId,
    userId: structure.userId,
    content: structure,
    sourceType,
    status: structure.status === "completed" ? "final" : "draft",
    metadata: { keywordCount: structure.keywordCount, campaignCount: structure.campaignCount },
  });
}

export async function registerVideoArtifact(videoScriptId: number, sourceType: ArtifactSourceType = "ai_output") {
  const db = await getDb();
  if (!db) return null;
  const [script] = await db.select().from(videoScripts).where(eq(videoScripts.id, videoScriptId)).limit(1);
  if (!script) return null;
  const sections = await db.select().from(videoScriptSections).where(eq(videoScriptSections.videoScriptId, videoScriptId));
  const sectionIds = sections.map((section) => section.id);
  const subtopics = sectionIds.length > 0
    ? await db.select().from(videoScriptSubtopics).where(inArray(videoScriptSubtopics.sectionId, sectionIds))
    : [];
  const shots = sectionIds.length > 0
    ? await db.select().from(videoScriptShots).where(inArray(videoScriptShots.sectionId, sectionIds))
    : [];
  const editScripts = await db.select().from(videoEditScripts).where(eq(videoEditScripts.videoScriptId, videoScriptId));
  const spvSegments = await db.select().from(videoSpvSegments).where(eq(videoSpvSegments.videoScriptId, videoScriptId));
  return registerBusinessArtifact({
    domain: "video",
    artifactKey: "video.script",
    sourceTable: "video_scripts",
    sourceRowId: script.id,
    projectId: script.projectId,
    userId: script.userId,
    content: { script, sections, subtopics, shots, editScripts, spvSegments },
    sourceType,
    status: script.status === "completed" ? "final" : "draft",
    metadata: { currentStage: script.currentStage, scriptVersion: script.version },
  });
}
