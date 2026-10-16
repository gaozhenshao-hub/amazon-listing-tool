import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeBusinessSkill } from "../domains/ai_os/services/businessSkillGateway";
import { storagePut } from "../storage";
import * as db from "../repositories";
import {
  createContentHash,
  registerProjectFileArtifactBundle,
  resolveUnifiedArtifact,
  type ArtifactSourceType,
} from "../domains/ai_os/services/artifactLifecycle";
import { actorFromContext, assertResourceAction, recordSecurityAuditLog, workspaceIdFromContext, type SecurityAction } from "../services/securityGovernance";
import { parse as csvParse } from "csv-parse/sync";
import {
  RUFUS_ATTRIBUTE_PROMPT,
  MULTI_COMPETITOR_ANALYSIS_PROMPT,
  COSMO_SCENE_MAPPING_PROMPT,
  A9_KEYWORD_GRADING_PROMPT,
} from "../analysisPrompts";
import { TRPCError } from "@trpc/server";
import { convertProfileSourceToText, loadProfileImportSource, profileImportWorkspace } from "../domains/listing/services/profileImportSource";
import { buildProjectFileEmperorSkill } from "./projectFileSkillRoutes";
import { buildCompletedAnalysisUpdate } from "./projectFileAnalysisState";
import { normalizeRufusProductIdentity } from "./projectFileRufusIdentity";

// ─── File Parsers ─────────────────────────────────────────────────

function parseTxtContent(content: string): string {
  // Clean up the text: normalize line endings, trim
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function databaseTextPreview(content: string) {
  return content.slice(0, 4_000);
}

function databaseParsedPreview(value: any) {
  const serialized = JSON.stringify(value ?? null);
  if (serialized.length <= 12_000) return serialized;
  return JSON.stringify({
    type: value?.type || "structured",
    headers: Array.isArray(value?.headers) ? value.headers : [],
    rowCount: Number(value?.rowCount || value?.rows?.length || 0),
    storageBacked: true,
  });
}

async function hydrateProjectFileForAnalysis(file: any, workspaceId: number | null) {
  const scope = {
    workspaceId,
    domain: "listing" as const,
    sourceTable: "projectFiles",
    sourceRowId: file.id,
    projectId: file.projectId,
    currentOnly: true,
    confirmedOnly: true,
  };
  const [rawArtifact, parsedArtifact] = await Promise.all([
    resolveUnifiedArtifact({ ...scope, artifactKey: `project_file.${file.fileType}.raw` }).catch(() => null),
    resolveUnifiedArtifact({ ...scope, artifactKey: `project_file.${file.fileType}.parsed` }).catch(() => null),
  ]);
  return {
    ...file,
    rawContent: typeof rawArtifact?.content === "string" ? rawArtifact.content : file.rawContent,
    parsedData: parsedArtifact?.content === undefined || parsedArtifact?.content === null
      ? file.parsedData
      : JSON.stringify(parsedArtifact.content),
  };
}

function parseCsvContent(content: string): { headers: string[]; rows: Record<string, string>[]; rawRows: string[][] } {
  try {
    const records = csvParse(content, {
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      bom: true,
    }) as string[][];

    if (records.length === 0) {
      return { headers: [], rows: [], rawRows: [] };
    }

    const headers = records[0];
    const rows = records.slice(1).map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] || "";
      });
      return obj;
    });

    return { headers, rows, rawRows: records };
  } catch (err) {
    // Fallback: try tab-separated
    try {
      const lines = content.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length === 0) return { headers: [], rows: [], rawRows: [] };

      const headers = lines[0].split("\t").map((h) => h.trim());
      const rows = lines.slice(1).map((line) => {
        const cells = line.split("\t").map((c) => c.trim());
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = cells[i] || "";
        });
        return obj;
      });

      return { headers, rows, rawRows: lines.map((l) => l.split("\t")) };
    } catch {
      throw new Error("Failed to parse CSV/TSV content");
    }
  }
}

