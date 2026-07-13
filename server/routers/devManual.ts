import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as devDb from "../devDb";
import { storagePut } from "../storage";
import { generateThemedManualHtml, THEME_PRESETS, FONT_PRESETS } from "../manualTemplates";

const MANUAL_CHAPTERS = [
  { key: "overview", titleEn: "Product Overview", titleEs: "Descripcion del Producto" },
  { key: "contents", titleEn: "Package Contents", titleEs: "Contenido del Paquete" },
  { key: "specs", titleEn: "Specifications", titleEs: "Especificaciones" },
  { key: "installation", titleEn: "Installation Guide", titleEs: "Guia de Instalacion" },
  { key: "usage", titleEn: "Usage Instructions", titleEs: "Instrucciones de Uso" },
  { key: "safety", titleEn: "Safety Warnings", titleEs: "Advertencias de Seguridad" },
  { key: "maintenance", titleEn: "Maintenance & Care", titleEs: "Mantenimiento y Cuidado" },
  { key: "troubleshooting", titleEn: "Troubleshooting", titleEs: "Solucion de Problemas" },
  { key: "warranty", titleEn: "Warranty & Contact", titleEs: "Garantia y Contacto" },
] as const;

// 说明书生成与测试报告管理路由

// Helper: resolve dev project access based on user role
async function resolveDevProjectAccess(projectId: number, user: { id: number; role: string }) {
  if (user.role === 'super_admin' || user.role === 'admin' || user.role === 'designer') {
    const project = await devDb.getDevProjectByIdAdmin(projectId);
    if (!project) throw new Error("Project not found");
    return project;
  }
  const project = await devDb.getDevProjectById(projectId, user.id);
  if (!project) throw new Error("Project not found");
  return project;
}

