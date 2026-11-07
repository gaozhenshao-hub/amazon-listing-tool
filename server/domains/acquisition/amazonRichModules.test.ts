import { describe, it, expect } from "vitest";
import { parseAmazonImageLayout } from "./amazonImageLayout";
import { AMAZON_MODULE_CATALOG } from "../../../shared/amazonModuleCatalog";
import {
  richTextSources,
  brandBackgroundHashes,
} from "../../../shared/richContentPresentation";
const image = (name: string) =>
  `<img src="https://m.media-amazon.com/images/I/${name}.jpg">`;
describe("complete A+ content capture", () => {
  it("does not collect inline carousel controls or translate them as product copy", () => {
    const {layout}=parseAmazonImageLayout('<div id="aplus"><div class="aplus-module" data-module-type="STANDARD_TEXT"><h2>Material</h2><p>Durable <span><span>Previous page</span></span>fabric.</p><span class="a-carousel-goto-nextpage">Next page</span><button>Can it be washed?</button><p>Hand wash.</p><p>Next page shows measurements.</p></div></div>');
    const texts=richTextSources(layout).map(t=>t.text);
    expect(texts).toContain('Durable fabric.');expect(texts).toContain('Can it be washed?');expect(texts).toContain('Hand wash.');expect(texts).toContain('Next page shows measurements.');
    expect(texts).not.toContain('Previous page');expect(texts).not.toContain('Next page');
  });
  it("retains every paragraph of a text-only OUR STORY module, including inline text and lists", () => {
    const html =
      '<div id="aplus"><section class="aplus-module" data-module-type="STANDARD_TEXT"><h2>OUR STORY</h2><p>Our first <strong>paragraph</strong>.</p><p>Our second paragraph.</p><p>Our third paragraph.</p><ul><li>First point</li><li>Second point</li></ul></section></div>';
    const { layout } = parseAmazonImageLayout(html),
      m = layout.modules[0];
    expect(m.kind).toBe("text");
    expect(m.cards[0].text).toBe(
      "Our first paragraph.\n\nOur second paragraph.\n\nOur third paragraph.\n\nFirst point\n\nSecond point"
    );
    expect(richTextSources(layout).map(b => b.text)).toEqual([
      "OUR STORY",
      "Our first paragraph.",
      "Our second paragraph.",
      "Our third paragraph.",
      "First point",
      "Second point",
    ]);
  });
  it("preserves collapsed FAQ answers and all answer paragraphs without requiring images", () => {
    const { layout } = parseAmazonImageLayout(
      '<div id="aplus"><div class="aplus-module" data-module-type="PREMIUM_FAQ"><h2>Questions</h2><h3>Can it be washed?</h3><div class="a-hidden"><p>Hand wash.</p><p>Air dry.</p></div><h3>What is included?</h3><p>Suit and gloves.</p></div></div>'
    );
    const m = layout.modules[0];
    expect(m.kind).toBe("faq");
    expect(m.questions).toHaveLength(2);
    expect(m.questions?.[0].answer.text).toBe("Hand wash.\n\nAir dry.");
    expect(
      richTextSources(layout)
        .map(b => b.text)
        .join("\n")
    ).toContain("Air dry.");
  });
  it("keeps text-only technical specifications and translates individual table cells", () => {
    const { layout } = parseAmazonImageLayout(
      '<div id="aplus"><div class="aplus-module" data-module-type="STANDARD_TECH_SPECS"><h2>Specifications</h2><table><tr><th>Weight</th><td>220 gsm</td></tr><tr><th>Material</th><td>65% cotton</td></tr></table></div></div>'
    );
    expect(layout.modules[0].rows).toMatchObject([
      { label: "Weight", cells: ["220 gsm"] },
      { label: "Material", cells: ["65% cotton"] },
    ]);
    expect(richTextSources(layout).map(b => b.text)).toEqual([
      "Specifications",
      "Weight",
      "220 gsm",
      "Material",
      "65% cotton",
    ]);
  });
  it("retains inactive carousel pages, text-only slides and all their text", () => {
    const { layout, urls } = parseAmazonImageLayout(
      `<div id="aplus"><div class="aplus-module" data-module-type="PREMIUM_NAVIGATION_CAROUSEL"><div class="a-carousel-card">${image("one")}<p>Page one.</p></div><div class="a-carousel-card a-hidden">${image("two")}<p>Page two.</p></div><div class="a-carousel-card"><h3>Text page</h3><p>All words.</p></div></div></div>`
    );
    expect(layout.modules[0].cards).toHaveLength(3);
    expect(urls.aplus).toHaveLength(2);
    expect(richTextSources(layout).map(b => b.text)).toContain("All words.");
  });
  it("preserves an unknown future module with all text instead of discarding it", () => {
    const { layout } = parseAmazonImageLayout(
      '<div id="aplus"><div class="aplus-module" data-module-type="FUTURE_3D_STORY"><h2>Future heading</h2><p>First paragraph.</p><p>Second paragraph.</p></div></div>'
    );
    expect(layout.modules[0].kind).toBe("unknown");
    expect(layout.modules[0].warnings?.length).toBe(1);
    expect(richTextSources(layout).map(b => b.text)).toContain(
      "Second paragraph."
    );
  });
  it("excludes brand background copy but retains text-only brand cards and questions", () => {
    const { layout } = parseAmazonImageLayout(
      `<div id="aplusBrandStory_feature_div"><div class="apm-brand-story-background">${image("background")}<h2>Background words</h2></div><div class="a-carousel-card"><h3>Our mission</h3><p>Better tools.</p><p>Better service.</p></div><div class="a-carousel-card"><h3>Why us?</h3><p>Quality.</p></div></div>`
    );
    expect(layout.modules[0].cards).toHaveLength(2);
    expect(brandBackgroundHashes(layout).size).toBe(1);
    expect(richTextSources(layout).map(b => b.text)).toEqual([
      "Our mission",
      "Better tools.",
      "Better service.",
      "Why us?",
      "Quality.",
    ]);
  });
  it.each(
    Object.keys(AMAZON_MODULE_CATALOG).filter(t => !t.startsWith("BRAND_"))
  )(
    "recognizes the published %s family without throwing away its content",
    type => {
      const { layout } = parseAmazonImageLayout(
        `<div id="aplus"><div class="aplus-module" data-module-type="${type}">${image("example")}<h2>Headline</h2><p>Retained source text.</p></div></div>`
      );
      expect(layout.modules[0].sourceType).toBe(type);
      expect(JSON.stringify(layout)).toContain("Retained source text.");
    }
  );
  it.each([
    [
      "celwidget aplus-module premium-module-15-text aplus-premium",
      "PREMIUM_TEXT",
    ],
    [
      "celwidget aplus-module premium-module-8-hero-video aplus-premium",
      "PREMIUM_HERO_VIDEO",
    ],
    [
      "celwidget aplus-module premium-module-1-image-text aplus-premium",
      "PREMIUM_IMAGE_TEXT",
    ],
    [
      "celwidget aplus-module 3p-module-b aplus-standard",
      "STANDARD_HEADER_IMAGE_TEXT",
    ],
  ])(
    "recognizes real page class %s without an API-style module attribute",
    (classes, type) => {
      const { layout } = parseAmazonImageLayout(
        `<div id="aplus"><div class="${classes}">${image("source")}<p>All source words.</p></div></div>`
      );
      expect(layout.modules[0].sourceType).toBe(type);
      expect(
        richTextSources(layout).some(t => t.text === "All source words.")
      ).toBe(true);
    }
  );
  it("uses descendant layout classes for Basic sidebars and does not mistake image specs for a text-only table", () => {
    const { layout } = parseAmazonImageLayout(
      `<div id="aplus"><div class="aplus-module legacy"><div class="apm-lefttwothirdswrap">${image("large")}<p>Main body.</p></div><div class="apm-rightthirdcol">${image("sidebar")}<p>Sidebar body.</p></div></div><div class="aplus-module legacy"><div class="apm-leftimage">${image("spec")}</div><div class="apm-sic-detail-specifications"><h3>Details</h3><p>Every specification.</p></div></div></div>`
    );
    expect(layout.modules[0]).toMatchObject({
      sourceType: "STANDARD_IMAGE_SIDEBAR",
      kind: "grid",
    });
    expect(layout.modules[0].cards).toHaveLength(2);
    expect(layout.modules[1]).toMatchObject({
      sourceType: "STANDARD_SINGLE_IMAGE_SPECS_DETAIL",
      kind: "image",
    });
    expect(richTextSources(layout).map(t => t.text)).toContain(
      "Every specification."
    );
  });
});
