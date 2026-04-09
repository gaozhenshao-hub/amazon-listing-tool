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
  list: protectedProcedure
    .input(z.object({ scope: z.enum(["mine", "shared", "all"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
    return kbDb.listOperationSkills(ctx.user.id, input?.scope ?? "mine");
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

  // Import by URL (with automatic image OCR extraction)
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
          const axios = (await import("axios")).default;
          const response = await axios.get(input.url, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } });
          const html = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
          const cheerio = await import("cheerio");
          const $ = cheerio.load(html);

          // Extract image URLs from article body (exclude icons/logos/ads)
          const baseUrl = new URL(input.url);
          const imageUrls: string[] = [];
          $("article img, .content img, .post img, .article img, main img, #content img, .rich_media_content img, [data-src]").each((_, el) => {
            const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-original") || "";
            if (!src) return;
            try {
              const fullUrl = src.startsWith("http") ? src : new URL(src, baseUrl.origin).href;
              // Filter out tiny icons (width/height hints in URL or attributes)
              const w = parseInt($(el).attr("width") || "999");
              const h = parseInt($(el).attr("height") || "999");
              if (w < 50 || h < 50) return;
              if (fullUrl.match(/\/icon|logo|avatar|emoji|gif/i)) return;
              if (!imageUrls.includes(fullUrl) && imageUrls.length < 20) imageUrls.push(fullUrl);
            } catch {}
          });

          // Extract text content
          $("script, style, nav, footer, header").remove();
          const text = $("body").text().replace(/\s+/g, " ").trim();

          // OCR images in parallel (max 8 to avoid timeout)
          let imageOcrText = "";
          if (imageUrls.length > 0) {
            const imagesToProcess = imageUrls.slice(0, 8);
            console.log(`[KB Skills] Auto OCR: ${imagesToProcess.length} images from ${input.url}`);
            const ocrResults = await Promise.allSettled(
              imagesToProcess.map(async (imgUrl, idx) => {
                try {
                  const imgResp = await axios.get(imgUrl, { responseType: "arraybuffer", timeout: 10000 });
                  const contentType = imgResp.headers["content-type"] || "image/jpeg";
                  const base64 = Buffer.from(imgResp.data).toString("base64");
                  const dataUrl = `data:${contentType};base64,${base64}`;
                  const ocrResp = await invokeLLM({
                    messages: [{
                      role: "user",
                      content: [
                        { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
                        { type: "text", text: "请提取这张图片中的所有文字内容和关键信息。如果是流程图/表格/数据图，请描述其结构和内容。如果图片没有有价值的文字内容，回复'无文字内容'。" }
                      ]
                    }]
                  });
                  const ocrText = String(ocrResp.choices?.[0]?.message?.content || "");
                  if (ocrText && !ocrText.includes("无文字内容")) {
                    return `[图片${idx + 1}内容]: ${ocrText}`;
                  }
                  return null;
                } catch {
                  return null;
                }
              })
            );
            const validOcrTexts = ocrResults
              .filter(r => r.status === "fulfilled" && r.value)
              .map(r => (r as PromiseFulfilledResult<string>).value);
            if (validOcrTexts.length > 0) {
              imageOcrText = "\n\n=== 文章图片内容（AI识别）===\n" + validOcrTexts.join("\n\n");
              console.log(`[KB Skills] OCR extracted ${validOcrTexts.length}/${imagesToProcess.length} images`);
            }
          }

          const fullContent = text.slice(0, 40000) + imageOcrText;
          await kbDb.updateOperationSkill(Number(id), ctx.user.id, {
            extractedContent: fullContent.slice(0, 50000),
            status: "analyzing",
          });

          const aiResponse = await invokeLLM({
            messages: [
              { role: "system", content: `你是亚马逊运营专家。对运营知识内容进行智能摘要，返回JSON: { title, summary, keyPoints, actionSteps, applicableScenarios, difficultyLevel, categories, tags, practicalityScore(1-10), briefSummary }` },
              { role: "user", content: `URL: ${input.url}\n文章文字内容:\n${text.slice(0, 5000)}${imageOcrText ? "\n\n" + imageOcrText.slice(0, 3000) : ""}` }
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

  // Step 1: OCR only - returns recognized text for user review before merging
  ocrImages: protectedProcedure
    .input(z.object({
      id: z.number(),
      images: z.array(z.object({
        base64: z.string(),
        mimeType: z.string().default("image/jpeg"),
        fileName: z.string().optional(),
      })).min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const item = await kbDb.getOperationSkill(input.id, ctx.user.id);
      if (!item) throw new Error("条目不存在或无权限");

      // OCR all images in parallel, return results for user review
      const ocrResults = await Promise.allSettled(
        input.images.map(async (img, idx) => {
          const dataUrl = `data:${img.mimeType};base64,${img.base64}`;
          const ocrResp = await invokeLLM({
            messages: [{
              role: "user",
              content: [
                { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
                { type: "text", text: "请提取这张图片中的所有文字内容和关键信息。如果是流程图/表格/数据图，请详细描述其结构和所有数据。如果是截图，请完整转录所有可见文字。如果图片没有有价值的文字内容，回复'无文字内容'。" }
              ]
            }]
          });
          const ocrText = String(ocrResp.choices?.[0]?.message?.content || "");
          return {
            index: idx,
            fileName: img.fileName || `图片${idx + 1}`,
            ocrText: ocrText.includes("无文字内容") ? "" : ocrText,
          };
        })
      );

      const results = ocrResults.map((r, idx) => {
        if (r.status === "fulfilled") return r.value;
        return { index: idx, fileName: input.images[idx].fileName || `图片${idx + 1}`, ocrText: "" };
      });

      return {
        success: true,
        results, // Return full OCR text for user to review/edit
        recognizedCount: results.filter(r => r.ocrText).length,
      };
    }),

  // Step 2: Merge user-confirmed OCR texts into the entry content
  mergeOcrTexts: protectedProcedure
    .input(z.object({
      id: z.number(),
      confirmedTexts: z.array(z.object({
        fileName: z.string(),
        ocrText: z.string(), // User-edited OCR text
      })).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const item = await kbDb.getOperationSkill(input.id, ctx.user.id);
      if (!item) throw new Error("条目不存在或无权限");

      const validTexts = input.confirmedTexts.filter(t => t.ocrText.trim());
      if (validTexts.length === 0) throw new Error("没有有效的图片内容可合并");

      const ocrSection = "\n\n=== 补充图片内容（AI识别）===\n" +
        validTexts.map(t => `[${t.fileName}]: ${t.ocrText}`).join("\n\n");
      const existingContent = item.extractedContent || "";
      const newContent = (existingContent + ocrSection).slice(0, 50000);

      await kbDb.updateOperationSkill(input.id, ctx.user.id, {
        extractedContent: newContent,
        status: "analyzing",
      });

      // Re-run AI analysis with enriched content
      (async () => {
        try {
          const aiResponse = await invokeLLM({
            messages: [
              { role: "system", content: `你是亚马逊运营专家。对运营知识内容进行智能摘要（包含图片识别内容），返回JSON: { title, summary, keyPoints, actionSteps, applicableScenarios, difficultyLevel, categories, tags, practicalityScore(1-10), briefSummary }` },
              { role: "user", content: `标题: ${item.title}\n内容（含图片识别）:\n${newContent.slice(0, 8000)}` }
            ],
            response_format: { type: "json_object" as const },
          });
          const summary = String(aiResponse.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(summary);
          await kbDb.updateOperationSkill(input.id, ctx.user.id, {
            aiSummary: summary,
            categories: JSON.stringify(parsed.categories || []),
            tags: JSON.stringify(parsed.tags || []),
            practicalityScore: parsed.practicalityScore || 7,
            status: "pending_review",
          });
        } catch (err: any) {
          console.error("[KB Skills] Re-analysis after image merge failed:", err.message);
          await kbDb.updateOperationSkill(input.id, ctx.user.id, { status: "pending_review" });
        }
      })();

      return {
        success: true,
        mergedCount: validTexts.length,
        message: `已合并 ${validTexts.length} 张图片内容，正在重新分析...`,
      };
    }),

  // Step 1+2 combined (legacy): OCR and merge in one step
  enrichWithImages: protectedProcedure
    .input(z.object({
      id: z.number(),
      images: z.array(z.object({
        base64: z.string(),
        mimeType: z.string().default("image/jpeg"),
        fileName: z.string().optional(),
      })).min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const item = await kbDb.getOperationSkill(input.id, ctx.user.id);
      if (!item) throw new Error("条目不存在或无权限");

      // OCR all uploaded images in parallel
      const ocrResults = await Promise.allSettled(
        input.images.map(async (img, idx) => {
          const dataUrl = `data:${img.mimeType};base64,${img.base64}`;
          const ocrResp = await invokeLLM({
            messages: [{
              role: "user",
              content: [
                { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
                { type: "text", text: "请提取这张图片中的所有文字内容和关键信息。如果是流程图/表格/数据图，请详细描述其结构和所有数据。如果是截图，请完整转录所有可见文字。如果图片没有有价值的文字内容，回复'无文字内容'。" }
              ]
            }]
          });
          const ocrText = String(ocrResp.choices?.[0]?.message?.content || "");
          return {
            index: idx + 1,
            fileName: img.fileName || `图片${idx + 1}`,
            ocrText: ocrText.includes("无文字内容") ? "" : ocrText,
          };
        })
      );

      const validResults = ocrResults
        .filter(r => r.status === "fulfilled" && (r as PromiseFulfilledResult<any>).value.ocrText)
        .map(r => (r as PromiseFulfilledResult<any>).value);

      if (validResults.length === 0) {
        return { success: true, enriched: 0, ocrResults: [], message: "所有图片均未识别到有效文字内容" };
      }

      // Append OCR results to extractedContent
      const ocrSection = "\n\n=== 补充图片内容（AI识别）===\n" +
        validResults.map(r => `[${r.fileName}]: ${r.ocrText}`).join("\n\n");
      const existingContent = item.extractedContent || "";
      const newContent = (existingContent + ocrSection).slice(0, 50000);

      await kbDb.updateOperationSkill(input.id, ctx.user.id, {
        extractedContent: newContent,
        status: "analyzing",
      });

      // Re-run AI analysis with enriched content
      (async () => {
        try {
          const aiResponse = await invokeLLM({
            messages: [
              { role: "system", content: `你是亚马逊运营专家。对运营知识内容进行智能摘要（包含图片识别内容），返回JSON: { title, summary, keyPoints, actionSteps, applicableScenarios, difficultyLevel, categories, tags, practicalityScore(1-10), briefSummary }` },
              { role: "user", content: `标题: ${item.title}\n内容（含图片识别）:\n${newContent.slice(0, 8000)}` }
            ],
            response_format: { type: "json_object" as const },
          });
          const summary = String(aiResponse.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(summary);
          await kbDb.updateOperationSkill(input.id, ctx.user.id, {
            aiSummary: summary,
            categories: JSON.stringify(parsed.categories || []),
            tags: JSON.stringify(parsed.tags || []),
            practicalityScore: parsed.practicalityScore || 7,
            status: "pending_review",
          });
        } catch (err: any) {
          console.error("[KB Skills] Re-analysis after image enrichment failed:", err.message);
          await kbDb.updateOperationSkill(input.id, ctx.user.id, { status: "pending_review" });
        }
      })();

      return {
        success: true,
        enriched: validResults.length,
        ocrResults: validResults.map(r => ({ fileName: r.fileName, preview: r.ocrText.slice(0, 200) })),
        message: `已识别 ${validResults.length}/${input.images.length} 张图片内容，正在重新分析...`,
      };
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
