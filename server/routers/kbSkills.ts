import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as kbDb from "../kbDb";
import { invokeLLM } from "../_core/llm";
import { storagePut } from "../storage";
// @ts-ignore - pdf-parse v2 uses named export
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
// @ts-ignore - officeparser uses named export
import { parseOffice } from "officeparser";

// File parsing utilities
async function parseFileContent(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  try {
    if (mimeType === "application/pdf") {
      const parser = new PDFParse({ data: buffer }) as any;
      await parser.load();
      return String(parser.getText());
    }
    if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mimeType === "application/msword") {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || mimeType === "application/vnd.ms-excel") {
      const text = await parseOffice(buffer) as any;
      return String(text);
    }
    if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || mimeType === "application/vnd.ms-powerpoint") {
      const text = await parseOffice(buffer) as any;
      return String(text);
    }
    if (mimeType === "text/markdown" || mimeType === "text/plain" || fileName.endsWith(".md") || fileName.endsWith(".txt")) {
      return buffer.toString("utf-8");
    }
    if (mimeType.startsWith("image/")) {
      return "[图片文件 - 需要视觉AI分析]";
    }
    // Mindmap formats (.xmind, .mm)
    if (fileName.endsWith(".xmind") || fileName.endsWith(".mm")) {
      try {
        const text = await parseOffice(buffer) as any;
        return String(text) || "[思维导图文件 - 已尝试解析]";
      } catch {
        return "[思维导图文件 - 格式暂不支持文本提取]";
      }
    }
    return `[不支持的文件格式: ${mimeType}]`;
  } catch (err: any) {
    console.error(`[KB Skills] File parse error for ${fileName}:`, err.message);
    return `[文件解析失败: ${err.message}]`;
  }
}

function detectSourceType(mimeType: string, fileName: string): "upload_pdf" | "upload_word" | "upload_excel" | "upload_ppt" | "upload_md" | "upload_image" | "upload_mindmap" | "url" | "manual" {
  if (mimeType === "application/pdf") return "upload_pdf";
  if (mimeType.includes("wordprocessingml") || mimeType === "application/msword") return "upload_word";
  if (mimeType.includes("spreadsheetml") || mimeType === "application/vnd.ms-excel") return "upload_excel";
  if (mimeType.includes("presentationml") || mimeType === "application/vnd.ms-powerpoint") return "upload_ppt";
  if (mimeType === "text/markdown" || mimeType === "text/plain" || fileName.endsWith(".md")) return "upload_md";
  if (mimeType.startsWith("image/")) return "upload_image";
  if (fileName.endsWith(".xmind") || fileName.endsWith(".mm")) return "upload_mindmap";
  return "manual";
}

