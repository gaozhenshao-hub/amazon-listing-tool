import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SellingPointSourceEvidence } from "./SellingPointSourceEvidence";
import { resolveSellingPointSourceEvidence } from "./sellingPointSourceEvidenceModel";

const original = "  Easy setup\nWith original dimensions.  ";
const analysis = { id: 12, asin: "B012345678", bulletPoints: ["First bullet", original] };
const point = { analysisId: 12, asin: "B012345678", bulletIndex: 1, text: original };

describe("selling point source evidence", () => {
  it("resolves the exact saved bullet with a one-based display number, preserving whitespace", () => {
    expect(resolveSellingPointSourceEvidence(point, analysis)).toEqual({
      status: "available", asin: analysis.asin, bulletNumber: 2,
      sourceText: original, comparisonDiffers: false,
    });
  });

  it("uses the saved source rather than an edited comparison text", () => {
    expect(resolveSellingPointSourceEvidence({ ...point, text: "Edited marketing copy" }, analysis)).toMatchObject({
      status: "available", sourceText: original, comparisonDiffers: true,
    });
  });

  it("resolves the first bullet without treating index zero as absent", () => {
    expect(resolveSellingPointSourceEvidence({ ...point, bulletIndex: 0, text: "First bullet" }, analysis)).toMatchObject({
      status: "available", bulletNumber: 1, sourceText: "First bullet", comparisonDiffers: false,
    });
  });

  it.each(["", original.trim(), original.toUpperCase()])("marks exact-text differences without normalizing (%j)", (text) => {
    expect(resolveSellingPointSourceEvidence({ ...point, text }, analysis)).toMatchObject({
      status: "available", sourceText: original, comparisonDiffers: true,
    });
  });

  it.each([null, undefined, [], "source"])("rejects a missing or malformed reference (%j)", (value) => {
    expect(resolveSellingPointSourceEvidence(value, analysis).status).toBe("unavailable");
    expect(resolveSellingPointSourceEvidence(point, value).status).toBe("unavailable");
  });

  it.each([
    { analysisId: 13 }, { analysisId: "12" }, { analysisId: 0 },
    { analysisId: Number.NaN }, { analysisId: Number.MAX_SAFE_INTEGER + 1 },
    { asin: "B999999999" }, { asin: "b012345678" }, { asin: "B012345678 " }, { asin: "" },
  ])("does not guess or coerce a competitor identity (%j)", (change) => {
    expect(resolveSellingPointSourceEvidence({ ...point, ...change }, analysis)).toEqual({
      status: "unavailable", reason: "identity-mismatch",
    });
  });

  it.each([-1, 0.5, "1", Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects an invalid index (%j)", (bulletIndex) => {
    expect(resolveSellingPointSourceEvidence({ ...point, bulletIndex }, analysis)).toEqual({
      status: "unavailable", reason: "invalid-index",
    });
  });

  it.each([null, "[\"First bullet\"]", [], ["First bullet"], ["First bullet", ""],
    ["First bullet", " \n"], ["First bullet", 3], ["First bullet", null], new Array(2)].map((bulletPoints) => ({ bulletPoints })))(
    "rejects missing, out-of-range or non-text saved bullets without falling back to point.text (%j)",
    ({ bulletPoints }) => {
      const result = resolveSellingPointSourceEvidence(point, { ...analysis, bulletPoints });
      expect(result).toEqual({ status: "unavailable", reason: "missing-source" });
      expect(result).not.toHaveProperty("sourceText");
    },
  );

  it("does not search other bullets for a match when the supplied index is stale", () => {
    expect(resolveSellingPointSourceEvidence({ ...point, bulletIndex: 5 }, analysis).status).toBe("unavailable");
  });

  it("rejects malformed comparison text without converting it to a source", () => {
    expect(resolveSellingPointSourceEvidence({ ...point, text: null }, analysis)).toEqual({
      status: "unavailable", reason: "invalid-comparison-text",
    });
  });

  it("does not mutate the supplied report or analysis", () => {
    const frozenAnalysis = Object.freeze({ ...analysis, bulletPoints: Object.freeze([...analysis.bulletPoints]) });
    expect(resolveSellingPointSourceEvidence(Object.freeze(point), frozenAnalysis).status).toBe("available");
    expect(frozenAnalysis.bulletPoints[1]).toBe(original);
  });
});

describe("SellingPointSourceEvidence rendering", () => {
  it("renders a closed native disclosure with ASIN, source position and the current-value limitation", () => {
    const html = renderToStaticMarkup(<SellingPointSourceEvidence point={point} analysis={analysis} />);
    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
    expect(html).toContain(`当前保存的五点原文 · ${analysis.asin} · 第 2 条`);
    expect(html).toContain(original);
    expect(html).toContain("不代表报告生成时的历史版本已核验");
    expect(html).not.toContain("对比文本与当前保存原文不同");
  });

  it("shows a difference notice but never presents the edited text as the quotation", () => {
    const html = renderToStaticMarkup(<SellingPointSourceEvidence point={{ ...point, text: "Not a source quote" }} analysis={analysis} />);
    expect(html).toContain("对比文本与当前保存原文不同");
    expect(html).toContain("可能经过人工调整或原文更新");
    expect(html).not.toContain("Not a source quote");
    expect(html).toContain(original);
  });

  it("keeps markup in the saved source as React text rather than executable HTML", () => {
    const sourceText = '<script>alert("source")</script><img src=x onerror=alert(1)>';
    const html = renderToStaticMarkup(<SellingPointSourceEvidence
      point={{ ...point, text: sourceText }} analysis={{ ...analysis, bulletPoints: ["First", sourceText] }}
    />);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });

  it.each([null, { ...analysis, id: 13 }, { ...analysis, bulletPoints: [] }])(
    "shows only the unavailable state rather than leaking an unverified quote",
    (source) => {
      const html = renderToStaticMarkup(<SellingPointSourceEvidence point={point} analysis={source} />);
      expect(html).toContain("来源暂无法核对");
      expect(html).not.toContain("<details");
      expect(html).not.toContain("<blockquote");
      expect(html).not.toContain(original);
    },
  );
});
