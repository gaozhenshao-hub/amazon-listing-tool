import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../../..");

describe("legacy Amazon crawler retirement", () => {
  it("removes the retired HTML scraper, crawler engine and anti-bot implementation files", () => {
    expect(existsSync(join(root, "server/scraper.ts"))).toBe(false);
    expect(existsSync(join(root, "server/crawlerEngine.ts"))).toBe(false);
    expect(existsSync(join(root, "server/antiBot.ts"))).toBe(false);
    expect(existsSync(join(root, "server/scraper.test.ts"))).toBe(false);
  });

  it("keeps runtime routes on Provider Jobs and Heartbeat without legacy fallbacks", () => {
    const files = [
      "server/routers/crawler.ts",
      "server/routers/kbImages.ts",
      "server/routers/kbListings.ts",
      "server/routers/kbProducts.ts",
      "server/routers/analysis.ts",
      "server/routers/conversionDataCollector.ts",
      "server/routers/systemSettings.ts",
    ];
    for (const relative of files) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source).not.toMatch(/from ["'][^"']*(?:scraper|crawlerEngine|antiBot)["']/);
      expect(source).not.toMatch(/import\(["'][^"']*(?:scraper|crawlerEngine|antiBot)["']/);
      expect(source).not.toMatch(/\bscrapeAmazonProduct\s*\(/);
    }
    const route = readFileSync(join(root, "server/routers/crawler.ts"), "utf8");
    expect(route).toContain("startAmazonMonitorJob");
    expect(route).toContain("createHeartbeatJob");
    expect(route).not.toContain("setInterval(");
    const settings = readFileSync(join(root, "server/routers/systemSettings.ts"), "utf8");
    expect(settings).toContain("retiredFeatureError");
    expect(settings).toContain("crawler.getProviderReadiness");
    expect(settings).toContain("旧内嵌Amazon爬虫配置");
  });
});
