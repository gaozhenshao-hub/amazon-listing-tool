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

        return updated;
      } catch (err: any) {
        await db.updateProjectFile(record.id, {
          status: "failed",
          errorMessage: err.message || "Analysis failed",
        });
        throw err;
      }
    }),

  // Delete a file
  delete: protectedProcedure
    .input(z.object({ fileId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const file = await db.getProjectFileById(input.fileId);
      if (!file) throw new Error("File not found");

      const project = await db.getProjectById(file.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

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
});