export const kbSkillsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return kbDb.listOperationSkills(ctx.user.id);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      return kbDb.getOperationSkill(input.id, ctx.user.id);
    }),

  // Upload single file
  uploadFile: protectedProcedure
    .input(z.object({
      title: z.string().min(1),
      fileName: z.string(),
      mimeType: z.string(),
      fileBase64: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const sourceType = detectSourceType(input.mimeType, input.fileName);

      // Upload to S3
      const fileKey = `kb-skills/${ctx.user.id}/${Date.now()}-${input.fileName}`;
      const { url: fileUrl } = await storagePut(fileKey, buffer, input.mimeType);

      const id = await kbDb.createOperationSkill({
        userId: ctx.user.id,
        title: input.title,
        sourceType,
        fileUrl,
        originalFileName: input.fileName,
        status: "parsing",
      });

      // Async parse + AI analyze
      (async () => {
        try {
          let extractedContent: string;
          if (sourceType === "upload_image") {
            extractedContent = "[图片文件]";
            // Use vision AI for image
            const response = await invokeLLM({
              messages: [
                { role: "system", content: `你是一位亚马逊运营SOP专家。请分析这张图片中的运营知识内容，提取关键信息和操作步骤。` },
                { role: "user", content: [{ type: "image_url" as const, image_url: { url: fileUrl } }, { type: "text" as const, text: "请提取这张图片中的运营知识内容" }] }
              ],
            });
            extractedContent = String(response.choices?.[0]?.message?.content || "[图片分析失败]");
          } else {
            extractedContent = await parseFileContent(buffer, input.mimeType, input.fileName);
          }

          await kbDb.updateOperationSkill(Number(id), ctx.user.id, {
            extractedContent, status: "analyzing",
          });

          // AI summarize
          const response = await invokeLLM({
            messages: [
              { role: "system", content: `你是一位资深的亚马逊运营专家。请对以下运营知识内容进行智能摘要分析，返回JSON格式：
{
  "title": "优化后的标题",
  "summary": "核心内容摘要（200字以内）",
  "keyPoints": ["要点1", "要点2", "要点3"],
  "actionSteps": ["步骤1", "步骤2"],
  "applicableScenarios": ["适用场景1", "适用场景2"],
  "difficultyLevel": "初级/中级/高级",
  "categories": ["广告优化", "Listing优化"],
  "tags": ["PPC", "关键词"],
  "practicalityScore": 8,
  "briefSummary": "一句话总结"
}` },
              { role: "user", content: `文件名: ${input.fileName}\n标题: ${input.title}\n内容:\n${extractedContent.slice(0, 8000)}` }
            ],
            response_format: { type: "json_object" as const },
          });
          const summary = String(response.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(summary);
          await kbDb.updateOperationSkill(Number(id), ctx.user.id, {
            aiSummary: summary,
            categories: JSON.stringify(parsed.categories || []),
            tags: JSON.stringify(parsed.tags || []),
            practicalityScore: parsed.practicalityScore || 7,
            status: "pending_review",
          });
        } catch (err: any) {
          console.error("[KB Skills] File processing failed:", err.message);
          await kbDb.updateOperationSkill(Number(id), ctx.user.id, { status: "archived" });
        }
      })();
      return { id: Number(id) };
    }),

  // Batch upload files
  batchUploadFiles: protectedProcedure
    .input(z.object({
      files: z.array(z.object({
        title: z.string(),
        fileName: z.string(),
        mimeType: z.string(),
        fileBase64: z.string(),
      })).min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const results: { id: number; fileName: string }[] = [];
      for (const file of input.files) {
        const buffer = Buffer.from(file.fileBase64, "base64");
        const sourceType = detectSourceType(file.mimeType, file.fileName);
        const fileKey = `kb-skills/${ctx.user.id}/${Date.now()}-${file.fileName}`;
        const { url: fileUrl } = await storagePut(fileKey, buffer, file.mimeType);

        const id = await kbDb.createOperationSkill({
          userId: ctx.user.id,
          title: file.title || file.fileName,
          sourceType, fileUrl, originalFileName: file.fileName,
          status: "parsing",
        });
        results.push({ id: Number(id), fileName: file.fileName });

        // Fire-and-forget parse + analyze
        (async () => {
          try {
            const extractedContent = sourceType === "upload_image"
              ? "[图片文件]"
              : await parseFileContent(buffer, file.mimeType, file.fileName);
            await kbDb.updateOperationSkill(Number(id), ctx.user.id, { extractedContent, status: "analyzing" });
            const response = await invokeLLM({
              messages: [
                { role: "system", content: `你是亚马逊运营专家。对运营知识内容进行智能摘要，返回JSON: { title, summary, keyPoints, actionSteps, applicableScenarios, difficultyLevel, categories, tags, practicalityScore(1-10), briefSummary }` },
                { role: "user", content: `文件: ${file.fileName}\n内容:\n${extractedContent.slice(0, 6000)}` }
              ],
              response_format: { type: "json_object" as const },
            });
            const summary = String(response.choices?.[0]?.message?.content || "{}");
            const parsed = JSON.parse(summary);
            await kbDb.updateOperationSkill(Number(id), ctx.user.id, {
              aiSummary: summary, categories: JSON.stringify(parsed.categories || []),
              tags: JSON.stringify(parsed.tags || []), practicalityScore: parsed.practicalityScore || 7,
              status: "pending_review",
            });
          } catch (err: any) {
            console.error(`[KB Skills] Batch file processing failed for ${file.fileName}:`, err.message);
            await kbDb.updateOperationSkill(Number(id), ctx.user.id, { status: "archived" });
          }
        })();
      }
      return { imported: results.length, items: results };
    }),

  // Import by URL
  importByUrl: protectedProcedure
    .input(z.object({ url: z.string().url(), title: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const id = await kbDb.createOperationSkill({
        userId: ctx.user.id,
        title: input.title || input.url,
        sourceType: "url",
        sourceUrl: input.url,
        status: "parsing",
      });
      (async () => {
        try {
          // Try to fetch content from URL
          const axios = (await import("axios")).default;
          const response = await axios.get(input.url, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } });
          const html = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
          // Simple HTML to text extraction
          const cheerio = await import("cheerio");
          const $ = cheerio.load(html);
          $("script, style, nav, footer, header").remove();
          const text = $("body").text().replace(/\s+/g, " ").trim();

          await kbDb.updateOperationSkill(Number(id), ctx.user.id, {
            extractedContent: text.slice(0, 50000), status: "analyzing",
          });
          const aiResponse = await invokeLLM({
            messages: [
              { role: "system", content: `你是亚马逊运营专家。对运营知识内容进行智能摘要，返回JSON: { title, summary, keyPoints, actionSteps, applicableScenarios, difficultyLevel, categories, tags, practicalityScore(1-10), briefSummary }` },
              { role: "user", content: `URL: ${input.url}\n内容:\n${text.slice(0, 8000)}` }
            ],
            response_format: { type: "json_object" as const },
          });
          const summary = String(aiResponse.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(summary);
          await kbDb.updateOperationSkill(Number(id), ctx.user.id, {
            title: parsed.title || input.title || input.url,
            aiSummary: summary, categories: JSON.stringify(parsed.categories || []),
            tags: JSON.stringify(parsed.tags || []), practicalityScore: parsed.practicalityScore || 7,
            status: "pending_review",
          });
        } catch (err: any) {
          console.error("[KB Skills] URL import failed:", err.message);
          await kbDb.updateOperationSkill(Number(id), ctx.user.id, { status: "archived" });
        }
      })();
      return { id: Number(id) };
    }),

  // Manual entry
  createManual: protectedProcedure
    .input(z.object({ title: z.string().min(1), content: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const id = await kbDb.createOperationSkill({
        userId: ctx.user.id, title: input.title,
        sourceType: "manual", extractedContent: input.content, status: "analyzing",
      });
      (async () => {
        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: `你是亚马逊运营专家。对运营知识内容进行智能摘要，返回JSON: { title, summary, keyPoints, actionSteps, applicableScenarios, difficultyLevel, categories, tags, practicalityScore(1-10), briefSummary }` },
              { role: "user", content: `标题: ${input.title}\n内容:\n${input.content.slice(0, 8000)}` }
            ],
            response_format: { type: "json_object" as const },
          });
          const summary = String(response.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(summary);
          await kbDb.updateOperationSkill(Number(id), ctx.user.id, {
            aiSummary: summary, categories: JSON.stringify(parsed.categories || []),
            tags: JSON.stringify(parsed.tags || []), practicalityScore: parsed.practicalityScore || 7,
            status: "pending_review",
          });
        } catch (err: any) {
          console.error("[KB Skills] Manual entry analysis failed:", err.message);
          await kbDb.updateOperationSkill(Number(id), ctx.user.id, { status: "archived" });
        }
      })();
      return { id: Number(id) };
    }),

  confirmSummary: protectedProcedure
    .input(z.object({ id: z.number(), editedSummary: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const update: any = { status: "confirmed" as const, confirmedAt: new Date() };
      if (input.editedSummary) update.userEditedSummary = input.editedSummary;
      await kbDb.updateOperationSkill(input.id, ctx.user.id, update);
      return { success: true };
    }),

  updateTags: protectedProcedure
    .input(z.object({ id: z.number(), tags: z.string(), categories: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const update: any = { tags: input.tags };
      if (input.categories) update.categories = input.categories;
      await kbDb.updateOperationSkill(input.id, ctx.user.id, update);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.deleteOperationSkill(input.id, ctx.user.id);
      return { success: true };
    }),
});
