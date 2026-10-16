import { describe, expect, it } from "vitest";
import { competitorStudy, matchesComparisonSelection } from "./competitorStudyModel";

const row = { id: 3, asin: "B000000003", summary: "保存原文", aiSummary: "AI 候选", summaryStatus: "draft", bulletPoints: '["五点原文"]' };
describe("saved competitor research", () => {
  it("prefers the exact saved text, never reconstructs a missing analysis", () => {
    expect(competitorStudy(row)).toMatchObject({ summary: "保存原文", canConfirm: true, bullets: ["五点原文"] });
    expect(competitorStudy({ ...row, summary: null, aiSummary: null })).toMatchObject({ summary: "", canConfirm: false });
  });
  it("labels an AI candidate rather than calling it confirmed saved text", () => {
    expect(competitorStudy({ ...row, summary: null })).toMatchObject({ summary: "AI 候选", summarySource: "AI 候选摘要（未确认）" });
    expect(competitorStudy({ ...row, summary: null, summaryStatus: "confirmed" })).toMatchObject({ inconsistent: true, canConfirm: false, canUnlock: false });
  });
  it.each(["not-json", '{}', '["text",2]'])("does not coerce malformed bullets %s", bulletPoints => {
    expect(competitorStudy({ ...row, bulletPoints })).toMatchObject({ bullets: [], bulletsUnavailable: true });
  });
  it.each([{ id: 0 }, { asin: "bad" }, { summaryStatus: "unknown" }, { summary: "x".repeat(20_001) }])("refuses invalid confirmation identity/state", patch => {
    expect(competitorStudy({ ...row, ...patch }).canConfirm).toBe(false);
  });
  it("unlocks only a known confirmed saved summary", () => {
    expect(competitorStudy({ ...row, summaryStatus: "confirmed" })).toMatchObject({ canConfirm: false, canUnlock: true });
  });
  it.each([{ analysisStale: true }, { captureOnly: true }, { analysisStale: true, captureOnly: true }])("keeps stale/capture-only saved success readable only as historical %j", flags => {
    const study = competitorStudy({ ...row, rawData: JSON.stringify(flags) });
    expect(study).toMatchObject({ summary: row.summary, historical: true, canConfirm: false, summarySource: "历史已保存摘要（非当前资料分析）" });
    expect(competitorStudy({ ...row, summary: null, rawData: JSON.stringify(flags) })).toMatchObject({ summary: row.aiSummary,
      summarySource: "历史 AI 候选摘要（未确认）", historical: true, canConfirm: false });
    expect(competitorStudy({ ...row, summaryStatus: "confirmed", rawData: JSON.stringify(flags) })).toMatchObject({ canUnlock: true, canConfirm: false, historical: true });
  });
  it.each([undefined, null, "", "{}", '{"legacyAnalysis":{"saved":true}}', '{"analysisStale":false,"captureOnly":false}'])("does not require deepAnalysis for ordinary compatible saved records %s", rawData => {
    expect(competitorStudy({ ...row, rawData })).toMatchObject({ historical: false, sourceUnknown: false, canConfirm: true });
  });
  it.each(["bad JSON", "[]", "null", "false", '{"analysisStale":"true"}', '{"captureOnly":1}', '{"captureOnly":null}'])("does not invent fresh/stale or successful job state for malformed source flags %s", rawData => {
    expect(competitorStudy({ ...row, rawData })).toMatchObject({ summary: row.summary, analysisStale: false, captureOnly: false,
      historical: false, sourceUnknown: true, canConfirm: false, summarySource: "已保存摘要（来源状态未核验）" });
    expect(competitorStudy({ ...row, rawData, summaryStatus: "confirmed" }).canUnlock).toBe(true);
  });
  it("does not interpret unknown failure metadata as staleness or a completed analysis", () => {
    expect(competitorStudy({ ...row, rawData: '{"presentationJob":{"status":"failed"},"errorMessage":"unknown"}' }))
      .toMatchObject({ summary: row.summary, analysisStale: false, captureOnly: false, historical: false, sourceUnknown: false });
  });
});
describe("comparison response ownership", () => {
  const report = { projectId: 1, analysisIds: [2, 3], selectionKey: "2-3" };
  it("accepts only the exact project and full selection", () => {
    expect(matchesComparisonSelection(report, 1, [3, 2])).toBe(true);
    for (const value of [null, { ...report, projectId: 2 }, { ...report, analysisIds: [2] }, { ...report, analysisIds: [2, 2] }, { ...report, analysisIds: ["2", 3] }, { ...report, selectionKey: "3-2" }]) {
      expect(matchesComparisonSelection(value, 1, [2, 3])).toBe(false);
    }
  });
  it("retains the existing 2–8 positive unique selection contract", () => {
    for (const ids of [[2], [2, 2], [0, 2], Array.from({ length: 9 }, (_, index) => index + 1)]) {
      expect(matchesComparisonSelection(report, 1, ids)).toBe(false);
    }
  });
});
