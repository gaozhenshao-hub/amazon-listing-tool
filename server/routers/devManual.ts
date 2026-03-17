import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as devDb from "../devDb";
import { storagePut } from "../storage";

const MANUAL_CHAPTERS = [
  { key: "overview", titleEn: "Product Overview", titleEs: "Descripción del Producto" },
  { key: "contents", titleEn: "Package Contents", titleEs: "Contenido del Paquete" },
  { key: "specs", titleEn: "Specifications", titleEs: "Especificaciones" },
  { key: "installation", titleEn: "Installation Guide", titleEs: "Guía de Instalación" },
  { key: "usage", titleEn: "Usage Instructions", titleEs: "Instrucciones de Uso" },
  { key: "safety", titleEn: "Safety Warnings", titleEs: "Advertencias de Seguridad" },
  { key: "maintenance", titleEn: "Maintenance & Care", titleEs: "Mantenimiento y Cuidado" },
  { key: "troubleshooting", titleEn: "Troubleshooting", titleEs: "Solución de Problemas" },
  { key: "warranty", titleEn: "Warranty & Contact", titleEs: "Garantía y Contacto" },
] as const;

export const devManualRouter = router({
  // ─── Get Manual ────────────────────────────────────────────
  getManual: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevManual(input.projectId);
    }),

  // ─── Step 1: AI Generate 9 Chapters (English) ─────────────
  generateManual: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const products = await devDb.getDevProductsByProject(input.projectId);
      const profile = await devDb.getDevProductProfile(input.projectId);
      const bom = await devDb.getDevBomItems(input.projectId);

      const context = `Product: ${project.name}
Target Market: ${project.targetMarket}
Competitor References: ${products.slice(0, 3).map(p => p.title).join("; ")}
${profile ? `Functions: ${profile.mainFunctions || ""}\nAppearance: ${profile.appearanceColors || ""}\nPackage: ${profile.packageDimensions || ""}` : ""}
BOM Components: ${bom.map(b => b.partName).join(", ")}`;

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a professional product manual writer for US consumer products.
Generate a complete product manual with 9 chapters in BOTH English and Spanish.
Each chapter should be detailed, professional, and comply with US market standards.

Return JSON format:
{
  "chapters": [
    {
      "key": "chapter_key",
      "titleEn": "English Title",
      "titleEs": "Spanish Title",
      "contentEn": "English content (detailed, with numbered steps where applicable)",
      "contentEs": "Spanish content (professional translation)",
      "confirmed": false
    }
  ]
}

