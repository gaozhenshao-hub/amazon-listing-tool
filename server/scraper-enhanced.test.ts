import { describe, it, expect } from "vitest";
import { toHighRes, isVideoThumbnail, identifyAplusModuleType } from "./scraper";
import type { AplusModuleType } from "./scraper";

describe("scraper enhanced features", () => {
  // ─── toHighRes ────────────────────────────────────────────────────
  describe("toHighRes", () => {
    it("should upgrade _AC_SY355_ to _AC_SL1500_", () => {
      const url = "https://m.media-amazon.com/images/I/71abc._AC_SY355_.jpg";
      expect(toHighRes(url)).toBe("https://m.media-amazon.com/images/I/71abc._AC_SL1500_.jpg");
    });

    it("should upgrade _AC_SX355_ to _AC_SL1500_", () => {
      const url = "https://m.media-amazon.com/images/I/71abc._AC_SX355_.jpg";
      expect(toHighRes(url)).toBe("https://m.media-amazon.com/images/I/71abc._AC_SL1500_.jpg");
    });

    it("should upgrade _AC_US40_ to _AC_SL1500_", () => {
      const url = "https://m.media-amazon.com/images/I/71abc._AC_US40_.jpg";
      expect(toHighRes(url)).toBe("https://m.media-amazon.com/images/I/71abc._AC_SL1500_.jpg");
    });

    it("should upgrade _SS40_ to _AC_SL1500_", () => {
      const url = "https://m.media-amazon.com/images/I/71abc._SS40_.jpg";
      expect(toHighRes(url)).toBe("https://m.media-amazon.com/images/I/71abc._AC_SL1500_.jpg");
    });

    it("should handle aplus-media-library URLs by removing __CR params", () => {
      const url = "https://m.media-amazon.com/images/S/aplus-media-library-service-media/abc.__CR0,0,970,600_PT0_SX970_V1___.jpg";
      const result = toHighRes(url);
      expect(result).not.toContain("__CR");
      expect(result).not.toContain("SX970");
    });

    it("should return empty string for empty input", () => {
      expect(toHighRes("")).toBe("");
    });

    it("should pass through URLs without size suffixes unchanged", () => {
      const url = "https://m.media-amazon.com/images/I/71abc.jpg";
      expect(toHighRes(url)).toBe(url);
    });
  });

  // ─── isVideoThumbnail ─────────────────────────────────────────────
  describe("isVideoThumbnail", () => {
    it("should detect play icon overlay", () => {
      expect(isVideoThumbnail("https://example.com/dp-play-icon-overlay.png")).toBe(true);
    });

    it("should detect play button", () => {
      expect(isVideoThumbnail("https://example.com/play-button.png")).toBe(true);
    });

    it("should detect video-icon", () => {
      expect(isVideoThumbnail("https://example.com/video-icon.png")).toBe(true);
    });

    it("should detect /videos/ path", () => {
      expect(isVideoThumbnail("https://example.com/videos/thumb.jpg")).toBe(true);
    });

    it("should detect video-thumbs", () => {
      expect(isVideoThumbnail("https://example.com/video-thumbs/123.jpg")).toBe(true);
    });

    it("should not flag regular product images", () => {
      expect(isVideoThumbnail("https://m.media-amazon.com/images/I/71abc._AC_SL1500_.jpg")).toBe(false);
    });

    it("should not flag aplus images", () => {
      expect(isVideoThumbnail("https://m.media-amazon.com/images/S/aplus-media-library-service-media/abc.jpg")).toBe(false);
    });
  });

  // ─── identifyAplusModuleType ──────────────────────────────────────
  describe("identifyAplusModuleType", () => {
    it("should identify comparison table module", () => {
      const html = '<div class="apm-tablemodule-table"><table>';
      expect(identifyAplusModuleType(html)).toBe("comparison_table");
    });

    it("should identify comparison table from aplus-comparison class", () => {
      expect(identifyAplusModuleType('<div class="aplus-comparison">')).toBe("comparison_table");
    });

    it("should identify image carousel module", () => {
      expect(identifyAplusModuleType('<div class="apm-carousel-container">')).toBe("image_carousel");
    });

    it("should identify carousel from a-carousel class", () => {
      expect(identifyAplusModuleType('<div class="a-carousel">')).toBe("image_carousel");
    });

    it("should identify full width image module", () => {
      expect(identifyAplusModuleType('<div class="apm-full-width-image">')).toBe("full_width_image");
    });

    it("should identify full width from premium-aplus-module-1", () => {
      expect(identifyAplusModuleType('<div class="premium-aplus-module-1">')).toBe("full_width_image");
    });

    it("should identify image text overlay module", () => {
      expect(identifyAplusModuleType('<div class="apm-image-text-overlay">')).toBe("image_text_overlay");
    });

    it("should identify four image text module", () => {
      expect(identifyAplusModuleType('<div class="apm-four-image-text">')).toBe("four_image_text");
    });

    it("should identify four image from premium-aplus-module-4", () => {
      expect(identifyAplusModuleType('<div class="premium-aplus-module-4">')).toBe("four_image_text");
    });

    it("should identify three image text module", () => {
      expect(identifyAplusModuleType('<div class="apm-three-image-text">')).toBe("three_image_text");
    });

    it("should identify hotspot interactive module", () => {
      expect(identifyAplusModuleType('<div class="apm-hotspot-module">')).toBe("hotspot_interactive");
    });

    it("should identify video module", () => {
      expect(identifyAplusModuleType('<div class="apm-video-player">')).toBe("video_module");
    });

    it("should identify brand story hero", () => {
      expect(identifyAplusModuleType('<div class="apm-brand-story-hero-image">')).toBe("brand_story_hero");
    });

    it("should identify brand story card", () => {
      expect(identifyAplusModuleType('<div class="apm-brand-story-card">')).toBe("brand_story_card");
    });

    it("should identify single image sidebar", () => {
      expect(identifyAplusModuleType('<div class="apm-single-image-sidebar">')).toBe("single_image_sidebar");
    });

    it("should identify single image from premium-aplus-module-2", () => {
      expect(identifyAplusModuleType('<div class="premium-aplus-module-2">')).toBe("single_image_sidebar");
    });

    it("should identify tech specs module", () => {
      expect(identifyAplusModuleType('<div class="apm-tech-spec-table">')).toBe("tech_specs");
    });

    it("should identify navigation carousel", () => {
      expect(identifyAplusModuleType('<div class="apm-navigation-carousel">')).toBe("navigation_carousel");
    });

    it("should identify standard image text as fallback", () => {
      expect(identifyAplusModuleType('<div class="apm-standard-image">')).toBe("standard_image_text");
    });

    it("should return unknown for unrecognized HTML", () => {
      expect(identifyAplusModuleType('<div class="random-class">')).toBe("unknown");
    });

    it("should be case-insensitive", () => {
      expect(identifyAplusModuleType('<div class="APM-TABLEMODULE-TABLE">')).toBe("comparison_table");
    });

    it("should handle empty string", () => {
      expect(identifyAplusModuleType("")).toBe("unknown");
    });
  });

  // ─── Module type coverage ─────────────────────────────────────────
  describe("module type coverage", () => {
    const allTypes: AplusModuleType[] = [
      "comparison_table", "image_carousel", "full_width_image",
      "image_text_overlay", "standard_image_text", "four_image_text",
      "three_image_text", "hotspot_interactive", "video_module",
      "brand_story_hero", "brand_story_card", "single_image_sidebar",
      "tech_specs", "navigation_carousel", "unknown"
    ];

    it("should have 15 defined module types", () => {
      expect(allTypes.length).toBe(15);
    });

    it("should have unique module types", () => {
      const unique = new Set(allTypes);
      expect(unique.size).toBe(allTypes.length);
    });
  });
});
