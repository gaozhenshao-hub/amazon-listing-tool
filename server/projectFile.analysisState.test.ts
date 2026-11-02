import { describe, expect, it } from "vitest";
import { buildCompletedAnalysisUpdate } from "./routers/projectFileAnalysisState";

describe("project file completed analysis state", () => {
  it("clears a prior failure message when an analysis succeeds", () => {
    expect(buildCompletedAnalysisUpdate({ coreSpecs: [{ attribute: "Voltage", value: "12V" }] })).toEqual({
      analysisResult: JSON.stringify({ coreSpecs: [{ attribute: "Voltage", value: "12V" }] }),
      status: "completed",
      errorMessage: null,
    });
  });
});
