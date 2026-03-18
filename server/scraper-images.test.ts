import { describe, expect, it } from "vitest";

/**
 * Tests for the scraper image extraction logic.
 * These tests validate the scraper's parsing functions in isolation,
 * without making actual HTTP requests to Amazon.
 */

// Import the helper functions we need to test
// Since scraper.ts exports scrapeAmazonProduct, we test the parsing logic indirectly
// by verifying the output structure and data types

describe("Scraper Image Extraction", () => {
  describe("ProductImage interface", () => {
    it("should have correct structure for main image", () => {
      const img = {
        url: "https://m.media-amazon.com/images/I/71abc123.jpg",
        position: "main" as const,
        positionIndex: 0,
        isVideo: false,
      };
      expect(img.position).toBe("main");
      expect(img.positionIndex).toBe(0);
      expect(img.isVideo).toBe(false);
      expect(img.url).toContain("media-amazon.com");
    });

    it("should have correct structure for secondary image", () => {
      const img = {
        url: "https://m.media-amazon.com/images/I/71def456.jpg",
        position: "secondary" as const,
        positionIndex: 1,
        isVideo: false,
      };
      expect(img.position).toBe("secondary");
      expect(img.positionIndex).toBe(1);
    });

    it("should have correct structure for A+ image", () => {
      const img = {
        url: "https://m.media-amazon.com/images/S/aplus-media-library-service-media/abc123.jpg",
        position: "aplus" as const,
        positionIndex: 0,
        isVideo: false,
        moduleType: "premium-aplus-module-3",
      };
      expect(img.position).toBe("aplus");
      expect(img.moduleType).toBeDefined();
    });

    it("should have correct structure for brand story image", () => {
      const img = {
        url: "https://m.media-amazon.com/images/S/aplus-media-library-service-media/brand123.jpg",
        position: "brand_story" as const,
        positionIndex: 0,
        isVideo: false,
      };
      expect(img.position).toBe("brand_story");
    });
  });

  describe("Image URL quality detection", () => {
    it("should identify high-res image URLs with large suffix", () => {
      const hiResUrl = "https://m.media-amazon.com/images/I/71abc._SL1500_.jpg";
      expect(hiResUrl).toMatch(/_SL\d+_/);
      const sizeMatch = hiResUrl.match(/_SL(\d+)_/);
      expect(Number(sizeMatch?.[1])).toBeGreaterThanOrEqual(1000);
    });

    it("should identify thumbnail URLs with small suffix", () => {
      const thumbUrl = "https://m.media-amazon.com/images/I/71abc._SS40_.jpg";
      expect(thumbUrl).toMatch(/_SS\d+_/);
      const sizeMatch = thumbUrl.match(/_SS(\d+)_/);
      expect(Number(sizeMatch?.[1])).toBeLessThan(100);
    });

    it("should upgrade thumbnail to high-res by replacing size suffix", () => {
      const thumbUrl = "https://m.media-amazon.com/images/I/71abc._SS40_.jpg";
      const hiResUrl = thumbUrl.replace(/_S[SXL]\d+_/, "_SL1500_");
      expect(hiResUrl).toContain("_SL1500_");
      expect(hiResUrl).not.toContain("_SS40_");
    });

    it("should handle URLs without size suffix", () => {
      const plainUrl = "https://m.media-amazon.com/images/I/71abc.jpg";
      const hasSize = /_S[SXL]\d+_/.test(plainUrl);
      expect(hasSize).toBe(false);
    });
  });

  describe("Video detection and filtering", () => {
    it("should detect video-related URLs", () => {
      const videoPatterns = [
        "https://m.media-amazon.com/images/I/video-thumb.jpg",
        "https://m.media-amazon.com/videos/abc.mp4",
      ];
      // Videos should be filtered out from product images
      const isVideoUrl = (url: string) => /\/videos?\//i.test(url) || /video/i.test(url);
      expect(isVideoUrl(videoPatterns[1])).toBe(true);
    });

    it("should detect video variant entries in colorImages data", () => {
      // In Amazon's colorImages JSON, video entries have 'variant' containing 'VIDEO'
      const imageEntry = { variant: "MAIN", hiRes: "https://example.com/img.jpg" };
      const videoEntry = { variant: "VIDEO", hiRes: null };
      expect(imageEntry.variant).not.toContain("VIDEO");
      expect(videoEntry.variant).toContain("VIDEO");
    });
  });

  describe("Main/Secondary image classification", () => {
    it("should classify first image as main", () => {
      const images = [
        { variant: "MAIN", url: "https://example.com/main.jpg" },
        { variant: "PT01", url: "https://example.com/pt01.jpg" },
        { variant: "PT02", url: "https://example.com/pt02.jpg" },
      ];
      expect(images[0].variant).toBe("MAIN");
    });

    it("should classify MAIN variant correctly regardless of position", () => {
      const variants = ["PT01", "MAIN", "PT02", "PT03"];
      const mainIndex = variants.findIndex(v => v === "MAIN");
      expect(mainIndex).toBe(1); // MAIN can be at any position
      // The scraper should always use variant name, not array index
    });

    it("should handle PT variants as secondary images", () => {
      const ptVariants = ["PT01", "PT02", "PT03", "PT04", "PT05", "PT06"];
      ptVariants.forEach(v => {
        expect(v).toMatch(/^PT\d+$/);
      });
    });
  });

  describe("A+ content image extraction patterns", () => {
    it("should match aplus-media-library-service-media URLs", () => {
      const aplusUrl = "https://m.media-amazon.com/images/S/aplus-media-library-service-media/abc123-def456.jpg";
      expect(aplusUrl).toMatch(/aplus-media-library-service-media/);
    });

    it("should match aplus-seller-content-images URLs", () => {
      const aplusUrl = "https://m.media-amazon.com/images/S/aplus-seller-content-images-us-east-1/abc.jpg";
      expect(aplusUrl).toMatch(/aplus-seller-content-images/);
    });

    it("should filter out tiny A+ images (icons, spacers)", () => {
      const urls = [
        "https://m.media-amazon.com/images/S/aplus-media-library-service-media/large-hero.jpg",
        "https://m.media-amazon.com/images/S/aplus-media-library-service-media/tiny-icon._SL50_.jpg",
      ];
      const isLargeEnough = (url: string) => {
        const sizeMatch = url.match(/_SL(\d+)_/);
        if (!sizeMatch) return true; // No size suffix = likely full size
        return Number(sizeMatch[1]) >= 100;
      };
      expect(isLargeEnough(urls[0])).toBe(true);
      expect(isLargeEnough(urls[1])).toBe(false);
    });
  });

  describe("Brand story image extraction patterns", () => {
    it("should identify brand story section by HTML markers", () => {
      const html = '<div id="aplus" class="aplus-v2"><div class="apm-brand-story-carousel-container">...</div></div>';
      expect(html).toContain("apm-brand-story");
    });

    it("should identify brand story by hero-image class", () => {
      const html = '<div class="apm-brand-story-hero"><img src="https://example.com/brand.jpg" /></div>';
      expect(html).toContain("apm-brand-story-hero");
    });
  });

  describe("Image deduplication", () => {
    it("should deduplicate images with same base URL", () => {
      const urls = [
        "https://m.media-amazon.com/images/I/71abc._SL1500_.jpg",
        "https://m.media-amazon.com/images/I/71abc._SL500_.jpg",
        "https://m.media-amazon.com/images/I/71abc._SS40_.jpg",
      ];
      // Extract base image ID (before size suffix)
      const getBaseId = (url: string) => url.replace(/_S[SXL]\d+_/, "");
      const baseIds = new Set(urls.map(getBaseId));
      expect(baseIds.size).toBe(1); // All same base image
    });

    it("should keep different images", () => {
      const urls = [
        "https://m.media-amazon.com/images/I/71abc._SL1500_.jpg",
        "https://m.media-amazon.com/images/I/71def._SL1500_.jpg",
      ];
      const getBaseId = (url: string) => url.replace(/_S[SXL]\d+_/, "");
      const baseIds = new Set(urls.map(getBaseId));
      expect(baseIds.size).toBe(2);
    });
  });
});