export const devManualRouter = router({
  // ─── Get Manual ────────────────────────────────────────────
  getManual: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevManual(input.projectId);
    }),

  // ─── Get Theme Presets ─────────────────────────────────────
  getThemePresets: protectedProcedure
    .query(async () => {
      return { themes: THEME_PRESETS, fonts: FONT_PRESETS };
    }),

  // ─── Save Theme Config ─────────────────────────────────────
  saveThemeConfig: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      themeStyle: z.enum(["classic", "modern", "minimal", "business", "creative"]),
      themeColor: z.string(),
      fontScheme: z.enum(["default", "serif", "sans", "elegant", "tech"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await devDb.upsertDevManual({
        projectId: input.projectId,
        userId: ctx.user.id,
        themeStyle: input.themeStyle,
        themeColor: input.themeColor,
        fontScheme: input.fontScheme,
      });
      return { success: true };
    }),

  // ─── 上传参考说明书 (Upload Reference Manual) ───────────────────────────────
  uploadReference: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fileName: z.string(),
      fileData: z.string(), // base64
      mimeType: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileData, "base64");
      const ext = input.fileName.split(".").pop() || "pdf";
      const key = `manual-refs/${input.projectId}/ref-${Date.now()}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType || "application/pdf");

      await devDb.upsertDevManual({
        projectId: input.projectId,
        userId: ctx.user.id,
        referenceManualUrl: url,
      });

      return { url };
    }),

  // ─── AI Analyze Reference Manual ───────────────────────────
  analyzeReference: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const manual = await devDb.getDevManual(input.projectId);
      if (!manual?.referenceManualUrl) throw new Error("Please upload a reference manual first");

      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a product manual design expert. Analyze the reference manual and extract:
1. Layout style and structure
2. Color scheme and typography choices
3. Content organization pattern
4. Key design elements worth replicating
5. Recommended theme style (classic/modern/minimal/business/creative)
6. Recommended color palette (primary hex color)
7. Recommended font scheme (default/serif/sans/elegant/tech)

Return JSON:
{
  "analysis": "Detailed analysis text",
  "recommendedTheme": "modern",
  "recommendedColor": "#2563eb",
  "recommendedFont": "sans",
  "layoutNotes": "Layout observations",
  "contentStructure": "Content structure notes",
  "designHighlights": ["highlight1", "highlight2"]
}`,
          },
          {
            role: "user",
            content: [
              { type: "text" as const, text: "Please analyze this reference manual and provide design recommendations:" },
              { type: "image_url" as const, image_url: { url: manual.referenceManualUrl } },
            ],
          },
        ],
      });

      const content = (response.choices?.[0]?.message?.content as string) || "";
      let analysis;
      try {
        analysis = JSON.parse(content.replace(/```json\n?|\n?```/g, ""));
      } catch {
        analysis = { analysis: content, recommendedTheme: "classic", recommendedColor: "#1a1a2e", recommendedFont: "default" };
      }

      await devDb.upsertDevManual({
        projectId: input.projectId,
        userId: ctx.user.id,
        referenceManualNotes: JSON.stringify(analysis),
      });

      return analysis;
    }),

  // ─── Step 1: AI Generate 9 Chapters ────────────────────────
  generateManual: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveDevProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");

      const products = await devDb.getDevProductsByProject(input.projectId);
      const profile = await devDb.getDevProductProfile(input.projectId);
      const bom = await devDb.getDevBomItems(input.projectId);
      const manual = await devDb.getDevManual(input.projectId);

      // Include reference analysis if available
      let refContext = "";
      if (manual?.referenceManualNotes) {
        try {
          const refAnalysis = JSON.parse(manual.referenceManualNotes as string);
          refContext = `\nReference Manual Analysis:\n${refAnalysis.analysis || ""}\nLayout Notes: ${refAnalysis.layoutNotes || ""}`;
        } catch {}
      }

      const context = `Product: ${project.name}
Target Market: ${project.targetMarket}
Competitor References: ${products.slice(0, 3).map((p: any) => p.title).join("; ")}
${profile ? `Functions: ${profile.mainFunctions || ""}\nAppearance: ${profile.appearanceColors || ""}\nPackage: ${profile.packageDimensions || ""}` : ""}
BOM Components: ${bom.map((b: any) => b.partName).join(", ")}${refContext}`;

      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a professional product manual writer for US consumer products.
Generate a complete product manual with 9 chapters in BOTH English and Spanish.
Each chapter should be detailed, professional, and comply with US market standards.
Use clear formatting with numbered steps, bullet points, and proper sections.