The 9 chapters are:
1. Product Overview - Product description, features, intended use
2. Package Contents - List of all items in the box
3. Specifications - Technical specs, dimensions, weight, power
4. Installation Guide - Step-by-step installation instructions
5. Usage Instructions - How to use the product
6. Safety Warnings - Safety precautions and warnings (CPSC compliant)
7. Maintenance & Care - Cleaning and maintenance tips
8. Troubleshooting - Common problems and solutions
9. Warranty & Contact - Warranty terms and customer service info`,
          },
          { role: "user", content: context },
        ],
      });

      const content = (response.choices?.[0]?.message?.content as string) || "";
      let chapters;
      try {
        const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, ""));
        chapters = parsed.chapters || parsed;
      } catch {
        // If AI returns non-JSON, create structured chapters from text
        chapters = MANUAL_CHAPTERS.map(ch => ({
          key: ch.key,
          titleEn: ch.titleEn,
          titleEs: ch.titleEs,
          contentEn: content,
          contentEs: "",
          confirmed: false,
        }));
      }

      await devDb.upsertDevManual({
        projectId: input.projectId,
        userId: ctx.user.id,
        contentSections: JSON.stringify(chapters),
        contentStatus: "draft",
      });

      return { chapters };
    }),

  // ─── Step 2: Save edited chapters + brand assets ──────────
  saveManual: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      chapters: z.string(), // JSON string of chapters array
      brandName: z.string().optional(),
      logoUrl: z.string().optional(),
      coverImageUrl: z.string().optional(),
      qrCodeUrl: z.string().optional(),
      status: z.enum(["draft", "editing", "confirmed"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const updateData: any = {
        projectId: input.projectId,
        userId: ctx.user.id,
        contentSections: input.chapters,
        contentStatus: (input.status ?? "editing") as any,
      };
      if (input.brandName !== undefined) updateData.brandName = input.brandName;
      if (input.logoUrl !== undefined) updateData.logoUrl = input.logoUrl;
      if (input.coverImageUrl !== undefined) updateData.coverImageUrl = input.coverImageUrl;
      if (input.qrCodeUrl !== undefined) updateData.qrCodeUrl = input.qrCodeUrl;

      await devDb.upsertDevManual(updateData);
      return { success: true };
    }),

  // ─── Step 3: Generate HTML manuals (EN + ES) ──────────────
  generateHtml: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const manual = await devDb.getDevManual(input.projectId);
      if (!manual?.contentSections) throw new Error("请先生成说明书内容");

      let chapters: any[];
      try {
        chapters = JSON.parse(manual.contentSections as string);
      } catch {
        throw new Error("说明书内容格式错误");
      }

      const brandName = manual.brandName || "Brand";
      const logoUrl = manual.logoUrl || "";
      const coverImageUrl = manual.coverImageUrl || "";
      const qrCodeUrl = manual.qrCodeUrl || "";

      // Generate English HTML
      const htmlEn = generateManualHtml(chapters, "en", brandName, logoUrl, coverImageUrl, qrCodeUrl);
      const htmlEs = generateManualHtml(chapters, "es", brandName, logoUrl, coverImageUrl, qrCodeUrl);

      // Upload to S3
      const enKey = `manuals/${input.projectId}/manual-en-${Date.now()}.html`;
      const esKey = `manuals/${input.projectId}/manual-es-${Date.now()}.html`;

      const enResult = await storagePut(enKey, Buffer.from(htmlEn, "utf-8"), "text/html");
      const esResult = await storagePut(esKey, Buffer.from(htmlEs, "utf-8"), "text/html");

      await devDb.upsertDevManual({
        projectId: input.projectId,
        userId: ctx.user.id,
        htmlEnUrl: enResult.url,
        htmlEsUrl: esResult.url,
        contentStatus: "confirmed",
      });

      return { htmlEnUrl: enResult.url, htmlEsUrl: esResult.url };
    }),

  // ─── Export PDF ────────────────────────────────────────────
  exportPdf: protectedProcedure
    .input(z.object({ projectId: z.number(), language: z.enum(["en", "es"]) }))
    .mutation(async ({ ctx, input }) => {
      const manual = await devDb.getDevManual(input.projectId);
      if (!manual?.contentSections) throw new Error("请先生成说明书内容");

      let chapters: any[];
      try {
        chapters = JSON.parse(manual.contentSections as string);
      } catch {
        throw new Error("说明书内容格式错误");
      }

      const brandName = manual.brandName || "Brand";
      const logoUrl = manual.logoUrl || "";
      const coverImageUrl = manual.coverImageUrl || "";
      const qrCodeUrl = manual.qrCodeUrl || "";

      const html = generateManualHtml(chapters, input.language, brandName, logoUrl, coverImageUrl, qrCodeUrl);

      // Store HTML for PDF generation (client-side will handle actual PDF conversion)
      const key = `manuals/${input.projectId}/manual-${input.language}-${Date.now()}.html`;
      const result = await storagePut(key, Buffer.from(html, "utf-8"), "text/html");

      const pdfField = input.language === "en" ? "pdfEnUrl" : "pdfEsUrl";
      await devDb.upsertDevManual({
        projectId: input.projectId,
        userId: ctx.user.id,
        [pdfField]: result.url,
      });

      return { htmlUrl: result.url, html };
    }),

  // ─── Test Report ───────────────────────────────────────────
  getTestReport: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevTestReport(input.projectId);
    }),

  generateTestReport: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const products = await devDb.getDevProductsByProject(input.projectId);
      const profile = await devDb.getDevProductProfile(input.projectId);
      const bom = await devDb.getDevBomItems(input.projectId);

      const context = `Product: ${project.name}
