import { describe, expect, it } from "vitest";
import { buildCompletedAnalysisUpdate, buildProjectFileAnalysisSummary } from "./routers/projectFileAnalysisState";

describe("project file completed analysis state", () => {
  it("clears a prior failure message when an analysis succeeds", () => {
    expect(buildCompletedAnalysisUpdate({ coreSpecs: [{ attribute: "Voltage", value: "12V" }] })).toEqual({
      analysisResult: JSON.stringify({ coreSpecs: [{ attribute: "Voltage", value: "12V" }] }),
      status: "completed",
      errorMessage: null,
    });
  });
});

describe("newest valid source analysis stays selected", () => {
  const file = (fileType = "product_attributes", value: unknown = { version: 2 }) => ({
    fileType, status: "completed", analysisResult: JSON.stringify(value), lifecycleState: "hot",
  });
  it.each([
    ["product_attributes", "productAttributes"], ["competitor_listings", "competitorListings"],
    ["search_term_report", "cosmoScenes"], ["aba_keywords", "a9Keywords"],
  ])("does not let an older %s file override the newest", (type, key) => {
    expect(buildProjectFileAnalysisSummary([file(type), file(type, { version: 1 })])[key]).toEqual({ version: 2 });
  });
  it.each([
    { analysisResult: "{" }, { analysisResult: "null" }, { analysisResult: "false" },
    { status: "failed" }, { lifecycleState: "deleted" }, { analysisResult: null },
  ])("skips an invalid/unavailable new source %j", patch => {
    expect(buildProjectFileAnalysisSummary([{ ...file(), ...patch }, file("product_attributes", { version: 1 })]).productAttributes).toEqual({ version: 1 });
  });
  it("retains N3 readiness, count and legacy hasAllFiles semantics", () => {
    expect(buildProjectFileAnalysisSummary([])).toMatchObject({ n3Ready: false, hasAllFiles: false, fileCount: 0 });
    expect(buildProjectFileAnalysisSummary([file()])).toMatchObject({ n3Ready: true, hasAllFiles: true, fileCount: 1 });
  });
});