Return JSON format:
{
  "chapters": [
    {
      "key": "chapter_key",
      "titleEn": "English Title",
      "titleEs": "Spanish Title",
      "contentEn": "English content (detailed, with numbered steps where applicable)",
      "contentEs": "Spanish content (professional translation, not machine-translated feel)",
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
9. Warranty & Contact - Warranty terms and customer service info

IMPORTANT: Spanish content must be natural, professional Spanish - not literal translation.`,
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
      chapters: z.string(),
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

  // ─── Step 3: Generate HTML manuals (EN + ES) with theme ───
  generateHtml: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const manual = await devDb.getDevManual(input.projectId);
      if (!manual?.contentSections) throw new Error("Please generate manual content first");

      let chapters: any[];
      try {
        chapters = JSON.parse(manual.contentSections as string);
      } catch {
        throw new Error("Manual content format error");
      }

      // Get assets from the assets table
      const assets = await devDb.getDevManualAssets(input.projectId);
      const contentBgAsset = assets.find((a: any) => a.assetType === "content_bg");

      const manualData = {
        chapters,
        brandName: manual.brandName || "Brand",
        logoUrl: manual.logoUrl || "",
        coverImageUrl: manual.coverImageUrl || "",
        contentBgUrl: contentBgAsset?.fileUrl || "",
        qrCodeUrl: manual.qrCodeUrl || "",
      };

      const themeConfig = {
        themeStyle: (manual as any).themeStyle || "classic",
        themeColor: (manual as any).themeColor || "#1a1a2e",
        fontScheme: (manual as any).fontScheme || "default",
      };

      const htmlEn = generateThemedManualHtml(manualData, "en", themeConfig);
      const htmlEs = generateThemedManualHtml(manualData, "es", themeConfig);

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

  // ─── Preview HTML (without saving to S3) ───────────────────
  previewHtml: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      language: z.enum(["en", "es"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const manual = await devDb.getDevManual(input.projectId);
      if (!manual?.contentSections) throw new Error("Please generate manual content first");

      let chapters: any[];
      try {
        chapters = JSON.parse(manual.contentSections as string);
      } catch {
        throw new Error("Manual content format error");
      }

      const assets = await devDb.getDevManualAssets(input.projectId);
      const contentBgAsset = assets.find((a: any) => a.assetType === "content_bg");

      const manualData = {
        chapters,
        brandName: manual.brandName || "Brand",
        logoUrl: manual.logoUrl || "",
        coverImageUrl: manual.coverImageUrl || "",
        contentBgUrl: contentBgAsset?.fileUrl || "",
        qrCodeUrl: manual.qrCodeUrl || "",
      };

      const themeConfig = {
        themeStyle: (manual as any).themeStyle || "classic",
        themeColor: (manual as any).themeColor || "#1a1a2e",
        fontScheme: (manual as any).fontScheme || "default",
      };

      const html = generateThemedManualHtml(manualData, input.language, themeConfig);
      return { html };
    }),

  // ─── Export PDF (generates print-ready HTML) ───────────────
  exportPdf: protectedProcedure
    .input(z.object({ projectId: z.number(), language: z.enum(["en", "es"]) }))
    .mutation(async ({ ctx, input }) => {
      const manual = await devDb.getDevManual(input.projectId);
      if (!manual?.contentSections) throw new Error("Please generate manual content first");

      let chapters: any[];
      try {
        chapters = JSON.parse(manual.contentSections as string);
      } catch {
        throw new Error("Manual content format error");
      }

      const assets = await devDb.getDevManualAssets(input.projectId);
      const contentBgAsset = assets.find((a: any) => a.assetType === "content_bg");

      const manualData = {
        chapters,
        brandName: manual.brandName || "Brand",
        logoUrl: manual.logoUrl || "",
        coverImageUrl: manual.coverImageUrl || "",
        contentBgUrl: contentBgAsset?.fileUrl || "",
        qrCodeUrl: manual.qrCodeUrl || "",
      };

      const themeConfig = {
        themeStyle: (manual as any).themeStyle || "classic",
        themeColor: (manual as any).themeColor || "#1a1a2e",
        fontScheme: (manual as any).fontScheme || "default",
      };

      const html = generateThemedManualHtml(manualData, input.language, themeConfig);

      // Upload print-ready HTML to S3
      const key = `manuals/${input.projectId}/manual-print-${input.language}-${Date.now()}.html`;
      const result = await storagePut(key, Buffer.from(html, "utf-8"), "text/html");

      const pdfField = input.language === "en" ? "pdfEnUrl" : "pdfEsUrl";
      await devDb.upsertDevManual({
        projectId: input.projectId,
        userId: ctx.user.id,
        [pdfField]: result.url,
      });

      return { htmlUrl: result.url, html };
    }),

  // ─── 测试报告 (Test Report) ───────────────────────────────────────────
  getTestReport: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevTestReport(input.projectId);
    }),

  generateTestReport: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveDevProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");

      const products = await devDb.getDevProductsByProject(input.projectId);
      const profile = await devDb.getDevProductProfile(input.projectId);
      const bom = await devDb.getDevBomItems(input.projectId);

      // Build comprehensive profile context using all 8 sub-modules
      const { buildProfileContext } = await import("../profileContextBuilder");
      const profileContext = buildProfileContext(profile);

      const context = `项目: ${project.name}
目标市场: ${project.targetMarket || "美国"}

竞品数据:
${products.slice(0, 3).map((p: any) => `${p.title} | $${p.price} | ${p.rating}\u2605 | ${(p.bulletPoints || "").slice(0, 200)}`).join("\n")}

${profileContext}

BOM物料清单:
${bom.map((b: any) => `${b.partName} | 材质:${b.material || "未知"} | 工艺:${b.process || "未知"} | 规格:${b.specification || ""}`).join("\n")}`;

      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a product quality testing expert. Generate a comprehensive test report with 8 categories of test items.

IMPORTANT: Carefully reference the product profile data provided:
- 【外观设计】 for material testing (drop test heights, surface scratch resistance, UV resistance based on materials)
- 【功能提升】 for function tests (each main feature and upgrade point needs specific test items)
- 【产品成本】 for quality grade expectations
- 【包装设计】 for packaging tests (compression, seal, dimensions)
- 【用户画像】 for safety tests (age group, usage patterns)
- 【使用场景】 for durability tests (environment conditions, usage frequency)

Each test item must include bilingual (Chinese + English) descriptions.

Return JSON format:
{
  "testItems": [
    {
      "category": "installation|usage|drop|shipping|function|durability|safety|packaging",
      "nameEn": "Test Name (English)",
      "nameCn": "Test Name (Chinese)",
      "descEn": "Test description in English",
      "descCn": "Test description in Chinese",
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
1. Installation Tests - Assembly, mounting, setup
2. Usage Tests - Normal operation, user interaction
3. Drop Tests - Various heights and angles
4. Shipping Tests - Vibration, compression, climate
5. Function Tests - All features verification
6. Durability Tests - Lifecycle, wear, fatigue
7. Safety Tests - CPSC, electrical, chemical
8. Packaging Tests - Seal, label, barcode

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

  saveTestReport: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      testItems: z.string(),
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
      if (!report?.testItems) throw new Error("Test report not found");

      let items: any[];
      try {
        items = JSON.parse(report.testItems as string);
      } catch {
        throw new Error("Test items format error");
      }

      if (input.itemIndex < 0 || input.itemIndex >= items.length) {
        throw new Error("Invalid test item index");
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

  exportTestExcel: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const report = await devDb.getDevTestReport(input.projectId);
      if (!report?.testItems) throw new Error("Test report not found");

      let items: any[];
      try {
        items = JSON.parse(report.testItems as string);
      } catch {
        throw new Error("Test items format error");
      }

      return {
        items,
        headers: [
          "Category", "Test Name (EN)", "Test Name (CN)", "Description (EN)", "Description (CN)",
          "Requirement", "Pass Standard", "Test Method", "Status", "Actual Result", "Notes"
        ],
      };
    }),

  // ─── Manual Asset Management ──────────────────────────────
  getManualAssets: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevManualAssets(input.projectId);
    }),

  uploadManualAsset: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      assetType: z.enum(["logo", "cover", "content_bg", "qrcode", "chapter_image", "reference", "other"]),
      chapterKey: z.string().optional(),
      fileName: z.string(),
      fileData: z.string(),
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

      // Auto-update manual record for specific asset types
      if (input.assetType === "logo") {
        await devDb.upsertDevManual({ projectId: input.projectId, userId: ctx.user.id, logoUrl: url });
      } else if (input.assetType === "cover") {
        await devDb.upsertDevManual({ projectId: input.projectId, userId: ctx.user.id, coverImageUrl: url });
      } else if (input.assetType === "qrcode") {
        await devDb.upsertDevManual({ projectId: input.projectId, userId: ctx.user.id, qrCodeUrl: url });
      } else if (input.assetType === "reference") {
        await devDb.upsertDevManual({ projectId: input.projectId, userId: ctx.user.id, referenceManualUrl: url });
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
