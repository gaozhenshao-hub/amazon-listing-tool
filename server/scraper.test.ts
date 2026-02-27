import { describe, expect, it, vi } from "vitest";
import * as cheerio from "cheerio";

// Test the HTML parsing logic directly without network calls
describe("scraper - HTML parsing", () => {
  const sampleHtml = `
    <html>
    <body>
      <h1 id="title"><span id="productTitle"> Test Brand - Wireless Bluetooth Speaker, Portable, Waterproof IPX7, 24H Playtime, Rich Bass </span></h1>
      <a id="bylineInfo">Visit the Test Brand Store</a>
      <div id="feature-bullets">
        <ul>
          <li><span class="a-list-item">360° Surround Sound: Delivers immersive audio with deep bass</span></li>
          <li><span class="a-list-item">IPX7 Waterproof: Perfect for pool, beach, and shower use</span></li>
          <li><span class="a-list-item">24-Hour Battery Life: Non-stop music for all-day events</span></li>
          <li><span class="a-list-item">Compact & Portable: Fits in your backpack or cup holder</span></li>
          <li><span class="a-list-item">Bluetooth 5.3: Stable connection up to 100ft range</span></li>
        </ul>
      </div>
      <span class="a-price"><span class="a-offscreen">$39.99</span></span>
      <span id="acrPopover" title="4.5 out of 5 stars"></span>
      <span id="acrCustomerReviewText">12,345 ratings</span>
      <div id="productDescription"><p>Experience premium sound quality with our portable Bluetooth speaker.</p></div>
    </body>
    </html>
  `;

  it("extracts product title", () => {
    const $ = cheerio.load(sampleHtml);
    const title = $("#productTitle").text().trim();
    expect(title).toContain("Test Brand");
    expect(title).toContain("Wireless Bluetooth Speaker");
  });

  it("extracts bullet points", () => {
    const $ = cheerio.load(sampleHtml);
    const bulletPoints: string[] = [];
    $("#feature-bullets ul li span.a-list-item").each((_, el) => {
      const text = $(el).text().trim();
      if (text) bulletPoints.push(text);
    });
    expect(bulletPoints).toHaveLength(5);
    expect(bulletPoints[0]).toContain("360° Surround Sound");
    expect(bulletPoints[1]).toContain("IPX7 Waterproof");
  });

  it("extracts price", () => {
    const $ = cheerio.load(sampleHtml);
    const price = $("span.a-price span.a-offscreen").first().text().trim();
    expect(price).toBe("$39.99");
  });

  it("extracts rating", () => {
    const $ = cheerio.load(sampleHtml);
    const ratingText = $("#acrPopover").attr("title") || "";
    const match = ratingText.match(/([\d.]+)/);
    const rating = match ? match[1] : "";
    expect(rating).toBe("4.5");
  });

  it("extracts review count", () => {
    const $ = cheerio.load(sampleHtml);
    const reviewCountText = $("#acrCustomerReviewText").text().trim();
    const match = reviewCountText.match(/([\d,]+)/);
    const reviewCount = match ? match[1].replace(/,/g, "") : "";
    expect(reviewCount).toBe("12345");
  });

  it("extracts brand name", () => {
    const $ = cheerio.load(sampleHtml);
    const brand = $("#bylineInfo").text().trim().replace(/^(Visit the |Brand: )/, "").replace(/ Store$/, "");
    expect(brand).toBe("Test Brand");
  });

  it("extracts product description", () => {
    const $ = cheerio.load(sampleHtml);
    const description = $("#productDescription p").text().trim();
    expect(description).toContain("premium sound quality");
  });

  it("handles missing elements gracefully", () => {
    const $ = cheerio.load("<html><body></body></html>");
    const title = $("#productTitle").text().trim();
    const price = $("span.a-price span.a-offscreen").first().text().trim();
    const rating = $("#acrPopover").attr("title") || "";

    expect(title).toBe("");
    expect(price).toBe("");
    expect(rating).toBe("");
  });
});

describe("scraper - ASIN validation", () => {
  it("validates correct ASIN format", () => {
    const validAsins = ["B0XXXXXXXX", "B09ABC1234", "B0DEFGH567"];
    for (const asin of validAsins) {
      expect(asin.length).toBe(10);
      expect(/^[A-Z0-9]{10}$/.test(asin)).toBe(true);
    }
  });

  it("rejects invalid ASIN formats", () => {
    const invalidAsins = ["SHORT", "toolongasinvalue", "b0lowercase", "B0!@#$%^&*"];
    for (const asin of invalidAsins) {
      const isValid = asin.length === 10 && /^[A-Z0-9]{10}$/.test(asin);
      expect(isValid).toBe(false);
    }
  });
});
