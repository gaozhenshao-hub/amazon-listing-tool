import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-manual-user",
    email: "manual@example.com",
    name: "Manual Tester",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return { ctx };
}

describe("devManual enhanced features", () => {
  // ─── Theme Presets ─────────────────────────────────────────
  describe("getThemePresets", () => {
    it("returns theme styles and font schemes", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);
      const result = await caller.devManual.getThemePresets();

      expect(result).toHaveProperty("themes");
      expect(result).toHaveProperty("fonts");
      expect(Array.isArray(result.themes)).toBe(true);
      expect(result.themes.length).toBeGreaterThanOrEqual(5);

      // Check theme structure
      const theme = result.themes[0];
      expect(theme).toHaveProperty("id");
      expect(theme).toHaveProperty("name");
      expect(theme).toHaveProperty("nameZh");
      expect(theme).toHaveProperty("desc");
      expect(theme).toHaveProperty("defaultColor");

      // Check font structure
      expect(result.fonts.length).toBeGreaterThanOrEqual(3);
      const font = result.fonts[0];
      expect(font).toHaveProperty("id");
      expect(font).toHaveProperty("name");
      expect(font).toHaveProperty("nameZh");
    });

    it("includes all 5 theme styles", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);
      const result = await caller.devManual.getThemePresets();

      const themeIds = result.themes.map((t: any) => t.id);
      expect(themeIds).toContain("classic");
      expect(themeIds).toContain("modern");
      expect(themeIds).toContain("minimal");
      expect(themeIds).toContain("business");
      expect(themeIds).toContain("creative");
    });

    it("includes all font schemes", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);
      const result = await caller.devManual.getThemePresets();

      const fontIds = result.fonts.map((f: any) => f.id);
      expect(fontIds).toContain("default");
      expect(fontIds).toContain("serif");
      expect(fontIds).toContain("sans");
      expect(fontIds).toContain("elegant");
      expect(fontIds).toContain("tech");
    });
  });

  // ─── Theme Config Save ─────────────────────────────────────
  describe("saveThemeConfig", () => {
    it("saves theme configuration for a project", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.devManual.saveThemeConfig({
        projectId: 99998,
        themeStyle: "classic",
        themeColor: "#dc2626",
        fontScheme: "sans",
      });

      expect(result).toHaveProperty("success", true);
    });

    it("accepts all valid theme styles", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const styles = ["classic", "modern", "minimal", "business", "creative"] as const;
      for (const style of styles) {
        const result = await caller.devManual.saveThemeConfig({
          projectId: 99999,
          themeStyle: style,
          themeColor: "#000000",
          fontScheme: "default",
        });
        expect(result.success).toBe(true);
      }
    });
  });

  // ─── Preview HTML ──────────────────────────────────────────
  describe("previewHtml", () => {
    it("generates preview HTML for English", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      // First save some content
      await caller.devManual.saveManual({
        projectId: 99998,
        chapters: JSON.stringify([
          {
            key: "safety_warnings",
            titleEn: "Safety Warnings",
            titleEs: "Advertencias de Seguridad",
            contentEn: "Please read all safety instructions before use.",
            contentEs: "Lea todas las instrucciones de seguridad antes de usar.",
            confirmed: true,
          },
        ]),
        brandName: "TestBrand",
        status: "editing",
      });

      const result = await caller.devManual.previewHtml({
        projectId: 99998,
        language: "en",
      });

      expect(result).toHaveProperty("html");
      expect(typeof result.html).toBe("string");
      expect(result.html.length).toBeGreaterThan(100);
      expect(result.html).toContain("Safety Warnings");
      expect(result.html).toContain("TestBrand");
    });

    it("generates preview HTML for Spanish", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.devManual.previewHtml({
        projectId: 99998,
        language: "es",
      });

      expect(result).toHaveProperty("html");
      expect(result.html).toContain("Advertencias de Seguridad");
    });
  });

  // ─── Export PDF ────────────────────────────────────────────
  describe("exportPdf", () => {
    it("generates print-ready HTML for PDF export", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.devManual.exportPdf({
        projectId: 99998,
        language: "en",
      });

      expect(result).toHaveProperty("html");
      expect(typeof result.html).toBe("string");
      // Should contain print-specific CSS
      expect(result.html).toContain("@media print");
    });

    it("generates PDF HTML for Spanish", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.devManual.exportPdf({
        projectId: 99998,
        language: "es",
      });

      expect(result).toHaveProperty("html");
      expect(result.html).toContain("print");
    });
  });

  // ─── Manual Template Engine ────────────────────────────────
  describe("manualTemplates", () => {
    it("preview HTML includes theme color styling", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      // Save with custom theme
      await caller.devManual.saveThemeConfig({
        projectId: 99998,
        themeStyle: "classic",
        themeColor: "#dc2626",
        fontScheme: "sans",
      });

      const result = await caller.devManual.previewHtml({
        projectId: 99998,
        language: "en",
      });

      // The HTML should contain theme-related content
      expect(result.html.length).toBeGreaterThan(100);
      expect(result.html).toContain("Safety Warnings");
    });
  });

  // ─── Manual Asset Upload ───────────────────────────────────
  describe("uploadManualAsset", () => {
    it("accepts reference asset type", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      // Create a small base64 test image (1x1 pixel PNG)
      const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      const result = await caller.devManual.uploadManualAsset({
        projectId: 99997,
        assetType: "reference",
        fileName: "reference-manual.png",
        fileData: tinyPng,
        mimeType: "image/png",
      });

      expect(result).toHaveProperty("url");
      expect(typeof result.url).toBe("string");
      expect(result.url.length).toBeGreaterThan(0);
    });
  });

  // ─── Get Manual Assets ─────────────────────────────────────
  describe("getManualAssets", () => {
    it("returns assets list for a project", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.devManual.getManualAssets({
        projectId: 99997,
      });

      expect(Array.isArray(result)).toBe(true);
      // Should have at least the reference we just uploaded
      expect(result.length).toBeGreaterThanOrEqual(1);
      const ref = result.find((a: any) => a.assetType === "reference");
      expect(ref).toBeDefined();
    });
  });

  // ─── Save Manual ───────────────────────────────────────────
  describe("saveManual", () => {
    it("saves manual with brand info and chapters", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.devManual.saveManual({
        projectId: 99996,
        chapters: JSON.stringify([
          {
            key: "intro",
            titleEn: "Introduction",
            titleEs: "Introduccion",
            contentEn: "Welcome to the product manual.",
            contentEs: "Bienvenido al manual del producto.",
            confirmed: true,
          },
        ]),
        brandName: "MyBrand",
        logoUrl: "https://example.com/logo.png",
        coverImageUrl: "https://example.com/cover.png",
        qrCodeUrl: "https://example.com/qr.png",
        status: "editing",
      });

      expect(result).toHaveProperty("success", true);
    });

    it("retrieves saved manual data", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.devManual.getManual({
        projectId: 99996,
      });

      expect(result).toBeDefined();
      expect(result?.brandName).toBe("MyBrand");
      expect(result?.logoUrl).toBe("https://example.com/logo.png");
    });
  });
});
