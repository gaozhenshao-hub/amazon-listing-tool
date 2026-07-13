import { runSkillViaEmperor } from "../emperorClient";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { storagePut } from "../storage";
import * as db from "../db";
import { parse as csvParse } from "csv-parse/sync";
import {
  RUFUS_ATTRIBUTE_PROMPT,
  MULTI_COMPETITOR_ANALYSIS_PROMPT,
  COSMO_SCENE_MAPPING_PROMPT,
  A9_KEYWORD_GRADING_PROMPT,
} from "../analysisPrompts";
import { eq, and, desc, inArray } from "drizzle-orm";
import { projectAssignments, devProjects, devProductProfiles } from "../../drizzle/schema";
import { getDb } from "../db";

// ─── File Parsers ─────────────────────────────────────────────────

function parseTxtContent(content: string): string {
  // Clean up the text: normalize line endings, trim
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
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

// ─── AI Analysis Functions ────────────────────────────────────────

async function analyzeRufusAttributes(rawContent: string): Promise<any> {
      // [Emperor] 优先调用 Emperor Skill: analysis.comparison.summary

  try {

    const _emperorRes = await runSkillViaEmperor("analysis.comparison.summary", { context: JSON.stringify(input).slice(0, 3000) });

    if (_emperorRes.success && _emperorRes.output) {

      // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

    }

  } catch (_e) { console.warn("[Emperor] projectFile.ts fallback:", _e); }

  const response = await invokeLLM({
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
    return JSON.parse(content);
  } catch {
    return { raw: content };
  }
}

async function analyzeCompetitorListings(rawContent: string): Promise<any> {
      // [Emperor] 优先调用 Emperor Skill: analysis.comparison.summary

  try {

    const _emperorRes = await runSkillViaEmperor("analysis.comparison.summary", { context: JSON.stringify(input).slice(0, 3000) });

    if (_emperorRes.success && _emperorRes.output) {

      // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

    }

  } catch (_e) { console.warn("[Emperor] projectFile.ts fallback:", _e); }

  const response = await invokeLLM({
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

  try {

    const _emperorRes = await runSkillViaEmperor("analysis.comparison.summary", { context: JSON.stringify(input).slice(0, 3000) });

    if (_emperorRes.success && _emperorRes.output) {

      // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

    }

  } catch (_e) { console.warn("[Emperor] projectFile.ts fallback:", _e); }

  const response = await invokeLLM({
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

  try {

    const _emperorRes = await runSkillViaEmperor("analysis.comparison.summary", { context: JSON.stringify(input).slice(0, 3000) });

    if (_emperorRes.success && _emperorRes.output) {

      // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

    }

  } catch (_e) { console.warn("[Emperor] projectFile.ts fallback:", _e); }

  const response = await invokeLLM({
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

export const projectFileRouter = router({
  // List all files for a project
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      return db.getProjectFilesByProject(input.projectId);
    }),

  // List files by type
  listByType: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fileType: z.enum(["product_attributes", "competitor_listings", "search_term_report", "aba_keywords"]),
    }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
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
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      // Decode base64 content
      const buffer = Buffer.from(input.content, "base64");
      const textContent = buffer.toString("utf-8");

      // Upload to S3
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const fileKey = `project-files/${input.projectId}/${input.fileType}-${randomSuffix}-${input.filename}`;
      let fileUrl = "";
      try {
        const uploadResult = await storagePut(fileKey, buffer, "application/octet-stream");
        fileUrl = uploadResult.url;
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
          projectId: input.projectId,
          userId: ctx.user.id,
          fileType: input.fileType,
          filename: input.filename,
          fileUrl,
          fileSize: buffer.length,
          rawContent: textContent.substring(0, 65000), // Limit to 65KB for TEXT column
          status: "failed",
          errorMessage: err.message || "Parse failed",
        });
        return record;
      }

      // Save to database
      const record = await db.createProjectFile({
        projectId: input.projectId,
        userId: ctx.user.id,
        fileType: input.fileType,
        filename: input.filename,
        fileUrl,
        fileSize: buffer.length,
        rawContent: rawContent.substring(0, 65000),
        parsedData: JSON.stringify(parsedData),
        status: "parsed",
      });

      return record;
    }),

  // Run AI analysis on a parsed file
  analyze: protectedProcedure
    .input(z.object({ fileId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const file = await db.getProjectFileById(input.fileId);
      if (!file) throw new Error("File not found");

      const project = await db.getProjectById(file.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

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

        const updated = await db.updateProjectFile(file.id, {
          analysisResult: JSON.stringify(analysisResult),
          status: "completed",
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

        return updated;
      } catch (err: any) {
        await db.updateProjectFile(file.id, {
          status: "failed",
          errorMessage: err.message || "Analysis failed",
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
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      // Decode base64 content
      const buffer = Buffer.from(input.content, "base64");
      const textContent = buffer.toString("utf-8");

      // Upload to S3
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const fileKey = `project-files/${input.projectId}/${input.fileType}-${randomSuffix}-${input.filename}`;
      let fileUrl = "";
      try {
        const uploadResult = await storagePut(fileKey, buffer, "application/octet-stream");
        fileUrl = uploadResult.url;
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

      // Save to database
      const record = await db.createProjectFile({
        projectId: input.projectId,
        userId: ctx.user.id,
        fileType: input.fileType,
        filename: input.filename,
        fileUrl,
        fileSize: buffer.length,
        rawContent: rawContent.substring(0, 65000),
        parsedData: JSON.stringify(parsedData),
        status: "analyzing",
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

        const updated = await db.updateProjectFile(record.id, {
          analysisResult: JSON.stringify(analysisResult),
          status: "completed",
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

        return updated;
      } catch (err: any) {
        await db.updateProjectFile(record.id, {
          status: "failed",
          errorMessage: err.message || "Analysis failed",
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
      const file = await db.getProjectFileById(input.fileId);
      if (!file) throw new Error("File not found");

      const project = await db.getProjectById(file.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

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

      return updated;
    }),

  // Get version history for a file
  getVersionHistory: protectedProcedure
    .input(z.object({ fileId: z.number() }))
    .query(async ({ ctx, input }) => {
      const file = await db.getProjectFileById(input.fileId);
      if (!file) throw new Error("File not found");

      const project = await db.getProjectById(file.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      return db.getAnalysisVersionsByFileId(file.id);
    }),

  // Restore a specific version
  restoreVersion: protectedProcedure
    .input(z.object({ versionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const version = await db.getAnalysisVersionById(input.versionId);
      if (!version) throw new Error("Version not found");

      const file = await db.getProjectFileById(version.projectFileId);
      if (!file) throw new Error("File not found");

      const project = await db.getProjectById(file.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      // Update the file's analysis result to the restored version
      const updated = await db.updateProjectFile(file.id, {
        analysisResult: version.analysisResult,
        status: "completed",
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

      return updated;
    }),

  // Delete a file
  delete: protectedProcedure
    .input(z.object({ fileId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const file = await db.getProjectFileById(input.fileId);
      if (!file) throw new Error("File not found");

      const project = await db.getProjectById(file.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      // Also delete version history
      await db.deleteAnalysisVersionsByFileId(file.id);
      return db.deleteProjectFile(file.id);
    }),

  // Get analysis summary for all files in a project (used by Listing generation)
  getAnalysisSummary: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

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

      summary.hasAllFiles = !!(
        summary.productAttributes &&
        summary.competitorListings &&
        summary.cosmoScenes &&
        summary.a9Keywords
      );

      return summary;
    }),

  // ─── Import from Product Profile (模块一产品画像导入) ─────────────
  importFromProfile: protectedProcedure
    .input(z.object({
      listingProjectId: z.number(),
      devProjectId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 1. Verify listing project exists and belongs to user
      const project = await db.getProjectById(input.listingProjectId, ctx.user.id);
      if (!project) {
        // Admin fallback
        const isAdmin = ["super_admin", "admin", "ops_manager"].includes(ctx.user.role);
        if (!isAdmin) throw new Error("Listing项目不存在或无权限");
      }

      // 2. Verify user has access to the dev project
      const dbConn = await getDb();
      if (!dbConn) throw new Error("Database not available");

      const isAdmin = ["super_admin", "admin", "ops_manager"].includes(ctx.user.role);
      if (!isAdmin) {
        const assignment = await dbConn.select().from(projectAssignments).where(
          and(
            eq(projectAssignments.projectId, input.devProjectId),
            eq(projectAssignments.projectType, "dev_project"),
            eq(projectAssignments.assignedUserId, ctx.user.id)
          )
        ).limit(1);
        if (!assignment.length) throw new Error("您没有该产品开发项目的访问权限");
      }

      // 3. Get dev project info
      const devProject = await dbConn.select().from(devProjects)
        .where(eq(devProjects.id, input.devProjectId))
        .limit(1);
      if (!devProject.length) throw new Error("产品开发项目不存在");

      // 4. Get product profile
      const profile = await dbConn.select().from(devProductProfiles)
        .where(eq(devProductProfiles.projectId, input.devProjectId))
        .limit(1);
      if (!profile.length) throw new Error("该项目尚未创建产品画像数据");

      const p = profile[0];

      // 5. Convert product profile to text format for Rufus analysis
      const profileText = convertProfileToText(p, devProject[0].name);

      // 6. Run Rufus attribute analysis on the profile text
      const analysisResult = await analyzeRufusAttributes(profileText);

      // 7. Save as a projectFile record
      const record = await db.createProjectFile({
        projectId: input.listingProjectId,
        userId: ctx.user.id,
        fileType: "product_attributes",
        filename: `产品画像导入_${devProject[0].name}.txt`,
        fileUrl: "",
        fileSize: Buffer.byteLength(profileText, "utf-8"),
        rawContent: profileText.substring(0, 65000),
        parsedData: JSON.stringify({ type: "text", lineCount: profileText.split("\n").length, charCount: profileText.length, source: "product_profile_import" }),
        status: "completed",
        analysisResult: JSON.stringify(analysisResult),
      });

      // 8. Save initial version history
      await db.createAnalysisVersion({
        projectFileId: record.id,
        userId: ctx.user.id,
        version: 1,
        analysisResult: JSON.stringify(analysisResult),
        changeType: "auto_analysis",
        changeNote: `从产品画像导入 (${devProject[0].name})`,
      });

      return record;
    }),
});

// ─── Helper: Convert product profile to text for Rufus analysis ───
function convertProfileToText(profile: any, projectName: string): string {
  const sections: string[] = [];
  sections.push(`产品名称: ${projectName}`);
  sections.push("");

  // Parse each profile section
  const moduleMap: { field: string; aiField: string; label: string }[] = [
    { field: "appearanceColors", aiField: "appearanceAiSuggestion", label: "外观设计" },
    { field: "mainFunctions", aiField: "functionsAiSuggestion", label: "功能特点" },
    { field: "costBreakdown", aiField: "costAiSuggestion", label: "产品成本" },
    { field: "packageDimensions", aiField: "packageAiSuggestion", label: "包装尺寸" },
    { field: "packageDesign", aiField: "packageDesignAiSuggestion", label: "包装设计" },
    { field: "userPersona", aiField: "userPersonaAiSuggestion", label: "用户画像" },
    { field: "usageScenarios", aiField: "usageScenariosAiSuggestion", label: "使用场景" },
    { field: "productMap", aiField: "productMapAiSuggestion", label: "产品地图" },
  ];

  for (const mod of moduleMap) {
    // Prefer user-edited data, fallback to AI suggestion
    const rawData = (profile as any)[mod.field] || (profile as any)[mod.aiField];
    if (!rawData) continue;

    try {
      const data = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
      sections.push(`【${mod.label}】`);
      sections.push(flattenProfileData(data));
      sections.push("");
    } catch {
      if (typeof rawData === "string" && rawData.trim()) {
        sections.push(`【${mod.label}】`);
        sections.push(rawData);
        sections.push("");
      }
    }
  }

  return sections.join("\n");
}

function flattenProfileData(data: any, indent = 0): string {
  if (!data) return "";
  const prefix = "  ".repeat(indent);

  if (typeof data === "string") return `${prefix}${data}`;
  if (typeof data === "number" || typeof data === "boolean") return `${prefix}${data}`;

  if (Array.isArray(data)) {
    return data.map((item, i) => {
      if (typeof item === "string") return `${prefix}- ${item}`;
      if (typeof item === "object" && item !== null) {
        const parts = Object.entries(item)
          .filter(([_, v]) => v !== null && v !== undefined && v !== "")
          .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
        return `${prefix}- ${parts.join(", ")}`;
      }
      return `${prefix}- ${JSON.stringify(item)}`;
    }).join("\n");
  }

  if (typeof data === "object") {
    return Object.entries(data)
      .filter(([_, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => {
        if (typeof v === "object") {
          return `${prefix}${k}:\n${flattenProfileData(v, indent + 1)}`;
        }
        return `${prefix}${k}: ${v}`;
      }).join("\n");
  }

  return `${prefix}${JSON.stringify(data)}`;
}