Target Market: ${project.targetMarket}
Competitors: ${products.slice(0, 3).map(p => `${p.title} | ${p.rating}★`).join("; ")}
${profile ? `Functions: ${profile.mainFunctions || ""}\nMaterials: ${profile.appearanceColors || ""}` : ""}
BOM: ${bom.map(b => `${b.partName}(${b.material || ""})`).join(", ")}`;

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a product quality testing expert. Generate a comprehensive test report with 8 categories of test items.

Each test item must include bilingual (Chinese + English) descriptions.

Return JSON format:
{
  "testItems": [
    {
      "category": "installation|usage|drop|shipping|function|durability|safety|packaging",
      "nameEn": "Test Name (English)",
      "nameCn": "测试名称 (中文)",
      "descEn": "Test description in English",
      "descCn": "测试描述（中文）",
      "requirement": "Test requirement/standard",
      "passStandard": "Pass criteria",
      "testMethod": "Testing method",
      "testStatus": "pending",
      "actualResult": "",
      "notes": ""
    }
  ]
}

8 categories:
1. Installation Tests (安装测试) - Assembly, mounting, setup
2. Usage Tests (使用测试) - Normal operation, user interaction
3. Drop Tests (跌落测试) - Various heights and angles
4. Shipping Tests (运输测试) - Vibration, compression, stacking
5. Function Tests (功能测试) - All features verification
6. Durability Tests (耐久性测试) - Lifecycle, wear, fatigue
7. Safety Tests (安全测试) - CPSC, electrical, chemical
8. Packaging Tests (包装测试) - Seal, label, barcode

Generate 2-4 test items per category. Consider US market regulations (CPSC, FDA, FCC, UL).`,
          },
          { role: "user", content: context },
        ],
      });

      const content = (response.choices?.[0]?.message?.content as string) || "";
      let testItems;
      try {
        const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, ""));
        testItems = parsed.testItems || parsed;
      } catch {
        testItems = [];
      }

      await devDb.upsertDevTestReport({
        projectId: input.projectId,
        userId: ctx.user.id,
        testItems: JSON.stringify(testItems),
        reportContent: content,
        status: "draft",
      });

      return { testItems };
    }),

  // Save test report with status tracking
  saveTestReport: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      testItems: z.string(), // JSON string of test items
      status: z.enum(["draft", "editing", "confirmed"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await devDb.upsertDevTestReport({
        projectId: input.projectId,
        userId: ctx.user.id,
        testItems: input.testItems,
        status: (input.status ?? "editing") as any,
      });
      return { success: true };
    }),

  // Update individual test item status
  updateTestItemStatus: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      itemIndex: z.number(),
      testStatus: z.enum(["pass", "fail", "pending"]),
      actualResult: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const report = await devDb.getDevTestReport(input.projectId);
      if (!report?.testItems) throw new Error("测试报告不存在");

      let items: any[];
      try {
        items = JSON.parse(report.testItems as string);
      } catch {
        throw new Error("测试项目数据格式错误");
      }

      if (input.itemIndex < 0 || input.itemIndex >= items.length) {
        throw new Error("测试项目索引无效");
      }

      items[input.itemIndex].testStatus = input.testStatus;
      if (input.actualResult !== undefined) items[input.itemIndex].actualResult = input.actualResult;
      if (input.notes !== undefined) items[input.itemIndex].notes = input.notes;

      await devDb.upsertDevTestReport({
        projectId: input.projectId,
        userId: ctx.user.id,
        testItems: JSON.stringify(items),
      });

      return { success: true, items };
    }),

  // Export test report as Excel (returns data for client-side generation)
  exportTestExcel: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const report = await devDb.getDevTestReport(input.projectId);
      if (!report?.testItems) throw new Error("测试报告不存在");

      let items: any[];
      try {
        items = JSON.parse(report.testItems as string);
      } catch {
        throw new Error("测试项目数据格式错误");
      }

      // Return structured data for client-side Excel generation
      return {
        items,
        headers: [
          "Category", "Test Name (EN)", "测试名称 (CN)", "Description (EN)", "描述 (CN)",
          "Requirement", "Pass Standard", "Test Method", "Status", "Actual Result", "Notes"
        ],
      };
    }),

  // ─── Manual Asset Management ──────────────────────────────────
  getManualAssets: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevManualAssets(input.projectId);
    }),

  uploadManualAsset: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      assetType: z.enum(["logo", "cover", "content_bg", "qrcode", "chapter_image", "other"]),
      chapterKey: z.string().optional(),
      fileName: z.string(),
      fileData: z.string(), // base64 encoded
      mimeType: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileData, "base64");
      const ext = input.fileName.split(".").pop() || "png";
      const key = `manual-assets/${input.projectId}/${input.assetType}-${Date.now()}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType || "image/png");

      const result = await devDb.upsertDevManualAsset({
        projectId: input.projectId,
        userId: ctx.user.id,
        assetType: input.assetType,
        chapterKey: input.chapterKey || null,
        fileName: input.fileName,
        fileUrl: url,
      });

      // Also update the manual record for logo/cover/qrcode
      if (input.assetType === "logo") {
        await devDb.upsertDevManual({ projectId: input.projectId, userId: ctx.user.id, logoUrl: url });
      } else if (input.assetType === "cover") {
        await devDb.upsertDevManual({ projectId: input.projectId, userId: ctx.user.id, coverImageUrl: url });
      } else if (input.assetType === "qrcode") {
        await devDb.upsertDevManual({ projectId: input.projectId, userId: ctx.user.id, qrCodeUrl: url });
      }

      return { id: result.id, url, assetType: input.assetType };
    }),

  deleteManualAsset: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await devDb.deleteDevManualAsset(input.id);
      return { success: true };
    }),
});

function generateManualHtml(
  chapters: any[],
  lang: string,
  brandName: string,
  logoUrl: string,
  coverImageUrl: string,
  qrCodeUrl: string
): string {
  const isEn = lang === "en";
  const title = isEn ? `${brandName} Product Manual` : `${brandName} Manual del Producto`;

  const chaptersHtml = chapters.map((ch, i) => {
    const chTitle = isEn ? (ch.titleEn || ch.key) : (ch.titleEs || ch.titleEn || ch.key);
    const chContent = isEn ? (ch.contentEn || "") : (ch.contentEs || ch.contentEn || "");
    return `
    <div class="chapter">
      <h2>${i + 1}. ${chTitle}</h2>
      <div class="content">${chContent.replace(/\n/g, "<br/>")}</div>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; line-height: 1.6; }
    .cover { text-align: center; padding: 60px 40px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; }
    .cover img.logo { max-width: 200px; margin-bottom: 30px; }
    .cover img.cover-bg { max-width: 400px; margin: 20px 0; border-radius: 12px; }
    .cover h1 { font-size: 2.5em; margin: 20px 0; }
    .cover .subtitle { font-size: 1.2em; opacity: 0.8; }
    .toc { padding: 40px; max-width: 800px; margin: 0 auto; }
    .toc h2 { font-size: 1.8em; margin-bottom: 20px; border-bottom: 2px solid #1a1a2e; padding-bottom: 10px; }
    .toc ul { list-style: none; }
    .toc li { padding: 8px 0; border-bottom: 1px solid #eee; font-size: 1.1em; }
    .toc li span { color: #666; }
    .chapter { padding: 40px; max-width: 800px; margin: 0 auto; page-break-before: always; }
    .chapter h2 { font-size: 1.6em; color: #1a1a2e; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #e0e0e0; }
    .chapter .content { font-size: 1em; white-space: pre-wrap; }
    .footer { text-align: center; padding: 40px; background: #f5f5f5; }
    .footer img.qr { max-width: 120px; }
    @media print { .cover { page-break-after: always; } .chapter { page-break-before: always; } }
  </style>
</head>
<body>
  <div class="cover">
    ${logoUrl ? `<img class="logo" src="${logoUrl}" alt="Logo"/>` : ""}
    ${coverImageUrl ? `<img class="cover-bg" src="${coverImageUrl}" alt="Cover"/>` : ""}
    <h1>${title}</h1>
    <p class="subtitle">${isEn ? "User Manual" : "Manual de Usuario"}</p>
  </div>
  <div class="toc">
    <h2>${isEn ? "Table of Contents" : "Índice"}</h2>
    <ul>
      ${chapters.map((ch, i) => `<li>${i + 1}. ${isEn ? (ch.titleEn || ch.key) : (ch.titleEs || ch.titleEn || ch.key)}</li>`).join("\n      ")}
    </ul>
  </div>
  ${chaptersHtml}
  <div class="footer">
    ${qrCodeUrl ? `<img class="qr" src="${qrCodeUrl}" alt="QR Code"/>` : ""}
    <p>&copy; ${new Date().getFullYear()} ${brandName}. All rights reserved.</p>
  </div>
</body>
</html>`;
}
