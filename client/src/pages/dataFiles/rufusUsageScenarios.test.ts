import { describe, expect, it } from "vitest";
import { getRufusUsageScenarios } from "./rufusUsageScenarios";

describe("Rufus usage scenario presentation", () => {
  it("keeps parsed scenarios available for review", () => {
    expect(getRufusUsageScenarios([
      { scenario: "GE洗衣机特定型号", detail: "用于兼容型号的控制板维修或替换。" },
    ])).toEqual([
      { scenario: "GE洗衣机特定型号", detail: "用于兼容型号的控制板维修或替换。" },
    ]);
  });

  it("filters empty scenario placeholders", () => {
    expect(getRufusUsageScenarios([{ scenario: " ", detail: "" }])).toEqual([]);
  });
});