async function uploadProjectFileDerivedJson(input: {
  projectId: number;
  fileType: string;
  filename: string;
  suffix: string;
  value: unknown;
}) {
  try {
    const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
    const key = `project-files/${input.projectId}/artifacts/${input.fileType}-${input.suffix}-${Date.now()}-${safeName}.json`;
    return await storagePut(key, JSON.stringify(input.value), "application/json");
  } catch (error) {
    console.warn("[ProjectFile] Failed to upload derived JSON artifact:", error);
    return null;
  }
}

async function registerProjectFileArtifacts(input: {
  workspaceId?: number | null;
  projectId: number;
  userId: number;
  projectFileId: number;
  fileType: string;
  filename: string;
  fileSizeBytes?: number | null;
  rawStorageUri?: string | null;
  parsedStorageUri?: string | null;
  fileUrl?: string | null;
  rawContent?: string | null;
  parsedData?: unknown;
  analysisResult?: unknown;
  analysisSourceType?: ArtifactSourceType;
  changeNote?: string | null;
}) {
  try {
    return await registerProjectFileArtifactBundle(input);
  } catch (error) {
    console.warn("[ProjectFile] Failed to register unified artifacts:", error);
    return null;
  }
}

// ─── AI Analysis Functions ────────────────────────────────────────

