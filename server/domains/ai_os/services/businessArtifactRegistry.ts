import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../../repositories/dbClient";
import {
  competitorAnalyses,
  competitorComparisonReports,
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

async function projectScope(projectId: number) {
  const db = await getDb();
  if (!db) return null;
  const [project] = await db.select({
    workspaceId: projects.workspaceId,
    userId: projects.userId,
  }).from(projects).where(eq(projects.id, projectId)).limit(1);
  return project || null;
}

async function registerBusinessArtifact(input: {
  domain: "listing" | "image" | "ads" | "video";
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
  const scope = input.projectId ? await projectScope(input.projectId) : null;
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