async function analyzeRufusAttributes(rawContent: string): Promise<any> {
  // [Emperor] 显式调用已发布的analysis.rufus.attribute Skill。
  const response = await invokeBusinessSkill({
    emperorSkill: buildProjectFileEmperorSkill("product_attributes"),
    messages: [
      { role: "system", content: RUFUS_ATTRIBUTE_PROMPT },
      {
        role: "user",
        content: `Please analyze the following product attribute table and extract all concrete parameters for Amazon Listing optimization:\n\n${rawContent}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const content =
    typeof response.choices[0].message.content === "string"
      ? response.choices[0].message.content
      : JSON.stringify(response.choices[0].message.content);

  try {
    return normalizeRufusProductIdentity(rawContent, JSON.parse(content));
  } catch {
    return { raw: content };
  }
}

async function analyzeCompetitorListings(rawContent: string): Promise<any> {
      // [Emperor] 优先调用 Emperor Skill: analysis.comparison.summary





  const response = await invokeBusinessSkill({
    messages: [
      { role: "system", content: MULTI_COMPETITOR_ANALYSIS_PROMPT },
      {
        role: "user",
        content: `Please analyze the following competitor listing texts. Find Parity (共性/standard selling points) and Gaps (缺口/opportunities):\n\n${rawContent}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const content =
    typeof response.choices[0].message.content === "string"
      ? response.choices[0].message.content
      : JSON.stringify(response.choices[0].message.content);

  try {
    return JSON.parse(content);
  } catch {
    return { raw: content };
  }
}

async function analyzeCosmoScenes(parsedData: any): Promise<any> {
  // Build a summary of the search term data for the LLM
  const rows = parsedData.rows || [];
  const summary = rows
    .slice(0, 500) // Limit to first 500 rows to avoid token limits
    .map((r: any) => {
      const values = Object.values(r).join(" | ");
      return values;
    })
    .join("\n");

  const headerInfo = `Columns: ${(parsedData.headers || []).join(", ")}`;

      // [Emperor] 优先调用 Emperor Skill: analysis.comparison.summary





  const response = await invokeBusinessSkill({
    messages: [
      { role: "system", content: COSMO_SCENE_MAPPING_PROMPT },
      {
        role: "user",
        content: `Please analyze the following competitor search term report (竞品出单词报告) to map real user search scenarios and usage scenes.\n\n${headerInfo}\n\nData:\n${summary}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const content =
    typeof response.choices[0].message.content === "string"
      ? response.choices[0].message.content
      : JSON.stringify(response.choices[0].message.content);

  try {
    return JSON.parse(content);
  } catch {
    return { raw: content };
  }
}

async function analyzeA9Keywords(parsedData: any): Promise<any> {
  const rows = parsedData.rows || [];
  const summary = rows
    .slice(0, 500)
    .map((r: any) => {
      const values = Object.values(r).join(" | ");
      return values;
    })
    .join("\n");

  const headerInfo = `Columns: ${(parsedData.headers || []).join(", ")}`;

      // [Emperor] 优先调用 Emperor Skill: analysis.comparison.summary





  const response = await invokeBusinessSkill({
    messages: [
      { role: "system", content: A9_KEYWORD_GRADING_PROMPT },
      {
        role: "user",
        content: `Please analyze the following ABA keyword data and grade each keyword for A9 optimization.\n\n${headerInfo}\n\nData:\n${summary}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const content =
    typeof response.choices[0].message.content === "string"
      ? response.choices[0].message.content
      : JSON.stringify(response.choices[0].message.content);

  try {
    return JSON.parse(content);
  } catch {
    return { raw: content };
  }

}
// ─── Router ──────────────────────────────────────────────────────

async function assertProjectFileAccess(ctx: any, projectId: number, action: SecurityAction) {
  const workspaceId = workspaceIdFromContext(ctx);
  const elevated = ["super_admin", "admin", "designer"].includes(ctx.user.role);
  const project = elevated
    ? await db.getProjectByIdAdmin(projectId, workspaceId)
    : await db.getProjectById(projectId, ctx.user.id, workspaceId);
  if (!project) throw new Error("Project not found");
  await assertResourceAction({
    actor: actorFromContext(ctx),
    resource: "file",
    action,
    workspaceId,
    projectId,
    resourceId: projectId,
    ownerUserId: project.userId,
  });
  return { project, workspaceId };
}

async function assertFileAccess(ctx: any, fileId: number, action: SecurityAction) {
  const file = await db.getProjectFileById(fileId);
  if (!file) throw new Error("File not found");
  const access = await assertProjectFileAccess(ctx, file.projectId, action);
  return { ...access, file };
}

export const projectFileRouter = router({
  // List all files for a project
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectFileAccess(ctx, input.projectId, "read");
      return db.getProjectFilesByProject(input.projectId);
    }),

  // List files by type
  listByType: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fileType: z.enum(["product_attributes", "competitor_listings", "search_term_report", "aba_keywords"]),
    }))
    .query(async ({ ctx, input }) => {
      await assertProjectFileAccess(ctx, input.projectId, "read");
      return db.getProjectFilesByType(input.projectId, input.fileType);
    }),

  // Upload and parse a file
  upload: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fileType: z.enum(["product_attributes", "competitor_listings", "search_term_report", "aba_keywords"]),
      filename: z.string(),
      content: z.string(), // base64 encoded file content
    }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId } = await assertProjectFileAccess(ctx, input.projectId, "upload");

      // Decode base64 content
      const buffer = Buffer.from(input.content, "base64");
      const textContent = buffer.toString("utf-8");

      // Upload to S3
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const fileKey = `project-files/${input.projectId}/${input.fileType}-${randomSuffix}-${input.filename}`;
      let fileUrl = "";
      let rawStorageUri = "";
      try {
        const uploadResult = await storagePut(fileKey, buffer, "application/octet-stream");
        fileUrl = uploadResult.url;
        rawStorageUri = uploadResult.storageUri;
      } catch (err) {
        console.error("S3 upload failed, continuing without URL:", err);
      }

      // Parse content based on file type
      let parsedData: any = null;
      let rawContent = "";

      try {
        if (input.fileType === "product_attributes" || input.fileType === "competitor_listings") {
          // TXT files
          rawContent = parseTxtContent(textContent);
          parsedData = { type: "text", lineCount: rawContent.split("\n").length, charCount: rawContent.length };
        } else {
          // CSV files
          rawContent = textContent;
          const csvResult = parseCsvContent(textContent);
          parsedData = {
            type: "csv",
            headers: csvResult.headers,
            rowCount: csvResult.rows.length,
            rows: csvResult.rows,
          };
        }
      } catch (err: any) {
        // Save the file record even if parsing fails
        const record = await db.createProjectFile({
          workspaceId,
          projectId: input.projectId,
          userId: ctx.user.id,
          fileType: input.fileType,
          filename: input.filename,
          fileUrl,
          fileSize: buffer.length,
          rawStorageUri: rawStorageUri || null,
          rawContentHash: createContentHash(textContent),
          rawContent: databaseTextPreview(textContent),
          status: "failed",
          errorMessage: err.message || "Parse failed",
        });
        await registerProjectFileArtifacts({
          workspaceId,
          projectId: input.projectId,
          userId: ctx.user.id,
          projectFileId: record.id,
          fileType: input.fileType,
          filename: input.filename,
          fileSizeBytes: buffer.length,
          rawStorageUri: rawStorageUri || null,
          fileUrl,
          rawContent: textContent,
          changeNote: err.message || "Parse failed",
        });
        await recordSecurityAuditLog({
          ctx,
          workspaceId,
          action: "file.upload",
          resourceType: "file",
          resourceId: record.id,
          resourceName: input.filename,
          projectId: input.projectId,
          status: "failed",
          riskLevel: "medium",
          reason: err.message || "Parse failed",
          metadata: { fileType: input.fileType, fileSize: buffer.length },
        });
        return record;
      }

      const parsedUpload = await uploadProjectFileDerivedJson({
        projectId: input.projectId,
        fileType: input.fileType,
        filename: input.filename,
        suffix: "parsed",
        value: parsedData,
      });

      // Save to database
      const record = await db.createProjectFile({
        workspaceId,
        projectId: input.projectId,
        userId: ctx.user.id,
        fileType: input.fileType,
        filename: input.filename,
        fileUrl,
        fileSize: buffer.length,
        rawStorageUri: rawStorageUri || null,
        parsedStorageUri: parsedUpload?.storageUri || null,
        rawContentHash: createContentHash(rawContent),
        parsedDataHash: createContentHash(parsedData),
        rawContent: databaseTextPreview(rawContent),
        parsedData: databaseParsedPreview(parsedData),
        status: "parsed",
      });
      await registerProjectFileArtifacts({
        workspaceId,
        projectId: input.projectId,
        userId: ctx.user.id,
        projectFileId: record.id,
        fileType: input.fileType,
        filename: input.filename,
        fileSizeBytes: buffer.length,
        rawStorageUri: rawStorageUri || null,
        parsedStorageUri: parsedUpload?.storageUri || null,
        fileUrl,
        rawContent,
        parsedData,
      });
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "file.upload",
        resourceType: "file",
        resourceId: record.id,
        resourceName: input.filename,
        projectId: input.projectId,
        status: "success",
        riskLevel: "medium",
        metadata: { fileType: input.fileType, fileSize: buffer.length },
      });

      return record;
    }),

  // Run AI analysis on a parsed file
  analyze: protectedProcedure
    .input(z.object({ fileId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertFileAccess(ctx, input.fileId, "update");
      const workspaceId = access.workspaceId;
      const file = await hydrateProjectFileForAnalysis(access.file, workspaceId);

      if (!file.rawContent && !file.parsedData) {
        throw new Error("File has no parsed content. Please re-upload.");
      }

      // Update status to analyzing
      await db.updateProjectFile(file.id, { status: "analyzing" });

      try {
        let analysisResult: any;

        switch (file.fileType) {
          case "product_attributes":
            analysisResult = await analyzeRufusAttributes(file.rawContent || "");
            break;
          case "competitor_listings":
            analysisResult = await analyzeCompetitorListings(file.rawContent || "");
            break;
          case "search_term_report": {
            const parsedData = file.parsedData ? JSON.parse(file.parsedData) : { rows: [] };
            analysisResult = await analyzeCosmoScenes(parsedData);
            break;
          }
          case "aba_keywords": {
            const parsedData = file.parsedData ? JSON.parse(file.parsedData) : { rows: [] };
            analysisResult = await analyzeA9Keywords(parsedData);
            break;
          }
          default:
            throw new Error(`Unknown file type: ${file.fileType}`);
        }

        const updated = await db.updateProjectFile(file.id, buildCompletedAnalysisUpdate(analysisResult));
        const artifactBundle = await registerProjectFileArtifacts({
          workspaceId,
          projectId: file.projectId,
          userId: ctx.user.id,
          projectFileId: file.id,
          fileType: file.fileType,
          filename: file.filename,
          fileSizeBytes: file.fileSize || null,
          rawStorageUri: file.rawStorageUri || null,
          parsedStorageUri: file.parsedStorageUri || null,
          fileUrl: file.fileUrl || null,
          analysisResult,
          analysisSourceType: "ai_output",
          changeNote: "Re-analyzed by AI",
        });

        // Save version history
        const latestVersion = await db.getLatestVersionNumber(file.id);
        await db.createAnalysisVersion({
          projectFileId: file.id,
          userId: ctx.user.id,
          version: latestVersion + 1,
          analysisResult: JSON.stringify(analysisResult),
          changeType: "re_analysis",
          changeNote: "Re-analyzed by AI",
        });
        await recordSecurityAuditLog({
          ctx,
          workspaceId,
          action: "file.analyze",
          resourceType: "file",
          resourceId: file.id,
          resourceName: file.filename,
          projectId: file.projectId,
          status: "success",
          riskLevel: "medium",
          metadata: { fileType: file.fileType },
        });

        return artifactBundle?.analysisArtifact
          ? { ...updated, analysisArtifactId: artifactBundle.analysisArtifact.artifactId }
          : updated;
      } catch (err: any) {
        await db.updateProjectFile(file.id, {
          status: "failed",
          errorMessage: err.message || "Analysis failed",
        });
        await recordSecurityAuditLog({
          ctx,
          workspaceId,
          action: "file.analyze",
          resourceType: "file",
          resourceId: file.id,
          resourceName: file.filename,
          projectId: file.projectId,
          status: "failed",
          riskLevel: "medium",
          reason: err.message || "Analysis failed",
          metadata: { fileType: file.fileType },
        });
        throw err;
      }
    }),

  // Upload and immediately analyze (convenience endpoint)
  uploadAndAnalyze: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fileType: z.enum(["product_attributes", "competitor_listings", "search_term_report", "aba_keywords"]),
      filename: z.string(),
      content: z.string(), // base64 encoded
    }))
    .mutation(async ({ ctx, input }) => {
      const { workspaceId } = await assertProjectFileAccess(ctx, input.projectId, "upload");

      // Decode base64 content
      const buffer = Buffer.from(input.content, "base64");
      const textContent = buffer.toString("utf-8");

      // Upload to S3
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const fileKey = `project-files/${input.projectId}/${input.fileType}-${randomSuffix}-${input.filename}`;
      let fileUrl = "";
      let rawStorageUri = "";
      try {
        const uploadResult = await storagePut(fileKey, buffer, "application/octet-stream");
        fileUrl = uploadResult.url;
        rawStorageUri = uploadResult.storageUri;
      } catch (err) {
        console.error("S3 upload failed:", err);
      }

      // Parse content
      let parsedData: any = null;
      let rawContent = "";

      if (input.fileType === "product_attributes" || input.fileType === "competitor_listings") {
        rawContent = parseTxtContent(textContent);
        parsedData = { type: "text", lineCount: rawContent.split("\n").length, charCount: rawContent.length };
      } else {
        rawContent = textContent;
        const csvResult = parseCsvContent(textContent);
        parsedData = {
          type: "csv",
          headers: csvResult.headers,
          rowCount: csvResult.rows.length,
          rows: csvResult.rows,
        };
      }

      const parsedUpload = await uploadProjectFileDerivedJson({
        projectId: input.projectId,
        fileType: input.fileType,
        filename: input.filename,
        suffix: "parsed",
        value: parsedData,
      });

      // Save to database
      const record = await db.createProjectFile({
        workspaceId,
        projectId: input.projectId,
        userId: ctx.user.id,
        fileType: input.fileType,
        filename: input.filename,
        fileUrl,
        fileSize: buffer.length,
        rawStorageUri: rawStorageUri || null,
        parsedStorageUri: parsedUpload?.storageUri || null,
        rawContentHash: createContentHash(rawContent),
        parsedDataHash: createContentHash(parsedData),
        rawContent: databaseTextPreview(rawContent),
        parsedData: databaseParsedPreview(parsedData),
        status: "analyzing",
      });
      await registerProjectFileArtifacts({
        workspaceId,
        projectId: input.projectId,
        userId: ctx.user.id,
        projectFileId: record.id,
        fileType: input.fileType,
        filename: input.filename,
        fileSizeBytes: buffer.length,
        rawStorageUri: rawStorageUri || null,
        parsedStorageUri: parsedUpload?.storageUri || null,
        fileUrl,
        rawContent,
        parsedData,
      });

      // Run AI analysis
      try {
        let analysisResult: any;

        switch (input.fileType) {
          case "product_attributes":
            analysisResult = await analyzeRufusAttributes(rawContent);
            break;
          case "competitor_listings":
            analysisResult = await analyzeCompetitorListings(rawContent);
            break;
          case "search_term_report":
            analysisResult = await analyzeCosmoScenes(parsedData);
            break;
          case "aba_keywords":
            analysisResult = await analyzeA9Keywords(parsedData);
            break;
        }

        const updated = await db.updateProjectFile(record.id, buildCompletedAnalysisUpdate(analysisResult));
        const artifactBundle = await registerProjectFileArtifacts({
          workspaceId,
          projectId: input.projectId,
          userId: ctx.user.id,
          projectFileId: record.id,
          fileType: input.fileType,
          filename: input.filename,
          fileSizeBytes: buffer.length,
          rawStorageUri: rawStorageUri || null,
          parsedStorageUri: parsedUpload?.storageUri || null,
          fileUrl,
          analysisResult,
          analysisSourceType: "ai_output",
          changeNote: "Initial AI analysis",
        });

        // Save initial version history
        await db.createAnalysisVersion({
          projectFileId: record.id,
          userId: ctx.user.id,
          version: 1,
          analysisResult: JSON.stringify(analysisResult),
          changeType: "auto_analysis",
          changeNote: "Initial AI analysis",
        });
        await recordSecurityAuditLog({
          ctx,
          workspaceId,
          action: "file.upload_and_analyze",
          resourceType: "file",
          resourceId: record.id,
          resourceName: input.filename,
          projectId: input.projectId,
          status: "success",
          riskLevel: "medium",
          metadata: { fileType: input.fileType, fileSize: buffer.length },
        });

        return artifactBundle?.analysisArtifact
          ? { ...updated, analysisArtifactId: artifactBundle.analysisArtifact.artifactId }
          : updated;
      } catch (err: any) {
        await db.updateProjectFile(record.id, {
          status: "failed",
          errorMessage: err.message || "Analysis failed",
        });
        await recordSecurityAuditLog({
          ctx,
          workspaceId,
          action: "file.upload_and_analyze",
          resourceType: "file",
          resourceId: record.id,
          resourceName: input.filename,
          projectId: input.projectId,
          status: "failed",
          riskLevel: "medium",
          reason: err.message || "Analysis failed",
          metadata: { fileType: input.fileType, fileSize: buffer.length },
        });
        throw err;
      }
    }),

  // Update analysis result (manual editing)
  updateAnalysisResult: protectedProcedure
    .input(z.object({
      fileId: z.number(),
      analysisResult: z.string(), // JSON string of the updated analysis result
      changeNote: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { file, workspaceId } = await assertFileAccess(ctx, input.fileId, "update");

      // Validate that the input is valid JSON
      try {
        JSON.parse(input.analysisResult);
      } catch {
        throw new Error("Invalid JSON format for analysis result");
      }

      const updated = await db.updateProjectFile(file.id, {
        analysisResult: input.analysisResult,
        status: "completed",
      });
      const artifactBundle = await registerProjectFileArtifacts({
        workspaceId,
        projectId: file.projectId,
        userId: ctx.user.id,
        projectFileId: file.id,
        fileType: file.fileType,
        filename: file.filename,
        fileSizeBytes: file.fileSize || null,
        rawStorageUri: file.rawStorageUri || null,
        parsedStorageUri: file.parsedStorageUri || null,
        fileUrl: file.fileUrl || null,
        analysisResult: input.analysisResult,
        analysisSourceType: "user_edit",
        changeNote: input.changeNote || "Manual edit",
      });

      // Save version history for manual edit
      const latestVersion = await db.getLatestVersionNumber(file.id);
      await db.createAnalysisVersion({
        projectFileId: file.id,
        userId: ctx.user.id,
        version: latestVersion + 1,
        analysisResult: input.analysisResult,
        changeType: "manual_edit",
        changeNote: input.changeNote || "Manual edit",
      });
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "file.analysis.update",
        resourceType: "file",
        resourceId: file.id,
        resourceName: file.filename,
        projectId: file.projectId,
        status: "success",
        riskLevel: "medium",
      });

      return artifactBundle?.analysisArtifact
        ? { ...updated, analysisArtifactId: artifactBundle.analysisArtifact.artifactId }
        : updated;
    }),

  // Get version history for a file
  getVersionHistory: protectedProcedure
    .input(z.object({ fileId: z.number() }))
    .query(async ({ ctx, input }) => {
      const { file } = await assertFileAccess(ctx, input.fileId, "read");

      return db.getAnalysisVersionsByFileId(file.id);
    }),

  // Restore a specific version
  restoreVersion: protectedProcedure
    .input(z.object({ versionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const version = await db.getAnalysisVersionById(input.versionId);
      if (!version) throw new Error("Version not found");

      const { file, workspaceId } = await assertFileAccess(ctx, version.projectFileId, "update");

      // Update the file's analysis result to the restored version
      const updated = await db.updateProjectFile(file.id, {
        analysisResult: version.analysisResult,
        status: "completed",
      });
      const artifactBundle = await registerProjectFileArtifacts({
        workspaceId,
        projectId: file.projectId,
        userId: ctx.user.id,
        projectFileId: file.id,
        fileType: file.fileType,
        filename: file.filename,
        fileSizeBytes: file.fileSize || null,
        rawStorageUri: file.rawStorageUri || null,
        parsedStorageUri: file.parsedStorageUri || null,
        fileUrl: file.fileUrl || null,
        analysisResult: version.analysisResult,
        analysisSourceType: "user_edit",
        changeNote: `Restored from version ${version.version}`,
      });

      // Create a new version entry for the restore action
      const latestVersion = await db.getLatestVersionNumber(file.id);
      await db.createAnalysisVersion({
        projectFileId: file.id,
        userId: ctx.user.id,
        version: latestVersion + 1,
        analysisResult: version.analysisResult,
        changeType: "manual_edit",
        changeNote: `Restored from version ${version.version}`,
      });
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "file.version.restore",
        resourceType: "file",
        resourceId: file.id,
        resourceName: file.filename,
        projectId: file.projectId,
        status: "success",
        riskLevel: "medium",
        metadata: { versionId: input.versionId, restoredVersion: version.version },
      });

      return artifactBundle?.analysisArtifact
        ? { ...updated, analysisArtifactId: artifactBundle.analysisArtifact.artifactId }
        : updated;
    }),

  // Delete a file
  delete: protectedProcedure
    .input(z.object({ fileId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { file, workspaceId } = await assertFileAccess(ctx, input.fileId, "delete");

      // Also delete version history
      await db.deleteAnalysisVersionsByFileId(file.id);
      const result = await db.deleteProjectFile(file.id);
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "file.delete",
        resourceType: "file",
        resourceId: file.id,
        resourceName: file.filename,
        projectId: file.projectId,
        status: "success",
        riskLevel: "high",
      });
      return result;
    }),

  // Get analysis summary for all files in a project (used by Listing generation)
  getAnalysisSummary: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectFileAccess(ctx, input.projectId, "read");

      const files = await db.getProjectFilesByProject(input.projectId);

      const summary: Record<string, any> = {
        productAttributes: null,
        competitorListings: null,
        cosmoScenes: null,
        a9Keywords: null,
        hasAllFiles: false,
        fileCount: files.length,
      };

      for (const file of files) {
        if (file.status !== "completed" || !file.analysisResult) continue;

        try {
          const result = JSON.parse(file.analysisResult);
          switch (file.fileType) {
            case "product_attributes":
              summary.productAttributes = result;
              break;
            case "competitor_listings":
              summary.competitorListings = result;
              break;
            case "search_term_report":
              summary.cosmoScenes = result;
              break;
            case "aba_keywords":
              summary.a9Keywords = result;
              break;
          }
        } catch {}
      }

      // N3 readiness: only product_attributes is required (v2 architecture)
      summary.n3Ready = !!summary.productAttributes;
      // Legacy compat: hasAllFiles now equals n3Ready
      summary.hasAllFiles = summary.n3Ready;

      return summary;
    }),

  // ─── Import from Product Profile (模块一产品画像导入) ─────────────
  importFromProfile: protectedProcedure
    .input(z.object({
      listingProjectId: z.number().int().positive(),
      devProjectId: z.number().int().positive(),
      expectedWorkspaceId: z.number().int().positive().nullable().optional(),
      expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      const workspaceId = profileImportWorkspace(ctx, input.expectedWorkspaceId);
      const requireTarget = async () => {
        const target = await assertProjectFileAccess(ctx, input.listingProjectId, "import");
        // Legacy NULL projects retain the repository + file.import authorization
        // above; only an explicit foreign scope is rejected here.
        if (target.workspaceId !== workspaceId
          || (target.project.workspaceId !== null && target.project.workspaceId !== workspaceId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Listing项目不属于当前工作区" });
        }
      };
      await requireTarget();
      const source = await loadProfileImportSource(ctx, input);
      if (!source.profile || !source.sourceHash) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "该项目尚未创建产品画像数据" });
      const profileText = convertProfileSourceToText(source.profile, source.project.name);

      // This legacy operation remains synchronous; it is not a durable background job.
      const analysisResult = await analyzeRufusAttributes(profileText);
      // Recheck both authorization and the complete source immediately before persistence.
      // Even old callers without a preview hash are bound to the source loaded above.
      await requireTarget();
      await loadProfileImportSource(ctx, { devProjectId: input.devProjectId,
        expectedWorkspaceId: workspaceId, expectedSourceHash: source.sourceHash });
      const provenance = { kind: "dev_product_profile", devProjectId: source.project.id,
        profileId: source.profile.id, sourceHash: source.sourceHash,
        projectUpdatedAt: source.project.updatedAt.toISOString(), profileUpdatedAt: source.profile.updatedAt.toISOString(),
        previewVersionBound: input.expectedSourceHash !== undefined, aiSuggestionsIncluded: false, factReviewRequired: true };
      const parsedProfileData = { type: "text", lineCount: profileText.split("\n").length, charCount: profileText.length,
        source: "product_profile_import", provenance };

      // 7. Save as a projectFile record
      const record = await db.createProjectFile({
        workspaceId,
        projectId: input.listingProjectId,
        userId: ctx.user.id,
        fileType: "product_attributes",
        filename: `产品画像导入_${source.project.name}.txt`,
        fileUrl: "",
        fileSize: Buffer.byteLength(profileText, "utf-8"),
        rawContentHash: createContentHash(profileText),
        parsedDataHash: createContentHash(parsedProfileData),
        rawContent: databaseTextPreview(profileText),
        parsedData: databaseParsedPreview(parsedProfileData),
        ...buildCompletedAnalysisUpdate(analysisResult),
      });
      await registerProjectFileArtifacts({
        workspaceId,
        projectId: input.listingProjectId,
        userId: ctx.user.id,
        projectFileId: record.id,
        fileType: "product_attributes",
        filename: record.filename,
        fileSizeBytes: Buffer.byteLength(profileText, "utf-8"),
        rawContent: profileText,
        parsedData: parsedProfileData,
        analysisResult,
        analysisSourceType: "ai_output",
        changeNote: `从产品画像导入 (${source.project.name})`,
      });

      // 8. Save initial version history
      await db.createAnalysisVersion({
        projectFileId: record.id,
        userId: ctx.user.id,
        version: 1,
        analysisResult: JSON.stringify(analysisResult),
        changeType: "auto_analysis",
        changeNote: `从产品画像导入 (${source.project.name})`,
      });
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "file.import_from_profile",
        resourceType: "file",
        resourceId: record.id,
        resourceName: record.filename,
        projectId: input.listingProjectId,
        status: "success",
        riskLevel: "medium",
        metadata: provenance,
      });

      return record;
    }),
});
